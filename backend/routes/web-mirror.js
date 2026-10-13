const express = require("express");

const WEB_MIRROR_UPSTREAM = "https://your-project-1.vercel.app";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const EXACT_PUBLIC_PATHS = new Set([
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/sw.js",
    "/app-icon.svg",
    "/app-icon-192.png",
    "/app-icon-512.png",
    "/apple-touch-icon.png",
    "/favicon.ico"
]);
const STATIC_PREFIX = "/web";
const STATIC_PATH_PATTERN = /^\/(?:assets|fonts)\/[a-zA-Z0-9._/-]+$/;
const PUBLIC_ROOT_PATTERN =
    /(["'`])\/(assets\/[a-zA-Z0-9._/-]+|fonts\/[a-zA-Z0-9._/-]+|manifest\.webmanifest|sw\.js|app-icon(?:-\d+)?\.(?:svg|png)|apple-touch-icon\.png|favicon\.ico)\1/g;

function createHttpError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function safeRequestPath(rawPath) {
    const value = String(rawPath || "/").split("?", 1)[0] || "/";
    if (/%(?:00|2e|2f|5c)/i.test(value) || value.includes("\\")) {
        return null;
    }

    let decoded;
    try {
        decoded = decodeURIComponent(value);
    } catch {
        return null;
    }
    if (
        decoded.split("/").some((segment) => segment === "..") ||
        decoded.includes("\0")
    ) {
        return null;
    }
    if (EXACT_PUBLIC_PATHS.has(decoded)) {
        return decoded;
    }
    if (
        STATIC_PATH_PATTERN.test(decoded) &&
        !decoded.split("/").some((segment) => segment === ".")
    ) {
        return decoded;
    }
    return null;
}

function prefixPublicPaths(text) {
    return String(text).replace(
        PUBLIC_ROOT_PATTERN,
        (match, quote, publicPath) =>
            `${quote}${STATIC_PREFIX}/${publicPath}${quote}`
    );
}

function rewriteHtml(text) {
    return prefixPublicPaths(text);
}

function rewriteManifest(text) {
    let manifest;
    try {
        manifest = JSON.parse(text);
    } catch {
        throw createHttpError(
            502,
            "WEB_MIRROR_UPSTREAM_INVALID",
            "网页镜像上游返回了无效的应用清单。"
        );
    }
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw createHttpError(
            502,
            "WEB_MIRROR_UPSTREAM_INVALID",
            "网页镜像上游返回了无效的应用清单。"
        );
    }

    manifest.id = `${STATIC_PREFIX}/`;
    manifest.start_url = `${STATIC_PREFIX}/`;
    manifest.scope = `${STATIC_PREFIX}/`;
    manifest.icons = Array.isArray(manifest.icons)
        ? manifest.icons.map((icon) => ({
              ...icon,
              src:
                  typeof icon?.src === "string" && icon.src.startsWith("/")
                      ? `${STATIC_PREFIX}${icon.src}`
                      : icon?.src
          }))
        : manifest.icons;
    return JSON.stringify(manifest);
}

function rewriteServiceWorker(text) {
    return prefixPublicPaths(text).replace(
        /(["'`])\/\1/g,
        (match, quote) => `${quote}${STATIC_PREFIX}/${quote}`
    );
}

function rewriteTextBody(pathname, contentType, body) {
    if (pathname === "/manifest.webmanifest") {
        return Buffer.from(rewriteManifest(body.toString("utf8")));
    }
    if (pathname === "/sw.js") {
        return Buffer.from(rewriteServiceWorker(body.toString("utf8")));
    }
    if (/^text\/html\b/i.test(contentType)) {
        return Buffer.from(rewriteHtml(body.toString("utf8")));
    }
    if (
        /(?:javascript|ecmascript|text\/css)/i.test(contentType) ||
        /\.(?:m?js|css)$/i.test(pathname)
    ) {
        return Buffer.from(prefixPublicPaths(body.toString("utf8")));
    }
    return body;
}

async function readBoundedBody(response, maxResponseBytes) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxResponseBytes
    ) {
        throw createHttpError(
            502,
            "WEB_MIRROR_UPSTREAM_TOO_LARGE",
            "网页镜像上游响应超过允许大小。"
        );
    }
    if (!response.body) {
        return Buffer.alloc(0);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxResponseBytes) {
            await reader.cancel().catch(() => {});
            throw createHttpError(
                502,
                "WEB_MIRROR_UPSTREAM_TOO_LARGE",
                "网页镜像上游响应超过允许大小。"
            );
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
}

function copyPublicResponseHeaders(response, res, { rewritten }) {
    for (const name of ["content-type", "cache-control"]) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
    }
    if (!rewritten) {
        for (const name of ["etag", "last-modified"]) {
            const value = response.headers.get(name);
            if (value) res.setHeader(name, value);
        }
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
}

function createMirrorMiddleware({
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    staticMount = ""
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new TypeError("web mirror requires fetch");
    }

    const normalizedTimeoutMs = Math.max(100, Number(timeoutMs) || 0);
    const normalizedMaxBytes = Math.max(
        1024,
        Number(maxResponseBytes) || 0
    );

    return async function webMirror(req, res, next) {
        if (!["GET", "HEAD"].includes(req.method)) {
            res.setHeader("Allow", "GET, HEAD");
            res.status(405).json({
                code: "WEB_MIRROR_METHOD_NOT_ALLOWED",
                message: "网页镜像只接受 GET 或 HEAD 请求。"
            });
            return;
        }

        const mountedPath = String(req.url || "/").split("?", 1)[0];
        const candidatePath = staticMount
            ? `${staticMount}${mountedPath === "/" ? "" : mountedPath}`
            : mountedPath;
        const pathname = safeRequestPath(candidatePath);
        if (!pathname) {
            res.status(404).json({
                code: "WEB_MIRROR_PATH_NOT_FOUND",
                message: "网页镜像中没有这个资源。"
            });
            return;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);
        timer.unref?.();
        let upstreamResponse;
        try {
            upstreamResponse = await fetchImpl(
                new URL(pathname, WEB_MIRROR_UPSTREAM),
                {
                    method: req.method,
                    redirect: "error",
                    signal: controller.signal,
                    headers: {
                        Accept: req.get("accept") || "*/*",
                        "User-Agent": "DengTa-Web-Mirror/1.0"
                    }
                }
            );
        } catch (error) {
            clearTimeout(timer);
            if (error?.name === "AbortError" || controller.signal.aborted) {
                next(
                    createHttpError(
                        504,
                        "WEB_MIRROR_UPSTREAM_TIMEOUT",
                        "网页镜像上游连接超时，请稍后重试。"
                    )
                );
                return;
            }
            next(
                createHttpError(
                    502,
                    "WEB_MIRROR_UPSTREAM_UNAVAILABLE",
                    "网页镜像上游暂时不可用，请稍后重试。"
                )
            );
            return;
        }

        try {
            const contentType =
                upstreamResponse.headers.get("content-type") ||
                "application/octet-stream";
            const rewritable =
                pathname === "/manifest.webmanifest" ||
                pathname === "/sw.js" ||
                /^text\/html\b/i.test(contentType) ||
                /(?:javascript|ecmascript|text\/css)/i.test(contentType) ||
                /\.(?:m?js|css)$/i.test(pathname);
            if (req.method === "HEAD") {
                copyPublicResponseHeaders(upstreamResponse, res, {
                    rewritten: rewritable
                });
                res.status(upstreamResponse.status);
                res.end();
                return;
            }
            const upstreamBody = await readBoundedBody(
                upstreamResponse,
                normalizedMaxBytes
            );
            const body = rewriteTextBody(
                pathname,
                contentType,
                upstreamBody
            );
            copyPublicResponseHeaders(upstreamResponse, res, {
                rewritten: rewritable
            });
            res.status(upstreamResponse.status);
            res.send(body);
        } catch (error) {
            if (error?.name === "AbortError" || controller.signal.aborted) {
                next(
                    createHttpError(
                        504,
                        "WEB_MIRROR_UPSTREAM_TIMEOUT",
                        "网页镜像上游连接超时，请稍后重试。"
                    )
                );
            } else {
                next(error);
            }
        } finally {
            clearTimeout(timer);
        }
    };
}

function createWebMirrorRouter(options = {}) {
    const router = express.Router();
    router.use(createMirrorMiddleware(options));
    router.use(webMirrorErrorHandler);
    return router;
}

function createWebMirrorAssetRouter(options = {}) {
    const router = express.Router();
    router.use(createMirrorMiddleware({ ...options, staticMount: "/assets" }));
    router.use(webMirrorErrorHandler);
    return router;
}

function createWebMirrorFontRouter(options = {}) {
    const router = express.Router();
    router.use(createMirrorMiddleware({ ...options, staticMount: "/fonts" }));
    router.use(webMirrorErrorHandler);
    return router;
}

function webMirrorErrorHandler(error, req, res, next) {
    void req;
    void next;
    const status = Number(error?.status) || 502;
    const code = /^WEB_MIRROR_[A-Z0-9_]+$/.test(String(error?.code || ""))
        ? error.code
        : "WEB_MIRROR_ERROR";
    res.status(status).json({
        code,
        message:
            status >= 500
                ? "网页入口暂时不可用，请稍后重试。"
                : String(error?.message || "网页入口请求失败。")
    });
}

module.exports = {
    WEB_MIRROR_UPSTREAM,
    createWebMirrorAssetRouter,
    createWebMirrorFontRouter,
    createWebMirrorRouter,
    prefixPublicPaths,
    rewriteManifest,
    safeRequestPath
};

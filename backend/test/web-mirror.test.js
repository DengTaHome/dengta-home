const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const {
    createWebMirrorAssetRouter,
    createWebMirrorFontRouter,
    createWebMirrorRouter,
    prefixPublicPaths,
    rewriteManifest,
    safeRequestPath
} = require("../routes/web-mirror");

const upstreamHtml = `<!doctype html>
<html><head>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/app-icon.svg">
<script type="module" src="/assets/index.js"></script>
</head><body><div id="root"></div></body></html>`;

function responseFor(url, options) {
    const path = new URL(url).pathname;
    if (path === "/") {
        return new Response(options.method === "HEAD" ? null : upstreamHtml, {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "public, max-age=0, must-revalidate"
            }
        });
    }
    if (path === "/manifest.webmanifest") {
        return new Response(
            JSON.stringify({
                name: "DengTa home",
                id: "/",
                start_url: "/",
                scope: "/",
                icons: [{ src: "/app-icon-192.png", sizes: "192x192" }]
            }),
            {
                headers: {
                    "Content-Type": "application/manifest+json; charset=utf-8",
                    "Cache-Control": "public, max-age=0"
                }
            }
        );
    }
    if (path === "/sw.js") {
        return new Response(
            'const APP_SHELL=["/","/manifest.webmanifest","/app-icon.svg"]; caches.match("/");',
            {
                headers: {
                    "Content-Type": "application/javascript; charset=utf-8",
                    "Cache-Control": "public, max-age=0"
                }
            }
        );
    }
    if (path === "/assets/index.js") {
        return new Response(
            'navigator.serviceWorker.register("/sw.js"); import("/assets/lazy.js");',
            {
                headers: {
                    "Content-Type": "application/javascript; charset=utf-8",
                    "Cache-Control": "public, max-age=31536000, immutable",
                    ETag: '"upstream-etag"'
                }
            }
        );
    }
    if (path === "/assets/lazy.js") {
        return new Response("export default 42;", {
            headers: { "Content-Type": "application/javascript" }
        });
    }
    if (path === "/fonts/test.woff2") {
        return new Response("font-data", {
            headers: { "Content-Type": "font/woff2" }
        });
    }
    if (path === "/app-icon.svg") {
        return new Response("<svg></svg>", {
            headers: {
                "Content-Type": "image/svg+xml",
                "Cache-Control": "public, max-age=3600"
            }
        });
    }
    return new Response("not found", { status: 404 });
}

async function withServer(fetchImpl, run, options = {}) {
    const app = express();
    app.get("/", (req, res) => res.json({ ok: true, root: true }));
    app.get("/health", (req, res) => res.json({ ok: true, health: true }));
    app.use(
        "/web",
        createWebMirrorRouter({ fetchImpl, ...options })
    );
    app.use(
        "/assets",
        createWebMirrorAssetRouter({ fetchImpl, ...options })
    );
    app.use(
        "/fonts",
        createWebMirrorFontRouter({ fetchImpl, ...options })
    );
    app.use((error, req, res, next) => {
        void next;
        res.status(error.status || 500).json({
            code: error.code || "TEST_ERROR",
            message: error.message
        });
    });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

async function testPublicMirrorContract() {
    const calls = [];
    await withServer(
        async (url, options) => {
            calls.push({ url: String(url), method: options.method });
            return responseFor(url, options);
        },
        async (baseUrl) => {
            const rootBefore = await fetch(`${baseUrl}/`);
            assert.deepEqual(await rootBefore.json(), { ok: true, root: true });
            const healthBefore = await fetch(`${baseUrl}/health`);
            assert.deepEqual(await healthBefore.json(), {
                ok: true,
                health: true
            });

            const htmlResponse = await fetch(`${baseUrl}/web/`);
            assert.equal(htmlResponse.status, 200);
            assert.match(htmlResponse.headers.get("content-type"), /^text\/html/);
            assert.equal(
                htmlResponse.headers.get("cache-control"),
                "public, max-age=0, must-revalidate"
            );
            const html = await htmlResponse.text();
            assert.match(html, /href="\/web\/manifest\.webmanifest"/);
            assert.match(html, /href="\/web\/app-icon\.svg"/);
            assert.match(html, /src="\/web\/assets\/index\.js"/);
            assert.doesNotMatch(html, /(?:href|src)="\/(?:assets|manifest|app-icon)/);

            const manifestResponse = await fetch(
                `${baseUrl}/web/manifest.webmanifest`
            );
            const manifest = await manifestResponse.json();
            assert.equal(manifest.id, "/web/");
            assert.equal(manifest.start_url, "/web/");
            assert.equal(manifest.scope, "/web/");
            assert.equal(manifest.icons[0].src, "/web/app-icon-192.png");

            const swResponse = await fetch(`${baseUrl}/web/sw.js`);
            const sw = await swResponse.text();
            assert.match(sw, /"\/web\/"/);
            assert.match(sw, /"\/web\/manifest\.webmanifest"/);
            assert.match(sw, /"\/web\/app-icon\.svg"/);
            assert.doesNotMatch(sw, /caches\.match\("\/"\)/);

            const entryResponse = await fetch(
                `${baseUrl}/web/assets/index.js`,
                {
                    headers: {
                        Origin: "https://your-project-4.onrender.com"
                    }
                }
            );
            assert.equal(
                entryResponse.headers.get("cache-control"),
                "public, max-age=31536000, immutable"
            );
            const entry = await entryResponse.text();
            assert.match(entry, /register\("\/web\/sw\.js"\)/);
            assert.match(entry, /import\("\/web\/assets\/lazy\.js"\)/);
            assert.notEqual(entryResponse.headers.get("etag"), '"upstream-etag"');

            const rootAssetResponse = await fetch(
                `${baseUrl}/assets/lazy.js`
            );
            assert.equal(rootAssetResponse.status, 200);
            assert.equal(await rootAssetResponse.text(), "export default 42;");

            const fontResponse = await fetch(
                `${baseUrl}/web/fonts/test.woff2`
            );
            assert.equal(fontResponse.status, 200);
            assert.equal(fontResponse.headers.get("content-type"), "font/woff2");
            const rootFontResponse = await fetch(
                `${baseUrl}/fonts/test.woff2`
            );
            assert.equal(rootFontResponse.status, 200);

            const iconResponse = await fetch(`${baseUrl}/web/app-icon.svg`);
            assert.equal(iconResponse.status, 200);
            assert.equal(iconResponse.headers.get("content-type"), "image/svg+xml");

            const headResponse = await fetch(`${baseUrl}/web/`, {
                method: "HEAD"
            });
            assert.equal(headResponse.status, 200);
            assert.equal(await headResponse.text(), "");

            const postResponse = await fetch(`${baseUrl}/web/`, {
                method: "POST"
            });
            assert.equal(postResponse.status, 405);
            assert.equal(postResponse.headers.get("allow"), "GET, HEAD");

            const blockedResponse = await fetch(`${baseUrl}/web/api/settings`);
            assert.equal(blockedResponse.status, 404);
            const encodedTraversal = await fetch(
                `${baseUrl}/web/assets/%2e%2e/secret.js`
            );
            assert.equal(encodedTraversal.status, 404);

            assert.equal(
                calls.every(
                    ({ url }) => new URL(url).origin === "https://your-project-1.vercel.app"
                ),
                true
            );
            assert.equal(
                calls.some(({ url }) => new URL(url).pathname === "/api/settings"),
                false
            );

            const rootAfter = await fetch(`${baseUrl}/`);
            assert.deepEqual(await rootAfter.json(), { ok: true, root: true });
            const healthAfter = await fetch(`${baseUrl}/health`);
            assert.deepEqual(await healthAfter.json(), {
                ok: true,
                health: true
            });
        }
    );
}

async function testResponseSizeAndTimeoutBoundaries() {
    await withServer(
        async () =>
            new Response(null, {
                headers: {
                    "Content-Type": "image/png",
                    ETag: '"empty-etag"',
                    "Last-Modified": "Fri, 14 Aug 2026 00:00:00 GMT"
                }
            }),
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/app-icon-192.png`);
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("etag"), '"empty-etag"');
            assert.equal(
                response.headers.get("last-modified"),
                "Fri, 14 Aug 2026 00:00:00 GMT"
            );
            assert.equal((await response.arrayBuffer()).byteLength, 0);
        }
    );

    await withServer(
        async () =>
            new Response("small", {
                headers: {
                    "Content-Type": "text/html",
                    "Content-Length": "4096"
                }
            }),
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/`);
            assert.equal(response.status, 502);
            assert.equal(
                (await response.json()).code,
                "WEB_MIRROR_UPSTREAM_TOO_LARGE"
            );
        },
        { maxResponseBytes: 2048 }
    );

    await withServer(
        async () => {
            throw new Error("network unavailable");
        },
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/`);
            assert.equal(response.status, 502);
            assert.equal(
                (await response.json()).code,
                "WEB_MIRROR_UPSTREAM_UNAVAILABLE"
            );
        }
    );

    await withServer(
        async () =>
            new Response("x".repeat(2049), {
                headers: { "Content-Type": "text/html" }
            }),
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/`);
            assert.equal(response.status, 502);
            const body = await response.json();
            assert.equal(body.code, "WEB_MIRROR_UPSTREAM_TOO_LARGE");
        },
        { maxResponseBytes: 2048 }
    );

    await withServer(
        async (url, { signal }) =>
            new Promise((resolve, reject) => {
                void url;
                signal.addEventListener(
                    "abort",
                    () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                    { once: true }
                );
                void resolve;
            }),
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/`);
            assert.equal(response.status, 504);
            const body = await response.json();
            assert.equal(body.code, "WEB_MIRROR_UPSTREAM_TIMEOUT");
        },
        { timeoutMs: 20 }
    );

    await withServer(
        async (url, { signal }) => {
            void url;
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode("partial"));
                        signal.addEventListener(
                            "abort",
                            () =>
                                controller.error(
                                    Object.assign(new Error("aborted"), {
                                        name: "AbortError"
                                    })
                                ),
                            { once: true }
                        );
                    }
                }),
                { headers: { "Content-Type": "text/html" } }
            );
        },
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/web/`);
            assert.equal(response.status, 504);
            const body = await response.json();
            assert.equal(body.code, "WEB_MIRROR_UPSTREAM_TIMEOUT");
        },
        { timeoutMs: 20 }
    );
}

function testMirrorHelperBoundaries() {
    assert.equal(safeRequestPath(), "/");
    assert.equal(safeRequestPath("/assets/app.js?cache=1"), "/assets/app.js");
    for (const blocked of [
        "/assets/%00.js",
        "/assets/%ZZ.js",
        "/assets/../secret.js",
        "/assets/./app.js",
        "/assets\\app.js",
        "/private/config.json"
    ]) {
        assert.equal(safeRequestPath(blocked), null, blocked);
    }

    assert.equal(
        prefixPublicPaths('url("/fonts/a.woff2") + "/not-public"'),
        'url("/web/fonts/a.woff2") + "/not-public"'
    );
    assert.throws(
        () => rewriteManifest("not-json"),
        (error) => error.code === "WEB_MIRROR_UPSTREAM_INVALID"
    );
    assert.throws(
        () => rewriteManifest("[]"),
        (error) => error.code === "WEB_MIRROR_UPSTREAM_INVALID"
    );
    assert.deepEqual(JSON.parse(rewriteManifest('{"icons":null}')), {
        icons: null,
        id: "/web/",
        start_url: "/web/",
        scope: "/web/"
    });
    assert.deepEqual(
        JSON.parse(
            rewriteManifest(
                '{"icons":[{"src":"icon.png"},{"src":null},{"src":"/icon.png"}]}'
            )
        ).icons,
        [{ src: "icon.png" }, { src: null }, { src: "/web/icon.png" }]
    );
}

async function main() {
    testMirrorHelperBoundaries();
    await testPublicMirrorContract();
    await testResponseSizeAndTimeoutBoundaries();

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    const mirrorMount = serverSource.indexOf(
        'app.use("/web", createWebMirrorRouter())'
    );
    const assetMount = serverSource.indexOf(
        'app.use("/assets", createWebMirrorAssetRouter())'
    );
    const fontMount = serverSource.indexOf(
        'app.use("/fonts", createWebMirrorFontRouter())'
    );
    const authMount = serverSource.indexOf("createAuthContextMiddleware({");
    const corsMount = serverSource.search(/app\.use\(\r?\n\s*cors\(\{/);
    assert.notEqual(mirrorMount, -1);
    assert.notEqual(assetMount, -1);
    assert.notEqual(fontMount, -1);
    assert.equal(mirrorMount < authMount, true);
    assert.equal(assetMount < authMount, true);
    assert.equal(fontMount < authMount, true);
    assert.ok(corsMount >= 0, "CORS middleware must be discoverable on LF and CRLF checkouts");
    assert.equal(mirrorMount < corsMount, true);
    assert.equal(assetMount < corsMount, true);
    assert.equal(fontMount < corsMount, true);
    assert.match(serverSource, /app\.get\("\/", \(req, res\) =>/);
    assert.match(serverSource, /app\.get\("\/health", async \(req, res\) =>/);
    assert.equal(serverSource.includes('"http://localhost:4174"'), true);
    assert.equal(serverSource.includes('"http://127.0.0.1:4174"'), true);

    console.log("fixed-upstream mobile web mirror tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

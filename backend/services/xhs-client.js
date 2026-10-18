"use strict";
const { createHmac } = require("node:crypto");
const { requireRequestScope } = require("./request-scope");

// 小红书服务 HTTP 客户端:灯塔后端 → dengta-home-xhs(Render Docker)。
// 未配置 XHS_SERVICE_URL 时优雅降级,所有操作返回明确错误。

function xhsServiceConfigured(env = process.env) {
    return Boolean(
        String(env.XHS_SERVICE_URL || "").trim() &&
        String(env.XHS_SERVICE_TOKEN || "").trim()
    );
}

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

const PUBLIC_ERRORS = Object.freeze({
    xhs_service_unconfigured: [503, "小红书服务还没有部署。"],
    xhs_session_isolation_required: [503, "小红书服务尚未支持当前账号与伴侣的独立会话，请更新服务后重试；未使用共享登录态。"],
    xhs_service_access_denied: [503, "小红书独立服务拒绝了连接，请检查服务访问权限和会话隔离版本。"],
    xhs_profile_busy: [503, "小红书独立浏览器暂时繁忙，请稍后重试。"],
    xhs_browser_unavailable: [503, "当前账号的小红书独立浏览器暂时无法打开，请稍后重试。"],
    xhs_profile_storage_failed: [503, "无法读写当前账号的小红书加密会话，原有资料未被自动清除。"],
    xhs_action_not_supported: [501, "小红书网页适配器尚未支持这个操作，请更新独立服务。"],
    xhs_page_changed: [502, "小红书页面结构变化，暂时无法确认操作结果，请重试或联系维护者更新适配器。"],
    xhs_search_request_invalid: [400, "请输入搜索词；当前小红书网页适配器仅支持第一页默认排序。"],
    xhs_note_lookup_required: [409, "请先在当前账号中搜索这篇笔记，再读取评论。"],
    xhs_scope_required: [401, "请从当前灯塔账号与伴侣重新打开小红书功能。"],
    xhs_storage_read_failed: [503, "无法读取当前账号的小红书登录资料，请稍后重试。"],
    xhs_credentials_unavailable: [503, "无法解密当前账号的小红书登录资料，请重新导入登录态。"],
    xhs_cookie_invalid: [400, "小红书登录资料格式无效，请重新导入。"],
    xhs_timeout: [504, "小红书服务响应超时，请稍后重试。"],
    xhs_unreachable: [502, "小红书服务暂时无法访问。"],
    xhs_response_invalid: [502, "小红书服务返回了无效结果，请稍后重试。"],
    xhs_upstream_error: [502, "小红书平台暂时无法完成操作，请检查当前账号登录状态或稍后重试。"],
    cookie_expired: [409, "当前账号的小红书登录已失效，请重新登录小红书；灯塔账号仍保持登录。"],
    verification_required: [409, "小红书平台需要人工验证，请在当前账号的页面中完成。"],
});
function publicError(code) {
    const key = Object.hasOwn(PUBLIC_ERRORS, code) ? code : "xhs_upstream_error";
    return requestError(PUBLIC_ERRORS[key][0], key, PUBLIC_ERRORS[key][1]);
}
function validCookie(cookie) {
    const value = String(cookie || "").trim();
    if (value.length > 32768 || value && !/^[\x20-\x7e]+$/.test(value)) throw publicError("xhs_cookie_invalid");
    return value;
}
function requireScope(scope) {
    try { return requireRequestScope({ scope }); } catch { throw publicError("xhs_scope_required"); }
}
async function savedCookie(scope, env) {
    const receipt = await scope.db.from("xhs_connections").select("cookie_ciphertext").maybeSingle();
    if (receipt.error) throw publicError("xhs_storage_read_failed");
    if (!receipt.data?.cookie_ciphertext) return "";
    try { return validCookie(require("./mcp-device-center").decryptCredential(receipt.data.cookie_ciphertext, env)); }
    catch { throw publicError("xhs_credentials_unavailable"); }
}

async function readResponse(response, wait) {
    const maximum = 1024 * 1024;
    if (Number(response.headers?.get("content-length")) > maximum) throw publicError("xhs_response_invalid");
    if (!response.body?.getReader) {
        const text = await wait(response.text());
        if (Buffer.byteLength(text, "utf8") > maximum) throw publicError("xhs_response_invalid");
        return text;
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
        while (true) {
            const next = await wait(reader.read());
            if (next.done) return Buffer.concat(chunks, size).toString("utf8");
            size += next.value.byteLength;
            if (size > maximum) throw publicError("xhs_response_invalid");
            chunks.push(Buffer.from(next.value));
        }
    } finally { void Promise.resolve().then(() => reader.cancel()).catch(() => {}); }
}

function createXhsClient({ env = process.env, fetchImpl = null, getCookie = scope => savedCookie(scope, env), timeoutMs = 60000 } = {}) {
    const baseUrl = String(env.XHS_SERVICE_URL || "").trim().replace(/\/$/, "");
    const token = String(env.XHS_SERVICE_TOKEN || "").trim();
    const fetcher = fetchImpl || ((url, options) => fetch(url, options));

    async function call(scope, method, path, body = null) {
        requireScope(scope);
        if (!baseUrl || !token) {
            throw publicError("xhs_service_unconfigured");
        }
        const session = createHmac("sha256", token).update(`dengta-xhs-v1\0${scope.userId}\0${scope.companionId}`).digest("hex");
        const controller = new AbortController();
        let timer, response;
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(publicError("xhs_timeout")); }, timeoutMs); });
        const wait = promise => Promise.race([promise, deadline]);
        try {
            const cookie = body?.cookie !== undefined ? validCookie(body.cookie) : method === "DELETE" || path.startsWith("/login/") ? "" : validCookie(await wait(Promise.resolve().then(() => getCookie(scope))));
            response = await wait(Promise.resolve().then(() => fetcher(baseUrl + path, {
                method,
                headers: {
                    "x-api-key": token,
                    "Content-Type": "application/json",
                    "x-dengta-isolation": "profile-v1",
                    "x-dengta-session": session,
                    ...(cookie && !body?.cookie ? { "x-dengta-cookie-base64": Buffer.from(cookie, "utf8").toString("base64") } : {})
                },
                body: body ? JSON.stringify(body) : undefined,
                redirect: "error",
                signal: controller.signal
            })));
            if (response.headers?.get("x-dengta-isolation") !== "profile-v1" || response.headers?.get("x-dengta-session") !== session) throw publicError([401, 403].includes(response.status) ? "xhs_service_access_denied" : "xhs_session_isolation_required");
            const text = await readResponse(response, wait);
            let payload = null;
            try { payload = JSON.parse(text); } catch { /* 非 JSON */ }
            if (!response.ok) {
                if (response.status === 404 && path.endsWith("/sticker-source")) throw publicError("xhs_action_not_supported");
                throw publicError(payload?.error);
            }
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw publicError("xhs_response_invalid");
            return payload;
        } catch (error) {
            if (Object.hasOwn(PUBLIC_ERRORS, error?.code)) throw publicError(error.code);
            throw publicError(controller.signal.aborted ? "xhs_timeout" : "xhs_unreachable");
        } finally {
            clearTimeout(timer); controller.abort();
            void Promise.resolve().then(() => response?.body?.cancel?.()).catch(() => {});
        }
    }

    return {
        configured: () => Boolean(baseUrl && token),
        forScope(scope) {
            requireScope(scope);
            return Object.freeze({
                configured: () => Boolean(baseUrl && token),
                loginStart: () => call(scope, "POST", "/login/start"),
                loginStatus: session => call(scope, "GET", "/login/status?session=" + encodeURIComponent(session)),
                setCookie: cookie => { const value = validCookie(cookie); if (!value) throw publicError("xhs_cookie_invalid"); return call(scope, "POST", "/login/cookie", { cookie: value }); },
                me: () => call(scope, "GET", "/me"),
                search: (keyword, page = 1, sort = "1") => call(scope, "GET", "/search?keyword=" + encodeURIComponent(keyword) + "&page=" + page + "&sort=" + encodeURIComponent(sort)),
                comments: noteId => call(scope, "GET", "/notes/" + encodeURIComponent(noteId) + "/comments"),
                stickerSource: noteId => call(scope, "GET", "/notes/" + encodeURIComponent(noteId) + "/sticker-source"),
                like: noteId => call(scope, "POST", "/notes/" + encodeURIComponent(noteId) + "/like"),
                comment: (noteId, content) => call(scope, "POST", "/notes/" + encodeURIComponent(noteId) + "/comment", { content }),
                follow: uid => call(scope, "POST", "/users/" + encodeURIComponent(uid) + "/follow"),
                logout: () => call(scope, "DELETE", "/logout")
            });
        }
    };
}

// 从笔记/用户链接里提取 id(页面路径最后一段)。
function extractXhsId(value, kind = "note") {
    const text = String(value || "").trim();
    const idMatch = text.match(/\/(explore|search_result|user\/profile)\/([0-9a-zA-Z]+)/);
    if (idMatch) return idMatch[2];
    if (/^[0-9a-zA-Z]{10,40}$/.test(text)) return text;
    return kind === "note"
        ? (text.match(/\/([0-9a-zA-Z]{16,40})\??/) || [])[1] || ""
        : "";
}

module.exports = { createXhsClient, extractXhsId, xhsServiceConfigured };

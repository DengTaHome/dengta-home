"use strict";

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

function createXhsClient({ env = process.env, fetchImpl = null } = {}) {
    const baseUrl = String(env.XHS_SERVICE_URL || "").trim().replace(/\/$/, "");
    const token = String(env.XHS_SERVICE_TOKEN || "").trim();
    const fetcher = fetchImpl || ((url, options) => fetch(url, options));

    async function call(method, path, body = null) {
        if (!baseUrl || !token) {
            throw requestError(503, "xhs_service_unconfigured", "小红书服务还没有部署。");
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
            const response = await fetcher(baseUrl + path, {
                method,
                headers: {
                    "x-api-key": token,
                    "Content-Type": "application/json"
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const text = await response.text();
            let payload = null;
            try { payload = JSON.parse(text); } catch { /* 非 JSON */ }
            if (!response.ok) {
                const message = payload?.message || text.slice(0, 160) || "小红书服务暂时失败。";
                throw requestError(502, payload?.error || "xhs_upstream_error", message);
            }
            return payload || {};
        } catch (error) {
            if (error?.code) throw error;
            if (error?.name === "AbortError") {
                throw requestError(504, "xhs_timeout", "小红书服务响应超时。");
            }
            throw requestError(502, "xhs_unreachable", "小红书服务暂时无法访问。");
        } finally {
            clearTimeout(timeout);
        }
    }

    return {
        configured: () => baseUrl && token,
        loginStart: () => call("POST", "/login/start"),
        loginStatus: (session) => call("GET", "/login/status?session=" + encodeURIComponent(session)),
        setCookie: (cookie) => call("POST", "/login/cookie", { cookie }),
        me: () => call("GET", "/me"),
        search: (keyword, page = 1, sort = "1") =>
            call("GET", "/search?keyword=" + encodeURIComponent(keyword) + "&page=" + page + "&sort=" + encodeURIComponent(sort)),
        comments: (noteId) => call("GET", "/notes/" + encodeURIComponent(noteId) + "/comments"),
        like: (noteId) => call("POST", "/notes/" + encodeURIComponent(noteId) + "/like"),
        comment: (noteId, content) => call("POST", "/notes/" + encodeURIComponent(noteId) + "/comment", { content }),
        follow: (uid) => call("POST", "/users/" + encodeURIComponent(uid) + "/follow"),
        logout: () => call("DELETE", "/logout")
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

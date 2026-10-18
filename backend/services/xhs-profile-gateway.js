const express = require("express");
const { timingSafeEqual, createHash } = require("node:crypto");

const SESSION = /^[a-f0-9]{64}$/;
const ERRORS = Object.freeze({
    xhs_scope_required: [401, "缺少有效的独立会话标识。"],
    xhs_service_access_denied: [403, "独立服务访问未获授权。"],
    xhs_session_isolation_required: [503, "需要独立浏览器会话协议。"],
    xhs_profile_busy: [503, "浏览器会话暂时繁忙，请稍后重试。"],
    xhs_browser_unavailable: [503, "独立浏览器暂时无法打开，请稍后重试。"],
    xhs_profile_storage_failed: [503, "无法读写当前账号的加密会话，原有资料未被自动清除。"],
    xhs_timeout: [504, "当前账号的网页操作超时，请稍后重试。"],
    xhs_cookie_invalid: [400, "当前账号登录资料格式无效。"],
    xhs_response_invalid: [502, "当前网页返回了无效结果。"],
    xhs_action_not_supported: [501, "当前网页适配器暂不支持这个操作。"],
    xhs_page_changed: [502, "小红书页面结构变化，暂时无法确认操作结果。"],
    xhs_search_request_invalid: [400, "请输入搜索词；当前网页适配器仅支持第一页默认排序。"],
    xhs_note_lookup_required: [409, "请先在当前账号中搜索这篇笔记，再读取评论。"],
    xhs_upstream_error: [502, "小红书网页暂时无法完成操作。"],
    xhs_unreachable: [502, "当前账号的网页暂时无法访问。"],
    cookie_expired: [401, "当前账号登录已失效，请重新登录。"],
    verification_required: [409, "当前账号需要在网页中完成人工验证。"],
});
function error(code) { const key = Object.hasOwn(ERRORS, code) ? code : "xhs_unreachable"; return Object.assign(new Error(ERRORS[key][1]), { code: key, status: ERRORS[key][0] }); }
function authorized(expected, actual) { const left = Buffer.from(expected), right = Buffer.from(String(actual || "")); return left.length === right.length && timingSafeEqual(left, right); }

function createXhsProfileGateway({ token, createProfile, maxProfiles = 4, timeoutMs = 45000 } = {}) {
    if (typeof token !== "string" || token.length < 32 || typeof createProfile !== "function") throw Error("XHS gateway configuration required");
    const entries = new Map(), closing = new Map(); let closed = false;
    const app = express(); app.use(express.json({ limit: "64kb" }));
    const closeProfile = entry => entry.profile.then(profile => profile.close()).catch(() => {});
    function dispose(session, entry) {
        if (entry.disposal) return entry.disposal;
        entry.valid = false;
        if (entries.get(session) === entry) entries.delete(session);
        const promise = closeProfile(entry);
        entry.disposal = promise; closing.set(session, promise);
        void promise.finally(() => { if (closing.get(session) === promise) closing.delete(session); });
        return promise;
    }
    async function run(session, operation, input, cookie, current) {
        if (closed || !current()) throw error("xhs_browser_unavailable");
        let entry = entries.get(session);
        if (!entry) {
            let priorClose = closing.get(session) || Promise.resolve();
            if (entries.size + closing.size >= maxProfiles && !closing.has(session)) {
                const idle = [...entries.entries()].filter(([, item]) => item.busy === 0).sort((a, b) => a[1].used - b[1].used)[0];
                if (!idle) throw error("xhs_profile_busy");
                priorClose = Promise.all([priorClose, dispose(idle[0], idle[1])]);
            }
            entry = { busy: 0, used: Date.now(), valid: true, ready: false, tail: Promise.resolve(), profile: priorClose.then(() => createProfile(session)) };
            void entry.profile.catch(() => {});
            entries.set(session, entry);
        }
        entry.busy++;
        const previous = entry.tail;
        const promise = previous.catch(() => {}).then(async () => {
            if (!entry.valid || closed || !current()) { entry.busy--; throw error("xhs_browser_unavailable"); }
            let timer;
            const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
                void dispose(session, entry); reject(error("xhs_timeout"));
            }, timeoutMs); });
            try {
                const profile = await Promise.race([entry.profile, deadline]);
                entry.ready = true;
                const result = await Promise.race([Promise.resolve().then(async () => {
                    if (cookie) await profile.importCookie(cookie);
                    if (!current() || !entry.valid) throw error("xhs_browser_unavailable");
                    return profile.execute(operation, input);
                }), deadline]);
                if (!entry.valid || closed) throw error("xhs_browser_unavailable");
                if (!result || typeof result !== "object" || Array.isArray(result)) throw error("xhs_response_invalid");
                return result;
            } catch (cause) {
                if (!entry.ready || cause?.code === "xhs_browser_unavailable") void dispose(session, entry);
                throw error(cause?.code);
            } finally { clearTimeout(timer); entry.busy--; entry.used = Date.now(); }
        });
        entry.tail = promise.catch(() => {});
        return promise;
    }
    app.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        if (!authorized(token, req.headers["x-api-key"])) return next(error("xhs_service_access_denied"));
        if (req.headers["x-dengta-isolation"] !== "profile-v1") return next(error("xhs_session_isolation_required"));
        const session = req.headers["x-dengta-session"];
        if (typeof session !== "string" || !SESSION.test(session)) return next(error("xhs_scope_required"));
        req.xhsSession = session;
        res.set("x-dengta-isolation", "profile-v1"); res.set("x-dengta-session", session); next();
    });
    const route = (method, pathname, operation, input = req => req.body || {}) => app[method](pathname, async (req, res, next) => {
        try {
            const encoded = req.headers["x-dengta-cookie-base64"];
            if (encoded && (typeof encoded !== "string" || encoded.length > 44000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))) throw error("xhs_cookie_invalid");
            const cookie = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
            res.json(await run(req.xhsSession, operation, input(req), cookie, () => !req.aborted && !res.destroyed));
        } catch (cause) { next(cause); }
    });
    route("post", "/login/start", "loginStart");
    route("get", "/login/status", "loginStatus", req => ({ session: String(req.query.session || "") }));
    route("post", "/login/cookie", "setCookie");
    route("get", "/me", "me");
    route("get", "/search", "search", req => ({ keyword: String(req.query.keyword || "").slice(0, 200), page: Number(req.query.page) || 1, sort: String(req.query.sort || "1") }));
    route("get", "/notes/:id/comments", "comments", req => ({ noteId: req.params.id }));
    route("get", "/notes/:id/sticker-source", "stickerSource", req => ({ noteId: req.params.id }));
    route("post", "/notes/:id/like", "like", req => ({ noteId: req.params.id }));
    route("post", "/notes/:id/comment", "comment", req => ({ noteId: req.params.id, content: String(req.body?.content || "").slice(0, 200) }));
    route("post", "/users/:id/follow", "follow", req => ({ userId: req.params.id }));
    route("delete", "/logout", "logout");
    app.use((cause, _req, res, _next) => { const safe = error(cause?.code); res.status(safe.status).json({ error: safe.code, message: safe.message }); });
    return { app, async close() {
        closed = true;
        const pending = [...entries].map(([session, entry]) => dispose(session, entry));
        let timer;
        try { await Promise.race([Promise.all([...pending, ...closing.values()]), new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
        finally { clearTimeout(timer); }
    } };
}

function createBrowserProfileFactory({ browser, operations, store = null } = {}) {
    return async session => {
        const saved = await store?.read(session);
        let context = await browser.newContext(saved?.browserState ? { storageState: saved.browserState } : {});
        let cookieHash = saved?.cookieHash || "", closed = false;
        const save = async () => { if (store && !closed) await store.write(session, { browserState: await context.storageState(), cookieHash }); };
        async function importCookie(cookie, force = false) {
            if (closed) throw error("xhs_browser_unavailable");
            if (typeof cookie !== "string" || cookie.length > 32768 || !/^[\x20-\x7e]+$/.test(cookie)) throw error("xhs_cookie_invalid");
            const hash = createHash("sha256").update(cookie).digest("hex");
            if (!force && hash === cookieHash) return;
            const cookies = cookie.split(";").map(part => {
                const index = part.indexOf("=");
                if (index < 1) throw error("xhs_cookie_invalid");
                const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
                if (!name || /[\s;=]/.test(name)) throw error("xhs_cookie_invalid");
                return name.startsWith("__Host-") ? { name, value, url: "https://www.xiaohongshu.com", secure: true }
                    : { name, value, domain: ".xiaohongshu.com", path: "/", secure: true };
            });
            const fresh = await browser.newContext();
            try { await fresh.addCookies(cookies); }
            catch { await fresh.close(); throw error("xhs_cookie_invalid"); }
            const old = context; context = fresh; cookieHash = hash; await old.close(); await save();
        }
        return {
            importCookie,
            async execute(operation, input) {
                if (closed) throw error("xhs_browser_unavailable");
                if (operation === "setCookie") { await importCookie(input.cookie, true); return { ok: true }; }
                if (operation === "logout") {
                    if (store) await store.write(session, { browserState: { cookies: [], origins: [] }, cookieHash });
                    closed = true; await context.close();
                    try { context = await browser.newContext(); closed = false; } catch { throw error("xhs_browser_unavailable"); }
                    return { ok: true };
                }
                if (typeof operations?.[operation] !== "function") throw error("xhs_action_not_supported");
                const result = await operations[operation](context, input); await save(); return result;
            },
            async close() { if (closed) return; closed = true; try { if (store) await store.write(session, { browserState: await context.storageState(), cookieHash }); } finally { await context.close(); } }
        };
    };
}

module.exports = { createXhsProfileGateway, createBrowserProfileFactory };

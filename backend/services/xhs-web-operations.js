const { randomUUID } = require("node:crypto");
const ORIGIN = "https://www.xiaohongshu.com";
const NOTE_ID = /^[a-f0-9]{24}$/i;
const SELF = 'a[href*="/user/profile/"]';
const NOTE_SOURCE_TTL_MS = 10 * 60 * 1000;
const NOTE_SOURCE_LIMIT = 100;
function failure(code) { return Object.assign(new Error("XHS webpage operation failed"), { code }); }
const clean = (value, length) => Array.from(String(value || "").trim()).slice(0, length).join("");
function safeImage(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.href.length > 4096 ||
            !(/^(?:[a-z0-9-]+\.)*xhscdn\.com$/i.test(url.hostname) || url.hostname === "ci.xiaohongshu.com")) return "";
        return url.href;
    } catch { return ""; }
}
function noteLink(value) {
    try {
        const url = new URL(value, ORIGIN), match = url.pathname.match(/^\/(?:explore|search_result)\/([a-f0-9]{24})\/?$/i);
        if (url.origin !== ORIGIN || !match) return null;
        const target = new URL("/explore/" + match[1], ORIGIN);
        for (const name of ["xsec_token", "xsec_source"]) if (url.searchParams.has(name)) target.searchParams.set(name, clean(url.searchParams.get(name), 1024));
        return { id: match[1].toLowerCase(), url: target.href };
    } catch { return null; }
}
function createXhsWebOperations({ timeoutMs = 15000, qrTtlMs = 180000, now = Date.now } = {}) {
    const sessions = new WeakMap(), knownNotes = new WeakMap();
    function recentNotes(context) {
        const notes = knownNotes.get(context) || new Map(), time = now();
        for (const [id, entry] of notes) if (entry.expiresAt <= time) notes.delete(id);
        return notes;
    }
    function rememberNotes(context, items) {
        const notes = recentNotes(context), expiresAt = now() + NOTE_SOURCE_TTL_MS;
        for (const item of items) {
            notes.delete(item.note_id);
            notes.set(item.note_id, { item, expiresAt });
        }
        while (notes.size > NOTE_SOURCE_LIMIT) notes.delete(notes.keys().next().value);
        knownNotes.set(context, notes);
    }
    const knownNote = (context, id) => recentNotes(context).get(id.toLowerCase())?.item;
    const visible = async locator => { for (const item of await locator.all()) if (await item.isVisible()) return item; return null; };
    async function status(page) {
        if (new URL(page.url()).origin !== ORIGIN) throw failure("xhs_unreachable");
        if (await visible(page.locator('[class*="captcha"], [id*="captcha"], .verify-container, .verify-modal'))) throw failure("verification_required");
        const self = await visible(page.locator(SELF).filter({ hasText: /^(我|个人中心|我的主页|My profile)$/i }));
        if (self) {
            const href = await self.getAttribute("href"), match = href?.match(/\/user\/profile\/([a-f0-9]{24})(?:[/?#]|$)/i);
            if (match) return { user_id: match[1].toLowerCase() };
        }
        if (new URL(page.url()).pathname.startsWith("/login") || await visible(page.locator('.login-container, .login-modal, [data-testid="login-panel"]'))) throw failure("cookie_expired");
        throw failure("xhs_page_changed");
    }
    async function navigate(page, url) {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        if (response && response.status() >= 400) throw failure(response.status() === 429 ? "xhs_profile_busy" : "xhs_upstream_error");
        await page.waitForSelector(`${SELF}, .login-container, .login-modal, [data-testid="login-panel"], [class*="captcha"]`, { state: "visible", timeout: timeoutMs });
    }
    async function withPage(context, url, action) {
        const page = await context.newPage();
        try { await navigate(page, url); const identity = await status(page); return await action(page, identity); }
        catch (error) {
            if (error?.code === "cookie_expired") knownNotes.delete(context);
            if (error?.code) throw error;
            throw failure(error?.name === "TimeoutError" ? "xhs_timeout" : "xhs_unreachable");
        }
        finally { await page.close().catch(() => {}); }
    }
    async function discard(context) {
        const old = sessions.get(context); sessions.delete(context); if (!old) return;
        clearTimeout(old.timer); await old.page.close().catch(() => {});
    }
    return {
        me: context => withPage(context, ORIGIN + "/explore", async (_page, identity) => identity),
        async loginStart(context) {
            knownNotes.delete(context);
            await discard(context);
            const page = await context.newPage();
            try {
                await navigate(page, ORIGIN + "/explore");
                try { await status(page); await page.close(); return { status: "done" }; }
                catch (error) { if (error.code !== "cookie_expired") throw error; }
                const qr = await visible(page.locator('.login-container canvas, .login-container img.qrcode-img, .login-modal canvas, .login-modal img.qrcode-img, [data-testid="login-panel"] [data-testid="qr-code"]'));
                if (!qr) throw failure("xhs_page_changed");
                const buffer = await qr.screenshot({ type: "png", timeout: timeoutMs });
                if (buffer.length > 600000) throw failure("xhs_response_invalid");
                const session = randomUUID(), expires = now() + qrTtlMs;
                const entry = { session, page, expires, timer: setTimeout(() => { if (sessions.get(context)?.session === session) void discard(context); }, qrTtlMs) };
                entry.timer.unref?.(); sessions.set(context, entry);
                return { session, qr: "data:image/png;base64," + buffer.toString("base64"), expires_at: new Date(expires).toISOString() };
            } catch (error) { await page.close().catch(() => {}); throw failure(error?.code || (error?.name === "TimeoutError" ? "xhs_timeout" : "xhs_unreachable")); }
        },
        async loginStatus(context, { session }) {
            const entry = sessions.get(context);
            if (!entry || entry.session !== session || now() >= entry.expires || entry.page.isClosed()) { if (entry?.session === session) await discard(context); return { status: "expired" }; }
            try { await status(entry.page); await discard(context); return { status: "done" }; }
            catch (error) { if (error.code === "cookie_expired") return { status: "pending" }; await discard(context); throw error; }
        },
        async search(context, { keyword, page = 1, sort = "1" }) {
            const query = clean(keyword, 200);
            if (!query || page !== 1 || sort !== "1") throw failure("xhs_search_request_invalid");
            const url = new URL("/search_result", ORIGIN); url.searchParams.set("keyword", query); url.searchParams.set("source", "web_explore_feed");
            return withPage(context, url.href, async browserPage => {
                await browserPage.waitForSelector('section.note-item, [data-note-id], .feeds-page .note-item, .no-data, .empty-container, [data-testid="search-empty"]', { timeout: timeoutMs });
                const cards = await browserPage.locator('section.note-item, article[data-note-id], .feeds-page .note-item').evaluateAll(elements => elements.slice(0, 40).map(element => ({
                    href: element.querySelector('a[href*="/explore/"], a[href*="/search_result/"]')?.getAttribute("href"),
                    title: element.querySelector('.title, [data-testid="note-title"]')?.textContent,
                    author: element.querySelector('.author .name, .author-wrapper .name, [data-testid="note-author"]')?.textContent,
                    image: element.querySelector('img')?.currentSrc || element.querySelector('img')?.getAttribute("src")
                })));
                const notes = new Map(), items = [];
                for (const card of cards) {
                    const link = noteLink(card.href); if (!link || notes.has(link.id)) continue;
                    const item = { note_id: link.id, url: link.url, title: clean(card.title, 300), author: clean(card.author, 120), cover: safeImage(card.image) };
                    notes.set(link.id, item); items.push(item); if (items.length >= 20) break;
                }
                if (!items.length && !await visible(browserPage.locator('.no-data, .empty-container, [data-testid="search-empty"]'))) throw failure("xhs_page_changed");
                rememberNotes(context, items);
                return { items, page: 1, has_more: false, pagination: "visible_page_only", source: "authenticated_webpage" };
            });
        },
        async comments(context, { noteId }) {
            if (!NOTE_ID.test(noteId || "")) throw failure("xhs_search_request_invalid");
            const url = knownNote(context, noteId)?.url;
            if (!url) throw failure("xhs_note_lookup_required");
            return withPage(context, url, async page => {
                await page.waitForSelector('.comments-container, .comment-list, [data-testid="comments-empty"]', { timeout: timeoutMs });
                const items = await page.locator('.comment-item').evaluateAll(elements => elements.slice(0, 30).map(element => ({
                    author: (element.querySelector('.author, .user-name')?.textContent || "").trim().slice(0, 120),
                    content: (element.querySelector('.content, .note-text')?.textContent || "").trim().slice(0, 2000)
                })));
                return { note_id: noteId.toLowerCase(), items, source: "visible_page_only" };
            });
        },
        async stickerSource(context, { noteId }) {
            if (!NOTE_ID.test(noteId || "")) throw failure("xhs_search_request_invalid");
            const item = knownNote(context, noteId);
            if (!item) throw failure("xhs_note_lookup_required");
            return { note_id: item.note_id, title: item.title, creator: item.author, cover: safeImage(item.cover), page_url: ORIGIN + "/explore/" + item.note_id };
        }
    };
}
module.exports = { createXhsWebOperations, safeImage, noteLink };

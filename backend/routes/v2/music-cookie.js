"use strict";

const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");

function createMusicCookieRouter({ neteaseCookie, storage = null } = {}) {
    if (!neteaseCookie) throw new TypeError("music cookie router requires neteaseCookie service");
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireRequestScope(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    router.post("/providers/netease/cookie-session", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const cookie = String(req.body?.cookie || "").trim().slice(0, 4096);
            if (!cookie) {
                const error = new Error("缺少网易云登录 Cookie。");
                error.status = 400;
                error.code = "netease_cookie_required";
                return next(error);
            }
            const account = await neteaseCookie.validateCookie(cookie);
            if (!account) {
                const error = new Error("这个登录状态已经失效，请重新在 App 内登录网易云。");
                error.status = 400;
                error.code = "netease_cookie_invalid";
                return next(error);
            }
            res.status(201).json({ session: await neteaseCookie.save(scope, cookie, account) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie-session", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            res.json({
                session: session
                    ? {
                          connected: true,
                          account_name: session.account_name || "",
                          account_id: session.account_id || "",
                          updated_at: session.updated_at || ""
                      }
                    : { connected: false }
            });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/providers/netease/cookie-session", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({ session: await neteaseCookie.clear(scope) });
        } catch (error) {
            next(error);
        }
    });

    // AI 放歌：App 轮询待播放请求（AI 说"放首歌"时后端落一条），拿到后静默调起网易云播放
    router.get("/providers/netease/ai-play-requests", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            // Legacy clients open before acknowledging; require an upgraded consumer.
            if (req.query.delivery !== "claim-v1") return res.json({ requests: [], update_required: true });
            const data = await scope.db
                .from("ai_music_play_requests")
                .select("id, song_id, title, artist, cover_url, status, error, created_at")
                .eq("status", "pending")
                .is("delivery_committed_at", null)
                .order("created_at", { ascending: true })
                .limit(10);
            if (data.error) throw data.error;
            res.json({ requests: data.data || [], delivery_protocol: "claim-v1" });
        } catch (error) {
            next(error);
        }
    });

    router.post("/providers/netease/ai-play-requests/:id/:action", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const id = String(req.params?.id || "").trim();
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
                const error = new Error("播放请求编号无效。");
                error.status = 400;
                error.code = "ai_play_request_invalid";
                return next(error);
            }
            const action = String(req.params.action || "");
            if (!["claim", "commit", "result"].includes(action)) return res.status(404).json({ code: "music_ai_delivery_invalid" });
            const status = String(req.body?.status || "played");
            if (action === "result" && !["played", "failed"].includes(status)) {
                const error = new Error("播放结果状态不正确。");
                error.status = 400;
                error.code = "ai_play_result_invalid";
                return next(error);
            }
            const deliveryToken = String(req.body?.delivery_token || "");
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryToken)) {
                throw Object.assign(new Error("请更新灯塔后重试自动点歌。"), { status: 409, code: "music_ai_claim_required" });
            }
            const data = await scope.db.rpc("apply_ai_music_delivery", {
                p_request_id: id, p_delivery_token: deliveryToken, p_action: action,
                p_status: status, p_error: req.body?.error === "music_ai_open_unconfirmed" ? "music_ai_open_unconfirmed" : "music_ai_open_failed"
            });
            if (data.error) throw data.error;
            if (data.data?.code) {
                const messages = {
                    music_ai_request_not_found: "点歌请求不存在或不属于当前账号和伴侣。",
                    music_ai_request_superseded: "这次点歌已被新请求替换，请在一起听中查看当前歌曲。",
                    music_ai_delivery_expired: "点歌领取已过期，请刷新后重试。",
                    music_ai_delivery_conflict: "这次点歌已由另一台设备处理，请在一起听中查看。",
                    music_ai_claim_required: "自动点歌需要先完成交接，请更新灯塔后重试。",
                    music_ai_result_conflict: "这次点歌已结束，请在一起听中查看。"
                };
                throw Object.assign(new Error(messages[data.data.code] || "点歌交接失败，请刷新后重试。"), { status: data.data.status || 409, code: data.data.code });
            }
            if (!data.data || data.data.request?.id !== id) throw Object.assign(new Error("服务器没有确认点歌交接，请稍后重试。"), { status: 502, code: "music_ai_delivery_receipt_invalid" });
            res.json(data.data);
        } catch (error) {
            next(error);
        }
    });

    // 随机挑一首 DengTa 里已存在、可不跳转内置播放的歌（direct_https 且有音频直链）。
    router.get("/providers/netease/random-playable", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const { data, error } = await scope.db
                .from("music_playlist_items")
                .select("id, playlist_id, title, artist, album, url, cover_url, duration_seconds, provider_track_id")
                .in("playback_mode", ["direct_https", "netease_resolved"])
                .not("url", "is", null);
            if (error) throw error;
            const items = Array.isArray(data) ? data.filter((item) => String(item?.url || "").startsWith("http")) : [];
            if (items.length === 0) {
                return res.json({ playable: false, song: null });
            }
            const song = items[Math.floor(Math.random() * items.length)];
            res.json({
                playable: true,
                song: {
                    title: String(song.title || "").slice(0, 300),
                    artist: String(song.artist || "").slice(0, 300),
                    album: String(song.album || "").slice(0, 300),
                    url: song.url,
                    cover_url: String(song.cover_url || "").slice(0, 4096) || null,
                    duration_seconds: Number(song.duration_seconds) || null
                }
            });
        } catch (error) {
            next(error);
        }
    });

    // 兜底：本地没有可内置播放的歌时，抓取一首随机热门歌下载导入 DengTa 内置播放。
    router.post("/providers/netease/random-fetch", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session?.cookie_text) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            if (!storage || typeof storage.from !== "function") {
                const error = new Error("音频存储还没有准备好。");
                error.status = 503;
                error.code = "music_storage_unavailable";
                return next(error);
            }
            const keywords = [
                "光年之外", "晴天", "七里香", "泡沫", "平凡之路", "成都", "小幸运", "演员",
                "告白气球", "你的答案", "少年", "星辰大海", "孤勇者", "玫瑰少年", "夏天的风",
                "起风了", "wonderful u", "lemon", "shape of you", "love story",
                "稻香", "海阔天空", "光辉岁月", "后来", "突然好想你", "夜空中最亮的星"
            ];
            const keyword = keywords[Math.floor(Math.random() * keywords.length)];
            const search = await neteaseCookie.cookieSearch(session.cookie_text, keyword, 1).catch(() => []);
            const searchItems = Array.isArray(search) ? search : Array.isArray(search?.items) ? search.items : [];
            const song = searchItems[0] || null;
            const songId = String(song?.provider_track_id || song?.id || "").trim();
            if (!songId) {
                const error = new Error("随机歌曲搜索失败，请稍后再试。");
                error.status = 502;
                error.code = "random_fetch_search_failed";
                return next(error);
            }
            const playback = await neteaseCookie.cookieSongUrl(session.cookie_text, songId).catch(() => ({ url: "" }));
            if (!playback?.url) {
                // 拿不到直链：VIP/版权/加密音频。按产品约定如实告诉用户，
                // 由用户决定"提供解密插件"或"改跳转网易云免确认播放"。
                return res.json({
                    ok: false,
                    reason: "encrypted",
                    message: "抓到了《" + String(song.title || "") + "》，但无法获取可内置播放的音频（网易云 VIP/版权歌曲在本机是加密格式，读不出来）。你可以：1) 提供一个能解密网易云音频文件的插件；2) 让我改成登录态跳转网易云播放（无需确认）。"
                });
            }
            const audioResponse = await fetch(playback.url, {
                headers: {
                    Referer: "https://music.163.com/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                },
                signal: AbortSignal.timeout(60000)
            }).catch(() => null);
            if (!audioResponse || !audioResponse.ok) {
                const error = new Error("音频下载失败，请稍后再试。");
                error.status = 502;
                error.code = "random_fetch_download_failed";
                return next(error);
            }
            const buffer = Buffer.from(await audioResponse.arrayBuffer());
            if (buffer.length < 10000) {
                const error = new Error("下载到的音频内容不完整。");
                error.status = 502;
                error.code = "random_fetch_audio_short";
                return next(error);
            }
            const objectPath = "public/random-" + Date.now() + "-" + Math.floor(Math.random() * 100000) + ".mp3";
            const { error: uploadError } = await storage
                .from("music-uploads")
                .upload(objectPath, buffer, { contentType: "audio/mpeg", upsert: false, cacheControl: "3600" });
            if (uploadError) throw uploadError;
            const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
            const url = base + "/storage/v1/object/public/music-uploads/" + objectPath;
            const title = String(song.title || keyword).slice(0, 300);
            const artist = String(song.artist || "").slice(0, 300);
            const coverUrl = String(song.cover_url || "").slice(0, 4096);
            const ownerDb = scope.db;
            const { data: existingPl } = await ownerDb
                .from("music_playlists")
                .select("id")
                .eq("provider", "netease")
                .eq("provider_playlist_id", songId)
                .maybeSingle();
            let playlistId = existingPl?.id || null;
            const plValues = {
                name: (title + " · " + artist || "随机音乐") + " · 内置播放",
                provider: "netease",
                provider_playlist_id: songId,
                external_url: "https://music.163.com/#/song?id=" + songId,
                source_format: "netease_cookie",
                item_count: 1,
                updated_at: new Date().toISOString()
            };
            if (playlistId) {
                await ownerDb.from("music_playlists").update(plValues).eq("id", playlistId);
            } else {
                const inserted = await ownerDb.from("music_playlists").insert(plValues).select("id").single();
                if (inserted.error) throw inserted.error;
                playlistId = inserted.data.id;
            }
            const itemValues = {
                playlist_id: playlistId,
                position: 0,
                provider_track_id: songId,
                external_url: "https://music.163.com/#/song?id=" + songId,
                playback_mode: "netease_resolved",
                url,
                title,
                artist,
                album: String(song.album || "").slice(0, 300),
                cover_url: coverUrl || null,
                duration_seconds: Number(song.duration_seconds) || null,
                lyrics: ""
            };
            const { data: existingItem } = await ownerDb
                .from("music_playlist_items")
                .select("id")
                .eq("playlist_id", playlistId)
                .limit(1);
            if (existingItem?.data?.[0]?.id) {
                await ownerDb.from("music_playlist_items").update(itemValues).eq("id", existingItem.data[0].id);
            } else {
                await ownerDb.from("music_playlist_items").insert(itemValues);
            }
            res.json({
                ok: true,
                song: {
                    title,
                    artist,
                    album: String(song.album || "").slice(0, 300),
                    url,
                    cover_url: coverUrl || null,
                    duration_seconds: Number(song.duration_seconds) || null
                },
                note: "已下载《" + title + "》到 DengTa 内置播放器（不跳转网易云）。"
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie/search", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            res.json({ items: await neteaseCookie.cookieSearch(session.cookie_text, req.query.q, req.query.limit) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie/song-url", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            res.json({ playback: await neteaseCookie.cookieSongUrl(session.cookie_text, req.query.id) });
        } catch (error) {
            next(error);
        }
    });


    router.get("/providers/netease/cookie/my-playlists", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const profile = await neteaseCookie.validateCookie(session.cookie_text);
            if (!profile) {
                const error = new Error("登录状态已失效，请重新在 App 内登录网易云。");
                error.status = 400;
                error.code = "netease_cookie_invalid";
                return next(error);
            }
            const response = await fetch(
                "https://music.163.com/api/user/playlist?uid=" + encodeURIComponent(profile.account_id) + "&limit=1000&offset=0",
                {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                        Referer: "https://music.163.com/",
                        Cookie: session.cookie_text
                    },
                    signal: AbortSignal.timeout(12000)
                }
            );
            const json = await response.json().catch(() => null);
            const rows = Array.isArray(json?.playlist) ? json.playlist : [];
            res.json({
                owned: rows.filter((row) => row?.subscribed !== true).map((row) => ({
                    playlist_id: String(row?.id ?? ""),
                    name: String(row?.name || "未命名歌单").slice(0, 180),
                    item_count: Math.min(2000, Math.max(0, Number(row?.trackCount) || 0)),
                    subscribed: false
                })).filter((row) => row.playlist_id),
                subscribed: rows.filter((row) => row?.subscribed === true).map((row) => ({
                    playlist_id: String(row?.id ?? ""),
                    name: String(row?.name || "未命名歌单").slice(0, 180),
                    item_count: Math.min(2000, Math.max(0, Number(row?.trackCount) || 0)),
                    subscribed: true
                })).filter((row) => row.playlist_id)
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie/playlist", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const detail = await neteaseCookie.cookiePlaylistDetail(session.cookie_text, String(req.query?.id || ""));
            if (!detail) {
                const error = new Error("歌单读取失败：网易云接口没有返回内容，请稍后重试。");
                error.status = 502;
                error.code = "netease_cookie_playlist_unavailable";
                return next(error);
            }
            res.json({ playlist: detail });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie/daily", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const { weapiRequest } = require("../../services/netease-weapi");
            const { json, status } = await weapiRequest(globalThis.fetch, "/weapi/v1/discovery/recommend/songs", {}, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200) {
                const error = new Error("每日推荐暂时不可用，请稍后重试。");
                error.status = 502;
                error.code = "netease_cookie_daily_failed";
                return next(error);
            }
            const songs = Array.isArray(json?.data?.dailySongs) ? json.data.dailySongs : [];
            res.json({
                daily: songs.slice(0, 30).map((song, index) => ({
                    id: String(song?.id ?? ""),
                    title: String(song?.name || "").slice(0, 300),
                    artist: (Array.isArray(song?.artists) ? song.artists.map((a) => String(a?.name || "")).filter(Boolean).join(" / ") : Array.isArray(song?.ar) ? song.ar.map((a) => String(a?.name || "")).filter(Boolean).join(" / ") : "").slice(0, 300),
                    album: String(song?.album?.name ?? song?.al?.name ?? "").slice(0, 300),
                    cover_url: String(song?.album?.picUrl ?? song?.al?.picUrl ?? "").replace(/^\/\//, "https:"),
                    duration_seconds: Number(song?.duration ?? song?.dt) || null,
                    reason: String(songs[index]?.reason || songs[index]?.recommendReason || "").slice(0, 200)
                })).filter((song) => song.id)
            });
        } catch (error) {
            next(error);
        }
    });

    router.get("/providers/netease/cookie/history", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const { weapiRequest } = require("../../services/netease-weapi");
            const profile = await neteaseCookie.validateCookie(session.cookie_text);
            const { json, status } = await weapiRequest(globalThis.fetch, "/weapi/v1/play/record", { uid: profile?.account_id || "", type: 0, limit: Math.min(50, Math.max(1, Number(req.query?.limit) || 20)) }, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200) {
                const error = new Error("听歌记录暂时不可用。");
                error.status = 502;
                error.code = "netease_cookie_history_failed";
                return next(error);
            }
            const records = Array.isArray(json?.allData) ? json.allData : [];
            res.json({
                records: records.slice(0, 50).map((row) => ({
                    id: String(row?.song?.id ?? ""),
                    title: String(row?.song?.name || "").slice(0, 300),
                    artist: (Array.isArray(row?.song?.ar) ? row.song.ar.map((a) => String(a?.name || "")).filter(Boolean).join(" / ") : "").slice(0, 300),
                    album: String(row?.song?.al?.name || "").slice(0, 300),
                    cover_url: String(row?.song?.al?.picUrl || "").replace(/^\/\//, "https:"),
                    duration_seconds: Number(row?.song?.dt) || null,
                    play_count: Number(row?.playCount) || 0
                })).filter((row) => row.id)
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/providers/netease/cookie/like", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const songId = String(req.body?.song_id || "").trim();
            const like = req.body?.like !== false;
            if (!/^\d{1,20}$/.test(songId)) {
                const error = new Error("歌曲编号格式不正确。");
                error.status = 400;
                error.code = "netease_cookie_id_invalid";
                return next(error);
            }
            const { eapiRequest } = require("../../services/netease-weapi");
            const { json, status } = await eapiRequest(globalThis.fetch, "/eapi/song/like", { trackId: songId, userid: "0", like: String(like).toLowerCase(), e_r: "true" }, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200) {
                const error = new Error(String(json?.message || "红心操作失败。"));
                error.status = 502;
                error.code = "netease_cookie_like_failed";
                return next(error);
            }
            res.json({ song_id: songId, liked: like });
        } catch (error) {
            next(error);
        }
    });

    router.post("/providers/netease/cookie/playlist", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const name = String(req.body?.name || "").trim().slice(0, 60);
            if (!name) {
                const error = new Error("请给歌单起个名字。");
                error.status = 400;
                error.code = "netease_cookie_name_required";
                return next(error);
            }
            const privacy = req.body?.privacy === true ? "10" : "0";
            const { eapiRequest } = require("../../services/netease-weapi");
            const { json, status } = await eapiRequest(globalThis.fetch, "/eapi/playlist/create", { name, privacy }, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200 || !json?.playlist?.id) {
                const error = new Error(String(json?.message || "歌单创建失败。"));
                error.status = 502;
                error.code = "netease_cookie_create_failed";
                return next(error);
            }
            res.status(201).json({ playlist_id: String(json.playlist.id), name: String(json.playlist.name || name).slice(0, 180) });
        } catch (error) {
            next(error);
        }
    });

    router.post("/providers/netease/cookie/playlist/tracks", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const playlistId = String(req.body?.playlist_id || "").trim();
            const ids = (Array.isArray(req.body?.track_ids) ? req.body.track_ids : [req.body?.track_ids])
                .map((value) => String(value || "").trim())
                .filter((value) => /^\d{1,20}$/.test(value))
                .slice(0, 100);
            if (!/^\d{1,20}$/.test(playlistId) || ids.length === 0) {
                const error = new Error("歌单编号或歌曲编号不正确。");
                error.status = 400;
                error.code = "netease_cookie_ids_invalid";
                return next(error);
            }
            const { weapiRequest } = require("../../services/netease-weapi");
            const { json, status } = await weapiRequest(globalThis.fetch, "/weapi/v1/playlist/manipulate/tracks", {
                trackIds: JSON.stringify(ids.map(Number)),
                pid: playlistId,
                op: "add",
                imme: "true"
            }, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200) {
                if (Number(json?.code) === 502) return res.json({ added: 0, note: "歌曲已在歌单中。" });
                const error = new Error(String(json?.message || "添加失败。"));
                error.status = 502;
                error.code = "netease_cookie_add_failed";
                return next(error);
            }
            res.json({ added: ids.length, playlist_id: playlistId });
        } catch (error) {
            next(error);
        }
    });

    router.delete("/providers/netease/cookie/playlist/tracks", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const session = await neteaseCookie.read(scope);
            if (!session) {
                const error = new Error("还没有连接网易云，请先完成 App 内一键登录。");
                error.status = 400;
                error.code = "netease_cookie_not_connected";
                return next(error);
            }
            const playlistId = String(req.body?.playlist_id || "").trim();
            const ids = (Array.isArray(req.body?.track_ids) ? req.body.track_ids : [req.body?.track_ids])
                .map((value) => String(value || "").trim())
                .filter((value) => /^\d{1,20}$/.test(value))
                .slice(0, 100);
            if (!/^\d{1,20}$/.test(playlistId) || ids.length === 0) {
                const error = new Error("歌单编号或歌曲编号不正确。");
                error.status = 400;
                error.code = "netease_cookie_ids_invalid";
                return next(error);
            }
            const { weapiRequest } = require("../../services/netease-weapi");
            const { json, status } = await weapiRequest(globalThis.fetch, "/weapi/v1/playlist/manipulate/tracks", {
                trackIds: JSON.stringify(ids.map(Number)),
                pid: playlistId,
                op: "del",
                imme: "true"
            }, session.cookie_text);
            if (status !== 200 || Number(json?.code) !== 200) {
                const error = new Error(String(json?.message || "移除失败。"));
                error.status = 502;
                error.code = "netease_cookie_remove_failed";
                return next(error);
            }
            res.json({ removed: ids.length, playlist_id: playlistId });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createMusicCookieRouter };

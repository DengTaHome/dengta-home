const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");
const express = require("express");
const http = require("node:http");
const { createPublicBilibiliRouter } = require("../routes/public-bilibili");
const { mediaRequestLifetime, relayMediaBody } = require("../services/media-stream-relay");

test("slow destination pauses upstream reads until drain and releases listeners", async () => {
    let reads = 0, release, cancelled = 0;
    const body = new ReadableStream({
        pull(controller) { reads++; if (reads < 4) controller.enqueue(new Uint8Array([reads])); else controller.close(); },
        cancel() { cancelled++; }
    }, { highWaterMark: 0 });
    const written = [];
    const res = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) { written.push(...chunk); release = callback; } });
    const req = new EventEmitter();
    const lifetime = mediaRequestLifetime(req, res); lifetime.ready();
    const pending = relayMediaBody({ body }, res, lifetime);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1); assert.deepEqual(written, [1]);
    for (let i = 0; i < 3; i++) { release(); await new Promise(resolve => setImmediate(resolve)); }
    await pending; lifetime.dispose();
    assert.deepEqual(written, [1, 2, 3]); assert.equal(cancelled, 0);
    assert.equal(req.listenerCount("aborted"), 0); assert.equal(res.listenerCount("drain"), 0);
});

test("client close during pending body cancels it and cannot finish successfully", async () => {
    let cancelled = 0;
    const body = new ReadableStream({ cancel() { cancelled++; } });
    const req = new EventEmitter(), res = new Writable({ write(_chunk, _encoding, cb) { cb(); } });
    const lifetime = mediaRequestLifetime(req, res); lifetime.ready();
    const pending = relayMediaBody({ body }, res, lifetime);
    res.emit("close");
    await assert.rejects(pending, { code: "media_client_closed" }); lifetime.dispose();
    assert.equal(cancelled, 1); assert.equal(res.writableEnded, false);
});

test("stalled read and stalled drain have bounded idle deadlines", async () => {
    for (const drain of [false, true]) {
        let cancelled = 0;
        const body = new ReadableStream({ start(c) { if (drain) c.enqueue(new Uint8Array([1])); }, cancel() { cancelled++; } });
        const req = new EventEmitter(), res = new Writable({ highWaterMark: 1, write() {} });
        const lifetime = mediaRequestLifetime(req, res); lifetime.ready();
        await assert.rejects(relayMediaBody({ body }, res, lifetime, 15), error => error.code === "bilibili_stream_idle_timeout" || error.cause?.code === "bilibili_stream_idle_timeout");
        lifetime.dispose(); assert.equal(cancelled, 1); assert.equal(res.listenerCount("drain"), 0);
    }
});

async function withRoute(fetchImpl, action, options = {}) {
    const app = express();
    app.use(createPublicBilibiliRouter({ fetchImpl, ...options }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, message: error.message }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    try { await action(`http://127.0.0.1:${server.address().port}`); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function fixture(view, media = null) {
    return async (url, options) => {
        if (url.includes("/view?")) return typeof view === "function" ? view(options) : Response.json(view);
        if (url.includes("/wbi/playurl?")) return Response.json({ code: 0, data: { durl: [{ url: "https://media.example.test/video" }] } });
        if (url.startsWith("https://media.example.test")) return media(options);
        return Response.json({ code: 0, data: {} });
    };
}
test("real router distinguishes upstream errors without leaking upstream text", async () => {
    for (const [view, status, code] of [
        [{ code: -404 }, 404, "bilibili_video_not_found"],
        [{ code: -412, message: "PRIVATE_UPSTREAM_TEXT" }, 502, "bilibili_platform_restricted"],
        [() => { throw Error("PRIVATE_NETWORK_TEXT"); }, 502, "bilibili_network_failed"],
        [() => new Response("PRIVATE_INVALID_BODY"), 502, "bilibili_response_invalid"],
        [() => new Response("PRIVATE_HTTP_BODY", { status: 503 }), 502, "bilibili_http_failed"]
    ]) await withRoute(fixture(view), async base => {
        for (const path of ["bilibili-stream", "bilibili-resolve"]) {
            const response = await fetch(`${base}/${path}?bvid=BV1234567890`);
            assert.equal(response.status, status); const data = await response.json();
            assert.equal(data.code, code); assert.ok(!JSON.stringify(data).includes("PRIVATE_"));
        }
    });
});
test("metadata timeout aborts the actual fetch signal", async () => {
    let aborted = false;
    await withRoute(fixture(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true }))), async base => {
        const response = await fetch(`${base}/bilibili-stream?bvid=BV1234567890`);
        assert.equal(response.status, 504); assert.equal((await response.json()).code, "bilibili_metadata_timeout");
    }, { metadataTimeoutMs: 20 });
    assert.equal(aborted, true);
});
test("Range and bytes survive the real router and stream completion", async () => {
    await withRoute(fixture({ code: 0, data: { cid: 1 } }, options => {
        assert.equal(options.headers.Range, "bytes=1-3"); assert.ok(options.signal instanceof AbortSignal);
        return new Response(new Uint8Array([2, 3, 4]), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 1-3/4", "accept-ranges": "bytes" } });
    }), async base => {
        const response = await fetch(`${base}/bilibili-stream?bvid=BV1234567890`, { headers: { Range: "bytes=1-3" } });
        assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), "bytes 1-3/4");
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4]);
    });
});
test("invalid Range remains 416 and does not become a gateway error", async () => {
    await withRoute(fixture({ code: 0, data: { cid: 1 } }, () => new Response(null, { status: 416, headers: { "content-range": "bytes */4" } })), async base => {
        const response = await fetch(`${base}/bilibili-stream?bvid=BV1234567890`);
        assert.equal(response.status, 416); assert.equal(response.headers.get("content-range"), "bytes */4");
    });
});
test("idle before first byte clears media headers before sending diagnostic JSON", async () => {
    await withRoute(fixture({ code: 0, data: { cid: 1 } }, () => new Response(new ReadableStream({}), { headers: { "content-length": "999", "content-type": "video/mp4" } })), async base => {
        const response = await fetch(`${base}/bilibili-stream?bvid=BV1234567890`);
        assert.equal(response.status, 504); assert.match(response.headers.get("content-type"), /json/);
        assert.equal((await response.json()).code, "bilibili_stream_idle_timeout");
    }, { idleTimeoutMs: 15 });
});
test("a movie can keep streaming beyond the metadata deadline", async () => {
    await withRoute(fixture({ code: 0, data: { cid: 1 } }, () => {
        let index = 0;
        return new Response(new ReadableStream({ async pull(controller) {
            await new Promise(resolve => setTimeout(resolve, 15));
            if (index++ < 4) controller.enqueue(new Uint8Array([index])); else controller.close();
        } }, { highWaterMark: 0 }));
    }), async base => {
        const response = await fetch(`${base}/bilibili-stream?bvid=BV1234567890`);
        assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
    }, { metadataTimeoutMs: 40, idleTimeoutMs: 50 });
});
test("closing the real HTTP client cancels the upstream body", async () => {
    let cancelled;
    const cancellation = new Promise(resolve => { cancelled = resolve; });
    await withRoute(fixture({ code: 0, data: { cid: 1 } }, () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled(); }
    }))), async base => {
        await new Promise((resolve, reject) => {
            const request = http.get(`${base}/bilibili-stream?bvid=BV1234567890`, response => {
                response.once("data", () => { response.destroy(); request.destroy(); resolve(); });
                response.on("error", () => {});
            });
            request.on("error", reject);
        });
        await Promise.race([cancellation, new Promise((_resolve, reject) => { const timer=setTimeout(() => reject(Error("Upstream was not cancelled")), 1000); timer.unref(); })]);
    });
});

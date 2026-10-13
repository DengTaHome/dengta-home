const { once } = require("node:events");

function mediaError(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

function mediaRequestLifetime(req, res, timeoutMs = 30_000) {
    const controller = new AbortController();
    const abort = () => controller.abort(mediaError(499, "media_client_closed", "播放器已经关闭。"));
    req.on("aborted", abort);
    res.on("close", abort);
    const timer = setTimeout(() => controller.abort(mediaError(504, "bilibili_metadata_timeout", "视频信息读取超时，请重试。")), timeoutMs);
    return {
        controller,
        signal: controller.signal,
        ready: () => clearTimeout(timer),
        dispose: () => {
            clearTimeout(timer);
            req.off("aborted", abort);
            res.off("close", abort);
            controller.abort();
        }
    };
}

async function relayMediaBody(upstream, res, lifetime, idleTimeoutMs = 30_000) {
    const reader = upstream.body.getReader();
    const { controller, signal } = lifetime;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    let completed = false;
    try {
        while (true) {
            signal.throwIfAborted();
            const timer = setTimeout(() => controller.abort(mediaError(504, "bilibili_stream_idle_timeout", "视频传输停滞，请重新载入播放器。")), idleTimeoutMs);
            try {
                const { done, value } = await reader.read();
                signal.throwIfAborted();
                if (done) { completed = true; break; }
                if (!res.write(Buffer.from(value))) await once(res, "drain", { signal });
            } finally {
                clearTimeout(timer);
            }
        }
        res.end();
    } finally {
        signal.removeEventListener("abort", cancel);
        if (!completed) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

module.exports = { mediaError, mediaRequestLifetime, relayMediaBody };

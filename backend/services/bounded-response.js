function responseTooLargeError() {
    const error = new Error("Upstream response exceeded the configured limit.");
    error.code = "UPSTREAM_RESPONSE_TOO_LARGE";
    error.status = 502;
    return error;
}

function contentLength(response) {
    const raw = response?.headers?.get?.("content-length");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readResponseTextLimited(
    response,
    { maxBytes = 1024 * 1024, createError = responseTooLargeError, stopWhen = null } = {}
) {
    const limit = Math.max(1024, Number(maxBytes) || 1024 * 1024);
    const declared = contentLength(response);
    if (declared !== null && declared > limit) throw createError();

    if (response?.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value || []);
                total += chunk.length;
                if (total > limit) {
                    await reader.cancel().catch(() => {});
                    throw createError();
                }
                chunks.push(chunk);
                if (stopWhen?.(Buffer.concat(chunks, total).toString("utf8"))) {
                    await reader.cancel().catch(() => {});
                    break;
                }
            }
        } finally {
            reader.releaseLock?.();
        }
        return Buffer.concat(chunks, total).toString("utf8");
    }

    const text = await response.text();
    if (Buffer.byteLength(String(text || ""), "utf8") > limit) {
        throw createError();
    }
    return String(text || "");
}

module.exports = {
    contentLength,
    readResponseTextLimited
};

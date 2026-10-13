"use strict";

// Vision image description for DengTa chat attachments.
// When the active chat model is text-only, a configured OpenAI-compatible
// vision API (Groq / DashScope / GLM / OpenRouter ...) describes image
// attachments so the companion can still "see" them.
// Graceful: unconfigured or failing vision calls simply return "".

const VISION_PROMPT =
    "请用中文详细描述这张图片的内容：人物、物品、场景、文字、颜色、布局，以及任何值得注意的细节。只输出描述正文，不要评论。";

function visionConfig(env = process.env) {
    return {
        apiKey: String(env.VISION_API_KEY || "").trim(),
        baseUrl: String(env.VISION_BASE_URL || "https://api.groq.com/openai/v1").trim().replace(/\/$/, ""),
        model: String(env.VISION_MODEL || "llama-3.2-11b-vision-preview").trim(),
        maxTokens: Math.min(4096, Math.max(128, Number(env.VISION_MAX_TOKENS) || 1024)),
        timeoutMs: Math.min(120000, Math.max(10000, Number(env.VISION_TIMEOUT_MS) || 60000))
    };
}

function visionConfigured(env = process.env) {
    const config = visionConfig(env);
    return Boolean(config.apiKey && config.baseUrl && config.model);
}

async function describeImageWithDebug(buffer, mimeType, config = visionConfig(), fetchImpl = globalThis.fetch) {
    const debug = { configured: false, httpStatus: null, error: "" };
    const key = String(config?.apiKey || "").trim();
    const baseUrl = String(config?.baseUrl || "").trim().replace(/\/$/, "");
    const model = String(config?.model || "").trim();
    debug.configured = Boolean(key && baseUrl && model);
    if (!key || !baseUrl || !model) {
        debug.error = "vision unconfigured";
        return { text: "", debug };
    }
    if (!buffer || buffer.length === 0) {
        debug.error = "empty buffer";
        return { text: "", debug };
    }
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const mediaType = String(mimeType || "image/png").trim() || "image/png";
    debug.model = model;
    try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                max_tokens: Math.min(4096, Math.max(128, Number(config.maxTokens) || 1024)),
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: VISION_PROMPT },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mediaType};base64,${bytes.toString("base64")}`
                                }
                            }
                        ]
                    }
                ]
            }),
            signal: AbortSignal.timeout(
                Math.min(120000, Math.max(10000, Number(config.timeoutMs) || 60000))
            )
        });
        debug.httpStatus = response.status;
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            debug.error = body.slice(0, 300);
            return { text: "", debug };
        }
        const json = await response.json().catch(() => ({}));
        const text = String(json?.choices?.[0]?.message?.content || "").trim();
        if (!text) debug.error = "empty completion";
        return { text: Array.from(text).slice(0, 4000).join(""), debug };
    } catch (error) {
        debug.error = String(error?.name || "fetch_error") + ": " + String(error?.message || error).slice(0, 200);
        return { text: "", debug };
    }
}

async function describeImage(buffer, mimeType, config = visionConfig(), fetchImpl = globalThis.fetch) {
    const result = await describeImageWithDebug(buffer, mimeType, config, fetchImpl);
    return result.text;
}

module.exports = {
    VISION_PROMPT,
    describeImage,
    describeImageWithDebug,
    visionConfig,
    visionConfigured
};

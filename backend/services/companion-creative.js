const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const {
    assertPublicMcpEndpoint,
    decryptCredential,
    encryptCredential
} = require("./mcp-device-center");

const ARTWORK_BUCKET = "companion-artworks";
const MAX_PROVIDER_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERATION_MODES = new Set(["confirm", "autonomous", "off"]);
const ARTWORK_KINDS = new Set(["avatar", "doodle", "gift"]);
const CREDENTIAL_STATES = new Set([
    "missing",
    "needs_reentry",
    "not_required",
    "ready",
    "unavailable"
]);
const IMAGE_SIGNATURES = Object.freeze({
    "image/jpeg": {
        extension: "jpg",
        matches(bytes) {
            return (
                bytes.length >= 3 &&
                bytes[0] === 0xff &&
                bytes[1] === 0xd8 &&
                bytes[2] === 0xff
            );
        }
    },
    "image/png": {
        extension: "png",
        matches(bytes) {
            return (
                bytes.length >= 8 &&
                bytes
                    .subarray(0, 8)
                    .equals(
                        Buffer.from([
                            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a,
                            0x0a
                        ])
                    )
            );
        }
    },
    "image/webp": {
        extension: "webp",
        matches(bytes) {
            return (
                bytes.length >= 12 &&
                bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
                bytes.subarray(8, 12).toString("ascii") === "WEBP"
            );
        }
    }
});

function creativeError(message, code, status = 400, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.isPublicCreativeError = true;
    Object.assign(error, details);
    return error;
}

function publicCreativeError(error) {
    if (error?.isPublicCreativeError === true) {
        const credentialState = CREDENTIAL_STATES.has(error.credential_state)
            ? error.credential_state
            : null;
        const credentialScope = ["artwork", "image_provider"].includes(
            error.credential_scope
        )
            ? error.credential_scope
            : null;
        const metadataState = CREDENTIAL_STATES.has(error.metadata_state)
            ? error.metadata_state
            : null;
        return {
            status: Number(error.status) || 500,
            code: cleanText(error.code, 100) || "creative_request_failed",
            message:
                cleanText(error.message, 400) ||
                "创作请求暂时没有完成，请稍后再试。",
            ...(credentialState
                ? { credential_state: credentialState }
                : {}),
            ...(error.credential_reentry_required === true
                ? { credential_reentry_required: true }
                : {}),
            ...(credentialScope
                ? { credential_scope: credentialScope }
                : {}),
            ...(metadataState ? { metadata_state: metadataState } : {}),
            ...(error.metadata_reentry_required === true
                ? { metadata_reentry_required: true }
                : {}),
            ...(Number(error.upstream_status)
                ? { upstream_status: Number(error.upstream_status) }
                : {})
        };
    }
    return {
        status: 500,
        code: "creative_request_failed",
        message: "创作请求暂时没有完成，请稍后再试。"
    };
}

function cleanText(value, maxLength = 1000) {
    return Array.from(String(value ?? "").trim())
        .slice(0, maxLength)
        .join("");
}

function normalizeIdentity(identity = {}) {
    const userId = cleanText(identity.userId, 80);
    const companionId = cleanText(identity.companionId, 80);
    if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(companionId)) {
        throw new TypeError(
            "Creative studio requires valid user and companion identifiers."
        );
    }
    return Object.freeze({ userId, companionId });
}

function normalizeGenerationMode(value, fallback = "confirm") {
    const normalized = cleanText(value || fallback, 24).toLowerCase();
    if (!GENERATION_MODES.has(normalized)) {
        throw creativeError(
            "图片生成权限只能是每次确认、自主创作或关闭。",
            "creative_mode_invalid"
        );
    }
    return normalized;
}

function normalizeCallLimit(value, max) {
    if (value === null || value === undefined || value === "" || Number(value) === 0) {
        return null;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > max) {
        throw creativeError(
            `调用上限必须是 1 到 ${max} 的整数，或留空表示不设上限。`,
            "creative_limit_invalid"
        );
    }
    return number;
}

function normalizeCreativeSettings(input = {}, current = {}) {
    const generationMode = normalizeGenerationMode(
        input.generation_mode ?? current.generation_mode ?? "confirm"
    );
    const surpriseEnabled =
        generationMode === "autonomous" &&
        (Object.hasOwn(input, "surprise_enabled")
            ? input.surprise_enabled === true
            : current.surprise_enabled === true);
    const maxSurpriseDays = Number(
        input.max_surprise_days ?? current.max_surprise_days ?? 30
    );
    if (
        !Number.isInteger(maxSurpriseDays) ||
        maxSurpriseDays < 1 ||
        maxSurpriseDays > 365
    ) {
        throw creativeError(
            "秘密惊喜最晚揭晓天数必须在 1 到 365 天之间。",
            "creative_surprise_days_invalid"
        );
    }
    return {
        generation_mode: generationMode,
        daily_call_limit: normalizeCallLimit(
            input.daily_call_limit ?? current.daily_call_limit,
            1000
        ),
        monthly_call_limit: normalizeCallLimit(
            input.monthly_call_limit ?? current.monthly_call_limit,
            10000
        ),
        surprise_enabled: surpriseEnabled,
        max_surprise_days: maxSurpriseDays
    };
}

function publicCreativeSettings(row = {}) {
    return {
        generation_mode: normalizeGenerationMode(
            row.generation_mode || "confirm"
        ),
        daily_call_limit:
            Number.isInteger(row.daily_call_limit) &&
            row.daily_call_limit > 0
                ? row.daily_call_limit
                : null,
        monthly_call_limit:
            Number.isInteger(row.monthly_call_limit) &&
            row.monthly_call_limit > 0
                ? row.monthly_call_limit
                : null,
        surprise_enabled: row.surprise_enabled === true,
        max_surprise_days: Math.max(
            1,
            Math.min(365, Number(row.max_surprise_days) || 30)
        ),
        updated_at: row.updated_at || null
    };
}

function scopedSecretContext(identity, type) {
    return [
        cleanText(type, 120),
        identity.userId,
        identity.companionId
    ].join("\u0000");
}

function scopedSecretDigest(identity, type) {
    return crypto
        .createHash("sha256")
        .update(scopedSecretContext(identity, type))
        .digest("base64url")
        .slice(0, 22);
}

function encryptScopedSecret(value, identity, type, env = process.env) {
    const text = String(value || "");
    if (!text) return null;
    return [
        "ctx1",
        scopedSecretDigest(identity, type),
        encryptCredential(text, env)
    ].join(".");
}

function decryptScopedSecret(value, identity, type, env = process.env) {
    if (!value) return "";
    const providerCredential = type === "image-provider";
    const [version, digest, ...cipherParts] = String(value).split(".");
    if (
        version !== "ctx1" ||
        digest !== scopedSecretDigest(identity, type) ||
        cipherParts.length !== 4
    ) {
        throw creativeError(
            providerCredential
                ? "图片接口凭据与当前账号不匹配，请重新填写图片 API Key。 / The image provider credential does not match this account. Re-enter the image API key."
                : "旧作品文案与当前账号不匹配，暂时无法读取；已有图片仍可查看，未完成作品需要重新构思。 / This legacy artwork metadata does not match the current account. Existing images remain viewable; unfinished artwork must be recreated.",
            "creative_secret_scope_invalid",
            503,
            providerCredential
                ? {
                      credential_state: "needs_reentry",
                      credential_reentry_required: true,
                      credential_scope: "image_provider"
                  }
                : {
                      metadata_state: "needs_reentry",
                      metadata_reentry_required: true
                  }
        );
    }
    try {
        return decryptCredential(cipherParts.join("."), env);
    } catch {
        throw creativeError(
            providerCredential
                ? "图片接口凭据无法解密，请重新填写图片 API Key。 / The image provider credential cannot be decrypted. Re-enter the image API key."
                : "旧作品文案暂时无法解密；已有图片仍可查看，未完成作品需要重新构思。 / This legacy artwork metadata cannot be decrypted. Existing images remain viewable; unfinished artwork must be recreated.",
            "creative_secret_invalid",
            503,
            providerCredential
                ? {
                      credential_state: "needs_reentry",
                      credential_reentry_required: true,
                      credential_scope: "image_provider"
                  }
                : {
                      metadata_state: "needs_reentry",
                      metadata_reentry_required: true
                  }
        );
    }
}

function inspectScopedSecret(value, identity, type, env = process.env) {
    if (!value) {
        return { state: "missing", usable: false, value: "" };
    }
    try {
        return {
            state: "ready",
            usable: true,
            value: decryptScopedSecret(value, identity, type, env)
        };
    } catch (error) {
        return {
            state: [
                "creative_secret_invalid",
                "creative_secret_scope_invalid"
            ].includes(error?.code)
                ? "needs_reentry"
                : "unavailable",
            usable: false,
            value: ""
        };
    }
}

function inspectImageProviderCredential(row, identity, env = process.env) {
    if (row?.auth_type === "none") {
        return {
            state: "not_required",
            usable: true,
            credential: ""
        };
    }
    const inspection = inspectScopedSecret(
        row?.secret_ciphertext,
        identity,
        "image-provider",
        env
    );
    return {
        state: inspection.state,
        usable: inspection.usable,
        credential: inspection.value
    };
}

function imageEndpoint(baseUrl) {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (/\/images\/generations$/i.test(normalizedPath)) {
        parsed.pathname = normalizedPath;
    } else {
        parsed.pathname = `${normalizedPath}/images/generations`.replace(
            /\/{2,}/g,
            "/"
        );
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
}

async function normalizeImageBaseUrl(
    value,
    {
        production = process.env.NODE_ENV === "production",
        lookup = dns.lookup
    } = {}
) {
    try {
        const normalized = await assertPublicMcpEndpoint(value, {
            production,
            lookup
        });
        return new URL(normalized).toString().replace(/\/+$/, "");
    } catch (error) {
        throw creativeError(
            cleanText(
                String(error?.message || "图片接口地址不可用")
                    .replaceAll("MCP", "图片")
                    .replaceAll("设备", "接口"),
                400
            ),
            String(error?.code || "creative_provider_url_invalid").replace(
                /^MCP_/,
                "CREATIVE_PROVIDER_"
            ),
            Number(error?.status) || 400
        );
    }
}

function publicImageProvider(row, credentialInspection = null) {
    if (!row) {
        return {
            configured: false,
            enabled: false,
            auth_configured: false,
            credential_state: "missing",
            credential_reentry_required: false,
            last_status: "untested",
            last_error_code: null,
            last_checked_at: null
        };
    }
    const credentialState =
        credentialInspection?.state ||
        (row.auth_type === "none"
            ? "not_required"
            : row.secret_ciphertext
              ? "stored"
              : "missing");
    const credentialUsable =
        typeof credentialInspection?.usable === "boolean"
            ? credentialInspection.usable
            : row.auth_type === "none" || Boolean(row.secret_ciphertext);
    return {
        configured: true,
        id: row.id,
        name: row.name,
        protocol: "openai-images",
        base_url: row.base_url,
        auth_type: row.auth_type || "bearer",
        auth_configured: credentialUsable,
        credential_state: credentialState,
        credential_reentry_required: credentialState === "needs_reentry",
        routable: row.enabled === true && credentialUsable,
        model: row.model || "",
        enabled: row.enabled === true,
        last_status: row.last_status || "untested",
        last_error_code: cleanText(row.last_error_code, 120) || null,
        last_checked_at: row.last_checked_at || null,
        updated_at: row.updated_at || null
    };
}

function normalizeArtworkKind(value) {
    const kind = cleanText(value || "doodle", 24).toLowerCase();
    if (!ARTWORK_KINDS.has(kind)) {
        throw creativeError(
            "作品类型只能是头像、涂鸦或礼物。",
            "creative_kind_invalid"
        );
    }
    return kind;
}

function normalizeIdea(input = {}) {
    const prompt = cleanText(input.prompt, 6000);
    const description = cleanText(input.description || input.idea, 1200);
    if (!prompt || !description) {
        throw creativeError(
            "这次构思还不完整，暂时不会调用图片接口。",
            "creative_idea_incomplete"
        );
    }
    const inspirationIds = [
        ...new Set(
            (Array.isArray(input.inspiration_ids)
                ? input.inspiration_ids
                : []
            )
                .map((id) => cleanText(id, 80))
                .filter((id) => UUID_PATTERN.test(id))
        )
    ].slice(0, 6);
    return {
        kind: normalizeArtworkKind(input.kind),
        title: cleanText(input.title, 120) || "一张没有命名的画",
        description,
        prompt,
        reason:
            cleanText(input.reason, 800) ||
            "想把这一刻留下来。",
        alt_text:
            cleanText(input.alt_text || input.alt, 500) ||
            "AI 伴侣创作的图片",
        ...(inspirationIds.length > 0
            ? { inspiration_ids: inspirationIds }
            : {}),
        surprise: input.surprise === true,
        reveal_after_minutes: Math.max(
            1,
            Math.min(
                365 * 24 * 60,
                Math.round(Number(input.reveal_after_minutes) || 24 * 60)
            )
        )
    };
}

function imageTypeForBytes(bytes, hintedMimeType = "") {
    const hinted = cleanText(hintedMimeType, 80)
        .split(";")[0]
        .toLowerCase();
    if (IMAGE_SIGNATURES[hinted]?.matches(bytes)) {
        return { mimeType: hinted, ...IMAGE_SIGNATURES[hinted] };
    }
    for (const [mimeType, definition] of Object.entries(IMAGE_SIGNATURES)) {
        if (definition.matches(bytes)) {
            return { mimeType, ...definition };
        }
    }
    throw creativeError(
        "图片供应商返回的文件不是可识别的 JPG、PNG 或 WebP。",
        "creative_provider_image_invalid",
        502
    );
}

function invalidUploadedImageStructure() {
    return creativeError(
        "图片文件结构不完整或已经损坏。",
        "creative_upload_invalid"
    );
}

function stripJpegMetadata(bytes) {
    if (
        bytes.length < 4 ||
        bytes[0] !== 0xff ||
        bytes[1] !== 0xd8
    ) {
        return bytes;
    }
    const parts = [bytes.subarray(0, 2)];
    let offset = 2;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            throw invalidUploadedImageStructure();
        }
        while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) {
            offset += 1;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xda || marker === 0xd9) {
            parts.push(bytes.subarray(offset));
            return Buffer.concat(parts);
        }
        if (
            marker === 0x01 ||
            marker === 0xd8 ||
            (marker >= 0xd0 && marker <= 0xd7)
        ) {
            parts.push(bytes.subarray(offset, offset + 2));
            offset += 2;
            continue;
        }
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) {
            throw invalidUploadedImageStructure();
        }
        const end = offset + 2 + length;
        if (![0xe1, 0xed].includes(marker)) {
            parts.push(bytes.subarray(offset, end));
        }
        offset = end;
    }
    throw invalidUploadedImageStructure();
}

function stripPngMetadata(bytes) {
    const signature = IMAGE_SIGNATURES["image/png"];
    if (!signature.matches(bytes)) return bytes;
    const parts = [bytes.subarray(0, 8)];
    const strippedTypes = new Set([
        "eXIf",
        "tEXt",
        "zTXt",
        "iTXt",
        "iCCP"
    ]);
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > bytes.length) {
            throw invalidUploadedImageStructure();
        }
        const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
        if (!strippedTypes.has(type)) {
            parts.push(bytes.subarray(offset, end));
        }
        offset = end;
        if (type === "IEND") {
            ended = true;
            break;
        }
    }
    if (!ended || offset !== bytes.length) {
        throw invalidUploadedImageStructure();
    }
    return Buffer.concat(parts);
}

function stripWebpMetadata(bytes) {
    if (!IMAGE_SIGNATURES["image/webp"].matches(bytes)) return bytes;
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
        throw invalidUploadedImageStructure();
    }
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const type = bytes.subarray(offset, offset + 4).toString("ascii");
        const length = bytes.readUInt32LE(offset + 4);
        const paddedLength = length + (length % 2);
        const end = offset + 8 + paddedLength;
        if (end > bytes.length) {
            throw invalidUploadedImageStructure();
        }
        if (!["EXIF", "XMP "].includes(type)) {
            const chunk = Buffer.from(bytes.subarray(offset, end));
            if (type === "VP8X" && length >= 1) {
                chunk[8] &= ~0x0c;
            }
            chunks.push(chunk);
        }
        offset = end;
    }
    if (offset !== bytes.length) {
        throw invalidUploadedImageStructure();
    }
    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(body.length + 4, 4);
    header.write("WEBP", 8, "ascii");
    return Buffer.concat([header, body]);
}

function sanitizeUploadedImage(bytes, hintedMimeType = "") {
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
        throw creativeError(
            "请选择一张可读取的图片。",
            "creative_upload_empty"
        );
    }
    if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
        throw creativeError(
            "手动上传的图片不能超过 12MB。",
            "creative_upload_too_large",
            413
        );
    }
    const type = imageTypeForBytes(bytes, hintedMimeType);
    const sanitized =
        type.mimeType === "image/jpeg"
            ? stripJpegMetadata(bytes)
            : type.mimeType === "image/png"
              ? stripPngMetadata(bytes)
              : stripWebpMetadata(bytes);
    if (sanitized.length > MAX_STORED_IMAGE_BYTES) {
        throw creativeError(
            "处理后的图片仍超过 5MB，请在手机相册中缩小后再上传。",
            "creative_upload_display_too_large",
            413
        );
    }
    return {
        bytes: sanitized,
        mimeType: type.mimeType,
        extension: type.extension
    };
}

async function readLimitedResponseBody(response, maxBytes) {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw creativeError(
            "图片供应商返回的文件超过 12MB。",
            "creative_provider_image_too_large",
            502
        );
    }
    if (!response.body?.getReader) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maxBytes) {
            throw creativeError(
                "图片供应商返回的文件超过 12MB。",
                "creative_provider_image_too_large",
                502
            );
        }
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw creativeError(
                "图片供应商返回的文件超过 12MB。",
                "creative_provider_image_too_large",
                502
            );
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
}

function base64Image(value) {
    const normalized = String(value || "")
        .replace(/^data:[^;]+;base64,/, "")
        .replace(/\s/g, "");
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
        throw creativeError(
            "图片供应商没有返回可读取的图片。",
            "creative_provider_image_missing",
            502
        );
    }
    const bytes = Buffer.from(normalized, "base64");
    if (!bytes.length || bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
        throw creativeError(
            "图片供应商返回的文件为空或超过 12MB。",
            "creative_provider_image_too_large",
            502
        );
    }
    return bytes;
}

function upstreamCreativeError(status) {
    if ([401, 403].includes(status)) {
        return creativeError(
            "图片供应商拒绝了 API Key，请检查图片接口凭据。",
            "creative_provider_auth_failed",
            502,
            { upstream_status: status }
        );
    }
    if (status === 429) {
        return creativeError(
            "图片供应商额度不足或触发了频率限制。",
            "creative_provider_rate_limited",
            502,
            { upstream_status: status }
        );
    }
    if (status >= 400 && status < 500) {
        return creativeError(
            "图片供应商拒绝了这次生成，请检查模型和接口格式。",
            "creative_provider_rejected",
            502,
            { upstream_status: status }
        );
    }
    return creativeError(
        "图片供应商暂时不可用，请稍后再试。",
        "creative_provider_unavailable",
        502,
        { upstream_status: status }
    );
}

function generatedImageReference(payload) {
    const seen = new Set();
    const base64Keys = new Set([
        "b64_json",
        "b64",
        "base64",
        "base64_image",
        "image_base64",
        "result",
        "image",
        "data"
    ]);
    const urlKeys = new Set(["url", "image_url", "imageUrl"]);

    function visit(value, key = "", depth = 0) {
        if (depth > 8 || value === null || value === undefined) return null;
        if (typeof value === "string") {
            const text = value.trim();
            if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(text)) {
                return { type: "base64", value: text };
            }
            if (/^https?:\/\//i.test(text)) {
                return urlKeys.has(key) || ["result", "image"].includes(key)
                    ? { type: "url", value: text }
                    : null;
            }
            if (
                base64Keys.has(key) &&
                text.length >= 16 &&
                /^[A-Za-z0-9+/\s]+={0,2}$/.test(text)
            ) {
                return { type: "base64", value: text };
            }
            return null;
        }
        if (typeof value !== "object" || seen.has(value)) return null;
        seen.add(value);

        if (Array.isArray(value)) {
            for (const item of value) {
                const found = visit(item, key, depth + 1);
                if (found) return found;
            }
            return null;
        }

        for (const candidateKey of [
            "b64_json",
            "b64",
            "base64",
            "base64_image",
            "image_base64",
            "result",
            "image",
            "url",
            "image_url",
            "imageUrl",
            "data"
        ]) {
            if (!Object.hasOwn(value, candidateKey)) continue;
            const found = visit(value[candidateKey], candidateKey, depth + 1);
            if (found) return found;
        }
        for (const child of Object.values(value)) {
            const found = visit(child, "", depth + 1);
            if (found) return found;
        }
        return null;
    }

    return visit(payload);
}

async function fetchGeneratedImage({
    provider,
    credential,
    prompt,
    fetchImpl = fetch,
    lookup = dns.lookup,
    production = process.env.NODE_ENV === "production"
}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    timer.unref?.();
    try {
        const endpoint = imageEndpoint(provider.base_url);
        const headers = {
            Accept: "application/json, image/*",
            "Content-Type": "application/json",
            ...(provider.auth_type === "none"
                ? {}
                : { Authorization: `Bearer ${credential}` })
        };
        const requestBody = {
            model: provider.model,
            prompt,
            size: "1024x1024",
            n: 1,
            response_format: "b64_json"
        };
        const request = (body) =>
            fetchImpl(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal
            });
        let response = await request(requestBody);
        if ([400, 422].includes(response.status)) {
            await response.body?.cancel?.().catch(() => {});
            const { response_format: _ignored, ...compatibleBody } =
                requestBody;
            response = await request(compatibleBody);
        }
        if (!response.ok) throw upstreamCreativeError(response.status);

        const contentType = cleanText(
            response.headers?.get?.("content-type"),
            120
        )
            .split(";")[0]
            .toLowerCase();
        if (contentType.startsWith("image/")) {
            const bytes = await readLimitedResponseBody(
                response,
                MAX_PROVIDER_IMAGE_BYTES
            );
            return {
                bytes,
                ...imageTypeForBytes(bytes, contentType)
            };
        }

        const payload = await response.json().catch(() => null);
        const result = generatedImageReference(payload);
        if (result?.type === "base64") {
            const bytes = base64Image(result.value);
            return {
                bytes,
                ...imageTypeForBytes(bytes)
            };
        }
        if (result?.type !== "url") {
            throw creativeError(
                "图片供应商没有返回可识别的图片数据。请检查接口是否兼容 Images API，或查看供应商返回格式。",
                "creative_provider_image_missing",
                502
            );
        }
        const safeUrl = await normalizeImageBaseUrl(result.value, {
            production,
            lookup
        });
        const imageResponse = await fetchImpl(safeUrl, {
            headers: { Accept: "image/*" },
            redirect: "error",
            signal: controller.signal
        }).catch(() => null);
        if (!imageResponse?.ok) {
            throw creativeError(
                "图片供应商给出的下载地址无法读取。",
                "creative_provider_image_download_failed",
                502
            );
        }
        const bytes = await readLimitedResponseBody(
            imageResponse,
            MAX_PROVIDER_IMAGE_BYTES
        );
        return {
            bytes,
            ...imageTypeForBytes(
                bytes,
                imageResponse.headers?.get?.("content-type")
            )
        };
    } catch (error) {
        if (error?.isPublicCreativeError === true) throw error;
        if (error?.name === "AbortError") {
            throw creativeError(
                "图片供应商生成超时，请稍后再试。",
                "creative_provider_timeout",
                504
            );
        }
        throw creativeError(
            "无法连接图片供应商，请检查网络和 Base URL。",
            "creative_provider_unavailable",
            502
        );
    } finally {
        clearTimeout(timer);
    }
}

function hiddenArtwork(row) {
    return (
        row?.visibility === "surprise" &&
        !["revealed", "deleted"].includes(row?.state)
    );
}

function publicArtwork(row, identity, env = process.env) {
    const descriptionInspection = inspectScopedSecret(
        row.description_ciphertext,
        identity,
        `artwork-description:${row.id}`,
        env
    );
    const reasonInspection = inspectScopedSecret(
        row.generation_reason_ciphertext,
        identity,
        `artwork-reason:${row.id}`,
        env
    );
    const credentialState = [descriptionInspection, reasonInspection].some(
        (inspection) => inspection.state === "needs_reentry"
    )
        ? "needs_reentry"
        : [descriptionInspection, reasonInspection].some(
                (inspection) => inspection.state === "unavailable"
            )
          ? "unavailable"
          : [descriptionInspection, reasonInspection].every(
                  (inspection) => inspection.state === "ready"
              )
            ? "ready"
            : "missing";
    const hasImage =
        Boolean(row.storage_path) &&
        ["ready", "revealed"].includes(row.state);
    return {
        id: row.id,
        kind: row.kind,
        state: row.state,
        title: row.title,
        description: descriptionInspection.value,
        reason: reasonInspection.value,
        metadata_state: credentialState,
        metadata_reentry_required: credentialState === "needs_reentry",
        ...(credentialState === "needs_reentry"
            ? {
                  metadata_message: hasImage
                      ? "旧作品文案暂不可读，但已有图片仍可查看。 / Legacy artwork text is temporarily unreadable, but the existing image remains viewable."
                      : "旧作品文案暂不可读，未完成作品需要重新构思。 / Legacy artwork text is temporarily unreadable; unfinished artwork must be recreated."
              }
            : {}),
        alt_text: row.alt_text || "AI 伴侣创作的图片",
        image_url: hasImage
            ? `/api/v2/creative/artworks/${encodeURIComponent(
                  row.id
              )}/image`
            : null,
        model: row.model || "",
        actual_call_count: Number(row.actual_call_count) || 0,
        inspiration_ids: Array.isArray(row.inspiration_ids)
            ? row.inspiration_ids.filter((id) => UUID_PATTERN.test(id)).slice(0, 6)
            : [],
        failure_code: cleanText(row.failure_code, 120) || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        revealed_at: row.revealed_at || null
    };
}

function createCompanionCreativeCenter({
    database,
    storage,
    identity,
    env = process.env,
    fetchImpl = fetch,
    lookup = dns.lookup,
    now = () => new Date()
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("Creative studio requires a tenant database.");
    }
    if (!storage || typeof storage.from !== "function") {
        throw new TypeError("Creative studio requires private storage.");
    }
    const owner = normalizeIdentity(identity);

    async function getSettingsRow() {
        const { data, error } = await database
            .from("companion_creative_settings")
            .select("*")
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (data) return data;
        const values = {
            generation_mode: "confirm",
            daily_call_limit: null,
            monthly_call_limit: null,
            surprise_enabled: false,
            max_surprise_days: 30
        };
        const created = await database
            .from("companion_creative_settings")
            .insert(values)
            .select("*")
            .single();
        if (!created.error) return created.data;
        if (created.error.code !== "23505") throw created.error;
        const retry = await database
            .from("companion_creative_settings")
            .select("*")
            .limit(1)
            .maybeSingle();
        if (retry.error) throw retry.error;
        if (!retry.data) throw created.error;
        return retry.data;
    }

    async function saveSettings(input = {}) {
        const current = await getSettingsRow();
        const normalized = normalizeCreativeSettings(input, current);
        if (normalized.surprise_enabled !== true) {
            const hidden = await hiddenSurpriseRows();
            if (hidden.length > 0) {
                const action = cleanText(
                    input.hidden_content_action,
                    20
                ).toLowerCase();
                if (!["reveal", "delete"].includes(action)) {
                    throw creativeError(
                        "还有尚未揭晓的内容。请选择立即揭晓或永久删除后，再关闭秘密惊喜。",
                        "creative_hidden_action_required",
                        409
                    );
                }
                for (const artwork of hidden) {
                    if (action === "delete") {
                        await deleteArtwork(artwork.id);
                    } else if (
                        artwork.state === "ready_hidden" &&
                        artwork.storage_path
                    ) {
                        await revealArtwork(artwork.id);
                    } else {
                        const { error } = await database
                            .from("companion_artworks")
                            .update({
                                state: "cancelled",
                                failure_code: "creative_surprise_disabled",
                                updated_at: now().toISOString()
                            })
                            .eq("id", artwork.id);
                        if (error) throw error;
                    }
                }
            }
        }
        const changes = {
            ...normalized,
            updated_at: now().toISOString()
        };
        const { data, error } = await database
            .from("companion_creative_settings")
            .update(changes)
            .eq("id", current.id)
            .select("*")
            .single();
        if (error) throw error;
        if (changes.generation_mode !== "autonomous") {
            await database
                .from("background_jobs")
                .update({
                    status: "cancelled",
                    completed_at: now().toISOString(),
                    updated_at: now().toISOString()
                })
                .eq("job_type", "creative_check")
                .eq("status", "pending");
        }
        if (changes.surprise_enabled !== true) {
            await database
                .from("background_jobs")
                .update({
                    status: "cancelled",
                    completed_at: now().toISOString(),
                    updated_at: now().toISOString()
                })
                .eq("job_type", "surprise_reveal")
                .eq("status", "pending");
        }
        return publicCreativeSettings(data);
    }

    async function getProviderRow() {
        const { data, error } = await database
            .from("image_provider_profiles")
            .select("*")
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function saveProvider(input = {}) {
        const existing = await getProviderRow();
        const existingCredential = existing
            ? inspectImageProviderCredential(existing, owner, env)
            : null;
        const name =
            cleanText(input.name ?? existing?.name, 80) ||
            "我的图片接口";
        const baseUrl = await normalizeImageBaseUrl(
            input.base_url ?? existing?.base_url,
            {
                production: env.NODE_ENV === "production",
                lookup
            }
        );
        const authType =
            input.auth_type === "none" ||
            (input.auth_type === undefined &&
                existing?.auth_type === "none")
                ? "none"
                : "bearer";
        const model = cleanText(input.model ?? existing?.model, 160);
        if (!model) {
            throw creativeError(
                "请填写图片生成模型名。",
                "creative_provider_model_required"
            );
        }
        const suppliedCredential = cleanText(input.credential, 8000);
        let secretCiphertext =
            authType === "none" ? null : existing?.secret_ciphertext || null;
        if (authType === "bearer" && suppliedCredential) {
            secretCiphertext = encryptScopedSecret(
                suppliedCredential,
                owner,
                "image-provider",
                env
            );
        }
        if (authType === "bearer" && !secretCiphertext) {
            throw creativeError(
                "请填写图片接口 API Key。 / Please enter the image provider API key.",
                "creative_provider_credential_required",
                400,
                {
                    credential_state: "missing",
                    credential_scope: "image_provider"
                }
            );
        }
        if (
            authType === "bearer" &&
            input.enabled === true &&
            !suppliedCredential &&
            existingCredential?.usable !== true
        ) {
            throw creativeError(
                "旧图片接口凭据无法使用，请重新填写图片 API Key 后再启用。 / The legacy image provider credential is unavailable. Re-enter the image API key before enabling it.",
                "creative_provider_credential_reentry_required",
                409,
                {
                    credential_state:
                        existingCredential?.state === "needs_reentry"
                            ? "needs_reentry"
                            : "missing",
                    credential_reentry_required:
                        existingCredential?.state === "needs_reentry",
                    credential_scope: "image_provider"
                }
            );
        }
        const values = {
            name,
            protocol: "openai-images",
            base_url: baseUrl,
            auth_type: authType,
            secret_ciphertext: secretCiphertext,
            model,
            enabled: input.enabled === true,
            last_status: "configuration_ok",
            last_error_code: null,
            last_checked_at: now().toISOString(),
            updated_at: now().toISOString()
        };
        const result = existing
            ? await database
                  .from("image_provider_profiles")
                  .update(values)
                  .eq("id", existing.id)
                  .select("*")
                  .single()
            : await database
                  .from("image_provider_profiles")
                  .insert(values)
                  .select("*")
                  .single();
        if (result.error) throw result.error;
        return publicImageProvider(
            result.data,
            inspectImageProviderCredential(result.data, owner, env)
        );
    }

    async function recentUsage() {
        const startedAfter = new Date(
            now().getTime() - 31 * 24 * 60 * 60 * 1000
        ).toISOString();
        const { data, error } = await database
            .from("image_generation_calls")
            .select("started_at")
            .gte("started_at", startedAfter)
            .order("started_at", { ascending: false });
        if (error) throw error;
        const dayBoundary =
            now().getTime() - 24 * 60 * 60 * 1000;
        const monthBoundary =
            now().getTime() - 31 * 24 * 60 * 60 * 1000;
        let day = 0;
        let month = 0;
        for (const row of data || []) {
            const timestamp = Date.parse(row.started_at);
            if (!Number.isFinite(timestamp)) continue;
            if (timestamp >= monthBoundary) month += 1;
            if (timestamp >= dayBoundary) day += 1;
        }
        return { day, month };
    }

    async function hiddenSurpriseRows() {
        const { data, error } = await database
            .from("companion_artworks")
            .select("*")
            .eq("visibility", "surprise")
            .in("state", [
                "idea",
                "awaiting_confirmation",
                "generating",
                "ready_hidden",
                "failed"
            ])
            .is("deleted_at", null)
            .order("created_at", { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function status() {
        const [settings, provider, usage, hiddenSurprises] = await Promise.all([
            getSettingsRow(),
            getProviderRow(),
            recentUsage(),
            hiddenSurpriseRows()
        ]);
        const providerCredential = provider
            ? inspectImageProviderCredential(provider, owner, env)
            : null;
        return {
            ok: true,
            settings: publicCreativeSettings(settings),
            provider: publicImageProvider(provider, providerCredential),
            usage,
            surprise_shutdown_required: hiddenSurprises.length > 0,
            credential_reentry_required:
                providerCredential?.state === "needs_reentry",
            credentials_requiring_reentry:
                providerCredential?.state === "needs_reentry" ? 1 : 0
        };
    }

    async function createIdea(input = {}, options = {}) {
        const settings = await getSettingsRow();
        if (settings.generation_mode === "off") {
            throw creativeError(
                "当前已关闭 AI 图片生成；仍可以保留手动上传的图片。",
                "creative_generation_disabled",
                409
            );
        }
        const idea = normalizeIdea(input);
        const surprise =
            options.allowSurprise === true &&
            settings.generation_mode === "autonomous" &&
            settings.surprise_enabled === true &&
            idea.surprise === true;
        const artworkId = crypto.randomUUID();
        const createdAt = now().toISOString();
        const revealAt = surprise
            ? new Date(
                  Math.min(
                      now().getTime() +
                          idea.reveal_after_minutes * 60 * 1000,
                      now().getTime() +
                          settings.max_surprise_days *
                              24 *
                              60 *
                              60 *
                              1000
                  )
              ).toISOString()
            : null;
        const values = {
            id: artworkId,
            source_job_id: options.sourceJobId || null,
            kind: idea.kind,
            visibility: surprise ? "surprise" : "ordinary",
            state:
                options.generateImmediately === true
                    ? "generating"
                    : "awaiting_confirmation",
            title: idea.title,
            description_ciphertext: encryptScopedSecret(
                idea.description,
                owner,
                `artwork-description:${artworkId}`,
                env
            ),
            prompt_ciphertext: encryptScopedSecret(
                idea.prompt,
                owner,
                `artwork-prompt:${artworkId}`,
                env
            ),
            generation_reason_ciphertext: encryptScopedSecret(
                idea.reason,
                owner,
                `artwork-reason:${artworkId}`,
                env
            ),
            alt_text: idea.alt_text,
            inspiration_ids: idea.inspiration_ids || [],
            reveal_at: revealAt,
            created_at: createdAt,
            updated_at: createdAt
        };
        const { data, error } = await database
            .from("companion_artworks")
            .insert(values)
            .select("*")
            .single();
        if (error) throw error;
        return { row: data, idea, settings };
    }

    async function uploadArtwork(input = {}) {
        const image = sanitizeUploadedImage(
            input.bytes,
            input.mimeType
        );
        const artworkId = crypto.randomUUID();
        const kind = normalizeArtworkKind(input.kind || "doodle");
        const createdAt = now().toISOString();
        const title =
            cleanText(input.title, 120) ||
            (kind === "avatar" ? "手动上传的形象" : "手动保存的图片");
        const description =
            cleanText(input.description, 1200) ||
            "由用户手动上传到私人作品库。";
        const altText =
            cleanText(input.altText, 500) ||
            "用户手动上传的私人图片";
        const storagePath = [
            owner.userId,
            owner.companionId,
            createdAt.slice(0, 10),
            `${artworkId}.${image.extension}`
        ].join("/");
        const uploaded = await storage
            .from(ARTWORK_BUCKET)
            .upload(storagePath, image.bytes, {
                contentType: image.mimeType,
                upsert: false,
                cacheControl: "3600"
            });
        if (uploaded.error) throw uploaded.error;
        const values = {
            id: artworkId,
            kind,
            visibility: "ordinary",
            state: "ready",
            title,
            description_ciphertext: encryptScopedSecret(
                description,
                owner,
                `artwork-description:${artworkId}`,
                env
            ),
            prompt_ciphertext: null,
            generation_reason_ciphertext: encryptScopedSecret(
                "用户手动上传，没有调用图片模型。",
                owner,
                `artwork-reason:${artworkId}`,
                env
            ),
            alt_text: altText,
            storage_bucket: ARTWORK_BUCKET,
            storage_path: storagePath,
            mime_type: image.mimeType,
            byte_size: image.bytes.length,
            actual_call_count: 0,
            revealed_at: createdAt,
            created_at: createdAt,
            updated_at: createdAt
        };
        const { data, error } = await database
            .from("companion_artworks")
            .insert(values)
            .select("*")
            .single();
        if (error) {
            try {
                await storage
                    .from(ARTWORK_BUCKET)
                    .remove([storagePath]);
            } catch {
                // The failed database insert remains authoritative.
            }
            throw error;
        }
        return data;
    }

    async function requireArtwork(id) {
        if (!UUID_PATTERN.test(String(id || ""))) {
            throw creativeError(
                "作品编号格式不正确。",
                "creative_artwork_id_invalid"
            );
        }
        const { data, error } = await database
            .from("companion_artworks")
            .select("*")
            .eq("id", id)
            .maybeSingle();
        if (error) throw error;
        if (!data || data.deleted_at || data.state === "deleted") {
            throw creativeError(
                "找不到这件作品。",
                "creative_artwork_not_found",
                404
            );
        }
        return data;
    }

    async function artworkForSourceJob(jobId) {
        if (!UUID_PATTERN.test(String(jobId || ""))) return null;
        const { data, error } = await database
            .from("companion_artworks")
            .select("*")
            .eq("source_job_id", jobId)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function assertCallBudget(settings) {
        const usage = await recentUsage();
        if (
            settings.daily_call_limit &&
            usage.day >= settings.daily_call_limit
        ) {
            throw creativeError(
                "今天的图片生成调用次数已达到你设置的上限。",
                "creative_daily_limit_reached",
                409
            );
        }
        if (
            settings.monthly_call_limit &&
            usage.month >= settings.monthly_call_limit
        ) {
            throw creativeError(
                "本月的图片生成调用次数已达到你设置的上限。",
                "creative_monthly_limit_reached",
                409
            );
        }
        return usage;
    }

    function generationInProgress() {
        return creativeError(
            "这件作品正在生成或状态已变化，请刷新作品库查看结果，避免重复调用图片接口。",
            "creative_generation_in_progress",
            409
        );
    }

    function ownedArtworkAttempt(artwork, attempt, changes) {
        const query = changes === undefined
            ? database.from("companion_artworks").select("id")
            : database.from("companion_artworks").update(changes);
        return query
            .eq("id", artwork.id)
            .eq("user_id", owner.userId)
            .eq("companion_id", owner.companionId)
            .eq("state", "generating")
            .eq("actual_call_count", attempt)
            .is("deleted_at", null);
    }

    async function assertArtworkAttemptOwned(artwork, attempt) {
        const result = await ownedArtworkAttempt(artwork, attempt).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw generationInProgress();
    }

    async function recordCallStart(artwork, provider, options) {
        const previousAttempt = Number(artwork.actual_call_count || 0);
        const attempt = Number(artwork.actual_call_count || 0) + 1;
        const startedAt = now().toISOString();
        if (!["idea", "awaiting_confirmation", "failed", "generating"].includes(artwork.state)) throw generationInProgress();
        let previousCall = null;
        if (artwork.state === "generating" && previousAttempt > 0) {
            if (!artwork.source_job_id || typeof options.lease?.assertOwned !== "function") {
                const started = Date.parse(artwork.updated_at);
                if (Number.isFinite(started) && now().getTime() - started >= 300_000) {
                    throw creativeError(
                        "本次图片生成的结果未能确认。请先刷新作品库查看；仍无结果时，可删除本次作品后重新构思。重新生成可能产生新的接口费用。",
                        "creative_generation_recovery_required",
                        409
                    );
                }
                throw generationInProgress();
            }
            await options.lease.assertOwned();
            const previous = await database.from("image_generation_calls").select("*")
                .eq("artwork_id", artwork.id).eq("attempt", previousAttempt).maybeSingle();
            if (previous.error) throw previous.error;
            previousCall = previous.data;
            if (!["failed", "cancelled"].includes(previousCall?.status)) {
                const started = Date.parse(previousCall?.started_at || artwork.updated_at);
                // Only an owned background lease may recover an abandoned attempt,
                // after the provider's 120s timeout plus time for storage completion.
                if (previousCall?.status === "succeeded" || !Number.isFinite(started) || now().getTime() - started < 300_000) throw generationInProgress();
            }
        }
        const update = await database
            .from("companion_artworks")
            .update({
                state: "generating",
                provider_profile_id: provider.id,
                model: provider.model,
                actual_call_count: attempt,
                failure_code: null,
                updated_at: startedAt
            })
            .eq("id", artwork.id)
            .eq("user_id", owner.userId)
            .eq("companion_id", owner.companionId)
            .eq("state", artwork.state)
            .eq("actual_call_count", previousAttempt)
            .is("deleted_at", null)
            .select("*")
            .maybeSingle();
        if (update.error) throw update.error;
        if (!update.data) throw generationInProgress();
        if (previousCall?.status === "started") {
            await finishCall(previousCall.id, { status: "cancelled", error_code: "creative_attempt_superseded" }).catch(() => {});
        }
        const { data, error } = await database.from("image_generation_calls").insert({
            artwork_id: artwork.id, provider_profile_id: provider.id,
            attempt, status: "started", model: provider.model, started_at: startedAt
        }).select("*").single();
        if (error) {
            try {
                await ownedArtworkAttempt(artwork, attempt, {
                    state: "failed", failure_code: "creative_call_record_failed", updated_at: now().toISOString()
                });
            } catch {
                // A missing ledger receipt must never start an unrecorded provider call.
            }
            throw creativeError("图片调用记录暂时无法保存，本次没有调用图片接口，请稍后重试。", "creative_call_record_failed", 503);
        }
        return { call: data, artwork: update.data, attempt };
    }

    async function finishCall(callId, values) {
        const { error } = await database
            .from("image_generation_calls")
            .update({
                ...values,
                completed_at: now().toISOString()
            })
            .eq("id", callId)
            .eq("user_id", owner.userId)
            .eq("companion_id", owner.companionId)
            .eq("status", "started");
        if (error) throw error;
    }

    async function generateArtwork(id, options = {}) {
        const [settings, provider, artwork] = await Promise.all([
            getSettingsRow(),
            getProviderRow(),
            requireArtwork(id)
        ]);
        if (settings.generation_mode === "off") {
            throw creativeError(
                "当前已关闭 AI 图片生成。",
                "creative_generation_disabled",
                409
            );
        }
        if (
            ["ready", "ready_hidden", "revealed"].includes(artwork.state) &&
            artwork.storage_path
        ) {
            return artwork;
        }
        if (!provider?.enabled) {
            throw creativeError(
                "请先在设置里保存并启用独立的图片生成接口。",
                "creative_provider_not_enabled",
                409
            );
        }
        const providerCredential = inspectImageProviderCredential(
            provider,
            owner,
            env
        );
        if (!providerCredential.usable) {
            const requiresReentry =
                providerCredential.state === "needs_reentry";
            throw creativeError(
                requiresReentry
                    ? "图片接口凭据无法解密，请在设置中重新填写图片 API Key 后再生成。 / The image provider credential cannot be decrypted. Re-enter the image API key in Settings before generating."
                    : "图片接口还没有可用的 API Key，请先在设置中填写。 / The image provider does not have a usable API key. Enter one in Settings first.",
                requiresReentry
                    ? "creative_provider_credential_reentry_required"
                    : "creative_provider_credential_required",
                409,
                {
                    credential_state: providerCredential.state,
                    credential_reentry_required: requiresReentry,
                    credential_scope: "image_provider"
                }
            );
        }
        const promptInspection = inspectScopedSecret(
            artwork.prompt_ciphertext,
            owner,
            `artwork-prompt:${artwork.id}`,
            env
        );
        if (!promptInspection.usable) {
            const requiresReentry =
                promptInspection.state === "needs_reentry";
            throw creativeError(
                requiresReentry
                    ? "这件旧作品的生成提示无法解密，请重新构思后再生成。 / This legacy artwork prompt cannot be decrypted. Create a new idea before generating."
                    : "这件作品没有可用的生成提示，请重新构思后再生成。 / This artwork has no usable generation prompt. Create a new idea before generating.",
                requiresReentry
                    ? "creative_artwork_metadata_reentry_required"
                    : "creative_artwork_prompt_missing",
                409,
                {
                    metadata_state: promptInspection.state,
                    metadata_reentry_required: requiresReentry
                }
            );
        }
        const credential = providerCredential.credential;
        await assertCallBudget(settings);
        await options.lease?.assertOwned?.();
        const started = await recordCallStart(artwork, provider, options);
        let image;
        let uploadedPath = null, readyCommitted = false, completionUnknown = false;
        try {
            await options.lease?.assertOwned?.();
            await assertArtworkAttemptOwned(artwork, started.attempt);
            image = await fetchGeneratedImage({
                provider,
                credential,
                prompt: promptInspection.value,
                fetchImpl,
                lookup,
                production: env.NODE_ENV === "production"
            });
            if (image.bytes.length > MAX_STORED_IMAGE_BYTES) {
                throw creativeError(
                    "生成结果超过 5MB，未保存也不会占用作品空间。请换用更高压缩率的模型。",
                    "creative_output_too_large",
                    502
                );
            }
            await options.lease?.assertOwned?.();
            await assertArtworkAttemptOwned(artwork, started.attempt);
            const storagePath = [
                owner.userId,
                owner.companionId,
                now().toISOString().slice(0, 10),
                `${artwork.id}-${started.attempt}.${image.extension}`
            ].join("/");
            const uploaded = await storage
                .from(ARTWORK_BUCKET)
                .upload(storagePath, image.bytes, {
                    contentType: image.mimeType,
                    upsert: false,
                    cacheControl: "3600"
                });
            if (uploaded.error) throw uploaded.error;
            uploadedPath = storagePath;
            await options.lease?.assertOwned?.();
            const nextState =
                artwork.visibility === "surprise"
                    ? "ready_hidden"
                    : "ready";
            completionUnknown = true;
            const updated = await ownedArtworkAttempt(artwork, started.attempt, {
                    state: nextState,
                    storage_bucket: ARTWORK_BUCKET,
                    storage_path: storagePath,
                    mime_type: image.mimeType,
                    byte_size: image.bytes.length,
                    failure_code: null,
                    revealed_at:
                        nextState === "ready" ? now().toISOString() : null,
                    updated_at: now().toISOString()
                })
                .select("*")
                .maybeSingle();
            if (updated.error) throw updated.error;
            if (!updated.data) {
                completionUnknown = false;
                throw generationInProgress();
            }
            readyCommitted = true;
            await finishCall(started.call.id, { status: "succeeded" });
            await database
                .from("image_provider_profiles")
                .update({
                    last_status: "connected",
                    last_error_code: null,
                    last_checked_at: now().toISOString(),
                    updated_at: now().toISOString()
                })
                .eq("id", provider.id);
            return updated.data;
        } catch (error) {
            const publicError = publicCreativeError(error);
            await finishCall(started.call.id, {
                status: "failed",
                error_code: publicError.code
            }).catch(() => {});
            let failureOwned = false;
            try {
                await options.lease?.assertOwned?.();
                const failed = await ownedArtworkAttempt(artwork, started.attempt, {
                        state:
                            options.keepGeneratingForRetry === true
                                ? "generating"
                                : "failed",
                        failure_code: publicError.code,
                        updated_at: now().toISOString()
                    }).select("id").maybeSingle();
                failureOwned = !failed.error && Boolean(failed.data);
            } catch {
                // The original provider error remains the public failure.
            }
            if (uploadedPath && !readyCommitted) {
                try {
                    const reference = await database.from("companion_artworks").select("state,actual_call_count,storage_path")
                        .eq("id", artwork.id).eq("user_id", owner.userId).eq("companion_id", owner.companionId).maybeSingle();
                    const stillUnknown = completionUnknown && reference.data?.state === "generating" && Number(reference.data.actual_call_count) === started.attempt;
                    // A failed response can hide a committed UPDATE. Keep any referenced
                    // image, and retain an uncertain upload until ownership is known.
                    if (!reference.error && reference.data?.storage_path !== uploadedPath && !stillUnknown) {
                        await storage.from(ARTWORK_BUCKET).remove([uploadedPath]);
                    }
                } catch {
                    // Cleanup uncertainty must not delete an image that may be referenced.
                }
            }
            try {
                if (!failureOwned) throw generationInProgress();
                await database
                    .from("image_provider_profiles")
                    .update({
                        last_status: "error",
                        last_error_code: publicError.code,
                        last_checked_at: now().toISOString(),
                        updated_at: now().toISOString()
                    })
                    .eq("id", provider.id);
            } catch {
                // Provider health metadata must not replace the generation error.
            }
            throw error;
        }
    }

    async function listArtworks() {
        const { data, error } = await database
            .from("companion_artworks")
            .select("*")
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(100);
        if (error) throw error;
        return (data || [])
            .filter((row) => !hiddenArtwork(row))
            .map((row) => publicArtwork(row, owner, env));
    }

    async function downloadArtwork(id) {
        const artwork = await requireArtwork(id);
        if (
            hiddenArtwork(artwork) ||
            !artwork.storage_path ||
            !["ready", "revealed"].includes(artwork.state)
        ) {
            throw creativeError(
                "这件作品还不能查看。",
                "creative_artwork_not_visible",
                404
            );
        }
        const { data, error } = await storage
            .from(artwork.storage_bucket || ARTWORK_BUCKET)
            .download(artwork.storage_path);
        if (error || !data) {
            throw creativeError(
                "作品图片暂时无法读取。",
                "creative_artwork_download_failed",
                502
            );
        }
        const bytes =
            Buffer.isBuffer(data)
                ? data
                : Buffer.from(await data.arrayBuffer());
        return {
            bytes,
            mimeType: artwork.mime_type || "application/octet-stream",
            altText: artwork.alt_text || "AI 伴侣创作的图片"
        };
    }

    async function revealArtwork(id) {
        const artwork = await requireArtwork(id);
        if (
            artwork.visibility !== "surprise" ||
            artwork.state !== "ready_hidden" ||
            !artwork.storage_path
        ) {
            return artwork;
        }
        const { data, error } = await database
            .from("companion_artworks")
            .update({
                state: "revealed",
                revealed_at: now().toISOString(),
                updated_at: now().toISOString()
            })
            .eq("id", id)
            .select("*")
            .single();
        if (error) throw error;
        return data;
    }

    async function deleteArtwork(id) {
        const artwork = await requireArtwork(id);
        if (artwork.storage_path) {
            const { error } = await storage
                .from(artwork.storage_bucket || ARTWORK_BUCKET)
                .remove([artwork.storage_path]);
            if (error) {
                throw creativeError(
                    "作品文件暂时无法删除，请稍后再试。",
                    "creative_artwork_delete_failed",
                    502
                );
            }
        }
        const { error } = await database
            .from("companion_artworks")
            .update({
                state: "deleted",
                storage_path: null,
                storage_bucket: null,
                byte_size: 0,
                deleted_at: now().toISOString(),
                updated_at: now().toISOString()
            })
            .eq("id", artwork.id);
        if (error) throw error;
        return { deleted: true, id: artwork.id };
    }

    return Object.freeze({
        artworkForSourceJob,
        createIdea,
        deleteArtwork,
        downloadArtwork,
        generateArtwork,
        getProviderRow,
        getSettingsRow,
        listArtworks,
        publicArtwork: (row) => publicArtwork(row, owner, env),
        revealArtwork,
        saveProvider,
        saveSettings,
        status,
        uploadArtwork
    });
}

module.exports = {
    ARTWORK_BUCKET,
    MAX_PROVIDER_IMAGE_BYTES,
    MAX_STORED_IMAGE_BYTES,
    createCompanionCreativeCenter,
    creativeError,
    decryptScopedSecret,
    encryptScopedSecret,
    fetchGeneratedImage,
    inspectImageProviderCredential,
    inspectScopedSecret,
    normalizeCreativeSettings,
    normalizeIdea,
    publicCreativeError,
    publicCreativeSettings,
    publicImageProvider,
    sanitizeUploadedImage
};

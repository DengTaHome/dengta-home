const { randomBytes } = require("node:crypto");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    normalizeReplySuggestions
} = require("./reply-suggestions");
const {
    UPDATE_COMPANION_STATUS_TOOL,
    validateCompanionStatusToolArguments
} = require("./companion-status");
const {
    SELECT_COMPANION_STICKER_TOOL,
    isAllowedCompanionStickerId,
    parseCompanionStickerToolArguments
} = require("./companion-stickers");

const REPLY_SUGGESTION_ENVELOPE_VERSION = "v1";
const REPLY_SUGGESTION_ENVELOPE_MAX_CHARS = 4096;
const REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX =
    "<<<DENGTA_REPLY_SUGGESTIONS_V1:";
const REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX =
    "<<<END_DENGTA_REPLY_SUGGESTIONS_V1:";

function trailingPrefixLength(value, tokens) {
    const normalizedValue = value.toLowerCase();
    let retained = 0;
    for (const token of tokens) {
        const normalizedToken = token.toLowerCase();
        const maximum = Math.min(normalizedValue.length, token.length - 1);
        for (let length = maximum; length > retained; length -= 1) {
            if (
                normalizedValue.endsWith(
                    normalizedToken.slice(0, length)
                )
            ) {
                retained = length;
                break;
            }
        }
    }
    return retained;
}

function safeEnvelopeNonce(value) {
    const nonce = String(value || "").trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(nonce)
        ? nonce
        : randomBytes(16).toString("hex");
}

function normalizeStickerTool(value) {
    if (value?.name !== SELECT_COMPANION_STICKER_TOOL.name) return null;
    const properties = value.input_schema?.properties;
    const builtin = (Array.isArray(properties?.sticker_id?.enum) ? properties.sticker_id.enum : [])
        .filter(isAllowedCompanionStickerId);
    const custom = [];
    for (const id of Array.isArray(properties?.custom_sticker_id?.enum) ? properties.custom_sticker_id.enum : []) {
        const parsed = parseCompanionStickerToolArguments({ custom_sticker_id: id }, [{ id }]);
        if (parsed.ok && !custom.includes(parsed.value)) custom.push(parsed.value);
        if (custom.length === 48) break;
    }
    if (!builtin.length && !custom.length) return null;
    return Object.freeze({
        name: SELECT_COMPANION_STICKER_TOOL.name,
        description: typeof value.description === "string" ? value.description : "",
        builtin: Object.freeze([...new Set(builtin)]),
        custom: Object.freeze(custom)
    });
}

function parseEnvelopeSticker(value, stickerTool) {
    if (!stickerTool) return null;
    const parsed = parseCompanionStickerToolArguments(value, stickerTool.custom.map(id => ({ id })));
    if (!parsed.ok) return null;
    if (parsed.kind === "custom") return { custom_sticker_id: parsed.value };
    return stickerTool.builtin.includes(parsed.value) ? { sticker_id: parsed.value } : null;
}

function buildReplySuggestionEnvelopeInstruction({
    openMarker,
    closeMarker,
    includeReplySuggestions,
    includeCompanionStatus,
    stickerTool
}) {
    const lines = [
        "【DengTa 本轮隐藏元数据协议】",
        "先完整写出本轮给对方看的自然回复，再判断是否需要在正文最后紧接一行隐藏协议。"
    ];
    const example = {};

    if (includeCompanionStatus) {
        lines.push(
            UPDATE_COMPANION_STATUS_TOOL.description,
            "每轮都要结合最新消息、近期对话和当前状态检查自己的情绪与状态。只要 mood、place、focus、note、energy_level、pulse_bpm、hot_zones 或 micro_state 中任一项发生变化，就必须在 companion_status 中给出全部八个字段；只有八项都没有变化时才省略它。"
        );
        example.companion_status = {
            mood: "开心",
            place: "DengTa home",
            focus: "继续聊刚才的话题",
            note: "这句话让我心里亮了一下。",
            energy_level: 72,
            pulse_bpm: 80,
            hot_zones: ["heart"],
            micro_state: "忍不住靠近了一点"
        };
    }
    if (includeReplySuggestions) {
        lines.push(
            SELECT_REPLY_SUGGESTIONS_TOOL.description,
            "只有确实能生成两条合适候选时才写 suggestions，否则省略它。"
        );
        example.suggestions = ["第一条候选", "第二条候选"];
    }
    if (stickerTool) {
        lines.push(
            stickerTool.description,
            "需要配图时，在 sticker 中仅选择一个给定的 sticker_id 或 custom_sticker_id；不需要表情时省略 sticker，不得输出图片网址或文件路径。"
        );
        example.sticker = stickerTool.builtin.length
            ? { sticker_id: stickerTool.builtin[0] }
            : { custom_sticker_id: stickerTool.custom[0] };
    }

    const allowedFields = [
        ...(includeCompanionStatus ? ["companion_status"] : []),
        ...(includeReplySuggestions ? ["suggestions"] : []),
        ...(stickerTool ? ["sticker"] : [])
    ];
    lines.push(
        `${openMarker}${JSON.stringify(example)}${closeMarker}`,
        `协议 JSON 只能包含 ${allowedFields.join(" 和 ")}；没有任何元数据时完全省略整段协议。不要使用 Markdown 代码块，不要解释协议，不要在结束标记后输出除空白外的任何内容。`
    );
    return lines.join("\n");
}

function emptyEnvelopeMetadata(stickerTool) {
    return { suggestions: [], companionStatus: null, ...(stickerTool ? { sticker: null } : {}) };
}

function parseReplySuggestionEnvelopeMetadata(
    value,
    {
        includeReplySuggestions = true,
        includeCompanionStatus = false,
        stickerTool: rawStickerTool = null
    } = {}
) {
    const stickerTool = normalizeStickerTool(rawStickerTool);
    const empty = () => emptyEnvelopeMetadata(stickerTool);
    const source = String(value || "");
    if (
        !source ||
        Array.from(source).length > REPLY_SUGGESTION_ENVELOPE_MAX_CHARS
    ) {
        return empty();
    }

    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch {
        return empty();
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return empty();
    }
    const keys = Object.keys(parsed);
    const allowedKeys = new Set([
        ...(includeReplySuggestions ? ["suggestions"] : []),
        ...(includeCompanionStatus ? ["companion_status"] : []),
        ...(stickerTool ? ["sticker"] : [])
    ]);
    if (
        keys.length === 0 ||
        keys.some((key) => !allowedKeys.has(key))
    ) {
        return empty();
    }

    let suggestions = [];
    if (Object.hasOwn(parsed, "suggestions")) {
        suggestions = normalizeReplySuggestions(parsed.suggestions);
        if (suggestions.length !== 2) return empty();
    }

    let companionStatus = null;
    if (Object.hasOwn(parsed, "companion_status")) {
        const validated = validateCompanionStatusToolArguments(
            parsed.companion_status
        );
        if (!validated.ok) return empty();
        companionStatus = validated.value;
    }

    let sticker = null;
    if (Object.hasOwn(parsed, "sticker")) {
        sticker = parseEnvelopeSticker(parsed.sticker, stickerTool);
        if (!sticker) return empty();
    }
    return { suggestions, companionStatus, ...(stickerTool ? { sticker } : {}) };
}

function parseReplySuggestionEnvelopePayload(value) {
    return parseReplySuggestionEnvelopeMetadata(value).suggestions;
}

function createReplySuggestionEnvelopeFilter({
    nonce,
    openMarker,
    closeMarker,
    includeReplySuggestions,
    includeCompanionStatus,
    stickerTool
}) {
    const hiddenPrefixes = [
        REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX,
        REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX
    ];
    let visibleBuffer = "";
    let hiddenBuffer = "";
    let hiddenStarted = false;
    let openingComplete = false;
    let hiddenClosed = false;
    let invalid = false;
    let payload = "";
    let payloadCharacters = 0;
    let tailHasNonWhitespace = false;

    function appendPayload(value) {
        if (invalid || !value) return;
        const characters = Array.from(value);
        if (
            payloadCharacters + characters.length >
            REPLY_SUGGESTION_ENVELOPE_MAX_CHARS
        ) {
            invalid = true;
            payload = "";
            payloadCharacters = 0;
            return;
        }
        payload += value;
        payloadCharacters += characters.length;
    }

    function consumeHidden(value) {
        if (!value) return;
        if (invalid) return;
        if (hiddenClosed) {
            if (/\S/u.test(value)) tailHasNonWhitespace = true;
            return;
        }

        hiddenBuffer += value;
        if (!openingComplete) {
            const markerEnd = hiddenBuffer.indexOf(">>>");
            if (markerEnd < 0) {
                if (hiddenBuffer.length > openMarker.length) {
                    invalid = true;
                    hiddenBuffer = "";
                }
                return;
            }

            const emittedMarker = hiddenBuffer.slice(0, markerEnd + 3);
            if (emittedMarker.toLowerCase() !== openMarker.toLowerCase()) {
                invalid = true;
            }
            openingComplete = true;
            hiddenBuffer = hiddenBuffer.slice(markerEnd + 3);
            if (invalid) {
                hiddenBuffer = "";
                return;
            }
        }

        const closeIndex = hiddenBuffer
            .toLowerCase()
            .indexOf(closeMarker.toLowerCase());
        if (closeIndex >= 0) {
            appendPayload(hiddenBuffer.slice(0, closeIndex));
            if (
                /\S/u.test(
                    hiddenBuffer.slice(closeIndex + closeMarker.length)
                )
            ) {
                tailHasNonWhitespace = true;
            }
            hiddenBuffer = "";
            hiddenClosed = true;
            return;
        }

        const retained = trailingPrefixLength(hiddenBuffer, [closeMarker]);
        const consumableLength = hiddenBuffer.length - retained;
        if (consumableLength <= 0) return;

        appendPayload(hiddenBuffer.slice(0, consumableLength));
        hiddenBuffer = hiddenBuffer.slice(consumableLength);
    }

    function startHidden(value, markerIndex) {
        const visible = value.slice(0, markerIndex);
        hiddenStarted = true;
        visibleBuffer = "";
        consumeHidden(value.slice(markerIndex));
        return visible;
    }

    function push(value) {
        const chunk = String(value || "");
        if (!chunk) return "";
        if (hiddenStarted) {
            consumeHidden(chunk);
            return "";
        }

        visibleBuffer += chunk;
        const normalizedVisibleBuffer = visibleBuffer.toLowerCase();
        const openIndex = normalizedVisibleBuffer.indexOf(
            REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX.toLowerCase()
        );
        const strayCloseIndex = normalizedVisibleBuffer.indexOf(
            REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX.toLowerCase()
        );
        const markerIndexes = [openIndex, strayCloseIndex].filter(
            (index) => index >= 0
        );
        if (markerIndexes.length > 0) {
            const markerIndex = Math.min(...markerIndexes);
            if (markerIndex === strayCloseIndex) invalid = true;
            return startHidden(visibleBuffer, markerIndex);
        }

        const retained = trailingPrefixLength(visibleBuffer, hiddenPrefixes);
        const visibleLength = visibleBuffer.length - retained;
        const visible = visibleBuffer.slice(0, visibleLength);
        visibleBuffer = visibleBuffer.slice(visibleLength);
        return visible;
    }

    function finish() {
        if (!hiddenStarted) {
            const visible =
                visibleBuffer.length <= 3 ? visibleBuffer : "";
            visibleBuffer = "";
            return visible;
        }
        hiddenBuffer = "";
        return "";
    }

    function getMetadata() {
        if (
            !hiddenStarted ||
            !hiddenClosed ||
            invalid ||
            tailHasNonWhitespace ||
            !openMarker.endsWith(`${nonce}>>>`) ||
            !closeMarker.endsWith(`${nonce}>>>`)
        ) {
            return emptyEnvelopeMetadata(stickerTool);
        }
        return parseReplySuggestionEnvelopeMetadata(payload, {
            includeReplySuggestions,
            includeCompanionStatus,
            stickerTool
        });
    }

    return {
        push,
        finish,
        getSuggestions() {
            return getMetadata().suggestions;
        },
        getCompanionStatus() {
            return getMetadata().companionStatus;
        },
        getSticker() {
            return getMetadata().sticker || null;
        },
        getMetadata
    };
}

function createReplySuggestionEnvelopeProtocol(options = {}) {
    const nonce = safeEnvelopeNonce(options.nonce);
    const includeReplySuggestions =
        options.includeReplySuggestions !== false;
    const includeCompanionStatus = options.includeCompanionStatus === true;
    const normalizedStickerTool = normalizeStickerTool(options.stickerTool);
    const stickerTool = normalizedStickerTool ? Object.freeze({
        name: normalizedStickerTool.name,
        description: normalizedStickerTool.description,
        input_schema: {
            properties: {
                sticker_id: { enum: normalizedStickerTool.builtin },
                custom_sticker_id: { enum: normalizedStickerTool.custom }
            }
        }
    }) : null;
    const openMarker = `${REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX}${nonce}>>>`;
    const closeMarker = `${REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX}${nonce}>>>`;
    return Object.freeze({
        version: REPLY_SUGGESTION_ENVELOPE_VERSION,
        nonce,
        openMarker,
        closeMarker,
        instruction: buildReplySuggestionEnvelopeInstruction({
            openMarker,
            closeMarker,
            includeReplySuggestions,
            includeCompanionStatus,
            stickerTool: normalizedStickerTool
        }),
        createFilter() {
            return createReplySuggestionEnvelopeFilter({
                nonce,
                openMarker,
                closeMarker,
                includeReplySuggestions,
                includeCompanionStatus,
                stickerTool
            });
        },
        filterText(value) {
            const filter = createReplySuggestionEnvelopeFilter({
                nonce,
                openMarker,
                closeMarker,
                includeReplySuggestions,
                includeCompanionStatus,
                stickerTool
            });
            const text = `${filter.push(value)}${filter.finish()}`;
            const result = {
                text,
                suggestions: filter.getSuggestions()
            };
            if (includeCompanionStatus) {
                result.companionStatus = filter.getCompanionStatus();
            }
            if (normalizedStickerTool) result.sticker = filter.getSticker();
            return result;
        }
    });
}

async function executeReplySuggestionEnvelope(suggestions, executeTool) {
    const normalized = normalizeReplySuggestions(suggestions);
    if (normalized.length !== 2 || typeof executeTool !== "function") {
        return false;
    }

    try {
        const result = await executeTool({
            id: "reply_suggestions_envelope_v1",
            name: SELECT_REPLY_SUGGESTIONS_TOOL.name,
            arguments: JSON.stringify({ suggestions: normalized })
        });
        return result?.ok === true;
    } catch {
        return false;
    }
}

async function executeReplySuggestionEnvelopeMetadata(metadata, executeTool) {
    if (typeof executeTool !== "function") {
        return { companionStatus: false, suggestions: false };
    }

    let companionStatus = false;
    const validatedStatus = validateCompanionStatusToolArguments(
        metadata?.companionStatus
    );
    if (validatedStatus.ok) {
        try {
            const result = await executeTool({
                id: "companion_status_envelope_v1",
                name: UPDATE_COMPANION_STATUS_TOOL.name,
                arguments: JSON.stringify(validatedStatus.value)
            });
            companionStatus = result?.ok === true;
        } catch {
            companionStatus = false;
        }
    }

    const suggestions = await executeReplySuggestionEnvelope(
        metadata?.suggestions,
        executeTool
    );
    if (!Object.hasOwn(metadata || {}, "sticker")) return { companionStatus, suggestions };
    let sticker = false;
    const parsedSticker = parseCompanionStickerToolArguments(metadata.sticker,
        [{ id: metadata.sticker?.custom_sticker_id }]);
    if (parsedSticker.ok) {
        try {
            // The real selector rechecks this turn's tenant-scoped candidate allowlist.
            const result = await executeTool({
                id: "companion_sticker_envelope_v1",
                name: SELECT_COMPANION_STICKER_TOOL.name,
                arguments: JSON.stringify(parsedSticker.kind === "custom"
                    ? { custom_sticker_id: parsedSticker.value }
                    : { sticker_id: parsedSticker.value })
            });
            sticker = result?.ok === true;
        } catch {
            sticker = false;
        }
    }
    return { companionStatus, suggestions, sticker };
}

module.exports = {
    REPLY_SUGGESTION_ENVELOPE_CLOSE_PREFIX,
    REPLY_SUGGESTION_ENVELOPE_MAX_CHARS,
    REPLY_SUGGESTION_ENVELOPE_OPEN_PREFIX,
    REPLY_SUGGESTION_ENVELOPE_VERSION,
    createReplySuggestionEnvelopeProtocol,
    executeReplySuggestionEnvelope,
    executeReplySuggestionEnvelopeMetadata,
    parseReplySuggestionEnvelopeMetadata,
    parseReplySuggestionEnvelopePayload
};

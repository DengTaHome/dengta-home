// Streaming marker-splitting behavior is adapted from monologue-stream:
// Copyright (c) 2026 tsuru0805, MIT License.
// Fixed source: https://github.com/tsuru0805/monologue-stream/tree/74ecec69fb8cf29e87162d1a95d2e568306b3a86
// See ../THIRD_PARTY_NOTICES.md for the complete license notice.

const DEFAULT_OPEN_MARKER = "[monologue]";
const DEFAULT_CLOSE_MARKER = "[/monologue]";
const DEFAULT_MAX_CHARACTERS = 6000;
const VISIBLE_MONOLOGUE_SOURCE = "model_authored_visible_monologue";
const MONOLOGUE_BOUNDARY_PATTERN = /[\n.!?\u3002\uff01\uff1f]/g;
const MAX_PENDING_MONOLOGUE_CHARACTERS = 24000;
const REDACTED_MONOLOGUE_TEXT = "[redacted sensitive content]";

function characterSlice(value, maximum) {
    return Array.from(String(value || ""))
        .slice(0, maximum)
        .join("");
}

function redactCredentialLikeText(value) {
    return String(value || "")
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted credential]")
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted credential]")
        .replace(
            /(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b(\s*[:=]\s*)[^\s,;]+/gi,
            "$1$2[redacted credential]"
        )
        .replace(
            /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
            "[redacted private key]"
        );
}

function normalizeSensitiveLines(values) {
    const source = Array.isArray(values) ? values : [values];
    const lines = new Set();

    for (const value of source) {
        if (typeof value !== "string") continue;
        for (const line of value.split(/\r?\n/)) {
            const normalized = line.trim();
            if (Array.from(normalized).length >= 8) {
                lines.add(characterSlice(normalized, 1200));
            }
        }
    }
    return [...lines].sort((left, right) => right.length - left.length);
}

function sanitizeMonologueFragment(value, sensitiveLines) {
    let text = redactCredentialLikeText(
        String(value || "").replace(
            /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
            " "
        )
    );
    const trimmed = text.trim();
    if (
        Array.from(trimmed).length >= 8 &&
        sensitiveLines.some((line) => line.includes(trimmed))
    ) {
        return { text: REDACTED_MONOLOGUE_TEXT, redacted: true };
    }
    let redacted = text !== value;
    for (const line of sensitiveLines) {
        if (!text.includes(line)) continue;
        redacted = true;
        text = text.split(line).join(REDACTED_MONOLOGUE_TEXT);
    }
    return { text, redacted };
}

// Hold only a possible marker (bounded), never a complete reply or a typing queue.
function createVisibleMonologueSplitter({
    openMarker = DEFAULT_OPEN_MARKER,
    closeMarker = DEFAULT_CLOSE_MARKER,
    maxCharacters = DEFAULT_MAX_CHARACTERS,
    extract = true
} = {}) {
    if (typeof openMarker !== "string" || typeof closeMarker !== "string" || !openMarker || !closeMarker || /^\s/.test(openMarker)) {
        throw new TypeError("Visible monologue markers must be nonempty strings without leading whitespace.");
    }
    const defaultMarkers = openMarker === DEFAULT_OPEN_MARKER && closeMarker === DEFAULT_CLOSE_MARKER;
    const markerStarts = defaultMarkers ? ["["] : [...new Set([openMarker[0], closeMarker[0]])];
    const maximum = Number.isFinite(Number(maxCharacters)) ? Math.max(1, Math.round(Number(maxCharacters))) : DEFAULT_MAX_CHARACTERS;
    let buffer = "", inMonologue = false, sawMonologue = false;
    let characters = 0, displayTruncated = false, finalOutput = null;

    function drain(final = false) {
        let textDelta = "", monologueDelta = "", justClosed = false;
        function publish(value) {
            if (!extract || !inMonologue) { textDelta += value; return; }
            const units = Array.from(value);
            const visible = units.slice(0, Math.max(0, maximum - characters));
            characters += visible.length;
            displayTruncated ||= visible.length < units.length;
            monologueDelta += visible.join("");
        }
        while (buffer) {
            if (!markerStarts.includes(buffer[0])) {
                const positions = markerStarts.map(start => buffer.indexOf(start)).filter(index => index >= 0);
                const next = positions.length ? Math.min(...positions) : -1;
                let length = next < 0 ? buffer.length : next;
                const last = buffer.charCodeAt(length - 1);
                if (!final && next < 0 && last >= 0xd800 && last <= 0xdbff) length -= 1;
                if (!length) break;
                publish(buffer.slice(0, length));
                buffer = buffer.slice(length);
                continue;
            }
            const marker = defaultMarkers
                ? buffer.match(/^\[(\/?)monologue[a-z \t]{0,32}\]/i)
                : buffer.startsWith(openMarker) ? [openMarker, ""] : buffer.startsWith(closeMarker) ? [closeMarker, "/"] : null;
            if (marker) {
                buffer = buffer.slice(marker[0].length);
                if (marker[1] === "/") {
                    justClosed ||= inMonologue;
                    inMonologue = false;
                } else if (extract) {
                    sawMonologue = true;
                    inMonologue = true;
                }
                continue;
            }
            const lower = buffer.toLowerCase();
            const partialMarker = defaultMarkers
                ? "[monologue".startsWith(lower) || "[/monologue".startsWith(lower) || /^\[\/?monologue[a-z \t]{0,32}$/i.test(buffer)
                : openMarker.startsWith(buffer) || closeMarker.startsWith(buffer);
            if (!final && partialMarker) break;
            const code = buffer.charCodeAt(0);
            if (!final && buffer.length === 1 && code >= 0xd800 && code <= 0xdbff) break;
            const width = buffer.codePointAt(0) > 0xffff ? 2 : 1;
            publish(buffer.slice(0, width));
            buffer = buffer.slice(width);
        }
        return { textDelta, monologueDelta, justClosed, displayTruncated };
    }
    function push(value) {
        if (finalOutput) return { textDelta: "", monologueDelta: "", justClosed: false, displayTruncated };
        buffer += String(value || "");
        return drain();
    }
    function finish() {
        if (finalOutput) return finalOutput;
        const output = drain(true);
        finalOutput = {
            textDelta: output.textDelta,
            monologueDelta: output.monologueDelta,
            state: !sawMonologue || characters === 0 ? "missing" : inMonologue ? "truncated" : "complete",
            displayTruncated
        };
        return finalOutput;
    }
    return { push, finish };
}

function createVisibleMonologueOutput({
    enabled = false,
    onEvent,
    maxCharacters = DEFAULT_MAX_CHARACTERS,
    sensitiveTexts = []
} = {}) {
    const emitEvent = typeof onEvent === "function" ? onEvent : () => {};
    let splitter = createVisibleMonologueSplitter({ maxCharacters, extract: enabled });
    let text = "";
    const monologueSegments = [""];
    let segment = 0;
    let segmentOffset = 0;
    let publishedMonologueCharacters = 0;
    let segmentStates = [];
    let displayTruncated = false;
    let redacted = false;
    let pendingMonologue = "";
    let finished = false;
    let finalResult = null;
    const accumulatedSensitiveTexts = Array.isArray(sensitiveTexts)
        ? [...sensitiveTexts]
        : [sensitiveTexts];
    const strictSensitiveTexts = new Set();

    function collectStrictSensitiveText(value, depth = 0) {
        if (depth > 5 || strictSensitiveTexts.size >= 200) return;
        if (typeof value === "string") {
            const normalized = characterSlice(value.trim(), 1200);
            if (normalized) strictSensitiveTexts.add(normalized);
            if (/^[\[{]/.test(normalized)) {
                try {
                    collectStrictSensitiveText(
                        JSON.parse(normalized),
                        depth + 1
                    );
                } catch {
                    // The complete serialized value is still protected.
                }
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 50)) {
                collectStrictSensitiveText(item, depth + 1);
            }
            return;
        }
        if (value && typeof value === "object") {
            for (const item of Object.values(value).slice(0, 50)) {
                collectStrictSensitiveText(item, depth + 1);
            }
        }
    }

    function emitSanitizedMonologue(value) {
        const sanitized = sanitizeMonologueFragment(
            value,
            [
                ...normalizeSensitiveLines(accumulatedSensitiveTexts),
                ...strictSensitiveTexts
            ]
        );
        redacted = redacted || sanitized.redacted;
        if (!sanitized.text) return;
        const remaining = Math.max(
            0,
            Number(maxCharacters) - publishedMonologueCharacters
        );
        const content = characterSlice(sanitized.text, remaining);
        if (Array.from(sanitized.text).length > remaining) {
            displayTruncated = true;
        }
        if (!content) return;
        const contentCharacters = Array.from(content);
        monologueSegments[segment] += content;
        emitEvent({
            type: "monologue", phase: "delta", content,
            source: VISIBLE_MONOLOGUE_SOURCE, public: true,
            segment, offset: segmentOffset
        });
        segmentOffset += contentCharacters.length;
        publishedMonologueCharacters += contentCharacters.length;
    }

    function flushCompleteMonologueSentences() {
        let boundaryIndex = -1;
        for (const match of pendingMonologue.matchAll(
            MONOLOGUE_BOUNDARY_PATTERN
        )) {
            boundaryIndex = match.index + match[0].length;
        }
        if (boundaryIndex <= 0) return;
        const complete = pendingMonologue.slice(0, boundaryIndex);
        pendingMonologue = pendingMonologue.slice(boundaryIndex);
        emitSanitizedMonologue(complete);
    }

    function flushPendingMonologue() {
        if (!pendingMonologue) return;
        const value = pendingMonologue;
        pendingMonologue = "";
        emitSanitizedMonologue(value);
    }

    function emitSplitterOutput(output) {
        if (!output || typeof output !== "object") return;
        if (output.monologueDelta) {
            pendingMonologue += output.monologueDelta;
            if (
                Array.from(pendingMonologue).length >
                MAX_PENDING_MONOLOGUE_CHARACTERS
            ) {
                pendingMonologue = REDACTED_MONOLOGUE_TEXT;
                redacted = true;
            }
            flushCompleteMonologueSentences();
        }
        if (output.justClosed) flushPendingMonologue();
        displayTruncated =
            displayTruncated || output.displayTruncated === true;
        if (output.textDelta) {
            text += output.textDelta;
            emitEvent({ type: "text", content: output.textDelta });
        }
    }

    function settleSegment() {
        if (!splitter) return;
        const settled = splitter.finish();
        emitSplitterOutput(settled);
        flushPendingMonologue();
        segmentStates.push(settled.state);
    }

    function pushText(value) {
        if (finished) return;
        emitSplitterOutput(splitter.push(value));
    }

    function nextAssistantResponse() {
        if (!enabled || finished) return;
        settleSegment();
        segment += 1;
        segmentOffset = 0;
        monologueSegments.push("");
        splitter = createVisibleMonologueSplitter({ maxCharacters });
    }

    function addSensitiveText(value) {
        collectStrictSensitiveText(value);
    }

    function finish({ outcome = "success" } = {}) {
        if (finished) return finalResult;
        finished = true;

        settleSegment();
        const visibleSegments = monologueSegments
            .map((value) => value.trim())
            .filter(Boolean);
        const monologue = visibleSegments.join("\n\n");
        const state =
            outcome === "failed" || !text.trim()
                ? "failed"
                : !monologue
                  ? "missing"
                  : displayTruncated || segmentStates.includes("truncated")
                  ? "truncated"
                  : "complete";
        const snapshot = enabled && outcome === "success" && Boolean(text.trim())
            ? {
                  schema_version: 1,
                  text: monologue,
                  state,
                  source: VISIBLE_MONOLOGUE_SOURCE,
                  generated_with_reply: true,
                  segment_count: visibleSegments.length,
                  display_truncated: displayTruncated,
                  redacted
              }
            : null;

        if (enabled) {
            emitEvent({
                type: "monologue",
                phase: "end",
                source: VISIBLE_MONOLOGUE_SOURCE,
                public: true,
                state,
                display_truncated: displayTruncated,
                characters: Array.from(monologue).length
            });
        }
        finalResult = {
            text: text.trim(),
            visible_monologue: snapshot
        };
        return finalResult;
    }

    return {
        addSensitiveText,
        finish,
        nextAssistantResponse,
        pushText,
        get hasText() {
            return Boolean(text.trim());
        }
    };
}

module.exports = {
    DEFAULT_CLOSE_MARKER,
    DEFAULT_MAX_CHARACTERS,
    DEFAULT_OPEN_MARKER,
    VISIBLE_MONOLOGUE_SOURCE,
    createVisibleMonologueOutput,
    createVisibleMonologueSplitter,
    emptyReplyBodyError
};

function emptyReplyBodyError() {
    const error = new Error("模型输出未包含可分离的正文，可能仅返回了心声或未闭合标记。");
    error.code = "reply_body_missing";
    error.errorSource = "dengta_stream_parser";
    error.providerPhase = "output_parse";
    error.status = 502;
    return error;
}

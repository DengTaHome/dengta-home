export const INNER_MONOLOGUE_STORAGE_KEY =
  "dengta_visible_inner_monologues_v1";
export const VISIBLE_MONOLOGUE_SOURCE =
  "model_authored_visible_monologue";

const VISIBLE_MONOLOGUE_STATES = new Set([
  "streaming",
  "complete",
  "missing",
  "truncated",
  "failed",
]);
const TERMINAL_VISIBLE_MONOLOGUE_STATES = new Set([
  "complete",
  "missing",
  "truncated",
  "failed",
]);

function storageKey(accountScope = "") {
  const scope = String(accountScope || "").trim();
  return scope
    ? `${INNER_MONOLOGUE_STORAGE_KEY}:${scope}`
    : INNER_MONOLOGUE_STORAGE_KEY;
}

const MAX_RECORDS = 120;
const MAX_TEXT_LENGTH = 12_000;

function removeControlCharacters(value) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || [9, 10, 13].includes(code);
    })
    .join("");
}

function cleanText(value, maximum = MAX_TEXT_LENGTH) {
  return Array.from(removeControlCharacters(value).trim())
    .slice(0, maximum)
    .join("");
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = cleanText(value.text);
  if (!text) return null;
  const createdAt = Number.isFinite(Date.parse(value.createdAt))
    ? new Date(value.createdAt).toISOString()
    : new Date().toISOString();
  return { text, createdAt };
}

export function readInnerMonologues(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  if (!storage) return {};
  try {
    const source = JSON.parse(
      storage.getItem(storageKey(accountScope)) || "{}",
    );
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(source)
        .map(([messageId, value]) => [
          cleanText(messageId, 80),
          normalizeRecord(value),
        ])
        .filter(([messageId, value]) => messageId && value)
        .slice(-MAX_RECORDS),
    );
  } catch {
    return {};
  }
}

export function storeInnerMonologue(
  { messageId, text, createdAt = new Date().toISOString() },
  storage = globalThis.localStorage,
  accountScope = "",
) {
  const id = cleanText(messageId, 80);
  const record = normalizeRecord({ text, createdAt });
  if (!storage || !id || !record) {
    return readInnerMonologues(storage, accountScope);
  }
  const current = readInnerMonologues(storage, accountScope);
  const next = Object.fromEntries(
    [...Object.entries(current), [id, record]].slice(-MAX_RECORDS),
  );
  try {
    storage.setItem(storageKey(accountScope), JSON.stringify(next));
  } catch {
    // The generated text remains visible for this app session.
  }
  return next;
}

export function innerMonologueForMessage(records, messageId) {
  const value = records?.[String(messageId || "")];
  return normalizeRecord(value);
}

function normalizeVisibleMonologue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (value.source !== VISIBLE_MONOLOGUE_SOURCE) return null;

  const state = String(value.state || "").trim().toLowerCase();
  if (!VISIBLE_MONOLOGUE_STATES.has(state)) return null;

  const rawText = removeControlCharacters(value.text);
  const rawTextCharacters = Array.from(rawText);
  const text = rawTextCharacters.slice(0, MAX_TEXT_LENGTH).join("");
  const streamOffset = Number(value.stream_offset);
  const segment = Number(value.stream_segment ?? value.segment);
  const segmentStart = Number(value.stream_segment_start);
  const schemaVersion = Number(value.schema_version);
  const segmentCount = Number(value.segment_count);

  return {
    text,
    state,
    source: VISIBLE_MONOLOGUE_SOURCE,
    synchronized: true,
    generated_with_reply: value.generated_with_reply !== false,
    display_truncated:
      value.display_truncated === true ||
      rawTextCharacters.length > Array.from(text).length,
    ...(Number.isFinite(streamOffset)
      ? { stream_offset: Math.max(0, Math.trunc(streamOffset)) }
      : {}),
    ...(Number.isFinite(segment)
      ? { stream_segment: Math.max(0, Math.trunc(segment)) }
      : {}),
    ...(Number.isFinite(segmentStart)
      ? { stream_segment_start: Math.max(0, Math.trunc(segmentStart)) }
      : {}),
    ...(Number.isFinite(schemaVersion)
      ? { schema_version: Math.max(1, Math.trunc(schemaVersion)) }
      : {}),
    ...(Number.isFinite(segmentCount)
      ? { segment_count: Math.max(0, Math.trunc(segmentCount)) }
      : {}),
  };
}

function invalidSynchronizedSnapshot() {
  return {
    text: "",
    state: "failed",
    source: VISIBLE_MONOLOGUE_SOURCE,
    synchronized: true,
    generated_with_reply: true,
    display_truncated: false,
    invalid_snapshot: true,
  };
}

function toolCallSnapshot(message) {
  const toolCalls = message?.tool_calls;
  if (
    !toolCalls ||
    typeof toolCalls !== "object" ||
    Array.isArray(toolCalls) ||
    !Object.hasOwn(toolCalls, "visible_monologue")
  ) {
    return { present: false, value: null };
  }
  return { present: true, value: toolCalls.visible_monologue };
}

export function beginVisibleMonologueStream() {
  return {
    text: "",
    state: "streaming",
    source: VISIBLE_MONOLOGUE_SOURCE,
    synchronized: true,
    generated_with_reply: true,
    display_truncated: false,
    stream_offset: 0,
    stream_segment: 0,
    stream_segment_start: 0,
  };
}

export function isSynchronizedVisibleMonologue(value) {
  return normalizeVisibleMonologue(value)?.synchronized === true;
}

export function canRequestVisibleMonologue(message = {}, monologue = visibleMonologueForMessage(message)) {
  if (message.chatError || message.isStreaming || message.generationInProgress || (message.role && message.role !== "assistant") || message.tool_calls?.refusal_detected) return false;
  return !monologue || (TERMINAL_VISIBLE_MONOLOGUE_STATES.has(monologue.state) && !String(monologue.text || "").trim());
}

function settleCurrentVisibleSegment(value = {}) {
  const text = String(value.text || "");
  const characters = Array.from(text);
  const rawSegmentStart = Number(value.stream_segment_start);
  if (!Number.isFinite(rawSegmentStart)) return text.trim();
  const segmentStart = Math.min(
    characters.length,
    Math.max(0, Math.trunc(rawSegmentStart)),
  );
  const previousSegments = characters.slice(0, segmentStart).join("");
  const currentSegment = characters.slice(segmentStart).join("").trim();
  if (currentSegment) return `${previousSegments}${currentSegment}`;
  return previousSegments.endsWith("\n\n")
    ? previousSegments.slice(0, -2)
    : previousSegments.trim();
}

export function visibleMonologueForMessage(message = {}) {
  const snapshot = toolCallSnapshot(message);
  if (snapshot.present) {
    return normalizeVisibleMonologue(snapshot.value) ||
      invalidSynchronizedSnapshot();
  }

  if (Object.hasOwn(message, "visibleMonologue")) {
    return normalizeVisibleMonologue(message.visibleMonologue);
  }
  if (Object.hasOwn(message, "visible_monologue")) {
    return normalizeVisibleMonologue(message.visible_monologue);
  }
  return null;
}

export function reduceVisibleMonologueEvent(current, event = {}) {
  const previous = normalizeVisibleMonologue(current);
  if (
    event?.type !== "monologue" ||
    event?.source !== VISIBLE_MONOLOGUE_SOURCE ||
    !["delta", "end"].includes(event?.phase)
  ) {
    return previous;
  }
  if (previous && TERMINAL_VISIBLE_MONOLOGUE_STATES.has(previous.state) &&
      !(event.phase === "end" && event.state === "failed")) {
    return previous;
  }

  const base = previous || beginVisibleMonologueStream();
  if (event.phase === "end") {
    const state = String(event.state || "").trim().toLowerCase();
    return normalizeVisibleMonologue({
      ...base,
      text: settleCurrentVisibleSegment(base),
      state: TERMINAL_VISIBLE_MONOLOGUE_STATES.has(state) ? state : "failed",
      display_truncated:
        base.display_truncated === true || event.display_truncated === true,
    });
  }

  const chunk = removeControlCharacters(event.content);
  if (!chunk) return base;

  const existingCharacters = Array.from(base.text);
  const eventSegmentValue = Number(event.segment);
  const currentSegment = Number.isFinite(Number(base.stream_segment))
    ? Math.max(0, Math.trunc(Number(base.stream_segment)))
    : 0;
  const eventSegment = Number.isFinite(eventSegmentValue)
    ? Math.max(0, Math.trunc(eventSegmentValue))
    : currentSegment;
  if (eventSegment < currentSegment) return base;

  const currentOffset = Number.isFinite(Number(base.stream_offset))
    ? Math.max(0, Math.trunc(Number(base.stream_offset)))
    : existingCharacters.length;
  const startsNewSegment = eventSegment > currentSegment;
  const offset = Number(event.offset);
  const normalizedOffset = Number.isFinite(offset)
    ? Math.max(0, Math.trunc(offset))
    : startsNewSegment
      ? 0
      : currentOffset;
  if (startsNewSegment && normalizedOffset !== 0) {
    return { ...base, stream_gap: true };
  }

  const storedSegmentStart = Number(base.stream_segment_start);
  const currentSegmentStart = Number.isFinite(storedSegmentStart)
    ? Math.max(0, Math.trunc(storedSegmentStart))
    : Math.max(0, existingCharacters.length - currentOffset);
  if (!startsNewSegment) {
    const chunkCharacters = Array.from(chunk);
    if (normalizedOffset < currentOffset) {
      const existingSlice = existingCharacters
        .slice(
          currentSegmentStart + normalizedOffset,
          currentSegmentStart + normalizedOffset + chunkCharacters.length,
        )
        .join("");
      if (existingSlice === chunk) return base;
      return { ...base, stream_gap: true };
    }
    if (normalizedOffset > currentOffset) {
      return { ...base, stream_gap: true };
    }
  }

  const settledBaseText = startsNewSegment
    ? settleCurrentVisibleSegment(base)
    : base.text;
  const settledBaseCharacters = Array.from(settledBaseText);
  const separator = startsNewSegment && settledBaseText ? "\n\n" : "";
  const joined = `${settledBaseText}${separator}${chunk}`;
  const joinedCharacters = Array.from(joined);
  const text = joinedCharacters.slice(0, MAX_TEXT_LENGTH).join("");
  const chunkCharacters = Array.from(chunk);
  const nextSegmentStart = startsNewSegment
    ? settledBaseCharacters.length + Array.from(separator).length
    : currentSegmentStart;
  return normalizeVisibleMonologue({
    ...base,
    text,
    state: "streaming",
    stream_offset: normalizedOffset + chunkCharacters.length,
    stream_segment: eventSegment,
    stream_segment_start: nextSegmentStart,
    display_truncated:
      base.display_truncated === true ||
      joinedCharacters.length > Array.from(text).length,
  });
}

export function mergeAuthoritativeVisibleMonologue(
  current,
  serverMessage = {},
) {
  const snapshot = toolCallSnapshot(serverMessage);
  if (snapshot.present) {
    return normalizeVisibleMonologue(snapshot.value) ||
      invalidSynchronizedSnapshot();
  }

  const serverValue = visibleMonologueForMessage(serverMessage);
  if (serverValue) return serverValue;

  const previous = normalizeVisibleMonologue(current);
  if (previous && TERMINAL_VISIBLE_MONOLOGUE_STATES.has(previous.state)) {
    return previous;
  }
  return reduceVisibleMonologueEvent(previous || beginVisibleMonologueStream(), {
    type: "monologue",
    phase: "end",
    source: VISIBLE_MONOLOGUE_SOURCE,
    state: "missing",
  });
}

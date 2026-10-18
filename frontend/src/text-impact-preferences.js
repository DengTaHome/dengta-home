const KEY = "dengta_text_impact_v1:";
const defaults = Object.freeze({ auto: false, mode: "scatter", target: "composer" });
const records = new Map();
const listeners = new Set();

function normalize(value = {}) {
  return Object.freeze({ auto: value.auto === true,
    mode: value.mode === "burst" ? "burst" : "scatter",
    target: value.target === "avatar" ? "avatar" : "composer" });
}

export function readTextImpactPreference(scope = "") {
  if (!scope) return defaults;
  if (records.has(scope)) return records.get(scope);
  let value = defaults;
  try { value = normalize(JSON.parse(globalThis.localStorage?.getItem(KEY + scope) || "{}")); } catch { /* optional preference */ }
  records.set(scope, value);
  return value;
}

export function saveTextImpactPreference(scope, changes) {
  if (!scope) return defaults;
  const value = normalize({ ...readTextImpactPreference(scope), ...changes });
  records.set(scope, value);
  try { globalThis.localStorage?.setItem(KEY + scope, JSON.stringify(value)); } catch { /* remains usable this session */ }
  for (const listener of listeners) listener();
  return value;
}

export function subscribeTextImpactPreference(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

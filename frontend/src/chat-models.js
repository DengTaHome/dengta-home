import { resolveAccountCacheStorage } from "./account-cache-vault.js";

export const CHAT_MODEL_STORAGE_KEY = "dengta_chat_model_v1";
export const CHAT_SESSION_MODELS_STORAGE_KEY =
  "dengta_chat_session_models_v1";

function cleanText(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function normalizeModel(item) {
  if (typeof item === "string") {
    const id = cleanText(item);
    return id ? { id, label: id } : null;
  }

  if (!item || typeof item !== "object") return null;
  const id = cleanText(item.id || item.model || item.value || item.name);
  if (!id) return null;
  return {
    id,
    label: cleanText(item.label || item.display_name || item.name) || id,
  };
}

export function normalizeModelsResponse(value, fallbackModel = "") {
  const source = value && typeof value === "object" ? value : {};
  const rawModels = Array.isArray(source.models)
    ? source.models
    : Array.isArray(source.available_models)
      ? source.available_models
      : Array.isArray(source.data)
        ? source.data
        : [];
  const seen = new Set();
  const models = [];

  for (const item of rawModels) {
    const model = normalizeModel(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }

  const currentModel = cleanText(
    source.current_model || source.current || source.model || fallbackModel,
  );
  if (currentModel && !seen.has(currentModel)) {
    models.unshift({ id: currentModel, label: currentModel });
  }

  return { models, currentModel };
}

export function readStoredChatModel(
  storage,
  accountScope = "",
) {
  try {
    storage = resolveAccountCacheStorage(storage, accountScope);
    return cleanText(
      readAccountStorage(storage, CHAT_MODEL_STORAGE_KEY, accountScope, {
        migrateLegacy: true,
      }),
    );
  } catch {
    return "";
  }
}

export function storeChatModel(
  value,
  storage,
  accountScope = "",
) {
  const model = cleanText(value);
  const storageKey = accountStorageKey(CHAT_MODEL_STORAGE_KEY, accountScope);
  try {
    storage = resolveAccountCacheStorage(storage, accountScope);
    if (model) storage?.setItem(storageKey, model);
    else storage?.removeItem(storageKey);
  } catch {
    // 本机存储不可用时只影响下次启动的选择，不影响当前聊天。
  }
  return model;
}

function readStoredSessionModels(storage) {
  try {
    storage = resolveAccountCacheStorage(storage);
    const parsed = JSON.parse(
      storage?.getItem(CHAT_SESSION_MODELS_STORAGE_KEY) || "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([sessionId, model]) => [cleanText(sessionId), cleanText(model)])
        .filter(([sessionId, model]) => sessionId && model),
    );
  } catch {
    return {};
  }
}

export function readStoredSessionChatModel(
  sessionId,
  storage,
) {
  const key = cleanText(sessionId);
  if (!key) return "";
  return readStoredSessionModels(storage)[key] || "";
}

export function readServerSessionChatModel(sessions, sessionId) {
  const key = cleanText(sessionId);
  if (!key || !Array.isArray(sessions)) return "";
  const session = sessions.find((item) => cleanText(item?.id) === key);
  return cleanText(session?.model_id || session?.model);
}

export function storeSessionChatModel(
  sessionId,
  value,
  storage,
) {
  const key = cleanText(sessionId);
  const model = cleanText(value);
  if (!key) return model;

  try {
    storage = resolveAccountCacheStorage(storage);
    const stored = readStoredSessionModels(storage);
    if (model) stored[key] = model;
    else delete stored[key];
    if (Object.keys(stored).length > 0) {
      storage?.setItem(CHAT_SESSION_MODELS_STORAGE_KEY, JSON.stringify(stored));
    } else {
      storage?.removeItem(CHAT_SESSION_MODELS_STORAGE_KEY);
    }
  } catch {
    // Storage failure only affects restoration after this page is closed.
  }
  return model;
}

export function migrateLegacyChatModelToSession(
  sessionId,
  storage,
  accountScope = "",
) {
  const key = cleanText(sessionId);
  if (!key) return "";
  try { storage = resolveAccountCacheStorage(storage, accountScope); }
  catch { return ""; }

  const storedSessionModel = readStoredSessionChatModel(key, storage);
  const legacyModel = readStoredChatModel(storage, accountScope);
  if (!legacyModel) return storedSessionModel;

  const migratedModel =
    storedSessionModel ||
    storeSessionChatModel(key, legacyModel, storage);
  try {
    storage?.removeItem(accountStorageKey(CHAT_MODEL_STORAGE_KEY, accountScope));
  } catch {
    // A failed cleanup may repeat a harmless migration on the next launch.
  }
  return migratedModel;
}

export function chooseChatModel({ models = [], stored = "", current = "", fallback = "" }) {
  const available = new Set(models.map((item) => item.id));
  const candidates = [stored, current, fallback, models[0]?.id]
    .map((item) => cleanText(item))
    .filter(Boolean);
  return candidates.find((item) => available.size === 0 || available.has(item)) || "";
}

export function reconcileModelCatalog(
  value,
  { previous = "", fallback = "" } = {},
) {
  const catalog = normalizeModelsResponse(value, fallback);
  return {
    ...catalog,
    selectedModel: chooseChatModel({
      models: catalog.models,
      stored: previous,
      current: catalog.currentModel,
      fallback,
    }),
  };
}
import { accountStorageKey, readAccountStorage } from "./account-storage.js";

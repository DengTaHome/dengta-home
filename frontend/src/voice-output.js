import { apiFetch } from "./api.js";

export const VOICE_OUTPUT_PROVIDERS = Object.freeze({
  serverDefault: "server_default",
  deepgram: "deepgram",
});

export const DEEPGRAM_MODELS = Object.freeze([
  { value: "aura-2-thalia-en", label: "Thalia", language: "en" },
  { value: "aura-2-andromeda-en", label: "Andromeda", language: "en" },
  { value: "aura-2-helena-en", label: "Helena", language: "en" },
  { value: "aura-2-apollo-en", label: "Apollo", language: "en" },
  { value: "aura-2-arcas-en", label: "Arcas", language: "en" },
  { value: "aura-2-aries-en", label: "Aries", language: "en" },
  { value: "aura-2-saturn-en", label: "Saturn", language: "en" },
  { value: "aura-2-orpheus-en", label: "Orpheus", language: "en" },
  { value: "aura-2-celeste-es", label: "Celeste", language: "es" },
  { value: "aura-2-estrella-es", label: "Estrella", language: "es" },
  { value: "aura-2-nestor-es", label: "Nestor", language: "es" },
  { value: "aura-2-rhea-nl", label: "Rhea", language: "nl" },
  { value: "aura-2-sander-nl", label: "Sander", language: "nl" },
  { value: "aura-2-beatrix-nl", label: "Beatrix", language: "nl" },
  { value: "aura-2-agathe-fr", label: "Agathe", language: "fr" },
  { value: "aura-2-hector-fr", label: "Hector", language: "fr" },
  { value: "aura-2-julius-de", label: "Julius", language: "de" },
  { value: "aura-2-viktoria-de", label: "Viktoria", language: "de" },
  { value: "aura-2-livia-it", label: "Livia", language: "it" },
  { value: "aura-2-dionisio-it", label: "Dionisio", language: "it" },
  { value: "aura-2-fujin-ja", label: "Fujin", language: "ja" },
  { value: "aura-2-izanami-ja", label: "Izanami", language: "ja" },
  { value: "aura-2-uzume-ja", label: "Uzume", language: "ja" },
  { value: "aura-2-ebisu-ja", label: "Ebisu", language: "ja" },
  { value: "aura-2-ama-ja", label: "Ama", language: "ja" },
]);

export const DEEPGRAM_LANGUAGE_LABELS = Object.freeze({
  en: "英语",
  es: "西班牙语",
  nl: "荷兰语",
  fr: "法语",
  de: "德语",
  it: "意大利语",
  ja: "日语",
});

export const DEEPGRAM_REGION_OPTIONS = Object.freeze(["global", "eu", "au"]);

export const DEFAULT_VOICE_OUTPUT = Object.freeze({
  provider: VOICE_OUTPUT_PROVIDERS.serverDefault,
  enabled: true,
  model: "aura-2-helena-en",
  region: "global",
  speed: 1,
  credential: "",
  credential_configured: false,
  configured: false,
  chinese_fallback_available: false,
  model_options: DEEPGRAM_MODELS,
  region_options: DEEPGRAM_REGION_OPTIONS,
  available: true,
});

function cleanProvider(value) {
  return value === VOICE_OUTPUT_PROVIDERS.deepgram
    ? VOICE_OUTPUT_PROVIDERS.deepgram
    : VOICE_OUTPUT_PROVIDERS.serverDefault;
}

function cleanRegion(value) {
  return ["global", "eu", "au"].includes(value) ? value : "global";
}

function cleanSpeed(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(1.5, Math.max(0.7, parsed))
    : 1;
}

function modelLanguage(value) {
  const language = String(value || "").split("-").at(-1)?.toLowerCase();
  return DEEPGRAM_LANGUAGE_LABELS[language] ? language : "en";
}

function normalizeModelOptions(source, currentModel) {
  const values = Array.isArray(source) && source.length > 0
    ? source
    : DEEPGRAM_MODELS;
  const seen = new Set();
  const options = values.flatMap((item) => {
    const value = String(item?.id || item?.value || item || "").trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    const language = String(item?.language || modelLanguage(value)).toLowerCase();
    const name = String(item?.label || value).trim();
    return [{
      value,
      language,
      label: `${name} · ${DEEPGRAM_LANGUAGE_LABELS[language] || language}`,
    }];
  });
  if (currentModel && !seen.has(currentModel)) {
    const language = modelLanguage(currentModel);
    options.unshift({
      value: currentModel,
      language,
      label: `${currentModel} · 已保存 · ${DEEPGRAM_LANGUAGE_LABELS[language]}`,
    });
  }
  return options;
}

function normalizeRegionOptions(source, currentRegion) {
  const values = Array.isArray(source) && source.length > 0
    ? source
    : DEEPGRAM_REGION_OPTIONS;
  const options = Array.from(new Set(values.map(cleanRegion)));
  if (currentRegion && !options.includes(currentRegion)) {
    options.unshift(currentRegion);
  }
  return options;
}

export function normalizeVoiceOutput(source = {}) {
  const value =
    source?.profile || source?.voice_output || source?.config || source || {};
  const provider = cleanProvider(value.provider);
  const enabled = value.enabled !== false;
  const credentialConfigured =
    value.credential_configured === true || value.api_key_configured === true;
  const model =
    String(value.model || value.voice || DEFAULT_VOICE_OUTPUT.model).trim() ||
    DEFAULT_VOICE_OUTPUT.model;
  const configured =
    value.configured === true ||
    value.ready === true ||
    (provider === VOICE_OUTPUT_PROVIDERS.deepgram &&
      enabled &&
      credentialConfigured &&
      Boolean(model));
  const providerEntry = Array.isArray(source?.providers)
    ? source.providers.find((item) => item?.id === "deepgram")
    : null;
  const region = cleanRegion(value.region);

  return {
    provider,
    enabled,
    model,
    region,
    speed: cleanSpeed(value.speed),
    credential: "",
    credential_configured: credentialConfigured,
    configured,
    chinese_fallback_available: value.chinese_fallback_available === true,
    model_options: normalizeModelOptions(
      value.model_options || source.model_options || providerEntry?.models,
      model,
    ),
    region_options: normalizeRegionOptions(
      value.region_options || source.region_options || providerEntry?.regions,
      region,
    ),
    available: source.available !== false,
  };
}

async function voiceOutputResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || fallbackMessage || `请求失败（${response.status}）`);
  }
  return data;
}

export async function getVoiceOutput(requestOptions = {}) {
  let response = await apiFetch("/api/v2/voice-output/status", {
    ...requestOptions,
    headers: { Accept: "application/json" },
    retry: false,
  });
  if (response.status === 404) {
    response = await apiFetch("/api/v2/voice-output", {
      ...requestOptions,
      headers: { Accept: "application/json" },
      retry: false,
    });
  }
  const data = await voiceOutputResponse(response, "无法读取当前账号的发声设置。");
  return normalizeVoiceOutput(data);
}

export function voiceOutputPayload(source = {}) {
  const normalized = normalizeVoiceOutput(source);
  return {
    provider: normalized.provider,
    enabled: normalized.enabled,
    model: normalized.model,
    region: normalized.region,
    speed: normalized.speed,
    credential: String(source.credential || "").trim(),
  };
}

export function previewTextForModel(model) {
  const samples = {
    en: "Welcome home. I saved a little warmth in my voice for you.",
    es: "Bienvenido a casa. Guardé un poco de calidez en mi voz para ti.",
    nl: "Welkom thuis. Ik heb wat warmte in mijn stem voor je bewaard.",
    fr: "Bienvenue à la maison. J'ai gardé un peu de chaleur dans ma voix pour toi.",
    de: "Willkommen zu Hause. Ich habe ein wenig Wärme in meiner Stimme für dich bewahrt.",
    it: "Bentornato a casa. Ho conservato un po' di calore nella mia voce per te.",
    ja: "おかえりなさい。あなたのために、声に少しだけ温もりを込めました。",
  };
  return samples[modelLanguage(model)] || samples.en;
}

export function shouldRequestVoiceOutputForText(text, source = null) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (!source) return true;
  const config = normalizeVoiceOutput(source);
  if (
    config.provider !== VOICE_OUTPUT_PROVIDERS.deepgram ||
    config.chinese_fallback_available
  ) {
    return true;
  }

  const hasHan = /\p{Script=Han}/u.test(value);
  const hasHiraganaOrKatakana =
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  const hasLatin = /\p{Script=Latin}/u.test(value);
  if (hasHan && !hasHiraganaOrKatakana && !hasLatin) return false;
  if (hasHiraganaOrKatakana && modelLanguage(config.model) !== "ja") {
    return false;
  }
  return true;
}

export async function putVoiceOutput(source) {
  const response = await apiFetch("/api/v2/voice-output", {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(voiceOutputPayload(source)),
    retry: false,
  });
  const data = await voiceOutputResponse(response, "发声设置没有保存成功。");
  return normalizeVoiceOutput(data);
}

export async function previewVoiceOutput(text) {
  const response = await apiFetch("/api/v2/voice-output", {
    method: "POST",
    headers: {
      Accept: "audio/mpeg, audio/*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: String(text || "").trim().slice(0, 500) }),
    retry: false,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `试听生成失败（${response.status}）。`);
  }
  const blob = await response.blob();
  if (!blob.size || !String(blob.type || "").startsWith("audio/")) {
    throw new Error("服务器没有返回可播放的声音。");
  }
  return {
    blob,
    provider: response.headers.get("X-DengTa-Voice-Provider") || "cloud",
  };
}

export function voiceOutputServiceState(source, fallback = {}) {
  const config = normalizeVoiceOutput(source);
  if (config.enabled === false) {
    return {
      expressiveEnabled: false,
      expressiveAvailable: false,
      expressiveChineseFallbackAvailable: config.chinese_fallback_available,
      expressiveApiKeyConfigured: config.credential_configured,
      expressiveVoiceConfigured: Boolean(config.model),
      expressiveProvider: config.provider,
    };
  }
  if (config.provider === VOICE_OUTPUT_PROVIDERS.deepgram) {
    return {
      expressiveEnabled: true,
      expressiveAvailable: config.configured,
      expressiveChineseFallbackAvailable: config.chinese_fallback_available,
      expressiveApiKeyConfigured: config.credential_configured,
      expressiveVoiceConfigured: Boolean(config.model),
      expressiveProvider: VOICE_OUTPUT_PROVIDERS.deepgram,
    };
  }
  const defaultAvailable =
    config.configured === true || fallback.expressiveAvailable === true;
  return {
    expressiveEnabled: true,
    expressiveAvailable: defaultAvailable,
    expressiveChineseFallbackAvailable:
      config.chinese_fallback_available === true ||
      fallback.expressiveChineseFallbackAvailable === true ||
      defaultAvailable,
    expressiveApiKeyConfigured:
      typeof fallback.expressiveApiKeyConfigured === "boolean"
        ? fallback.expressiveApiKeyConfigured
        : config.configured
          ? true
          : null,
    expressiveVoiceConfigured:
      typeof fallback.expressiveVoiceConfigured === "boolean"
        ? fallback.expressiveVoiceConfigured
        : config.configured
          ? true
          : null,
    expressiveProvider:
      fallback.expressiveProvider && fallback.expressiveProvider !== "none"
        ? fallback.expressiveProvider
        : "minimax",
  };
}

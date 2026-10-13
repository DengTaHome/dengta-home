import assert from "node:assert/strict";
import {
  buildServiceStatusCards,
  describeExpressiveTts,
  describeGroqExpiry,
  readGroqExpiryDate,
  storeGroqExpiryDate,
} from "../src/service-status.js";

const cards = buildServiceStatusCards({
  health: {
    ok: true,
    version: "0.11.1",
    features: {
      hervoice_proxy_configured: true,
      expressive_tts_configured: false,
      expressive_tts_provider: "none",
      ombre_mcp_client: true,
      ombre_mcp_configured: false,
    },
  },
  settings: {
    provider: "openai-compatible",
    api_url: "https://example.test/v1",
    model: "test-model",
  },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
});

assert.equal(cards.find((item) => item.id === "backend").status, "online");
assert.equal(cards.find((item) => item.id === "database").status, "online");
assert.equal(cards.find((item) => item.id === "provider").status, "pending");
assert.equal(cards.find((item) => item.id === "groq").status, "pending");
assert.equal(cards.find((item) => item.id === "database").summary, "应用设置已读取");
assert.match(cards.find((item) => item.id === "database").detail, /没有执行写入测试/);
assert.equal(cards.find((item) => item.id === "voice-output").status, "pending");
assert.equal(
  cards.find((item) => item.id === "voice-output").summary,
  "尚未配置自然语音",
);
assert.equal(cards.find((item) => item.id === "ombre-mcp").status, "pending");

const providerCenterCards = buildServiceStatusCards({
  health: {
    ok: true,
    features: {
      ai_provider_center: true,
      ai_provider_active_profile: {
        name: "我的 GPT 接口",
        protocol: "openai-responses",
        default_model: "gpt-5.6-sol",
        health: { state: "catalog_ok" },
      },
    },
  },
  // The legacy settings row is intentionally empty. The provider center is
  // authoritative once the backend advertises it.
  settings: { api_url: "", model: "" },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
});
const providerCenterCard = providerCenterCards.find(
  (item) => item.id === "provider",
);
assert.equal(providerCenterCard.status, "online");
assert.equal(providerCenterCard.summary, "我的 GPT 接口 · gpt-5.6-sol");
assert.match(providerCenterCard.detail, /不代表聊天生成请求一定成功/);

for (const [state, expected] of [["catalog_error", "error"], ["untested", "pending"], ["expired", "pending"]]) {
  const card = buildServiceStatusCards({
    health: { ok: true, features: { ai_provider_center: true } },
    providerStatus: { active_profile: { name: "fixture", default_model: "test-model", health: { state } } },
    settings: {}, hasLoadedSettings: true, isOnline: true,
  }).find(item => item.id === "provider");
  assert.equal(card.status, expected);
  if (state === "expired") assert.equal(card.summary, "活动接口已到期");
}
const disconnected = buildServiceStatusCards({
  health: { ok: true, features: { expressive_tts_configured: true, ombre_mcp_configured: true } },
  settings: {}, hasLoadedSettings: true, isOnline: false,
});
assert.equal(disconnected.find(item => item.id === "voice-output").status, "pending");
assert.equal(disconnected.find(item => item.id === "ombre-mcp").status, "pending");

const missingProviderCenterModel = buildServiceStatusCards({
  health: {
    ok: true,
    features: {
      ai_provider_center: true,
      ai_provider_active_profile: {
        name: "我的 GPT 接口",
        protocol: "openai-responses",
        default_model: "",
        health: { state: "untested" },
      },
    },
  },
  settings: { api_url: "https://stale.invalid/v1", model: "stale-model" },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
});
assert.equal(
  missingProviderCenterModel.find((item) => item.id === "provider").summary,
  "活动接口尚未填写模型",
);

const awaitingVoice = describeExpressiveTts({
  expressive_tts_configured: false,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: false,
  expressive_tts_provider: "minimax",
});
assert.equal(awaitingVoice.stage, "awaiting_voice");
assert.equal(awaitingVoice.status, "pending");
assert.equal(awaitingVoice.summary, "密钥已就绪，等待生成音色");
assert.match(awaitingVoice.settingsText, /Voice Design/);

const readyVoice = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "minimax",
});
assert.equal(readyVoice.stage, "ready");
assert.equal(readyVoice.status, "online");
assert.equal(readyVoice.summary, "已连接 MiniMax");

const readyDeepgram = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "deepgram",
});
assert.equal(readyDeepgram.providerName, "Deepgram");
assert.match(readyDeepgram.settingsText, /中文回退尚未配置/);
assert.equal(readyDeepgram.summary, "Deepgram 已连接 · 中文暂不可用");

const readyDeepgramWithFallback = describeExpressiveTts({
  expressive_tts_configured: true,
  expressive_tts_api_key_configured: true,
  expressive_tts_voice_configured: true,
  expressive_tts_provider: "deepgram",
  expressive_tts_chinese_fallback_available: true,
});
assert.match(readyDeepgramWithFallback.settingsText, /自动使用服务器 MiniMax/);

const deepgramCards = buildServiceStatusCards({
  health: {
    ok: true,
    features: {},
  },
  settings: { api_url: "https://example.test/v1", model: "test-model" },
  hasLoadedSettings: true,
  isOnline: true,
  error: "",
  voiceOutput: {
    provider: "deepgram",
    enabled: true,
    model: "aura-2-helena-en",
    credential_configured: true,
    configured: true,
    chinese_fallback_available: false,
  },
});
const deepgramCard = deepgramCards.find((item) => item.id === "voice-output");
assert.equal(deepgramCard.name, "Deepgram 自然语音");
assert.equal(deepgramCard.status, "online");
assert.equal(deepgramCard.summary, "Deepgram 已连接 · 中文暂不可用");
assert.equal(deepgramCard.link, "https://console.deepgram.com/");

const missingKey = describeExpressiveTts({
  expressive_tts_configured: false,
  expressive_tts_api_key_configured: false,
  expressive_tts_voice_configured: false,
});
assert.equal(missingKey.stage, "incomplete");
assert.match(missingKey.settingsText, /配置还不完整/);

const legacyVoice = describeExpressiveTts({
  expressive_tts_configured: false,
});
assert.equal(legacyVoice.stage, "legacy_pending");
assert.equal(legacyVoice.summary, "尚未配置自然语音");
assert.doesNotMatch(
  JSON.stringify([
    describeExpressiveTts({
      expressive_tts_configured: true,
      expressive_tts_api_key_configured: true,
      expressive_tts_voice_configured: true,
    }),
    awaitingVoice,
    missingKey,
    legacyVoice,
  ]),
  /手机系统朗读|手机朗读备用/,
);

const fixedNow = new Date("2026-07-23T00:00:00Z");
assert.equal(describeGroqExpiry("", fixedNow).status, "unknown");
assert.equal(describeGroqExpiry("2026-07-30", fixedNow).status, "warning");
assert.equal(describeGroqExpiry("2026-10-21", fixedNow).status, "ok");
assert.equal(describeGroqExpiry("2026-07-01", fixedNow).status, "expired");

const values = new Map();
const storage = {
  getItem(key) {
    return values.get(key) || null;
  },
  setItem(key, value) {
    values.set(key, value);
  },
  removeItem(key) {
    values.delete(key);
  },
};

storeGroqExpiryDate("2026-10-21", storage);
assert.equal(readGroqExpiryDate(storage), "2026-10-21");
storeGroqExpiryDate("", storage);
assert.equal(readGroqExpiryDate(storage), "");

console.log("frontend service status tests passed");

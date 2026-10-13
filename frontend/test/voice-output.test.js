import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeVoiceOutput,
  previewTextForModel,
  shouldRequestVoiceOutputForText,
  voiceOutputPayload,
  voiceOutputServiceState,
} from "../src/voice-output.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const component = fs.readFileSync(
  path.join(here, "..", "src", "VoiceProviderSettings.jsx"),
  "utf8",
);
const app = fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8");
const apiHelper = fs.readFileSync(
  path.join(here, "..", "src", "voice-output.js"),
  "utf8",
);

const initial = normalizeVoiceOutput({});
assert.equal(initial.provider, "server_default");
assert.equal(initial.enabled, true);
assert.ok(initial.model_options.length >= 20);
assert.deepEqual(initial.region_options, ["global", "eu", "au"]);

const statusConfig = normalizeVoiceOutput({
  ok: true,
  available: true,
  profile: {
    provider: "deepgram",
    enabled: true,
    model: "aura-2-new-en",
    region: "global",
    credential_configured: true,
    configured: true,
    chinese_fallback_available: false,
  },
  providers: [
    {
      id: "deepgram",
      models: [
        { id: "aura-2-new-en", language: "en", label: "New voice" },
      ],
      regions: ["global", "eu", "au"],
    },
  ],
});
assert.equal(statusConfig.model_options[0].value, "aura-2-new-en");
assert.match(statusConfig.model_options[0].label, /英语/);
assert.equal(statusConfig.chinese_fallback_available, false);

const firstAccountDefault = normalizeVoiceOutput({
  ok: true,
  profile: {
    provider: "server_default",
    enabled: true,
    configured: true,
    chinese_fallback_available: true,
    model_options: [{ id: "aura-2-helena-en", language: "en", label: "Helena" }],
    region_options: ["global", "eu", "au"],
  },
});
assert.equal(firstAccountDefault.provider, "server_default");
assert.equal(firstAccountDefault.configured, true);
assert.equal(
  voiceOutputServiceState(firstAccountDefault).expressiveAvailable,
  true,
);

const deepgram = normalizeVoiceOutput({
  voice_output: {
    provider: "deepgram",
    enabled: true,
    model: "aura-2-helena-en",
    region: "eu",
    speed: 3,
    credential_configured: true,
  },
});
assert.equal(deepgram.provider, "deepgram");
assert.equal(deepgram.region, "eu");
assert.equal(deepgram.speed, 1.5);
assert.equal(deepgram.configured, true);
assert.equal(deepgram.credential, "");

assert.deepEqual(
  voiceOutputPayload({ ...deepgram, credential: "  dg-secret  " }),
  {
    provider: "deepgram",
    enabled: true,
    model: "aura-2-helena-en",
    region: "eu",
    speed: 1.5,
    credential: "dg-secret",
  },
);

assert.deepEqual(voiceOutputServiceState(deepgram), {
  expressiveEnabled: true,
  expressiveAvailable: true,
  expressiveChineseFallbackAvailable: false,
  expressiveApiKeyConfigured: true,
  expressiveVoiceConfigured: true,
  expressiveProvider: "deepgram",
});
assert.deepEqual(
  voiceOutputServiceState(
    { provider: "server_default", enabled: true },
    {
      expressiveAvailable: true,
      expressiveApiKeyConfigured: true,
      expressiveVoiceConfigured: true,
      expressiveProvider: "minimax",
    },
  ),
  {
    expressiveEnabled: true,
    expressiveAvailable: true,
    expressiveChineseFallbackAvailable: true,
    expressiveApiKeyConfigured: true,
    expressiveVoiceConfigured: true,
    expressiveProvider: "minimax",
  },
);

assert.match(apiHelper, /api\/v2\/voice-output/g);
assert.match(apiHelper, /api\/v2\/voice-output\/status/);
assert.match(previewTextForModel("aura-2-fujin-ja"), /おかえりなさい/);
assert.match(previewTextForModel("aura-2-celeste-es"), /Bienvenido/);
const noChineseFallback = {
  provider: "deepgram",
  enabled: true,
  configured: true,
  model: "aura-2-helena-en",
  chinese_fallback_available: false,
};
assert.equal(
  shouldRequestVoiceOutputForText("今天想和你一起看书。", noChineseFallback),
  false,
);
assert.equal(
  shouldRequestVoiceOutputForText("今天想看 2 本书📚！", noChineseFallback),
  false,
);
assert.equal(
  shouldRequestVoiceOutputForText("Welcome home.", noChineseFallback),
  true,
);
assert.equal(
  shouldRequestVoiceOutputForText("今晚は一緒に本を読みたい。", {
    ...noChineseFallback,
    model: "aura-2-fujin-ja",
  }),
  true,
);
assert.equal(
  shouldRequestVoiceOutputForText("今晚は一緒に本を読みたい。", noChineseFallback),
  false,
);
assert.equal(
  shouldRequestVoiceOutputForText("今天想和你一起看书。", {
    ...noChineseFallback,
    chinese_fallback_available: true,
  }),
  true,
);
assert.equal(
  shouldRequestVoiceOutputForText("今天想和你一起看书。", {
    provider: "server_default",
    enabled: true,
  }),
  true,
);
assert.match(component, /留空会保留原密钥/);
assert.match(component, /Deepgram Aura 当前不包含中文音色/);
assert.match(component, /服务器 MiniMax 中文回退尚未配置/);
assert.match(component, /previewTextForModel\(saved\.model\)/);
assert.match(component, /new Audio\(objectUrl\)/);
assert.match(app, /lazy\(\s*\(\) => import\("\.\/VoiceProviderSettings"\)/);
assert.match(app, /void refreshVoiceOutputStatus\(\)/);
assert.match(app, /<VoiceProviderSettings/);
assert.match(app, /voiceOutputServiceState/);
assert.match(app, /shouldRequestVoiceOutputForText/);

console.log("frontend voice output tests passed");

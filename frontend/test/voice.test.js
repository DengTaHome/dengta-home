import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VOICE_MAX_DURATION_MS,
  VOICE_MIN_DURATION_MS,
  VOICE_PLAYBACK_MODES,
  VOICE_STATES,
  VOICE_STATE_LABELS,
  VOICE_TURN_TIMEOUT_MS,
  buildVoiceTurnFormData,
  createVoiceTurnRequest,
  formatVoiceRemainingSeconds,
  formatVoiceConfidence,
  hydrateStoredVoiceAnalysis,
  hydrateStoredVoiceMessages,
  localizeVoiceEmotion,
  normalizeVoiceAnalysis,
  normalizeVoicePlaybackMode,
  requestExpressiveSpeech,
  resolveVoiceCaptureAfterPermission,
  selectRecorderMimeType,
  validateVoiceDuration,
  voiceCaptureErrorMessage,
  voiceBlocksComposer,
  voiceRecordingSupported,
} from "../src/voice.js";

class MockMediaRecorder {
  static isTypeSupported(value) {
    return value === "audio/webm";
  }
}

assert.equal(selectRecorderMimeType(MockMediaRecorder), "audio/webm");
assert.equal(selectRecorderMimeType(undefined), "");

assert.equal(validateVoiceDuration(VOICE_MIN_DURATION_MS - 1).ok, false);
assert.match(
  validateVoiceDuration(VOICE_MIN_DURATION_MS - 1).message,
  /太短/,
);
assert.equal(validateVoiceDuration(VOICE_MIN_DURATION_MS).ok, true);
assert.equal(validateVoiceDuration(VOICE_MAX_DURATION_MS).ok, true);
assert.equal(validateVoiceDuration(VOICE_MAX_DURATION_MS + 2_001).ok, false);

const normalized = normalizeVoiceAnalysis({
  text: "  今天\u0000有一点开心  ",
  emotion: "轻松",
  confidence: 82,
  hint: "语速平稳",
  features: { internal_debug: "不得显示" },
});
assert.deepEqual(normalized, {
  text: "今天有一点开心",
  emotion: "轻松",
  confidence: 0.82,
  hint: "语速平稳",
});
assert.equal("features" in normalized, false);
assert.equal(formatVoiceConfidence(0.826), "置信度 83%");
assert.equal(formatVoiceConfidence("unknown"), "置信度未知");

const storedVoiceMessage = hydrateStoredVoiceAnalysis({
  id: "voice-message",
  role: "user",
  content: "历史转写内容",
  tool_calls: {
    is_voice: true,
    voice_analysis: {
      emotion: "tired",
      confidence: 0.7,
      hint: "语速偏慢",
    },
  },
});
assert.deepEqual(storedVoiceMessage.voiceAnalysis, {
  text: "历史转写内容",
  emotion: "疲惫",
  confidence: 0.7,
  hint: "语速偏慢",
});
assert.equal(
  hydrateStoredVoiceMessages([storedVoiceMessage, { id: "plain" }]).length,
  2,
);
assert.equal(localizeVoiceEmotion("happy"), "开心");
assert.equal(localizeVoiceEmotion("sad"), "难过");
assert.equal(localizeVoiceEmotion("angry"), "生气");
assert.equal(localizeVoiceEmotion("tired"), "疲惫");
assert.equal(localizeVoiceEmotion("affectionate"), "温柔亲昵");
assert.equal(localizeVoiceEmotion("excited"), "兴奋");
assert.equal(localizeVoiceEmotion("anxious"), "焦虑紧张");
assert.equal(localizeVoiceEmotion("neutral"), "中性");
assert.equal(localizeVoiceEmotion("unexpected_internal_label"), "未确定");
assert.equal(localizeVoiceEmotion("平静"), "平静");

assert.match(
  voiceCaptureErrorMessage({ name: "NotAllowedError" }),
  /麦克风权限/,
);
assert.match(
  voiceCaptureErrorMessage({ name: "NotFoundError" }),
  /没有找到可用麦克风/,
);
assert.match(
  voiceCaptureErrorMessage({ name: "NotReadableError" }),
  /其他应用占用/,
);

assert.equal(
  voiceRecordingSupported({
    navigator: { mediaDevices: { getUserMedia() {} } },
    MediaRecorder: MockMediaRecorder,
  }),
  true,
);
assert.equal(voiceRecordingSupported({ navigator: {} }), false);

assert.deepEqual(resolveVoiceCaptureAfterPermission(true, false), {
  startRecording: true,
  tapToSend: false,
});
assert.deepEqual(resolveVoiceCaptureAfterPermission(false, false), {
  startRecording: true,
  tapToSend: true,
});
assert.deepEqual(resolveVoiceCaptureAfterPermission(true, true), {
  startRecording: true,
  tapToSend: true,
});

const formData = buildVoiceTurnFormData({
  blob: new Blob(["voice"], { type: "audio/webm" }),
  sessionId: "session-id",
  clientTime: "2026/7/21 20:00:00",
  timezone: "Asia/Shanghai",
  model: "gpt-5.5",
  emotionUnderstandingEnabled: true,
  companionStatus: { mood: "安心" },
  environmentContext: {
    timeZone: "Asia/Shanghai",
    weather: { temperatureC: 25.5, description: "多云" },
  },
  turnContext: "本轮语音的临时背景",
  timestamp: 123,
});
assert.equal(formData.get("session_id"), "session-id");
assert.equal(formData.get("timezone"), "Asia/Shanghai");
assert.equal(formData.get("model"), "gpt-5.5");
assert.equal(formData.get("emotion_understanding_enabled"), "true");
assert.deepEqual(JSON.parse(formData.get("companion_status")), {
  mood: "安心",
});
assert.deepEqual(JSON.parse(formData.get("environment_context")), {
  timeZone: "Asia/Shanghai",
  weather: { temperatureC: 25.5, description: "多云" },
});
assert.equal(formData.get("turn_context"), "本轮语音的临时背景");
assert.equal(formData.get("file").name, "dengta-voice-123.webm");
assert.equal(formData.get("file").type, "audio/webm");

// 安卓 WebView 可能录出没有 type 的 blob；上传时必须显式补上，否则服务端只收到 octet-stream
const untypedBlob = new Blob(["voice-bytes"]);
assert.equal(untypedBlob.type, "");
const untypedForm = buildVoiceTurnFormData({ blob: untypedBlob, timestamp: 9 });
assert.equal(untypedForm.get("file").type, "audio/webm");
assert.equal(untypedForm.get("file").name, "dengta-voice-9.webm");

assert.equal(VOICE_STATES.recording, "recording");
assert.match(VOICE_STATE_LABELS.recording, /松开发送/);
assert.match(VOICE_STATE_LABELS.speaking, /播放/);
assert.ok(VOICE_TURN_TIMEOUT_MS <= 75_000);
assert.equal(voiceBlocksComposer(VOICE_STATES.requesting), true);
assert.equal(voiceBlocksComposer(VOICE_STATES.recording), true);
assert.equal(voiceBlocksComposer(VOICE_STATES.uploading), true);
assert.equal(
  voiceBlocksComposer(VOICE_STATES.thinking),
  false,
  "remote analysis must not lock text chat",
);
assert.equal(
  normalizeVoicePlaybackMode("expressive"),
  VOICE_PLAYBACK_MODES.expressive,
);
assert.equal(normalizeVoicePlaybackMode("system"), VOICE_PLAYBACK_MODES.off);
assert.equal(normalizeVoicePlaybackMode("unknown"), VOICE_PLAYBACK_MODES.off);

const voiceSource = fs.readFileSync(
  new URL("../src/voice.js", import.meta.url),
  "utf8",
);
const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
const packageSource = fs.readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  `${voiceSource}\n${appSource}\n${packageSource}`,
  /speechSynthesis|SpeechSynthesisUtterance|TextToSpeech|capacitor-community\/text-to-speech/,
  "device and browser system reading paths must stay removed",
);
assert.match(
  appSource,
  /取消语音处理/,
  "a pending voice request must always have a visible escape hatch",
);
assert.match(
  appSource,
  /\/voice\/warmup/,
  "voice service should be warmed in the background before recording",
);

let expressiveRequest;
const expressiveSpeech = await requestExpressiveSpeech("65", {
  sessionId: "11111111-1111-4111-8111-111111111111",
  speechToken: "v1.1784854800.test-speech-token",
  async fetchImpl(url, options) {
    expressiveRequest = { url, options };
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name === "X-DengTa-Voice-Provider") return "minimax";
          if (name === "X-DengTa-Voice-Emotion") return "happy";
          return null;
        },
      },
      async blob() {
        return new Blob(["audio"], { type: "audio/mpeg" });
      },
    };
  },
});
assert.match(expressiveRequest.url, /\/voice\/speech$/);
assert.deepEqual(JSON.parse(expressiveRequest.options.body), {
  message_id: "65",
  session_id: "11111111-1111-4111-8111-111111111111",
  speech_token: "v1.1784854800.test-speech-token",
});
assert.equal(expressiveSpeech.provider, "minimax");
assert.equal(expressiveSpeech.emotion, "happy");
assert.equal(expressiveSpeech.blob.type, "audio/mpeg");

let missingCredentialFetches = 0;
await assert.rejects(
  () =>
    requestExpressiveSpeech("65", {
      async fetchImpl() {
        missingCredentialFetches += 1;
      },
    }),
  /凭据已失效/,
);
assert.equal(missingCredentialFetches, 0);

// 录音倒计时：60s 上限与"最后 10 秒警示"依赖这个纯函数
{
  assert.equal(formatVoiceRemainingSeconds(0), 60);
  assert.equal(formatVoiceRemainingSeconds(1_200), 59);
  assert.equal(formatVoiceRemainingSeconds(55_000), 5);
  assert.equal(formatVoiceRemainingSeconds(59_200), 1);
  assert.equal(formatVoiceRemainingSeconds(60_000), 0);
  assert.equal(formatVoiceRemainingSeconds(75_000), 0, "超过上限不能出现负数");
  assert.equal(formatVoiceRemainingSeconds(-500), 60, "异常负数不能放大剩余时间");
  assert.equal(formatVoiceRemainingSeconds(undefined), 60);
}

// abort-before-send：token 刷新期间点取消，不能再 open+send（真机评审发现的行为缺口）
class AbortableFakeXhr {
  constructor() {
    this.upload = { addEventListener() {} };
    this.listeners = {};
    this.opened = false;
    this.sent = false;
    this.aborted = false;
    this.status = 0;
    this.response = null;
    this.responseText = "";
    AbortableFakeXhr.last = this;
  }
  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
  setRequestHeader() {}
  getResponseHeader() {
    return "";
  }
  open() {
    this.opened = true;
  }
  send() {
    this.sent = true;
  }
  abort() {
    this.aborted = true;
    // 真实 XHR 在 UNSENT 状态调 abort 不派发 abort 事件，保持一致才能验证
    // 「未 send 时取消必须靠 reject 生效」。
    if (this.opened) this.listeners.abort?.();
  }
}

let releaseContext = null;
const contextGate = new Promise((resolve) => {
  releaseContext = resolve;
});
const abortFormData = buildVoiceTurnFormData({
  blob: new Blob(["bytes"], { type: "audio/webm" }),
  timestamp: 11,
});
const abortHandle = createVoiceTurnRequest(abortFormData, {
  XMLHttpRequestImpl: AbortableFakeXhr,
  authSession: { getRequestContext: () => contextGate },
});
abortHandle.abort();
// 用 race 加超时：如果实现的 abort 在未 send 时不 reject，这条会快速失败而不是挂住。
await Promise.race([
  assert.rejects(abortHandle.promise, (error) => error.name === "AbortError"),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("abort-before-send 超时：取消没有 reject")), 800),
  ),
]);
releaseContext({ accessToken: "token" });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(AbortableFakeXhr.last.sent, false, "取消发生在 send 之前时绝不能发出请求");
abortHandle.abort();
assert.ok(true, "abort-before-send：未发送时取消生效且可重复调用");

console.log("voice helper tests passed");

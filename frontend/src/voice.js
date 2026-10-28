import { API_BASE_URL } from "./api.js";
import { authSession as defaultAuthSession } from "./auth-session.js";

export const VOICE_MAX_DURATION_MS = 60_000;
export const VOICE_MIN_DURATION_MS = 650;
export const VOICE_TURN_TIMEOUT_MS = 75_000;

export const VOICE_STATES = Object.freeze({
  idle: "idle",
  requesting: "requesting",
  recording: "recording",
  uploading: "uploading",
  thinking: "thinking",
  speaking: "speaking",
  error: "error",
});

export const VOICE_PLAYBACK_MODES = Object.freeze({
  off: "off",
  expressive: "expressive",
});

export const VOICE_STATE_LABELS = Object.freeze({
  idle: "按住说话",
  requesting: "等待麦克风授权…",
  recording: "正在听你说话，松开发送",
  uploading: "正在安全上传语音…",
  thinking: "正在理解语音和情绪…",
  speaking: "AI 正在播放回复…",
  error: "语音没有发送，按住可重试",
});

export function voiceBlocksComposer(state) {
  return [
    VOICE_STATES.requesting,
    VOICE_STATES.recording,
    VOICE_STATES.uploading,
  ].includes(state);
}

const RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

const VOICE_EMOTION_LABELS = Object.freeze({
  happy: "开心",
  joy: "开心",
  joyful: "开心",
  sad: "难过",
  sadness: "难过",
  angry: "生气",
  anger: "生气",
  tired: "疲惫",
  fatigue: "疲惫",
  fatigued: "疲惫",
  affectionate: "温柔亲昵",
  tender: "温柔亲昵",
  tender_affectionate: "温柔亲昵",
  loving: "温柔亲昵",
  excited: "兴奋",
  excitement: "兴奋",
  anxious: "焦虑紧张",
  anxiety: "焦虑紧张",
  nervous: "焦虑紧张",
  tense: "焦虑紧张",
  neutral: "中性",
  calm: "中性",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanDisplayText(value, maxLength) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .slice(0, maxLength)
    .join("")
    .trim();
}

function normalizedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const zeroToOne = number > 1 && number <= 100 ? number / 100 : number;
  return Math.min(1, Math.max(0, zeroToOne));
}

export function localizeVoiceEmotion(value) {
  const text = cleanDisplayText(value, 48);
  if (!text) return "未确定";
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  if (VOICE_EMOTION_LABELS[key]) return VOICE_EMOTION_LABELS[key];
  if (/[\u3400-\u9fff]/u.test(text)) return text;
  return "未确定";
}

export function selectRecorderMimeType(MediaRecorderImpl = globalThis.MediaRecorder) {
  if (!MediaRecorderImpl) return "";
  if (typeof MediaRecorderImpl.isTypeSupported !== "function") {
    return "";
  }
  return (
    RECORDER_MIME_TYPES.find((mimeType) =>
      MediaRecorderImpl.isTypeSupported(mimeType),
    ) || ""
  );
}

export function validateVoiceDuration(durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration < VOICE_MIN_DURATION_MS) {
    return {
      ok: false,
      message: "录音太短了。请按住按钮说完一句话，再松开发送。",
    };
  }
  if (duration > VOICE_MAX_DURATION_MS + 2_000) {
    return {
      ok: false,
      message: "这段录音超过 60 秒，没有发送。请分成两句话再试。",
    };
  }
  return { ok: true, message: "" };
}

export function normalizeVoiceAnalysis(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    text: cleanDisplayText(source.text, 12_000),
    emotion: localizeVoiceEmotion(source.emotion),
    confidence: normalizedConfidence(source.confidence),
    hint: cleanDisplayText(source.hint, 320),
  };
}

export function hydrateStoredVoiceAnalysis(message = {}) {
  const stored =
    message.voiceAnalysis ||
    message.voice_analysis ||
    message.tool_calls?.voice_analysis;
  if (!isPlainObject(stored)) return message;

  const analysis = normalizeVoiceAnalysis(stored);
  return {
    ...message,
    voiceAnalysis: {
      ...analysis,
      text: analysis.text || cleanDisplayText(message.content, 12_000),
    },
  };
}

export function hydrateStoredVoiceMessages(messages = []) {
  return Array.isArray(messages)
    ? messages.map((message) => hydrateStoredVoiceAnalysis(message))
    : [];
}

export function formatVoiceConfidence(value) {
  const confidence = normalizedConfidence(value);
  return confidence === null ? "置信度未知" : `置信度 ${Math.round(confidence * 100)}%`;
}

export function voiceCaptureErrorMessage(error) {
  const name = String(error?.name || "");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限没有开启。请在手机“设置 → 应用 → DengTa home → 权限”中允许麦克风，然后重试。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有找到可用麦克风。请确认手机麦克风可用，并关闭正在独占麦克风的其他应用。";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "麦克风正被其他应用占用。请结束通话或录音应用后重试。";
  }
  if (name === "AbortError") {
    return "本次语音已取消，没有保存或发送原始录音。";
  }
  return cleanDisplayText(error?.message, 240) || "语音功能暂时不可用，请稍后重试。";
}

export function voiceRecordingSupported(environment = globalThis) {
  return Boolean(
    environment?.navigator?.mediaDevices?.getUserMedia &&
      environment?.MediaRecorder,
  );
}

export function resolveVoiceCaptureAfterPermission(
  pointerHeld,
  permissionWasUnconfirmed = false,
) {
  return {
    startRecording: true,
    tapToSend: permissionWasUnconfirmed || pointerHeld !== true,
  };
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

export function buildVoiceTurnFormData({
  blob,
  sessionId = "",
  clientTime = "",
  timezone = "",
  model = "",
  emotionUnderstandingEnabled = true,
  companionStatus = {},
  environmentContext = {},
  turnContext = "",
  timestamp = Date.now(),
  FormDataImpl = globalThis.FormData,
}) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("录音数据为空，请重新按住说话。");
  }
  if (!FormDataImpl) {
    throw new Error("当前环境不能上传语音。");
  }

  const formData = new FormDataImpl();
  // 有些安卓 WebView 录出来的 blob 没有 type；显式补上，
  // 否则服务端只能收到 application/octet-stream。
  const mimeType = blob.type || "audio/webm";
  const uploadBlob =
    blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const fileName = `dengta-voice-${timestamp}.${extensionForMimeType(mimeType)}`;
  formData.append("file", uploadBlob, fileName);
  formData.append("session_id", String(sessionId || ""));
  formData.append("client_time", String(clientTime || ""));
  formData.append("timezone", String(timezone || ""));
  formData.append("model", String(model || ""));
  formData.append(
    "emotion_understanding_enabled",
    emotionUnderstandingEnabled ? "true" : "false",
  );
  formData.append(
    "companion_status",
    JSON.stringify(isPlainObject(companionStatus) ? companionStatus : {}),
  );
  formData.append(
    "environment_context",
    JSON.stringify(
      isPlainObject(environmentContext) ? environmentContext : {},
    ),
  );
  formData.append("turn_context", String(turnContext || ""));
  return formData;
}

function parsedResponse(xhr) {
  if (isPlainObject(xhr.response)) return xhr.response;
  try {
    return JSON.parse(xhr.responseText || "{}");
  } catch {
    return {};
  }
}

export function createVoiceTurnRequest(
  formData,
  {
    timeoutMs = VOICE_TURN_TIMEOUT_MS,
    onUploadComplete,
    XMLHttpRequestImpl = globalThis.XMLHttpRequest,
    authSession = defaultAuthSession,
  } = {},
) {
  if (!XMLHttpRequestImpl) {
    throw new Error("当前环境不能上传语音。");
  }

  const xhr = new XMLHttpRequestImpl();
  const safeTimeoutMs = Math.min(
    VOICE_TURN_TIMEOUT_MS,
    Math.max(5_000, Number(timeoutMs) || VOICE_TURN_TIMEOUT_MS),
  );
  let settled = false;
  let uploadReported = false;

  let rejectRequestOnce = null;
  const promise = new Promise((resolve, reject) => {
    rejectRequestOnce = reject;
    function finishUpload() {
      if (uploadReported) return;
      uploadReported = true;
      onUploadComplete?.();
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    xhr.upload?.addEventListener("load", finishUpload, { once: true });
    xhr.addEventListener(
      "load",
      () => {
        if (settled) return;
        settled = true;
        finishUpload();
        const data = parsedResponse(xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          authSession?.captureCompanionFromResponse?.({
            headers: {
              get(name) {
                return xhr.getResponseHeader?.(name) || "";
              },
            },
          });
          resolve(data);
          return;
        }
        reject(
          new Error(
            cleanDisplayText(data.message || data.detail, 300) ||
              `语音请求失败（${xhr.status || "网络错误"}）。`,
          ),
        );
      },
      { once: true },
    );
    xhr.addEventListener(
      "error",
      () => fail(new Error("无法连接语音服务器，请检查网络后重试。")),
      { once: true },
    );
    xhr.addEventListener(
      "timeout",
      () =>
        fail(
          new Error(
            `语音转写或回复等待超过${Math.ceil(safeTimeoutMs / 1000)}秒，本次不会自动重复发送。`,
          ),
        ),
      { once: true },
    );
    xhr.addEventListener(
      "abort",
      () => {
        const error = new Error("本次语音请求已取消。");
        error.name = "AbortError";
        fail(error);
      },
      { once: true },
    );
    Promise.resolve(authSession?.getRequestContext?.() || {})
      .then((authContext) => {
        if (settled) return;
        xhr.open("POST", `${API_BASE_URL}/voice/turn`, true);
        xhr.timeout = safeTimeoutMs;
        xhr.responseType = "json";
        if (authContext?.accessToken) {
          xhr.setRequestHeader(
            "Authorization",
            `Bearer ${authContext.accessToken}`,
          );
        }
        if (authContext?.companionId) {
          xhr.setRequestHeader(
            "X-DengTa-Companion-Id",
            authContext.companionId,
          );
        }
        xhr.send(formData);
      })
      .catch((error) =>
        fail(
          new Error("无法读取登录状态，请重新登录后再发送语音。", {
            cause: error,
          }),
        ),
      );
  });

  return {
    promise,
    abort() {
      // 必须在 send 之前也生效：token 刷新期间点取消时，xhr 还是 UNSENT，
      // 只调 xhr.abort() 不会派发 abort 事件，稍后 .then 仍会 open+send。
      if (!settled) {
        settled = true;
        const abortError = new Error("本次语音请求已取消。");
        abortError.name = "AbortError";
        if (rejectRequestOnce) rejectRequestOnce(abortError);
      }
      try {
        xhr.abort();
      } catch {
        // 未 open 的 XHR 可能抛错，取消本身已经生效。
      }
    },
  };
}

let activeAudioPlayback = null;

export function normalizeVoicePlaybackMode(value) {
  return Object.values(VOICE_PLAYBACK_MODES).includes(value)
    ? value
    : VOICE_PLAYBACK_MODES.off;
}

export async function requestExpressiveSpeech(
  messageId,
  {
    sessionId = "",
    speechToken = "",
    fetchImpl = globalThis.fetch,
    timeoutMs = 60_000,
    authSession = defaultAuthSession,
  } = {},
) {
  const safeMessageId = String(messageId || "").trim();
  const safeSessionId = String(sessionId || "").trim();
  const safeSpeechToken = String(speechToken || "").trim();
  if (!safeMessageId) {
    throw new Error("这条回复还没有可用于自然语音的消息编号。");
  }
  if (!safeSessionId || !safeSpeechToken) {
    throw new Error("这条回复的自然语音凭据已失效，请发送新消息后再试。");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("当前设备不能连接自然语音服务。");
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    const authContext = await authSession?.getRequestContext?.();
    try {
      response = await fetchImpl(`${API_BASE_URL}/voice/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authContext?.accessToken
            ? { Authorization: `Bearer ${authContext.accessToken}` }
            : {}),
          ...(authContext?.companionId
            ? {
                "X-DengTa-Companion-Id": authContext.companionId,
              }
            : {}),
        },
        body: JSON.stringify({
          message_id: safeMessageId,
          session_id: safeSessionId,
          speech_token: safeSpeechToken,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("自然语音等待超时。", { cause: error });
      }
      throw new Error("暂时无法连接自然语音服务。", { cause: error });
    }

    if (!response.ok) {
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        // 非 JSON 错误响应统一按状态码处理。
      }
      if (
        response.status === 401 &&
        ["invalid_session", "authentication_required"].includes(payload.code)
      ) {
        await authSession?.invalidateSession?.(payload.message);
      }
      throw new Error(
        cleanDisplayText(payload.message, 240) ||
          `自然语音暂时不可用（${response.status}）。`,
      );
    }

    const blob = await response.blob();
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error("自然语音服务没有返回可播放的声音。");
    }
    return {
      blob,
      provider: response.headers?.get?.("X-DengTa-Voice-Provider") || "cloud",
      emotion: response.headers?.get?.("X-DengTa-Voice-Emotion") || "",
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function playAudioBlob(
  blob,
  { AudioImpl = globalThis.Audio, URLImpl = globalThis.URL } = {},
) {
  if (typeof AudioImpl !== "function" || typeof URLImpl?.createObjectURL !== "function") {
    throw new Error("当前设备不能播放云端语音。");
  }

  return new Promise((resolve, reject) => {
    const url = URLImpl.createObjectURL(blob);
    const audio = new AudioImpl();
    let finished = false;

    function finish(error, stopped = false) {
      if (finished) return;
      finished = true;
      if (activeAudioPlayback?.audio === audio) activeAudioPlayback = null;
      audio.onended = null;
      audio.onerror = null;
      URLImpl.revokeObjectURL?.(url);
      if (error) reject(error);
      else resolve({ engine: "cloud", stopped });
    }

    activeAudioPlayback = {
      audio,
      stop() {
        try {
          audio.pause?.();
          audio.currentTime = 0;
        } catch {
          // 播放器已经结束时无需再次处理。
        }
        finish(null, true);
      },
    };
    audio.preload = "auto";
    audio.src = url;
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("自然语音播放失败。"));
    Promise.resolve(audio.play()).catch(() =>
      finish(new Error("手机阻止了自动播放，请先触碰一次页面后重试。")),
    );
  });
}

export async function speakVoiceText(
  value,
  {
    mode = VOICE_PLAYBACK_MODES.off,
    messageId = "",
    sessionId = "",
    speechToken = "",
  } = {},
) {
  const normalizedMode = normalizeVoicePlaybackMode(mode);
  const text = cleanDisplayText(value, 8_000);
  if (!text || normalizedMode === VOICE_PLAYBACK_MODES.off) {
    return { engine: "none" };
  }

  const speech = await requestExpressiveSpeech(messageId, {
    sessionId,
    speechToken,
  });
  const playback = await playAudioBlob(speech.blob);
  return {
    ...playback,
    provider: speech.provider,
    emotion: speech.emotion,
  };
}

export async function stopVoiceSpeech() {
  activeAudioPlayback?.stop?.();
  activeAudioPlayback = null;
}

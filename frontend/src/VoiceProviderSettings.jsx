import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEEPGRAM_LANGUAGE_LABELS,
  DEFAULT_VOICE_OUTPUT,
  VOICE_OUTPUT_PROVIDERS,
  getVoiceOutput,
  previewTextForModel,
  previewVoiceOutput,
  putVoiceOutput,
} from "./voice-output";

function providerLabel(value) {
  return value === VOICE_OUTPUT_PROVIDERS.deepgram
    ? "Deepgram Aura"
    : "服务器默认语音";
}

function connectionMessage(config) {
  if (config.provider !== VOICE_OUTPUT_PROVIDERS.deepgram) {
    return config.configured
      ? "当前沿用已连接的服务器默认语音。"
      : "当前沿用服务器默认语音，但服务器尚未完成配置。";
  }
  if (!config.configured) return "Deepgram 尚缺 API Key 或音色模型。";
  return config.chinese_fallback_available
    ? "Deepgram 已连接；中文回复的 MiniMax 回退也已就绪。"
    : "Deepgram 已连接：英语、日语等所选语言可用；中文语音当前不可用。";
}

function regionLabel(value) {
  return {
    global: "Global · 自动",
    eu: "EU · 欧洲",
    au: "AU · 澳大利亚",
  }[value] || value;
}

export default function VoiceProviderSettings({
  accountScope = "",
  onStatusChange,
}) {
  const [draft, setDraft] = useState(DEFAULT_VOICE_OUTPUT);
  const [status, setStatus] = useState("loading");
  const [feedback, setFeedback] = useState("正在读取当前账号的发声设置…");
  const audioRef = useRef(null);
  const objectUrlRef = useRef("");

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getVoiceOutput()
      .then((config) => {
        if (cancelled) return;
        setDraft(config);
        setStatus("idle");
        setFeedback(connectionMessage(config));
        onStatusChange?.(config);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setFeedback(error.message);
      });
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [accountScope, onStatusChange, stopPreview]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFeedback("");
  }

  async function save({ preview = false } = {}) {
    setStatus(preview ? "previewing" : "saving");
    setFeedback(preview ? "正在安全保存并生成试听…" : "正在安全保存…");
    stopPreview();
    try {
      const saved = await putVoiceOutput(draft);
      setDraft(saved);
      onStatusChange?.(saved);
      if (!preview) {
        setStatus("idle");
        setFeedback(`${providerLabel(saved.provider)}已保存到当前账号。${connectionMessage(saved)}`);
        return;
      }
      const previewResult = await previewVoiceOutput(
        previewTextForModel(saved.model),
      );
      const objectUrl = URL.createObjectURL(previewResult.blob);
      const audio = new Audio(objectUrl);
      objectUrlRef.current = objectUrl;
      audioRef.current = audio;
      audio.onended = stopPreview;
      await audio.play();
      setStatus("idle");
      setFeedback(`正在播放 ${providerLabel(saved.provider)} 试听。`);
    } catch (error) {
      setStatus("error");
      setFeedback(error.message || "语音设置操作失败。");
    }
  }

  const busy = ["loading", "saving", "previewing"].includes(status);
  const usingDeepgram = draft.provider === VOICE_OUTPUT_PROVIDERS.deepgram;
  const deepgramWithoutChinese =
    usingDeepgram &&
    draft.configured &&
    draft.chinese_fallback_available !== true;
  const supportedLanguages = Array.from(
    new Set(
      (draft.model_options || []).map(
        (model) => DEEPGRAM_LANGUAGE_LABELS[model.language] || model.language,
      ),
    ),
  ).filter(Boolean);

  return (
    <section className="voice-provider-center settings-card" aria-label="发声接口">
      <div className="voice-provider-heading">
        <div>
          <span className="settings-kicker">发声接口</span>
          <h3>为当前账号选择声音</h3>
          <p className="card-hint">
            API Key 只发送给 DengTa 后端加密保存；页面不会回读或显示已经保存的密钥。
          </p>
        </div>
        <span className={`voice-provider-state ${draft.configured ? "ready" : "pending"}`}>
          {draft.enabled === false
            ? "已停用"
            : deepgramWithoutChinese
              ? "部分语言可用"
            : draft.configured
              ? "可发声"
              : "待配置"}
        </span>
      </div>

      <div className="voice-provider-form-grid">
        <label>
          发声来源
          <select
            value={draft.provider}
            onChange={(event) => update("provider", event.target.value)}
            disabled={busy}
          >
            <option value={VOICE_OUTPUT_PROVIDERS.serverDefault}>
              服务器默认语音（当前 MiniMax）
            </option>
            <option value={VOICE_OUTPUT_PROVIDERS.deepgram}>
              Deepgram Aura
            </option>
          </select>
          <small>设置按登录账号与伴侣隔离；切换账号后会读取该账号自己的选择。</small>
        </label>
        <label className="voice-provider-toggle">
          <span>启用云端发声</span>
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(event) => update("enabled", event.target.checked)}
            disabled={busy}
          />
          <small>关闭后保留配置，只停止自动发声和试听。</small>
        </label>
      </div>

      {usingDeepgram && (
        <>
          <div className="voice-provider-language-note" role="note">
            <strong>Deepgram Aura 当前不包含中文音色</strong>
            <p>
              当前后端允许选择的音色语言包括
              {supportedLanguages.join("、") || "英语和日语等语言"}。
              {draft.chinese_fallback_available
                ? "中文回复会自动使用服务器 MiniMax 语音回退，不会被翻译成别的语言。"
                : "服务器 MiniMax 中文回退尚未配置，因此英文、日文等受支持语言可以发声，中文回复暂时只显示文字。"}
            </p>
          </div>
          <div className="voice-provider-form-grid">
            <label>
              Deepgram API Key
              <input
                type="password"
                value={draft.credential || ""}
                onChange={(event) => update("credential", event.target.value)}
                placeholder={
                  draft.credential_configured
                    ? "已安全保存；留空会保留原密钥"
                    : "粘贴 Deepgram API Key"
                }
                autoComplete="off"
                spellCheck="false"
                disabled={busy}
              />
              <small>
                {draft.credential_configured
                  ? "当前账号已有密钥；只有重新填写才会替换。"
                  : "还没有保存密钥。保存后页面会立即清空这个输入框。"}
              </small>
            </label>
            <label>
              Aura 音色模型
              <select
                value={draft.model}
                onChange={(event) => update("model", event.target.value)}
                disabled={busy}
              >
                {(draft.model_options || []).map((model) => (
                  <option value={model.value} key={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <small>试听使用所选模型；以后可以继续增加 Deepgram 新音色。</small>
            </label>
            <label>
              接入区域
              <select
                value={draft.region}
                onChange={(event) => update("region", event.target.value)}
                disabled={busy}
              >
                {(draft.region_options || []).map((region) => (
                  <option value={region} key={region}>
                    {regionLabel(region)}
                  </option>
                ))}
              </select>
              <small>优先选择离后端较近且账户可用的 Deepgram 区域。</small>
            </label>
            <label>
              语速 · {Number(draft.speed || 1).toFixed(2)}×
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.05"
                value={draft.speed}
                onChange={(event) => update("speed", Number(event.target.value))}
                disabled={busy}
              />
              <small>1.00× 是原始语速；可在 0.70× 到 1.50× 之间调节。</small>
            </label>
          </div>
        </>
      )}

      {feedback && (
        <p className={`voice-provider-feedback ${status}`} role="status">
          {feedback}
        </p>
      )}

      <div className="voice-provider-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void save()}
          disabled={busy}
        >
          {status === "saving" ? "保存中…" : "保存设置"}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => void save({ preview: true })}
          disabled={busy || draft.enabled === false}
        >
          {status === "previewing" ? "正在生成试听…" : "保存并试听声音"}
        </button>
      </div>
    </section>
  );
}

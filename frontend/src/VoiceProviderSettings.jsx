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
  return {
    [VOICE_OUTPUT_PROVIDERS.deepgram]: "Deepgram Aura",
    [VOICE_OUTPUT_PROVIDERS.edge]: "Edge 免费神经语音",
    [VOICE_OUTPUT_PROVIDERS.openai]: "OpenAI 兼容 TTS",
    [VOICE_OUTPUT_PROVIDERS.custom]: "自定义 HTTP 语音",
  }[value] || "服务器默认语音";
}

function connectionMessage(config) {
  if (config.provider === VOICE_OUTPUT_PROVIDERS.edge) {
    return "已选择 Edge 免费神经语音：无需 API Key，直接保存即可试听。";
  }
  if (
    config.provider === VOICE_OUTPUT_PROVIDERS.openai ||
    config.provider === VOICE_OUTPUT_PROVIDERS.custom
  ) {
    return config.configured
      ? "已保存你自己的语音接口；试听会直接调用它。"
      : "请填写语音服务地址后再保存。";
  }
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
            <option value={VOICE_OUTPUT_PROVIDERS.edge}>
              Edge 免费神经语音（无需 Key）
            </option>
            <option value={VOICE_OUTPUT_PROVIDERS.openai}>
              OpenAI 兼容 TTS（自带服务）
            </option>
            <option value={VOICE_OUTPUT_PROVIDERS.custom}>
              自定义 HTTP 语音接口
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

      {draft.provider === VOICE_OUTPUT_PROVIDERS.edge && (
        <div className="voice-provider-form-grid">
          <label>
            Edge 音色
            <select
              value={draft.voice_id}
              onChange={(event) => update("voice_id", event.target.value)}
              disabled={busy}
            >
              {(draft.edge_voices || []).map((voice) => (
                <option value={voice.value} key={voice.value}>
                  {voice.label}
                </option>
              ))}
            </select>
            <small>免费音色由微软 Edge Read Aloud 提供，无需 API Key，中文自然。</small>
          </label>
          <label>
            语速微调 · {Number(draft.rate || 0)}%
            <input
              type="range"
              min="-30"
              max="30"
              step="5"
              value={draft.rate}
              onChange={(event) => update("rate", Number(event.target.value))}
              disabled={busy}
            />
            <small>0 为原始语速；正数更快，负数更慢。</small>
          </label>
        </div>
      )}

      {draft.provider === VOICE_OUTPUT_PROVIDERS.openai && (
        <div className="voice-provider-form-grid">
          <label>
            语音服务地址
            <input
              type="url"
              value={draft.api_base_url}
              onChange={(event) => update("api_base_url", event.target.value)}
              placeholder="https://api.openai.com/v1 或你的中转站地址"
              spellCheck="false"
              disabled={busy}
            />
            <small>兼容 /v1/audio/speech 的服务都可以；例如官方、硅基流动或自建网关。</small>
          </label>
          <label>
            API Key
            <input
              type="password"
              value={draft.credential || ""}
              onChange={(event) => update("credential", event.target.value)}
              placeholder={
                draft.credential_configured
                  ? "已安全保存；留空会保留原密钥"
                  : "粘贴你的语音服务 API Key"
              }
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
            />
            <small>只加密保存在当前账号下，不会回读显示。</small>
          </label>
          <label>
            模型
            <input
              type="text"
              value={draft.model}
              onChange={(event) => update("model", event.target.value)}
              placeholder="tts-1 / tts-1-hd / 服务商模型名"
              spellCheck="false"
              disabled={busy}
            />
            <small>不同服务商模型名不同，按你的服务商文档填写。</small>
          </label>
          <label>
            音色
            <input
              type="text"
              value={draft.voice_id}
              onChange={(event) => update("voice_id", event.target.value)}
              placeholder="alloy / nova / 你的音色 ID"
              spellCheck="false"
              disabled={busy}
            />
          </label>
          <label>
            输出格式
            <select
              value={draft.output_format}
              onChange={(event) => update("output_format", event.target.value)}
              disabled={busy}
            >
              {(draft.output_formats || []).map((format) => (
                <option value={format.value} key={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            语速 · {Number(draft.speed || 1).toFixed(2)}×
            <input
              type="range"
              min="0.25"
              max="4"
              step="0.05"
              value={draft.speed}
              onChange={(event) => update("speed", Number(event.target.value))}
              disabled={busy}
            />
          </label>
        </div>
      )}

      {draft.provider === VOICE_OUTPUT_PROVIDERS.custom && (
        <div className="voice-provider-form-grid">
          <label>
            接口地址
            <input
              type="url"
              value={draft.api_base_url}
              onChange={(event) => update("api_base_url", event.target.value)}
              placeholder="https://your-tts.example.com/synthesize"
              spellCheck="false"
              disabled={busy}
            />
            <small>后端会直接请求这个地址；默认只允许 https 公网地址。</small>
          </label>
          <label>
            请求方法
            <select
              value={draft.method}
              onChange={(event) => update("method", event.target.value)}
              disabled={busy}
            >
              {["POST", "GET", "PUT", "PATCH"].map((method) => (
                <option value={method} key={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label>
            Authorization / API Key（可选）
            <input
              type="password"
              value={draft.credential || ""}
              onChange={(event) => update("credential", event.target.value)}
              placeholder={
                draft.credential_configured
                  ? "已安全保存；留空会保留原密钥"
                  : "可选：会作为 Bearer 发送"
              }
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
            />
          </label>
          <label>
            输出格式
            <select
              value={draft.output_format}
              onChange={(event) => update("output_format", event.target.value)}
              disabled={busy}
            >
              {(draft.output_formats || []).map((format) => (
                <option value={format.value} key={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-provider-wide">
            请求头 JSON（可选）
            <textarea
              value={draft.headers_template}
              onChange={(event) => update("headers_template", event.target.value)}
              placeholder='{"X-Api-Key": "{{api_key}}"}'
              rows={2}
              spellCheck="false"
              disabled={busy}
            />
          </label>
          <label className="voice-provider-wide">
            请求体模板
            <textarea
              value={draft.body_template}
              onChange={(event) => update("body_template", event.target.value)}
              placeholder='{"text": "{{text_json}}", "voice": "{{voice}}"}'
              rows={3}
              spellCheck="false"
              disabled={busy}
            />
            <small>
              可用占位符：{"{{text}}"}、{"{{text_json}}"}、{"{{voice}}"}、{"{{model}}"}、
              {"{{api_key}}"}、{"{{format}}"}。
            </small>
          </label>
          <label>
            返回方式
            <select
              value={draft.response_mode}
              onChange={(event) => update("response_mode", event.target.value)}
              disabled={busy}
            >
              {(draft.response_modes || []).map((mode) => (
                <option value={mode.value} key={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            音频字段路径
            <input
              type="text"
              value={draft.audio_path}
              onChange={(event) => update("audio_path", event.target.value)}
              placeholder="data.audio / data.url"
              spellCheck="false"
              disabled={busy}
            />
            <small>只在返回 JSON（base64 或音频 URL）时需要。</small>
          </label>
        </div>
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

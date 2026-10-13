import { providerHealthView } from "./ai-provider-health.js";

export const GROQ_EXPIRY_STORAGE_KEY = "dengta_groq_key_expires_at";

export const SERVICE_LINKS = Object.freeze({
  backend: "https://dashboard.render.com/web/srv-d9ukrqvqj5pc73frp5d0",
  database: "https://supabase.com/dashboard/project/nyyqizwrlmejpfdhgrnd",
  groq: "https://console.groq.com/keys",
  groqUsage: "https://console.groq.com/dashboard",
  minimax: "https://platform.minimax.io/user-center/payment/billing",
  deepgram: "https://console.deepgram.com/",
});

function statusCard(id, name, status, summary, detail, link, linkLabel) {
  return { id, name, status, summary, detail, link, linkLabel };
}

export function describeExpressiveTts(features = {}) {
  const configured = features.expressive_tts_configured === true;
  const apiKeyConfigured = features.expressive_tts_api_key_configured;
  const voiceConfigured = features.expressive_tts_voice_configured;
  const provider = String(features.expressive_tts_provider || "minimax").toLowerCase();
  const isDeepgram = provider === "deepgram";
  const providerName = isDeepgram ? "Deepgram" : "MiniMax";
  const chineseFallbackAvailable =
    features.expressive_tts_chinese_fallback_available === true;

  if (features.expressive_tts_enabled === false) {
    return {
      provider,
      providerName,
      stage: "disabled",
      status: "pending",
      summary: "当前账号已停用云端发声",
      detail: "配置仍安全保留；重新启用后可继续使用原来的语音服务。",
      settingsText: "当前账号已停用云端发声；文字聊天和语音理解不受影响。",
    };
  }

  if (configured) {
    return {
      provider,
      providerName,
      stage: "ready",
      status: "online",
      summary:
        isDeepgram && !chineseFallbackAvailable
          ? "Deepgram 已连接 · 中文暂不可用"
          : `已连接 ${providerName}`,
      detail: isDeepgram
        ? chineseFallbackAvailable
          ? "AI 的受支持语言可使用 Deepgram Aura 发声，中文自动回退 MiniMax；费用由相应服务额度决定。"
          : "Deepgram 的英语、日语等受支持语言可以发声；MiniMax 回退尚未配置，所以中文回复暂时只显示文字。"
        : "AI 回复可使用 MiniMax 云端情绪语音；费用由 MiniMax 套餐或余额决定。",
      settingsText: isDeepgram
        ? chineseFallbackAvailable
          ? "Deepgram Aura 已连接。Aura 当前不支持中文；中文回复会自动使用服务器 MiniMax 语音回退。"
          : "Deepgram Aura 已连接，英语、日语等所选语言可用；中文回退尚未配置，中文回复暂时只显示文字。"
        : "MiniMax 自然语音已连接：会根据 AI 回复选择较合适的情绪后播放；云端失败时本轮只显示文字。",
    };
  }

  if (apiKeyConfigured === true && voiceConfigured !== true) {
    return {
      provider,
      providerName,
      stage: "awaiting_voice",
      status: "pending",
      summary: isDeepgram ? "密钥已就绪，等待选择 Aura 音色" : "密钥已就绪，等待生成音色",
      detail: isDeepgram
        ? "Deepgram API Key 已安全保存，还需要选择 Aura 模型后才能发声。"
        : "还缺 Voice Design 返回的 Voice ID；生成前不会调用 MiniMax，也不会影响文字聊天和语音理解。",
      settingsText: isDeepgram
        ? "Deepgram 密钥已安全连接，请选择 Aura 音色模型并保存。"
        : "MiniMax 密钥已安全连接，正在等待 Voice Design 生成音色；在 Voice ID 配置完成前只显示文字。",
    };
  }

  if (apiKeyConfigured === false || voiceConfigured === true) {
    return {
      provider,
      providerName,
      stage: "incomplete",
      status: "pending",
      summary: `${providerName} 语音配置不完整`,
      detail: isDeepgram
        ? "请填写 Deepgram API Key 并选择 Aura 音色模型；当前只显示文字。"
        : "请检查 MiniMax API Key 与 Voice ID；当前只显示文字，不会影响文字聊天和语音理解。",
      settingsText: isDeepgram
        ? "Deepgram 还没有完整连接；请在发声接口中保存 API Key 和 Aura 音色。"
        : "MiniMax 服务器配置还不完整；现在选择自然语音时本轮只显示文字。",
    };
  }

  return {
    provider,
    providerName,
    stage: "legacy_pending",
    status: "pending",
    summary: "尚未配置自然语音",
    detail:
      "服务器未返回细分配置状态；当前不会产生语音服务费用，也不会影响文字聊天和语音理解。",
    settingsText:
      "自然语音接口已经预留，但服务器尚未报告完整配置；当前只显示文字。",
  };
}

function expressiveFeaturesForAccount(features, voiceOutput) {
  if (!voiceOutput) return features;
  if (voiceOutput.provider === "server_default") {
    return {
      ...features,
      expressive_tts_enabled: voiceOutput.enabled !== false,
      expressive_tts_configured:
        voiceOutput.configured === true ||
        features.expressive_tts_configured === true,
      expressive_tts_api_key_configured:
        voiceOutput.configured === true ||
        features.expressive_tts_api_key_configured,
      expressive_tts_voice_configured:
        voiceOutput.configured === true ||
        features.expressive_tts_voice_configured,
      expressive_tts_provider:
        features.expressive_tts_provider || "minimax",
      expressive_tts_chinese_fallback_available:
        voiceOutput.chinese_fallback_available === true ||
        voiceOutput.configured === true,
    };
  }
  return {
    ...features,
    expressive_tts_enabled: voiceOutput.enabled !== false,
    expressive_tts_configured: voiceOutput.configured === true,
    expressive_tts_api_key_configured:
      voiceOutput.credential_configured === true,
    expressive_tts_voice_configured: Boolean(voiceOutput.model),
    expressive_tts_provider: voiceOutput.provider,
    expressive_tts_chinese_fallback_available:
      voiceOutput.chinese_fallback_available === true,
  };
}

export function buildServiceStatusCards({
  health,
  settings,
  hasLoadedSettings,
  isOnline,
  error,
  voiceOutput = null,
  providerStatus = null,
}) {
  const backendOnline = isOnline && health?.ok === true;
  const features = health?.features || {};
  const providerCenterAuthoritative =
    providerStatus !== null || features.ai_provider_center === true;
  const activeProfile = providerStatus !== null
    ? providerStatus.active_profile || null
    : features.ai_provider_active_profile || null;
  const activeProfileModel = String(activeProfile?.default_model || "").trim();
  const activeProfileHealth = providerHealthView(activeProfile || {});
  const providerReady = providerCenterAuthoritative
    ? backendOnline &&
      Boolean(activeProfile && activeProfileModel) &&
      activeProfileHealth.state !== "expired"
    : backendOnline &&
      Boolean(settings?.api_url && settings?.model);
  const providerName = providerCenterAuthoritative
    ? String(
        activeProfile?.name || activeProfile?.protocol || "自定义接口",
      ).trim()
    : settings?.provider || "自定义接口";
  const providerModel = providerCenterAuthoritative
    ? activeProfileModel
    : settings?.model;
  const expressiveTts = describeExpressiveTts(
    expressiveFeaturesForAccount(features, voiceOutput),
  );

  return [
    statusCard(
      "backend",
      "DengTa 后端",
      backendOnline ? "online" : error ? "error" : "checking",
      backendOnline ? "服务器在线" : error || "正在检查服务器",
      backendOnline
        ? `版本 ${health?.version || "未知"} · 本次检查已收到 HTTP 200`
        : "聊天、设置和语音都需要先连接后端。",
      SERVICE_LINKS.backend,
      "打开 Render",
    ),
    statusCard(
      "database",
      "Supabase 数据库",
      backendOnline && hasLoadedSettings ? "online" : "checking",
      backendOnline && hasLoadedSettings ? "应用设置已读取" : "等待应用数据回读",
      hasLoadedSettings
        ? "已读取应用设置；这次检查没有执行写入测试。"
        : "如果这里长期停留在等待状态，请检查 Supabase 项目和后端环境变量。",
      SERVICE_LINKS.database,
      "打开 Supabase",
    ),
    statusCard(
      "provider",
      "当前聊天模型",
      providerReady
        ? activeProfileHealth.state === "catalog_error" ? "error"
          : providerCenterAuthoritative && activeProfileHealth.state === "catalog_ok" ? "online" : "pending"
        : "pending",
      providerReady
        ? `${providerName} · ${providerModel}`
        : providerCenterAuthoritative
          ? activeProfile
            ? activeProfileHealth.state === "expired" ? "活动接口已到期" : !backendOnline ? "等待后端连接" : "活动接口尚未填写模型"
            : "尚未选择活动接口"
          : "接口或模型尚未完整填写",
      providerReady
        ? providerCenterAuthoritative
          ? `${activeProfileHealth.summary}。${activeProfileHealth.detail} 聊天生成仍需实际调用确认。`
          : "接口和模型已填写，尚未验证生成请求；可以去聊天发送一条消息确认。"
        : providerCenterAuthoritative
          ? "到“多供应商 API 控制台”中添加、测试并启用一个接口。"
          : "请检查 API 地址和模型名称。",
      "",
      "",
    ),
    statusCard(
      "groq",
      "Groq 语音理解",
      "pending",
      features.hervoice_proxy_configured === true
        ? "Voice 代理已配置"
        : "尚未连接 Voice 代理",
      features.hervoice_proxy_configured === true
        ? "后端报告了代理配置；转写是否成功需实际录音验证，免费额度或密钥到期可在 Groq 控制台查看。"
        : "需要在 Render 配置 Voice 地址与内部密钥。",
      SERVICE_LINKS.groq,
      "管理 Groq 密钥",
    ),
    statusCard(
      "voice-output",
      `${expressiveTts.providerName} 自然语音`,
      backendOnline ? expressiveTts.status : "pending",
      expressiveTts.summary,
      expressiveTts.detail,
      expressiveTts.provider === "deepgram"
        ? SERVICE_LINKS.deepgram
        : SERVICE_LINKS.minimax,
      expressiveTts.provider === "deepgram"
        ? "打开 Deepgram 控制台"
        : "查看 MiniMax 账单",
    ),
    statusCard(
      "ombre-mcp",
      "Ombre MCP 记忆",
      features.ombre_mcp_configured === true
        ? "pending"
        : features.ombre_mcp_client === true
          ? "pending"
          : "checking",
      features.ombre_mcp_configured === true
        ? "服务器地址已配置"
        : features.ombre_mcp_client === true
          ? "客户端已就绪，等待服务器"
          : "等待后端更新",
      features.ombre_mcp_configured === true
        ? "请到“记忆”页面查看真实握手结果和服务器工具目录。"
        : "可以在“连接设置 → 外部记忆”中自行添加地址并测试；凭据由后端加密保存。",
      "",
      "",
    ),
  ];
}

export function describeGroqExpiry(value, now = new Date()) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      status: "unknown",
      text: "尚未记录到期日；请按照 Groq 创建密钥时选择的日期填写。",
    };
  }

  const expiresAt = new Date(`${normalized}T23:59:59Z`);
  if (Number.isNaN(expiresAt.getTime())) {
    return { status: "unknown", text: "到期日期格式不正确。" };
  }

  const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) {
    return { status: "expired", text: "该日期已经过去，请立即轮换 Groq 密钥。" };
  }
  if (days <= 14) {
    return {
      status: "warning",
      text: `距离到期约 ${days} 天，请提前创建并更换密钥。`,
    };
  }
  return { status: "ok", text: `距离到期约 ${days} 天。` };
}

export function readGroqExpiryDate(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    return (
      readAccountStorage(storage, GROQ_EXPIRY_STORAGE_KEY, accountScope, {
        migrateLegacy: true,
      }) || ""
    );
  } catch {
    return "";
  }
}

export function storeGroqExpiryDate(
  value,
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    const normalized = String(value || "").trim();
    writeAccountStorage(
      storage,
      GROQ_EXPIRY_STORAGE_KEY,
      accountScope,
      normalized || null,
    );
  } catch {
    // 本地提醒写入失败不应影响聊天和服务器设置。
  }
}
import { readAccountStorage, writeAccountStorage } from "./account-storage.js";

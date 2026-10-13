const SETTINGS_SERVICE_ERROR_MESSAGES = Object.freeze({
  AI_PROVIDER_CREDENTIAL_INVALID:
    "已保存的接口密钥无法由当前后端解密。请在对应接口卡片重新粘贴 API Key，保存修改后再检查模型目录 / The saved provider key cannot be decrypted by this backend. Re-enter the API key, save the profile, then check the model catalog.",
  OMBRE_MCP_UPSTREAM_ERROR: "记忆服务返回 HTTP 错误。检查 HTTPS 地址和 /mcp 路径；旧 /mcp-extra 已停用。401/403 请重新检查令牌。",
  OMBRE_MCP_TIMEOUT: "记忆服务响应超时。检查服务是否启动及网络，再点击测试连接。",
  OMBRE_MCP_UNAVAILABLE: "无法连接记忆服务。检查公网 HTTPS 地址与服务状态，再点击测试连接。",
  MCP_PROTOCOL_UNSUPPORTED: "记忆服务使用的 MCP 协议版本不兼容，请检查服务版本。",
  EXTERNAL_MEMORY_READ_TOOL_MISSING: "已连上 MCP，但没有识别出记忆读取工具。检查工具清单与服务版本。",
  private_media_preference_clear_failed: "未能清除图片的使用设置，文件尚未删除，请重试。",
  private_media_remove_failed: "存储服务未能删除图片，请检查服务状态后重试。",
  AI_PROVIDER_CREDENTIAL_REQUIRED:
    "请先填写接口 API Key / Enter the provider API key before continuing.",
  AI_PROVIDER_MODEL_REQUIRED:
    "请先填写默认模型 / Enter a default model before enabling this provider.",
  AI_PROVIDER_MIGRATION_REQUIRED:
    "模型接口数据库尚未准备完成 / The provider database migration is not ready yet.",
  AI_PROVIDER_UPSTREAM_AUTH_FAILED:
    "供应商拒绝了接口凭据。请检查 API Key、账号权限和模型访问权限 / The provider rejected the credential. Check the API key, account permissions, and model access.",
  AI_PROVIDER_MODEL_CATALOG_UNAVAILABLE:
    "供应商没有提供可读取的模型目录。请核对 Base URL 和接口类型 / The provider model catalog is unavailable. Check the Base URL and protocol.",
  AI_PROVIDER_UPSTREAM_RATE_LIMITED:
    "供应商暂时限制请求。请检查额度或稍后重试 / The provider rate-limited the request. Check quota or retry later.",
  AI_PROVIDER_UPSTREAM_REJECTED:
    "供应商拒绝了模型目录检查。请核对接口配置和访问策略 / The provider rejected the model catalog probe. Check the endpoint configuration and access policy.",
  AI_PROVIDER_UPSTREAM_TIMEOUT:
    "供应商接口响应超时，请稍后重试 / The provider request timed out. Try again later.",
  AI_PROVIDER_UPSTREAM_UNAVAILABLE:
    "供应商接口暂时不可用，请稍后重试 / The provider is temporarily unavailable. Try again later.",
  MCP_CREDENTIAL_INVALID:
    "已保存的设备凭据无法由当前后端解密。请在对应 MCP 连接重新填写令牌并保存 / The saved device credential cannot be decrypted by this backend. Re-enter the token on that MCP connection and save it.",
  MCP_ENCRYPTION_NOT_CONFIGURED:
    "后端尚未配置凭据加密密钥；需要令牌的连接暂时不能保存 / The backend credential-encryption key is not configured, so token-protected connections cannot be saved yet.",
});

const MESSAGE_CODE_PATTERNS = Object.freeze([
  [
    /接口凭据无法解密|provider (?:credential|key).*(?:cannot|could not) be decrypted/i,
    "AI_PROVIDER_CREDENTIAL_INVALID",
  ],
  [
    /无法解密设备凭据|device credential.*(?:cannot|could not) be decrypted/i,
    "MCP_CREDENTIAL_INVALID",
  ],
]);

function inferredCode(source = {}) {
  const explicit = String(source?.code || "").trim();
  if (explicit) return explicit;
  const message = String(source?.message || source || "");
  return MESSAGE_CODE_PATTERNS.find(([pattern]) => pattern.test(message))?.[1] || "";
}

export function settingsServiceErrorMessage(source, fallback) {
  const mapped = SETTINGS_SERVICE_ERROR_MESSAGES[inferredCode(source)];
  if (mapped) return mapped;
  const message = String(source?.message || source || "").trim();
  return message || fallback;
}

function httpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

export function settingsServiceErrorDetail(source, fallback) {
  const message = settingsServiceErrorMessage(source, fallback);
  const code = inferredCode(source);
  const status = httpStatus(source?.status);
  const upstreamStatus = httpStatus(
    source?.upstream_status ?? source?.upstreamStatus,
  );
  const diagnostic = [
    code,
    status ? `后端 HTTP ${status}` : "",
    upstreamStatus ? `上游 HTTP ${upstreamStatus}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

export function providerCredentialNeedsRecovery(profile = {}) {
  const detail = String(profile?.health?.detail || "");
  return MESSAGE_CODE_PATTERNS[0][0].test(detail);
}

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { AuthenticatedImage } from "./PrivateMedia";

const EMPTY_STATUS = {
  settings: {
    generation_mode: "confirm",
    daily_call_limit: null,
    monthly_call_limit: null,
    surprise_enabled: false,
    max_surprise_days: 30,
  },
  provider: {
    configured: false,
    name: "我的图片接口",
    base_url: "",
    auth_type: "bearer",
    model: "",
    enabled: false,
    auth_configured: false,
    credential_state: "missing",
    credential_reentry_required: false,
    last_status: "untested",
    last_error_code: null,
  },
  usage: { day: 0, month: 0 },
  surprise_shutdown_required: false,
};

const CREATIVE_CREDENTIAL_RECOVERY_CODES = new Set([
  "creative_secret_invalid",
  "creative_secret_scope_invalid",
  "creative_provider_credential_unreadable",
  "creative_provider_credential_reentry_required",
]);

const IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE =
  "旧部署保存的图片接口凭据无法由当前后端解密。已有图片与手动上传文件仍保留；如需生成新图片，请重新填写图片接口。 / The saved image API credential cannot be decrypted by this backend. Existing images and manual uploads remain stored. Re-enter the image API settings to generate new images.";

const ARTWORK_METADATA_RECOVERY_MESSAGE =
  "已有图片与手动上传文件仍保留；旧作品文案可能暂不可读，未完成作品需要重新构思。重新填写图片 API Key 不能恢复旧作品文案。 / Existing images and manual uploads remain stored. Text from old artwork may be unavailable, and unfinished artwork must be recreated. Re-entering the image API key cannot restore old artwork text.";

function isCreativeCredentialRecoveryError(error) {
  return (
    CREATIVE_CREDENTIAL_RECOVERY_CODES.has(String(error?.code || "")) ||
    /图片接口或作品凭据.*(?:无法解密|不匹配)|(?:image|artwork).*(?:credential|secret).*(?:cannot|could not).*decrypt/i.test(
      String(error?.message || ""),
    )
  );
}

function providerNeedsCredentialReentry(provider) {
  return (
    provider?.credential_reentry_required === true ||
    provider?.credential_state === "needs_reentry"
  );
}

function artworkNeedsMetadataRecovery(artwork) {
  return (
    artwork?.metadata_reentry_required === true ||
    artwork?.metadata_state === "needs_reentry"
  );
}

function isArtworkMetadataRecoveryError(error) {
  return (
    String(error?.code || "") ===
      "creative_artwork_metadata_reentry_required" ||
    error?.metadata_reentry_required === true ||
    error?.metadata_state === "needs_reentry"
  );
}

function creativeErrorFeedback(
  error,
  recoveryMessage = ARTWORK_METADATA_RECOVERY_MESSAGE,
) {
  return isCreativeCredentialRecoveryError(error)
    ? recoveryMessage
    : error?.message || "请求失败，请稍后重试。";
}

function normalizeCreativeStatus(value = {}) {
  return {
    ...EMPTY_STATUS,
    ...value,
    settings: { ...EMPTY_STATUS.settings, ...(value.settings || {}) },
    provider: { ...EMPTY_STATUS.provider, ...(value.provider || {}) },
    usage: { ...EMPTY_STATUS.usage, ...(value.usage || {}) },
  };
}

const CREATIVE_FAILURE_MESSAGES = Object.freeze({
  creative_provider_not_enabled: "图片接口尚未启用，请先在设置里勾选启用并保存。",
  creative_provider_auth_failed: "图片接口拒绝了密钥，请检查 API Key。",
  creative_provider_rate_limited: "图片接口额度不足或当前请求过于频繁。",
  creative_provider_rejected: "图片接口拒绝了请求，请核对模型名和接口协议。",
  creative_provider_unavailable: "暂时无法连接图片接口，请检查 Base URL 和网络。",
  creative_provider_timeout: "图片供应商生成超时，可以稍后重试。",
  creative_provider_image_missing: "接口有响应，但返回格式里没有可识别的图片。",
  creative_provider_image_invalid: "接口返回的内容不是有效的 JPG、PNG 或 WebP 图片。",
  creative_provider_image_download_failed: "接口给出了图片地址，但服务器无法安全下载。",
  creative_provider_image_too_large: "接口返回的图片超过 12MB。",
  creative_output_too_large: "生成结果超过私人作品库的 5MB 保存上限。",
  creative_daily_limit_reached: "已达到你设置的今日图片调用上限。",
  creative_monthly_limit_reached: "已达到你设置的本月图片调用上限。",
});

function creativeFailureMessage(code) {
  return (
    CREATIVE_FAILURE_MESSAGES[String(code || "")] ||
    "图片生成没有完成，请查看图片接口状态后重试。"
  );
}

function creativeRequest(path, options) {
  return apiRequest(`/api/v2/creative${path}`, options);
}

function loadCreativeLibraryResources(request = creativeRequest) {
  // Provider health and the artwork library are independent. A stale provider
  // credential must never prevent a readable stored image from being shown.
  return Promise.allSettled([
    request("/status"),
    request("/artworks"),
  ]);
}

function useCreativeLibraryScope() {
  const [scope] = useState(() => {
    let owner, controller, active = false, generation = 0, operation = null;
    const matches = () => {
      const current = authSession.getSnapshot();
      return Boolean(owner?.user?.id && owner.activeCompanionId) &&
        current?.user?.id === owner.user.id && current?.activeCompanionId === owner.activeCompanionId;
    };
    const current = token => active && !controller.signal.aborted && matches() && (!token || token.generation === generation);
    const assertCurrent = () => {
      if (!current()) throw new DOMException("旧画室操作已取消。", "AbortError");
    };
    const cancel = () => { active = false; generation++; controller?.abort(); operation = null; };
    return {
      activate() { owner = authSession.getSnapshot(); controller = new AbortController(); active = true; generation++; },
      cancel, current, capture: () => ({ generation }),
      busy: () => operation !== null,
      begin() {
        if (!current() || operation) return null;
        operation = { generation };
        return operation;
      },
      finish(token) { if (operation === token) operation = null; },
      async request(path, options = {}) {
        assertCurrent();
        const token = { generation }, requestOwner = owner, requestController = controller;
        const assertRequest = () => {
          if (!current(token)) throw new DOMException("旧画室请求已取消。", "AbortError");
        };
        const data = await creativeRequest(path, { ...options, signal: requestController.signal,
          authSession: {
            getSnapshot: () => requestOwner,
            async getRequestContext() {
              assertRequest();
              const context = await authSession.getRequestContext();
              assertRequest();
              if (context?.companionId !== requestOwner.activeCompanionId) throw new DOMException("画室伴侣已切换。", "AbortError");
              return context;
            },
            captureCompanionFromResponse: response => { if (current(token)) authSession.captureCompanionFromResponse?.(response); },
            invalidateSession: message => { if (current(token)) return authSession.invalidateSession?.(message); },
          },
        });
        // JSON decoding can finish after an account switch even when fetch was aborted.
        assertRequest();
        return data;
      },
    };
  });
  useLayoutEffect(() => {
    scope.activate();
    const unsubscribe = authSession.subscribe?.(() => { if (!scope.current()) scope.cancel(); });
    return () => { unsubscribe?.(); scope.cancel(); };
  }, [scope]);
  return scope;
}

function modeLabel(value) {
  if (value === "autonomous") return "自主创作";
  if (value === "off") return "关闭图片生成";
  return "每次确认";
}

function stateLabel(value) {
  return (
    {
      idea: "构思中",
      awaiting_confirmation: "等你确认后再画",
      generating: "正在调用图片接口",
      ready: "已经画好",
      revealed: "惊喜已揭晓",
      failed: "这次生成失败",
      cancelled: "已经取消",
    }[value] || value
  );
}

function kindLabel(value) {
  return (
    {
      avatar: "头像构思",
      doodle: "随手涂鸦",
      gift: "一份画出来的礼物",
    }[value] || "作品"
  );
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function imageElementForFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    image.__dengtaObjectUrl = objectUrl;
    return image;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function prepareArtworkUpload(file) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file?.type) ||
    !file.size
  ) {
    throw new Error("手动上传只支持 JPG、PNG 或 WebP 图片。");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("手动上传的原图不能超过 12MB。");
  }
  const image = await imageElementForFile(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    image.close?.();
    throw new Error("这张图片无法解码。");
  }
  const maxDimension = 2048;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (image.__dengtaObjectUrl) {
    URL.revokeObjectURL(image.__dengtaObjectUrl);
  }
  image.close?.();
  let quality = 0.9;
  let blob = await canvasBlob(canvas, "image/webp", quality);
  while (blob && blob.size > 5 * 1024 * 1024 && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, "image/webp", quality);
  }
  if (!blob || blob.size > 5 * 1024 * 1024) {
    throw new Error("处理后的图片仍超过 5MB，请先在相册中缩小。");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    data: btoa(binary),
    mime_type: blob.type || "image/webp",
  };
}

export function CompanionArtworkLibrary({
  aiName = "伴侣",
  onNotice,
  onOpenImageProviderSettings,
}) {
  const scope = useCreativeLibraryScope();
  const [artworks, setArtworks] = useState([]);
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [providerCredentialRecoveryRequired, setProviderCredentialRecoveryRequired] =
    useState(false);
  const [artworkMetadataUnavailable, setArtworkMetadataUnavailable] =
    useState(false);

  const applyLoadResults = useCallback((results) => {
    const [statusResult, artworkResult] = results;
    let providerRecoveryRequired = false;
    let metadataUnavailable = false;
    const ordinaryErrors = [];

    if (statusResult.status === "fulfilled") {
      const nextStatus = normalizeCreativeStatus(statusResult.value);
      setStatus(nextStatus);
      providerRecoveryRequired = providerNeedsCredentialReentry(
        nextStatus.provider,
      );
    } else if (isCreativeCredentialRecoveryError(statusResult.reason)) {
      providerRecoveryRequired = true;
    } else {
      ordinaryErrors.push(statusResult.reason);
    }

    if (artworkResult.status === "fulfilled") {
      const returnedArtworks = Array.isArray(artworkResult.value.artworks)
        ? artworkResult.value.artworks
        : [];
      setArtworks(returnedArtworks);
      metadataUnavailable =
        artworkResult.value.metadata_reentry_required === true ||
        returnedArtworks.some(artworkNeedsMetadataRecovery);
    } else if (isCreativeCredentialRecoveryError(artworkResult.reason)) {
      metadataUnavailable = true;
    } else {
      ordinaryErrors.push(artworkResult.reason);
    }

    setProviderCredentialRecoveryRequired(providerRecoveryRequired);
    setArtworkMetadataUnavailable(metadataUnavailable);
    if (ordinaryErrors.length > 0) {
      setFeedback(
        ordinaryErrors[0]?.message || "作品库暂时无法读取，请稍后重试。",
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = scope.capture();
    const results = await loadCreativeLibraryResources(scope.request);
    if (!scope.current(token)) throw new DOMException("旧画室操作已取消。", "AbortError");
    applyLoadResults(results);
    return results;
  }, [applyLoadResults, scope]);

  useEffect(() => {
    let active = true;
    loadCreativeLibraryResources(scope.request)
      .then((results) => {
        if (!active || !scope.current()) return;
        applyLoadResults(results);
      });
    return () => {
      active = false;
    };
  }, [applyLoadResults, scope]);

  async function requestIdea(kind) {
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`idea:${kind}`);
    setFeedback("");
    try {
      const data = await scope.request("/ideas", {
        method: "POST",
        body: JSON.stringify({ kind, acknowledge_cost: false }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      const message = data.created
        ? `${aiName}已经留下构思，图片还没有生成。`
        : data.reason || `${aiName}这次没有勉强自己画。`;
      setFeedback(message);
      onNotice?.(message);
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function refreshArtworks() {
    const operation = scope.begin();
    if (!operation) return;
    setBusy("refresh");
    setFeedback("");
    try {
      await refresh();
    } catch (error) {
      if (scope.current(operation)) setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function generateArtwork(artwork) {
    if (!scope.current() || scope.busy()) return;
    if (artworkNeedsMetadataRecovery(artwork)) {
      setFeedback(ARTWORK_METADATA_RECOVERY_MESSAGE);
      return;
    }
    if (providerCredentialRecoveryRequired) {
      setFeedback(IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE);
      return;
    }
    if (!status.provider.enabled) {
      setFeedback(
        "图片接口尚未启用。请先前往设置保存并启用图片接口。 / The image API is not enabled. Save and enable it in Settings first.",
      );
      return;
    }
    if (
      !window.confirm(
        `现在会真实调用“${status.provider.name || "图片接口"}”生成《${
          artwork.title
        }》，可能产生供应商费用。继续吗？`,
      )
    ) {
      return;
    }
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`generate:${artwork.id}`);
    setFeedback("");
    try {
      await scope.request(`/artworks/${artwork.id}/generate`, {
        method: "POST",
        body: JSON.stringify({ acknowledge_cost: true }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      const message = "图片已经生成并只保存在当前账号的私人作品库里。";
      setFeedback(message);
      onNotice?.(message);
    } catch (error) {
      if (!scope.current(operation)) return;
      await refresh().catch(() => {});
      if (!scope.current(operation)) return;
      if (isArtworkMetadataRecoveryError(error)) {
        setArtworkMetadataUnavailable(true);
      } else if (isCreativeCredentialRecoveryError(error)) {
        setProviderCredentialRecoveryRequired(true);
      }
      setFeedback(
        creativeErrorFeedback(
          error,
          isArtworkMetadataRecoveryError(error)
            ? ARTWORK_METADATA_RECOVERY_MESSAGE
            : IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE,
        ),
      );
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function removeArtwork(artwork) {
    if (!scope.current() || scope.busy()) return;
    if (!window.confirm(`永久删除《${artwork.title}》吗？删除后无法恢复。`)) {
      return;
    }
    const operation = scope.begin();
    if (!operation) return;
    setBusy(`delete:${artwork.id}`);
    try {
      await scope.request(`/artworks/${artwork.id}`, {
        method: "DELETE",
      });
      await refresh();
      if (!scope.current(operation)) return;
      setFeedback("作品已经从私人存储中删除。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  async function uploadArtwork(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const operation = scope.begin();
    if (!operation) return;
    setBusy("upload");
    setFeedback("");
    try {
      const prepared = await prepareArtworkUpload(file);
      if (!scope.current(operation)) return;
      await scope.request("/artworks/upload", {
        method: "POST",
        body: JSON.stringify({
          ...prepared,
          kind: "doodle",
          title: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
          description: "由当前账号手动放进私人作品库的图片。",
          alt_text: file.name.slice(0, 200),
        }),
      });
      await refresh();
      if (!scope.current(operation)) return;
      setFeedback("图片已去除可识别元数据并保存到私人作品库，没有调用图片模型。");
    } catch (error) {
      if (!scope.current(operation)) return;
      setFeedback(creativeErrorFeedback(error));
    } finally {
      scope.finish(operation);
      if (scope.current(operation)) setBusy("");
    }
  }

  return (
    <section className="companion-artwork-library" aria-labelledby="creative-library-title">
      <div className="profile-section-heading">
        <div>
          <span className="eyebrow">只属于你们的私人画册</span>
          <h3 id="creative-library-title">头像、涂鸦与小礼物</h3>
        </div>
        <small>{modeLabel(status.settings.generation_mode)}</small>
      </div>

      {(providerCredentialRecoveryRequired || artworkMetadataUnavailable) && (
        <div className="creative-credential-recovery" role="alert">
          <div>
            <strong>
              {providerCredentialRecoveryRequired
                ? "图片接口需要重新填写 / Image API setup required"
                : "旧作品文案暂不可读 / Old artwork text unavailable"}
            </strong>
            <p>
              {providerCredentialRecoveryRequired
                ? IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE
                : ARTWORK_METADATA_RECOVERY_MESSAGE}
            </p>
          </div>
          {providerCredentialRecoveryRequired && (
            <button type="button" onClick={onOpenImageProviderSettings}>
              前往图片接口设置 / Open image settings
            </button>
          )}
        </div>
      )}

      <div className="creative-invitation-card">
        <div>
          <strong>{aiName}可以先想，再决定画不画</strong>
          <p>
            构思会参考真实聊天和角色档案；先构思只会使用当前文字模型，不会调用图片接口。
          </p>
        </div>
        <div className="creative-invitation-actions">
          {[
            ["doodle", "想一张涂鸦"],
            ["gift", "想一份画出来的礼物"],
            ["avatar", "想一个自我形象"],
          ].map(([kind, label]) => (
            <button
              type="button"
              key={kind}
              disabled={
                Boolean(busy) ||
                status.settings.generation_mode === "off"
              }
              onClick={() => requestIdea(kind)}
            >
              {busy === `idea:${kind}` ? "正在想…" : label}
            </button>
          ))}
          <label className="creative-upload-button">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={Boolean(busy)}
              onChange={uploadArtwork}
            />
            <span>{busy === "upload" ? "处理中…" : "手动上传"}</span>
          </label>
        </div>
      </div>

      {status.settings.generation_mode === "off" && (
        <p className="creative-feedback" role="status">
          图片生成已关闭，不影响聊天和已有表情包。以后仍可在设置里重新开启。
        </p>
      )}
      {feedback && (
        <p className="creative-feedback" role="status">
          {feedback}
        </p>
      )}

      <div className="artwork-grid">
        {artworks.length === 0 ? (
          <div className="artwork-empty">
            <strong>这里还没有作品</strong>
            <p>
              没有真实聊天依据时，{aiName}不会用虚假的共同经历凑一张画。
            </p>
          </div>
        ) : (
          artworks.map((artwork) => (
            <article className={`artwork-card state-${artwork.state}`} key={artwork.id}>
              {artwork.image_url ? (
                <AuthenticatedImage
                  src={artwork.image_url}
                  alt={artwork.alt_text}
                  className="artwork-card-image"
                  loading="lazy"
                />
              ) : (
                <div className="artwork-concept" aria-hidden="true">
                  <span>✦</span>
                  <small>{kindLabel(artwork.kind)}</small>
                </div>
              )}
              <div className="artwork-card-copy">
                <span>{stateLabel(artwork.state)}</span>
                <strong>{artwork.title}</strong>
                <p>
                  {artwork.description ||
                    (artworkNeedsMetadataRecovery(artwork)
                      ? "旧作品文案暂不可读；已保存图片不受影响，未完成作品需重新构思。 / Old artwork text is unavailable. Saved images are unaffected; unfinished artwork must be recreated."
                      : "")}
                </p>
                {artwork.reason && <small>为什么想画：{artwork.reason}</small>}
                {artwork.model && (
                  <small>
                    {artwork.model} · 实际调用 {artwork.actual_call_count} 次
                  </small>
                )}
                {artwork.failure_code && (
                  <small className="artwork-error">
                    生成失败：{creativeFailureMessage(artwork.failure_code)}
                    <br />
                    错误码：{artwork.failure_code}
                  </small>
                )}
                {artwork.state === "generating" && (
                  <small>
                    先刷新查看是否已画好。若长时间没有结果，可以删除本次作品，再从上方重新构思。
                    删除不会撤回已提交的接口调用；重新生成可能产生新的接口费用。
                  </small>
                )}
              </div>
              <div className="artwork-card-actions">
                {artwork.state === "generating" && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={Boolean(busy)}
                    onClick={refreshArtworks}
                  >
                    {busy === "refresh" ? "正在刷新…" : "刷新作品状态"}
                  </button>
                )}
                {["awaiting_confirmation", "failed"].includes(
                  artwork.state,
                ) && (
                  <button
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      status.settings.generation_mode === "off"
                    }
                    onClick={() => generateArtwork(artwork)}
                  >
                    {busy === `generate:${artwork.id}`
                      ? "正在画…"
                      : artworkNeedsMetadataRecovery(artwork)
                        ? "重新构思后生成 / Recreate idea"
                        : providerCredentialRecoveryRequired
                          ? "重新配置后生成 / Reconfigure"
                          : !status.provider.enabled
                            ? "先启用图片接口 / Enable image API"
                      : artwork.state === "failed"
                        ? "确认费用后重试"
                        : "确认费用并生成"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => removeArtwork(artwork)}
                >
                  删除
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

export default function CompanionCreativeSettings() {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [settingsDraft, setSettingsDraft] = useState(EMPTY_STATUS.settings);
  const [providerDraft, setProviderDraft] = useState(EMPTY_STATUS.provider);
  const [hiddenAction, setHiddenAction] = useState("reveal");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const data = await creativeRequest("/status");
    const next = normalizeCreativeStatus(data);
    setStatus(next);
    setSettingsDraft(next.settings);
    setProviderDraft(next.provider);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    creativeRequest("/status")
      .then((data) => {
        if (!active) return;
        const next = normalizeCreativeStatus(data);
        setStatus(next);
        setSettingsDraft(next.settings);
        setProviderDraft(next.provider);
      })
      .catch((error) => {
        if (active) {
          setFeedback(
            isCreativeCredentialRecoveryError(error)
              ? IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE
              : error.message,
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    setBusy("settings");
    setFeedback("");
    try {
      const data = await creativeRequest("/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...settingsDraft,
          daily_call_limit:
            settingsDraft.daily_call_limit === ""
              ? null
              : settingsDraft.daily_call_limit,
          monthly_call_limit:
            settingsDraft.monthly_call_limit === ""
              ? null
              : settingsDraft.monthly_call_limit,
          hidden_content_action:
            status.surprise_shutdown_required &&
            settingsDraft.surprise_enabled !== true
              ? hiddenAction
              : undefined,
        }),
      });
      await load();
      setFeedback(
        data.settings.generation_mode === "autonomous"
          ? "自主创作已启用；后台只会在随机检查到期且确实想画时调用图片接口。"
          : "图片创作权限已保存。",
      );
    } catch (error) {
      setFeedback(creativeErrorFeedback(error));
    } finally {
      setBusy("");
    }
  }

  async function saveProvider(event) {
    event.preventDefault();
    setBusy("provider");
    setFeedback("");
    try {
      const data = await creativeRequest("/provider", {
        method: "PUT",
        body: JSON.stringify({
          name: providerDraft.name,
          base_url: providerDraft.base_url,
          auth_type: providerDraft.auth_type,
          credential,
          model: providerDraft.model,
          enabled: providerDraft.enabled === true,
        }),
      });
      setCredential("");
      await load();
      setFeedback(data.message);
    } catch (error) {
      setFeedback(
        creativeErrorFeedback(error, IMAGE_PROVIDER_CREDENTIAL_RECOVERY_MESSAGE),
      );
    } finally {
      setBusy("");
    }
  }

  function updateSettings(field, value) {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  }

  function updateProvider(field, value) {
    setProviderDraft((current) => ({ ...current, [field]: value }));
  }

  const providerCredentialRecoveryRequired =
    providerNeedsCredentialReentry(status.provider);

  return (
    <section className="settings-card companion-creative-settings">
      <div className="creative-settings-heading">
        <div>
          <span className="settings-kicker">私人创作</span>
          <h3>图片接口、涂鸦与秘密惊喜</h3>
          <p>
            图片接口与聊天模型完全分开。旧背景和头像不会恢复；已有表情包功能不受影响。
          </p>
        </div>
        <span className={status.provider.enabled ? "provider-state ready" : "provider-state pending"}>
          {status.provider.enabled ? "图片接口已启用" : "尚未启用"}
        </span>
      </div>

      {feedback && (
        <p className="creative-feedback" role="status">
          {feedback}
        </p>
      )}

      <form className="creative-permission-form" onSubmit={saveSettings}>
        <label>
          图片生成权限
          <select
            value={settingsDraft.generation_mode}
            onChange={(event) =>
              updateSettings("generation_mode", event.target.value)
            }
          >
            <option value="confirm">每次确认（默认）</option>
            <option value="autonomous">自主创作</option>
            <option value="off">关闭图片生成</option>
          </select>
          <small>
            “每次确认”只保存构思，直到你明确确认一次可能付费的图片调用。
          </small>
        </label>
        <label>
          24 小时滚动调用上限
          <input
            type="number"
            min="1"
            max="1000"
            value={settingsDraft.daily_call_limit ?? ""}
            placeholder="留空表示不设上限"
            onChange={(event) =>
              updateSettings("daily_call_limit", event.target.value)
            }
          />
        </label>
        <label>
          31 天滚动调用上限
          <input
            type="number"
            min="1"
            max="10000"
            value={settingsDraft.monthly_call_limit ?? ""}
            placeholder="留空表示不设上限"
            onChange={(event) =>
              updateSettings("monthly_call_limit", event.target.value)
            }
          />
        </label>
        <label className="creative-switch-row">
          <input
            type="checkbox"
            checked={settingsDraft.surprise_enabled === true}
            disabled={settingsDraft.generation_mode !== "autonomous"}
            onChange={(event) =>
              updateSettings("surprise_enabled", event.target.checked)
            }
          />
          <span>
            <strong>允许秘密惊喜</strong>
            <small>
              默认关闭。开启后，未揭晓的构思、作品和进度不会出现在聊天或作品库。
            </small>
          </span>
        </label>
        {settingsDraft.surprise_enabled === true && (
          <label>
            最晚揭晓天数
            <input
              type="number"
              min="1"
              max="365"
              value={settingsDraft.max_surprise_days}
              onChange={(event) =>
                updateSettings("max_surprise_days", Number(event.target.value))
              }
            />
          </label>
        )}
        {status.surprise_shutdown_required &&
          settingsDraft.surprise_enabled !== true && (
            <label>
              关闭后怎样处理已经准备的秘密内容
              <select
                value={hiddenAction}
                onChange={(event) => setHiddenAction(event.target.value)}
              >
                <option value="reveal">已完成作品立即揭晓，未完成任务取消</option>
                <option value="delete">全部永久删除</option>
              </select>
              <small>
                DengTa 不会把秘密任务无限留在后台，也不会替你做不可撤销的选择。
              </small>
            </label>
          )}
        <button className="primary-button" disabled={Boolean(busy)}>
          {busy === "settings" ? "保存中…" : "保存创作权限"}
        </button>
      </form>

      <form
        id="creative-provider-settings"
        className="creative-provider-form"
        onSubmit={saveProvider}
      >
        {providerCredentialRecoveryRequired && (
          <div className="creative-provider-reentry" role="alert">
            <strong>请重新填写图片 API Key / Re-enter image API key</strong>
            <small>
              旧密钥无法由当前后端解密；请在下方填写新密钥并保存。保存配置不会调用图片模型，也不会产生生成费用。 / The old key cannot be decrypted by this backend. Enter a new key below and save. Saving does not call the image model or incur generation charges.
            </small>
          </div>
        )}
        <div className="provider-section-title">
          <div>
            <strong>独立图片生成接口</strong>
            <small>
              首版支持 OpenAI Images API 兼容接口。保存只检查格式和公网地址，不调用模型、不收费。
            </small>
          </div>
        </div>
        <div className="creative-provider-grid">
          <label>
            显示名称
            <input
              value={providerDraft.name || ""}
              onChange={(event) => updateProvider("name", event.target.value)}
              placeholder="例如：我的图片 API"
            />
          </label>
          <label>
            图片模型
            <input
              value={providerDraft.model || ""}
              onChange={(event) => updateProvider("model", event.target.value)}
              placeholder="例如：gpt-image-1"
              autoCapitalize="none"
              spellCheck="false"
            />
          </label>
          <label className="creative-provider-wide">
            Base URL
            <input
              type="url"
              value={providerDraft.base_url || ""}
              onChange={(event) =>
                updateProvider("base_url", event.target.value)
              }
              placeholder="https://api.example.com/v1"
              autoCapitalize="none"
              spellCheck="false"
            />
            <small>
              可填 API 根地址或完整的 /images/generations 地址，不要填控制台网页。
            </small>
          </label>
          <label>
            授权方式
            <select
              value={providerDraft.auth_type || "bearer"}
              onChange={(event) =>
                updateProvider("auth_type", event.target.value)
              }
            >
              <option value="bearer">Bearer API Key</option>
              <option value="none">无需密钥</option>
            </select>
          </label>
          {providerDraft.auth_type !== "none" && (
            <label>
              {providerDraft.auth_configured
                ? "更新图片 API Key（可留空）"
                : providerCredentialRecoveryRequired
                  ? "重新填写图片 API Key / Re-enter image API key"
                  : "图片 API Key"}
              <input
                type="password"
                required={providerCredentialRecoveryRequired}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                placeholder={
                  providerDraft.auth_configured
                    ? "已加密保存；只在更换时填写"
                    : providerCredentialRecoveryRequired
                      ? "必须重新粘贴；旧密钥无法恢复"
                      : "粘贴图片供应商 API Key"
                }
                autoComplete="new-password"
              />
            </label>
          )}
          <label className="creative-switch-row creative-provider-wide">
            <input
              type="checkbox"
              checked={providerDraft.enabled === true}
              onChange={(event) =>
                updateProvider("enabled", event.target.checked)
              }
            />
            <span>
              <strong>启用这个图片接口</strong>
              <small>
                只有启用后，确认生成或自主创作才会真实调用它。
              </small>
            </span>
          </label>
        </div>
        <div className="creative-provider-summary">
          <span>
            最近 24 小时调用 <strong>{status.usage.day}</strong> 次
          </span>
          <span>
            最近 31 天调用 <strong>{status.usage.month}</strong> 次
          </span>
          <span>
            状态 <strong>{status.provider.last_status}</strong>
          </span>
          {status.provider.last_error_code && (
            <span className="artwork-error">
              最近失败：
              <strong>
                {creativeFailureMessage(status.provider.last_error_code)}
              </strong>
            </span>
          )}
        </div>
        <button className="primary-button" disabled={Boolean(busy)}>
          {busy === "provider" ? "安全保存中…" : "保存配置（不调用图片模型）"}
        </button>
      </form>
    </section>
  );
}

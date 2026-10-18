import { useEffect, useMemo, useRef, useState } from "react";
import { settingsServiceErrorDetail } from "./settings-service-errors.js";
import { apiFetch, apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { filterStickerShelf, importStickerFiles } from "./sticker-shelf.js";
import { AuthenticatedImage } from "./PrivateMedia";
import StickerImportSettings, { StickerSource } from "./StickerImportSettings.jsx";
import XhsStickerImportSettings from "./XhsStickerImportSettings.jsx";
import {
  archivePrivateMediaAsset,
  patchPrivateMediaAsset,
  privateMediaFileWarning,
  updatePrivateMediaPreferences,
  uploadPrivateMediaAsset,
} from "./private-media-api.js";
import {
  normalizePrivateMediaCatalog,
  privateMediaContentPath,
} from "./private-media.js";
const PURPOSES = [
  ["user_avatar", "用户头像", "你的聊天头像"],
  ["companion_avatar", "伴侣头像", "AI 伴侣的聊天头像"],
  ["chat_background", "聊天背景", "只显示在聊天视图"],
];

function preferenceKey(purpose) {
  return `${purpose}_asset_id`;
}

function UploadControl({ purpose, label, busy, disabled, onUpload }) {
  const [warning, setWarning] = useState("");
  return (
    <div className="media-upload-control">
      <label className="media-upload-button">
        <span>{busy ? "上传中…" : `上传${label}`}</span>
        <input
          type="file"
          accept={purpose === "custom_sticker" ? "image/jpeg,image/png,image/webp,image/gif" : "image/jpeg,image/png,image/webp"}
          multiple={purpose === "custom_sticker"}
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setWarning(privateMediaFileWarning(file, purpose));
            if (file) void onUpload(purpose === "custom_sticker" ? Array.from(event.target.files) : file);
            event.target.value = "";
          }}
        />
      </label>
      {warning && <small className="media-file-warning">{warning}</small>}
    </div>
  );
}

function StickerEditor({ asset, busy, onSave, onArchive, onDelete, onPreview }) {
  const [draft, setDraft] = useState(() => ({
    display_name: asset.display_name,
    alt_text: asset.alt_text,
    mood_tags: asset.mood_tags.join(", "),
  }));
  return (
    <article className="media-sticker-item">
      <AuthenticatedImage
        src={privateMediaContentPath(asset.id)}
        alt={asset.alt_text || asset.display_name || "自定义表情"}
        className="media-sticker-preview"
        animationControls
        width={asset.width}
        height={asset.height}
        buttonClassName="media-preview-button"
        onPreview={onPreview}
      />
      <div className="media-sticker-fields">
        <label>
          显示名称
          <input
            value={draft.display_name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, display_name: event.target.value }))
            }
          />
        </label>
        <label>
          替代文字
          <input
            value={draft.alt_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, alt_text: event.target.value }))
            }
          />
        </label>
        <label>
          心情标签（逗号分隔）
          <input
            value={draft.mood_tags}
            onChange={(event) =>
              setDraft((current) => ({ ...current, mood_tags: event.target.value }))
            }
          />
        </label>
      </div>
      <div className="media-item-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onSave(asset.id, {
              display_name: draft.display_name,
              alt_text: draft.alt_text,
              mood_tags: draft.mood_tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        >
          保存文字
        </button>
        <button type="button" className="danger" disabled={busy} onClick={() => void onArchive(asset.id)}>
          归档
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("确认永久删除这个表情包？删除后不可恢复。")) return;
            void onDelete(asset.id);
          }}
        >
          删除
        </button>
      </div>
      <StickerSource assetId={asset.id} />
    </article>
  );
}

export default function MediaSettings({
  catalog,
  loading,
  error,
  onRefresh,
  onCatalogChange,
  onPreview,
}) {
  const normalized = useMemo(() => normalizePrivateMediaCatalog(catalog), [catalog]);
  const [busy, setBusy] = useState("");
  const [localError, setLocalError] = useState("");
  const [stickerQuery, setStickerQuery] = useState("");
  const [importResults, setImportResults] = useState([]);
  const operation = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = authSession.subscribe?.(() => {
      if (operation.current && settingsSaveScope(authSession.getSnapshot()) !== operation.current.scope) {
        operation.current.controller.abort(); operation.current = null;
      }
    });
    return () => { mounted.current = false; operation.current?.controller.abort(); operation.current = null; unsubscribe?.(); };
  }, []);

  async function perform(key, action) {
    if (!mounted.current || operation.current || loading) return;
    const request = { scope: settingsSaveScope(authSession.getSnapshot()), controller: new AbortController() };
    operation.current = request;
    const isCurrent = () => mounted.current && operation.current === request &&
      !request.controller.signal.aborted && settingsSaveScope(authSession.getSnapshot()) === request.scope;
    const options = { signal: request.controller.signal,
      authSession: createScopedSettingsSession(authSession, request.scope, request.controller.signal) };
    let confirmed = 0;
    const client = {
      apiFetch: (path, init) => apiFetch(path, { ...init, ...options }),
      apiRequest: (path, init) => apiRequest(path, { ...init, ...options }),
      isCurrent,
      onConfirmed: () => { confirmed++; },
    };
    let submitted = false;
    setBusy(key);
    setLocalError("");
    try {
      await action(client);
      submitted = true;
      if (!isCurrent()) {
        // The parent catalog refresh has its own scope guard and may outlive this sheet.
        if (settingsSaveScope(authSession.getSnapshot()) === request.scope) await onRefresh?.();
        return;
      }
      if (key.startsWith('delete:') || key.startsWith('archive:')) {
        const id = key.slice(key.indexOf(':') + 1);
        onCatalogChange?.(current => {
          const latest = normalizePrivateMediaCatalog(current);
          return { ...latest,
            assets: latest.assets.filter(asset => asset.id !== id),
            preferences: Object.fromEntries(Object.entries(latest.preferences).filter(([, selected]) => selected !== id)),
          };
        });
      }
      const fresh = await onRefresh?.();
      if (!isCurrent()) return;
      if (!fresh) setLocalError("图片操作已提交，但目录暂时无法刷新。请点击刷新确认结果，请勿重复上传或删除。（Code: private_media_refresh_failed）");
    } catch (caught) {
      if (isCurrent()) setLocalError((submitted ? "图片操作已提交，目录刷新失败，请先点击刷新确认结果。" : "") + settingsServiceErrorDetail(caught, "私密媒体操作失败，请稍后重试。"));
      else if (confirmed > 0 && settingsSaveScope(authSession.getSnapshot()) === request.scope) {
        // A cancelled batch may already have confirmed files; only reconcile its original parent scope.
        await Promise.resolve().then(() => onRefresh?.()).catch(() => {});
      }
    } finally {
      if (isCurrent()) { operation.current = null; setBusy(""); }
    }
  }

  function upload(purpose, file) {
    return perform(`upload:${purpose}`, async (client) => {
      if (purpose !== "custom_sticker") return uploadPrivateMediaAsset({ image: file, purpose }, client);
      const results = await importStickerFiles(Array.isArray(file) ? file : [file], {
        upload: values => uploadPrivateMediaAsset(values, client), isCurrent: client.isCurrent,
        onConfirmed: client.onConfirmed,
      });
      if (client.isCurrent()) setImportResults(results);
    },
    );
  }

  function choose(purpose, id) {
    return perform(`preference:${purpose}`, (client) =>
      updatePrivateMediaPreferences({ [preferenceKey(purpose)]: id || null }, client),
    );
  }

  async function refreshCatalog() {
    setLocalError("");
    try { await onRefresh(); }
    catch (caught) {
      if (mounted.current) setLocalError(settingsServiceErrorDetail(caught, "私密媒体目录暂时无法读取。"));
    }
  }

  const stickers = filterStickerShelf(normalized.assets, stickerQuery);
  const feedback = localError || error;

  return (
    <section className="media-settings settings-card" aria-labelledby="media-settings-title">
      <div className="settings-card-heading">
        <div>
          <span className="settings-kicker">PRIVATE MEDIA</span>
          <h3 id="media-settings-title">头像、背景与表情包</h3>
          <p>图片经登录态安全读取，不接受外部图片地址。</p>
        </div>
        <button type="button" className="media-refresh-button" disabled={loading || Boolean(busy)} onClick={() => void refreshCatalog()}>
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>

      {feedback && <div className="media-settings-error" role="alert">{feedback}</div>}

      <div className="media-purpose-grid" aria-busy={loading || Boolean(busy)}>
        {PURPOSES.map(([purpose, label, hint]) => {
          const items = normalized.assets.filter((asset) => asset.purpose === purpose);
          const selectedId = String(normalized.preferences[preferenceKey(purpose)] || "");
          return (
            <section className="media-purpose-card" key={purpose} aria-labelledby={`media-${purpose}`}>
              <div className="media-purpose-heading">
                <div><h4 id={`media-${purpose}`}>{label}</h4><small>{hint}</small></div>
                <UploadControl purpose={purpose} label={label} busy={busy === `upload:${purpose}`} disabled={loading || Boolean(busy)} onUpload={(file) => upload(purpose, file)} />
              </div>
              {items.length ? (
                <div className="media-choice-list">
                  {items.map((asset) => {
                    const alt =
                      asset.alt_text || asset.display_name || label;
                    return (
                      <article
                        className={`media-choice${
                          selectedId === asset.id ? " selected" : ""
                        }`}
                        key={asset.id}
                      >
                        <AuthenticatedImage
                          src={privateMediaContentPath(asset.id)}
                          alt={alt}
                          className="media-choice-image"
                          buttonClassName="media-choice-preview"
                          onPreview={onPreview}
                        />
                        <span title={asset.display_name || label}>
                          {asset.display_name || label}
                        </span>
                        <div className="media-choice-actions">
                          <button
                            type="button"
                            className="media-choice-enable"
                            aria-pressed={selectedId === asset.id}
                            disabled={loading || Boolean(busy) || selectedId === asset.id}
                            onClick={() => void choose(purpose, asset.id)}
                          >
                            {selectedId === asset.id ? "使用中" : "启用"}
                          </button>
                          <button
                            type="button"
                            className="media-choice-edit"
                            disabled={loading || Boolean(busy)}
                            onClick={() => {
                              const nextName = window.prompt("显示名称（可留空）：", asset.display_name || "");
                              if (nextName === null) return;
                              const nextAlt = window.prompt("替代文字（可留空）：", asset.alt_text || "");
                              if (nextAlt === null) return;
                              void perform(`patch:${asset.id}`, (client) =>
                                patchPrivateMediaAsset(asset.id, {
                                  display_name: nextName.trim(),
                                  alt_text: nextAlt.trim(),
                                }, client),
                              );
                            }}
                          >
                            修改
                          </button>
                          <button
                            type="button"
                            className="danger"
                            disabled={loading || Boolean(busy)}
                            onClick={() => {
                              if (!window.confirm(`确认删除此${label}？删除后不可恢复。`)) return;
                              void perform(`delete:${asset.id}`, (client) => archivePrivateMediaAsset(asset.id, true, client));
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  <div className="media-default-row">
                    <button
                      type="button"
                      className="media-default-button"
                      disabled={loading || Boolean(busy) || !selectedId}
                      onClick={() => void choose(purpose, null)}
                    >
                      {purpose === "chat_background" ? (selectedId ? "移除背景，恢复默认" : "默认天空·太阳轨迹·银河") : (selectedId ? "移除头像，恢复默认" : "默认头像")}
                    </button>
                    {purpose === "chat_background" && !selectedId && (
                      <small className="media-default-hint">日出日落、夜晚银河正在显示</small>
                    )}
                  </div>
                </div>
              ) : (
                <p className="media-empty-state">还没有上传{label}。</p>
              )}
            </section>
          );
        })}
      </div>

      <section className="media-sticker-section" aria-labelledby="media-stickers-title">
        <div className="media-purpose-heading">
          <div><h4 id="media-stickers-title">表情包架</h4><small>可批量上传 JPG、PNG、WebP 和 GIF，保留表情动画。填写描述和心情，方便伴侣挑选；动图可暂停，单张不超过 12MB、240 帧。</small></div>
          <UploadControl purpose="custom_sticker" label="表情" busy={busy === "upload:custom_sticker"} disabled={loading || Boolean(busy)} onUpload={(file) => upload("custom_sticker", file)} />
        </div>
        <StickerImportSettings onRefresh={onRefresh} />
        <XhsStickerImportSettings onRefresh={onRefresh} />
        <label>搜索表情包<input type="search" value={stickerQuery} placeholder="名称、描述或心情" onChange={event => setStickerQuery(event.target.value)} /></label>
        {importResults.length > 0 && <div role="status" className="media-import-results">
          <p>已确认上传 {importResults.filter(item => item.ok).length} / {importResults.length} 张。失败项目不会自动重传。</p>
          {importResults.some(item => !item.ok) && <ul>{importResults.filter(item => !item.ok).map((item, index) => <li key={index}>{item.name}：{item.message}（{item.code}）</li>)}</ul>}
        </div>}
        {stickers.length ? (
          <div className="media-sticker-list">
            {stickers.map((asset) => (
              <StickerEditor
                key={asset.id}
                asset={asset}
                busy={loading || Boolean(busy)}
                onPreview={onPreview}
                onSave={(id, changes) => perform(`patch:${id}`, (client) => patchPrivateMediaAsset(id, changes, client))}
                onArchive={(id) => perform(`archive:${id}`, (client) => archivePrivateMediaAsset(id, false, client))}
                onDelete={(id) => perform(`delete:${id}`, (client) => archivePrivateMediaAsset(id, true, client))}
              />
            ))}
          </div>
        ) : <p className="media-empty-state">{stickerQuery ? "没有匹配的表情，试试其他名称或心情。" : "还没有自定义表情，上传后可编辑显示文字与心情标签。"}</p>}
      </section>
    </section>
  );
}

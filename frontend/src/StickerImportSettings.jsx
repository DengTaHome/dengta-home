import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { bilibiliStickerId, stickerImportError, stickerImportRequest, requestStickerImport, validateStickerImportReceipt, normalizeStickerSource } from "./sticker-import.js";
import "./sticker-import.css";

const BASE = "/api/v2/private-media/sticker-import";

function useStickerScope(session) {
  const subscribe = useCallback(listener => session.subscribe(listener), [session]);
  const snapshot = useCallback(() => settingsSaveScope(session.getSnapshot()), [session]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function StickerSource({ assetId, request = apiRequest, session = authSession }) {
  const scope = useStickerScope(session);
  return <StickerSourceView key={`${scope}:${assetId}`} assetId={assetId} request={request} session={session} />;
}

function StickerSourceView({ assetId, request, session }) {
  const [source, setSource] = useState(null), [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(null);
  useEffect(() => {
    return () => { operation.current?.abort(); operation.current = null; };
  }, [assetId, session]);
  async function inspect() {
    if (operation.current) return;
    const controller = new AbortController(), scope = settingsSaveScope(session.getSnapshot());
    operation.current = controller; setBusy(true); setMessage("");
    const current = () => operation.current === controller && !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope;
    try {
      const data = await requestStickerImport(request, `/api/v2/private-media/assets/${encodeURIComponent(assetId)}/source`, {
        signal: controller.signal, authSession: createScopedSettingsSession(session, scope, controller.signal),
      });
      const value = normalizeStickerSource(data?.source);
      if (current()) setSource(value);
    } catch (caught) {
      if (current()) setMessage(caught?.code === "sticker_import_source_not_found" ? "未关联外部来源，可能是手动上传的表情。" : stickerImportError(caught));
    } finally { if (current()) { operation.current = null; setBusy(false); } }
  }
  return <div className="sticker-source"><button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? "读取来源…" : "查看图片来源"}</button>
    {source && <p><a href={source.page_url} target="_blank" rel="noopener noreferrer">{source.title || source.bvid || source.note_id}</a>{source.creator && ` · ${source.creator}`}（{source.provider === "xiaohongshu" ? "小红书笔记封面" : "B站视频封面"}）</p>}
    {message && <p role="status">{message}</p>}</div>;
}

export default function StickerImportSettings({ onRefresh, request = apiRequest, session = authSession }) {
  const scope = useStickerScope(session);
  return <StickerImportView key={scope} scope={scope} onRefresh={onRefresh} request={request} session={session} />;
}

function StickerImportView({ scope, onRefresh, request, session }) {
  const [preferences, setPreferences] = useState(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [video, setVideo] = useState("");
  const [result, setResult] = useState(null);
  const [reload, setReload] = useState(0);
  const operation = useRef(null);
  const pendingReceipt = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal, authSession: createScopedSettingsSession(session, scope, controller.signal) };
    const current = () => !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope;
    operation.current = controller;
    void requestStickerImport(request, `${BASE}/preferences`, options).then(data => {
      if (!current()) return;
      if (typeof data?.schema_available !== "boolean" || typeof data?.bilibili_enabled !== "boolean") throw new Error("invalid receipt");
      setPreferences(data);
    }).catch(caught => { if (current()) setError(stickerImportError(caught)); })
      .finally(() => { if (current()) { operation.current = null; setBusy(""); } });
    return () => { controller.abort(); operation.current?.abort(); operation.current = null; };
  }, [scope, session, request, reload]);

  async function perform(kind, action) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const current = () => operation.current === controller && !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope;
    const client = (path, options) => requestStickerImport(request, path, { ...options, signal: controller.signal,
      authSession: createScopedSettingsSession(session, scope, controller.signal) });
    setBusy(kind); setError("");
    try { await action(client, current); }
    catch (caught) { if (current()) setError(stickerImportError(caught)); }
    finally { if (current()) { operation.current = null; setBusy(""); } }
  }

  function importVideo(event) {
    event.preventDefault();
    const bvid = bilibiliStickerId(video);
    if (!bvid) { setError(stickerImportError({ code: "sticker_import_request_invalid" })); return; }
    void perform("import", async (client, current) => {
      if (pendingReceipt.current?.bvid !== bvid) pendingReceipt.current = stickerImportRequest(scope, bvid);
      const receipt = validateStickerImportReceipt(await client(`${BASE}/bilibili`, { method: "POST", body: JSON.stringify(pendingReceipt.current) }));
      if (!current()) return;
      setResult(receipt);
      try { if (!await onRefresh?.()) throw new Error("catalog unavailable"); }
      catch { if (current()) setError("表情已保存，目录暂时未刷新。请点击上方刷新，无需再次上传。（Code: private_media_refresh_failed）"); }
    });
  }

  return <div className="sticker-import-settings" aria-busy={Boolean(busy)}>
    <div className="sticker-import-heading"><div><h5>B站灵感搜集</h5><p>将视频的静态封面收进私人表情库，保留来源；请使用有权保存和分享的图片。</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => { setPreferences(null); setBusy("load"); setError(""); setReload(value => value + 1); }}>重新检测</button></div>
    <label className="sticker-import-toggle"><input type="checkbox" checked={preferences?.bilibili_enabled === true}
      disabled={!preferences?.schema_available || Boolean(busy)} onChange={event => {
        const enabled = event.target.checked;
        void perform("permission", async (client, current) => {
          const saved = await client(`${BASE}/preferences`, { method: "PUT", body: JSON.stringify({ bilibili_enabled: enabled }) });
          if (saved?.schema_available !== true || saved?.bilibili_enabled !== enabled) throw new Error("invalid receipt");
          if (current()) setPreferences(saved);
        });
      }} /><span>允许伴侣自己搜集并发送表情<small>默认关闭。开启后每次回复最多一张，可随时关闭；只使用当前账号与伴侣的B站登录态。</small></span></label>
    {preferences?.schema_available === false && <p role="status">此功能尚待数据库更新，原有上传和发送不受影响。（sticker_import_schema_required）</p>}
    <form onSubmit={importVideo} className="sticker-import-form"><label>手动收一张封面<input value={video} onChange={event => setVideo(event.target.value)} placeholder="BV号或 bilibili.com/video/… 链接" disabled={Boolean(busy)} /></label>
      <button disabled={!preferences?.schema_available || Boolean(busy) || !video.trim()} type="submit">{busy === "import" ? "正在收集…" : "导入私人表情库"}</button></form>
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result.replayed ? "已找回上次导入" : "已保存到表情包架"}：<a href={result.source.page_url} target="_blank" rel="noopener noreferrer">{result.source.title || result.source.bvid}</a>{result.source.creator && ` · ${result.source.creator}`}。这是视频封面。</p>}
  </div>;
}

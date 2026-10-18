import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { requestStickerImport } from "./sticker-import.js";
import { validateXhsSearch, validateXhsImport, xhsStickerRequest, xhsStickerError } from "./xhs-sticker-import.js";
import "./sticker-import.css";
const BASE = "/api/v2/private-media/sticker-import/xhs";
const invalid = () => Object.assign(new Error("invalid receipt"), { code: "sticker_import_receipt_invalid" });
export default function XhsStickerImportSettings({ onRefresh, request = apiRequest, session = authSession }) {
  const subscribe = useCallback(listener => session.subscribe(listener), [session]);
  const snapshot = useCallback(() => settingsSaveScope(session.getSnapshot()), [session]);
  const scope = useSyncExternalStore(subscribe, snapshot, snapshot);
  return <XhsStickerView key={scope} scope={scope} onRefresh={onRefresh} request={request} session={session} />;
}
function XhsStickerView({ scope, onRefresh, request, session }) {
  const [preferences, setPreferences] = useState(null), [busy, setBusy] = useState("load"), [error, setError] = useState(""), [keyword, setKeyword] = useState("");
  const [items, setItems] = useState(null), [result, setResult] = useState(null), [reload, setReload] = useState(0);
  const operation = useRef(null), receipt = useRef(null);
  useEffect(() => {
    const controller = new AbortController(); operation.current = controller;
    const current = () => !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope;
    void requestStickerImport(request, BASE + "/preferences", { signal: controller.signal, authSession: createScopedSettingsSession(session, scope, controller.signal) }).then(data => {
      if (!current()) return;
      if (typeof data?.schema_available !== "boolean" || typeof data.xhs_enabled !== "boolean") throw invalid();
      setPreferences(data);
    }).catch(caught => { if (current()) setError(xhsStickerError(caught)); }).finally(() => { if (current()) { operation.current = null; setBusy(""); } });
    return () => { controller.abort(); operation.current?.abort(); operation.current = null; };
  }, [scope, request, session, reload]);
  async function perform(kind, action) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller; setBusy(kind); setError("");
    const current = () => operation.current === controller && !controller.signal.aborted && settingsSaveScope(session.getSnapshot()) === scope;
    const client = (path, options) => requestStickerImport(request, path, { ...options, signal: controller.signal, authSession: createScopedSettingsSession(session, scope, controller.signal) });
    try { await action(client, current); }
    catch (caught) { if (current()) setError(xhsStickerError(caught)); }
    finally { if (current()) { operation.current = null; setBusy(""); } }
  }
  function search(event) {
    event.preventDefault(); if (!keyword.trim()) return;
    void perform("search", async (client, current) => {
      const found = validateXhsSearch(await client(BASE + "/search?keyword=" + encodeURIComponent(keyword.trim())));
      if (current()) { setItems(found); setResult(null); }
    });
  }
  function collect(item) {
    void perform("import", async (client, current) => {
      if (receipt.current?.note_id !== item.note_id) receipt.current = xhsStickerRequest(scope, item.note_id);
      const value = validateXhsImport(await client(BASE, { method: "POST", body: JSON.stringify(receipt.current) }));
      if (!current()) return;
      if (value.source.note_id !== item.note_id) throw invalid();
      setResult(value);
      try { if (!await onRefresh?.()) throw new Error("catalog unavailable"); }
      catch { if (current()) setError("表情已保存，目录暂时未刷新；请刷新表情包架，无需重复导入。（Code: private_media_refresh_failed）"); }
    });
  }
  return <section className="sticker-import-settings xhs-sticker-settings" aria-label="小红书表情搜集" aria-busy={Boolean(busy)}>
    <div className="sticker-import-heading"><div><h5>小红书灵感搜集</h5><p>从自己的登录会话搜索笔记，将选中的静态封面收进私人表情库，并保留作者与来源。</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => { setPreferences(null); setBusy("load"); setError(""); setReload(value => value + 1); }}>重新检测</button></div>
    <label className="sticker-import-toggle"><input type="checkbox" checked={preferences?.xhs_enabled === true} disabled={!preferences?.schema_available || Boolean(busy)} onChange={event => {
      const enabled = event.target.checked;
      void perform("permission", async (client, current) => { const saved = await client(BASE + "/preferences", { method: "PUT", body: JSON.stringify({ xhs_enabled: enabled }) }); if (saved?.schema_available !== true || saved?.xhs_enabled !== enabled) throw invalid(); if (current()) setPreferences(saved); });
    }} /><span>允许伴侣从小红书搜集并发送表情<small>默认关闭，可随时取消；与 B 站、已有表情合计每轮最多附一张。只使用当前账号与伴侣的登录会话。</small></span></label>
    {preferences?.schema_available === false && <p role="status">小红书表情搜集尚待数据库更新；原有上传和 B 站设置不受影响。（sticker_import_schema_required）</p>}
    <form className="sticker-import-form" onSubmit={search}><label>寻找一张表情<input type="search" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={200} placeholder="例如：开心猫猫、晚安、抱抱" disabled={Boolean(busy)} /></label><button type="submit" disabled={!preferences?.schema_available || Boolean(busy) || !keyword.trim()}>{busy === "search" ? "正在搜索…" : "搜索小红书"}</button></form>
    {items?.length === 0 && <p role="status">这次没有找到相关笔记，可以换一个词再试。</p>}
    {items?.length > 0 && <ul className="xhs-sticker-results">{items.map(item => <li key={item.note_id}><div><strong>{item.title || "未命名笔记"}</strong><small>{item.creator || "作者未提供"} · 笔记封面</small></div><button type="button" disabled={Boolean(busy)} onClick={() => collect(item)}>收进表情库</button></li>)}</ul>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result.replayed ? "已找回上次导入" : "已保存到表情包架"}：<a href={result.source.page_url} target="_blank" rel="noopener noreferrer">{result.source.title || result.source.note_id}</a>{result.source.creator && ` · ${result.source.creator}`}。</p>}
  </section>;
}

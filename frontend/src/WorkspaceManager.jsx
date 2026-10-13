import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";
import "./workspace-polish.css";
import {
  workspaceAgentsMd,
  workspaceDeleteFile,
  workspaceReadFile,
  workspaceStats,
  workspaceTree,
  workspaceWriteFile,
} from "./workspace-api.js";
import {
  workspaceCacheClear,
  workspaceCacheDelete,
  workspaceCacheList,
  workspaceCacheRead,
  workspaceCacheWrite,
  cachedWorkspaceEntries,
} from "./workspace-cache.js";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileLabel(entry) {
  return String(entry?.name || "").replace(/\/$/, "");
}

function checkedFilePath(value, directory = "") {
  const name = String(value || "").trim();
  const full = directory ? `${directory}/${name}` : name;
  const parts = full.split("/");
  if (!name || name.startsWith("/") || full.length > 500 || parts.length > 16 || parts.some(part => !part || part === "." || part === ".." || part.length > 120 || /[\\:*?"<>|]/.test(part) || Array.from(part).some(char => char.charCodeAt(0) < 32))) {
    throw workspaceError("workspace_path_invalid");
  }
  return full;
}

function workspaceError(code) { return Object.assign(new Error("工作区操作未完成。"), { code }); }

const LOCAL_FAILURES = {
  workspace_path_invalid: "文件路径无效。请使用相对路径，例如 docs/note.md；每段最多 120 字符，不能含 . 或 .. 段。",
  workspace_tree_receipt_invalid: "目录读取回执缺少有效路径或列表。云端目录尚未确认，请刷新重新读取。",
  workspace_file_receipt_invalid: "文件读取回执与当前路径不一致或正文不完整。请重新读取文件；不要保存当前预览。",
  workspace_write_receipt_invalid: "服务未返回与本次文件和字节数匹配的保存回执。",
  workspace_delete_receipt_invalid: "服务未返回与目标文件匹配的删除回执。先刷新目录核对，不要直接重复删除。",
  workspace_agents_receipt_invalid: "agents.md 预览回执无效。请重试读取；没有修改个性化指令或记忆。",
  workspace_stats_receipt_invalid: "统计回执无效。文件仍可操作，请刷新重新核对统计。",
  workspace_import_read_failed: "本地文件读取失败，未上传也未覆盖云端。请重新选择可读取的文本文件。",
  workspace_import_read_timeout: "等待本地文件读取超过 15 秒，未上传任何内容。可以重新选择文件后再导入。",
  workspace_import_too_large: "工作区单个文件目前最多 5MiB。聊天附件和聊天记录导入使用各自容量限制。",
  workspace_clipboard_failed: "无法读取剪贴板，未上传任何内容。请检查浏览器权限，或使用新建文件后手动粘贴。",
  workspace_clipboard_timeout: "等待剪贴板权限或读取超过 15 秒，未上传任何内容。可手动粘贴到新建文件，或检查浏览器权限后重试。",
  workspace_download_failed: "当前浏览器未能发起下载。内容仍在编辑器中；可复制保留，或换浏览器后重新下载。",
  workspace_cache_failed: "本账号离线缓存未完成读取或清理。云端文件不受影响，请刷新重试，或使用当前内容的下载按钮保留副本。",
  workspace_operation_failed: "工作区没有确认本次操作的结果。先刷新目录或重新读取文件核对；仍失败时通过日志中的错误代码排查。",
};

function failureMessage(error, { write = false } = {}) {
  const { code, reason, action } = describeOperationError(error);
  const status = Number(error?.status);
  const writeHelp = write ? resultUnconfirmed(error) ? "草稿仍保留；写入可能已经到达云端，先重新读取文件核对，避免重复提交。" : "草稿仍保留；服务已明确返回未完成，可核对错误原因后手动重试。" : "";
  return `${LOCAL_FAILURES[code] || `${reason}${action}`}${writeHelp}（错误代码：${code}${Number.isInteger(status) && status >= 400 && status <= 599 ? `；HTTP：${status}` : ""}）`;
}

function requireReceipt(data, code, valid) {
  if (data?.ok === false) throw Object.assign(workspaceError(data.code || "workspace_operation_failed"), { definiteFailure: true });
  if (data?.ok !== true || !valid(data)) throw workspaceError(code);
  return data;
}

function resultUnconfirmed(error) {
  const status = Number(error?.status);
  return !error?.definiteFailure && !(status >= 400 && status < 500 && status !== 408);
}

function cacheDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "时间未知";
}

function createWorkspaceLifecycle() {
  const scope = settingsSaveScope(authSession.getSnapshot());
  let controller = new AbortController();
  let options = { signal: controller.signal, authSession: createScopedSettingsSession(authSession, scope, controller.signal) };
  return {
    get options() { return options; },
    isCurrent: () => !controller.signal.aborted && settingsSaveScope(authSession.getSnapshot()) === scope,
    reset() {
      if (!controller.signal.aborted) return;
      controller = new AbortController();
      options = { signal: controller.signal, authSession: createScopedSettingsSession(authSession, scope, controller.signal) };
    },
    abort: () => controller.abort(),
  };
}

function downloadTextFile(name, text) {
  const blob = new Blob([String(text ?? "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  let anchor;
  try {
    anchor = document.createElement("a");
    anchor.href = url; anchor.download = name || "workspace-file.txt";
    document.body.appendChild(anchor); anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch {
    URL.revokeObjectURL(url); throw workspaceError("workspace_download_failed");
  } finally { anchor?.remove?.(); }
}

export default function WorkspaceManager({ accountScope = "", registerLeaveGuard }) {
  return <WorkspaceView key={JSON.stringify([accountScope, settingsSaveScope(authSession.getSnapshot())])} accountScope={accountScope} registerLeaveGuard={registerLeaveGuard} />;
}

function WorkspaceView({ accountScope, registerLeaveGuard }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [openPath, setOpenPath] = useState("");
  const [content, setContent] = useState("");
  const [cachedAt, setCachedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [cacheInfo, setCacheInfo] = useState({ files: null, totalBytes: null, error: "" });
  const [agentsMd, setAgentsMd] = useState(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [offline, setOffline] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [cacheWarning, setCacheWarning] = useState("");
  const [cloudSnapshot, setCloudSnapshot] = useState(null);
  const [unconfirmedOperation, setUnconfirmedOperation] = useState(null);
  const unconfirmedRef = useRef(null);
  const fileRequestRef = useRef(0);
  const treeRequestRef = useRef(0);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const mutationRef = useRef(false);
  const openingRef = useRef(false);
  const draftRef = useRef({ path: "", content: "", dirty: false, revision: 0 });
  const timersRef = useRef(new Set());
  const statsRequestRef = useRef(0);
  const cacheRequestRef = useRef(0);
  const [lifecycle] = useState(createWorkspaceLifecycle);
  const operationUnconfirmed = Boolean(unconfirmedOperation && !unconfirmedOperation.released);

  const later = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => { timersRef.current.delete(timer); if (lifecycle.isCurrent()) callback(); }, delay);
    timersRef.current.add(timer);
  }, [lifecycle]);

  const toast = useCallback((text, duration = 3500) => {
    if (!lifecycle.isCurrent()) return;
    setMessage(text);
    later(() => setMessage((current) => (current === text ? "" : current)), duration);
  }, [later, lifecycle]);

  const breadcrumbs = useMemo(() => {
    const parts = path ? path.split("/").filter(Boolean) : [];
    const crumbs = [{ label: "工作区根目录", target: "" }];
    let cumulative = "";
    parts.forEach((part) => {
      cumulative = cumulative ? `${cumulative}/${part}` : part;
      crumbs.push({ label: part, target: cumulative });
    });
    return crumbs;
  }, [path]);

  const refreshStats = useCallback(() => {
    if (!lifecycle.isCurrent()) return;
    const request = ++statsRequestRef.current;
    workspaceStats(lifecycle.options).then(data => {
      if (!lifecycle.isCurrent() || request !== statsRequestRef.current) return;
      requireReceipt(data, "workspace_stats_receipt_invalid", value => Number.isInteger(value.files) && value.files >= 0 && Number.isFinite(value.bytes) && value.bytes >= 0 && typeof value.partial === "boolean");
      setStats(data); setStatsError("");
    }).catch(caught => {
      if (lifecycle.isCurrent() && request === statsRequestRef.current) setStatsError(failureMessage(caught));
    });
  }, [lifecycle]);

  const refreshCacheInfo = useCallback(() => {
    if (!lifecycle.isCurrent()) return;
    const request = ++cacheRequestRef.current;
    workspaceCacheList(accountScope)
      .then((items) => {
        if (!lifecycle.isCurrent() || request !== cacheRequestRef.current) return;
        const files = Array.isArray(items) ? items.length : 0;
        const totalBytes = Array.isArray(items)
          ? items.reduce((sum, item) => sum + new Blob([item.content || ""]).size, 0)
          : 0;
        setCacheInfo({ files, totalBytes, error: "" });
      })
      .catch(() => {
        if (lifecycle.isCurrent() && request === cacheRequestRef.current) setCacheInfo(previous => ({ ...previous, error: failureMessage(workspaceError("workspace_cache_failed")) }));
      });
  }, [accountScope, lifecycle]);

  const loadTree = useCallback(async (targetPath, { clearError = true } = {}) => {
    if (!lifecycle.isCurrent()) return;
    const request = ++treeRequestRef.current;
    setLoading(true);
    if (clearError) setError("");
    try {
      const data = await workspaceTree(targetPath, lifecycle.options);
      if (!lifecycle.isCurrent() || request !== treeRequestRef.current) return;
      requireReceipt(data, "workspace_tree_receipt_invalid", value => value.path === (targetPath || "/") && Array.isArray(value.entries) && value.entries.every(entry => typeof entry?.name === "string" && fileLabel(entry) && !fileLabel(entry).includes("/") && !entry.name.includes("\\") && fileLabel(entry) !== "." && fileLabel(entry) !== ".." && ["file", "dir"].includes(entry.type) && Number.isFinite(entry.size) && entry.size >= 0));
      setEntries(data.entries);
      setPath(targetPath);
      setOffline(false);
    } catch (caught) {
      if (!lifecycle.isCurrent() || request !== treeRequestRef.current) return;
      try {
        const cached = await workspaceCacheList(accountScope);
        if (!lifecycle.isCurrent() || request !== treeRequestRef.current) return;
        setPath(targetPath); setEntries(cachedWorkspaceEntries(cached, targetPath)); setOffline(true);
        setError(`云端暂时无法读取；当前显示本账号的离线副本。恢复连接后点“刷新”重试。${failureMessage(caught)}`);
      } catch {
        if (!lifecycle.isCurrent() || request !== treeRequestRef.current) return;
        setOffline(true);
        setError(`云端和离线缓存本次均未读到；不能据此认定目录为空。${failureMessage(caught)}${failureMessage(workspaceError("workspace_cache_failed"))}`);
      }
    } finally {
      if (lifecycle.isCurrent() && request === treeRequestRef.current) setLoading(false);
    }
  }, [accountScope, lifecycle]);

  useEffect(() => {
    const activeTimers = timersRef.current;
    lifecycle.reset();
    const initial = window.setTimeout(() => { void loadTree(""); refreshStats(); refreshCacheInfo(); }, 0);
    return () => {
      lifecycle.abort(); fileRequestRef.current += 1; treeRequestRef.current += 1; statsRequestRef.current += 1; cacheRequestRef.current += 1;
      window.clearTimeout(initial); activeTimers.forEach(timer => window.clearTimeout(timer)); activeTimers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener?.("beforeunload", warn);
    return () => window.removeEventListener?.("beforeunload", warn);
  }, [dirty]);

  function discardAllowed() {
    if (!lifecycle.isCurrent() || mutationRef.current) return false;
    return !draftRef.current.dirty || window.confirm("当前文件有未保存修改。离开会丢弃草稿；可以取消后先保存或下载。确认离开？");
  }

  useEffect(() => {
    const unregister = registerLeaveGuard?.(discardAllowed);
    return () => unregister?.();
    // draftRef holds the latest exact edit; the guard must not change on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerLeaveGuard]);

  function updateDraft(target, text, changed = false) {
    if (draftRef.current.path !== target) setCloudSnapshot(null);
    draftRef.current = { path: target, content: text, dirty: changed, revision: draftRef.current.revision + 1 };
    setOpenPath(target); setContent(text); setDirty(changed);
  }

  const navigate = useCallback((target) => {
    if (!discardAllowed()) return;
    fileRequestRef.current += 1;
    updateDraft("", ""); openingRef.current = false; setBusy(""); setCopied(false);
    void loadTree(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTree]);

  function cacheFile(target, text) {
    if (!lifecycle.isCurrent()) return;
    void workspaceCacheWrite(accountScope, target, text).then(() => {
      if (!lifecycle.isCurrent()) return;
      setCacheWarning(""); refreshCacheInfo();
    }).catch(() => {
      if (lifecycle.isCurrent()) setCacheWarning("云端已确认，离线副本未保存。可下载当前内容保留本地文件。（错误代码：workspace_cache_failed）");
    });
  }

  function rememberUnconfirmed(operation) {
    unconfirmedRef.current = operation;
    setUnconfirmedOperation(operation);
  }

  function acceptCheckedFile(data) {
    const pending = unconfirmedRef.current;
    if (pending?.kind !== "write" || pending.path !== data.path || data.truncated) return;
    if (data.content === pending.content) {
      unconfirmedRef.current = null; setUnconfirmedOperation(null);
      if (draftRef.current.path === data.path && draftRef.current.content === data.content) {
        draftRef.current.dirty = false; setDirty(false);
      }
      toast("目标文件的云端完整正文与提交副本一致，已核对当前内容。没有重复提交。", 6000);
    } else {
      rememberUnconfirmed({ ...pending, checked: true, cloudContent: data.content });
      toast("已读取目标文件的完整现状。请比较云端快照与提交副本；这不能证明前次写入未生效。", 6000);
    }
  }

  async function openFile(entry) {
    if (!discardAllowed()) return;
    const name = fileLabel(entry);
    if (!name) return;
    const full = entry.path || (path ? `${path}/${name}` : name);
    const request = ++fileRequestRef.current;
    openingRef.current = true;
    setReadOnly(true);
    updateDraft(full, "");
    setCachedAt("");
    setPreviewTruncated(false);
    setCopied(false);
    setBusy(`open:${full}`);
    setError("");
    try {
      const cached = await workspaceCacheRead(accountScope, full).catch(() => null);
      if (!lifecycle.isCurrent() || request !== fileRequestRef.current) return;
      if (cached?.content != null) {
        updateDraft(full, String(cached.content));
        setCachedAt(`（本地缓存 ${cacheDate(cached.savedAt)}）`);
      }
      let data;
      try {
        data = await workspaceReadFile(full, lifecycle.options);
        if (!lifecycle.isCurrent() || request !== fileRequestRef.current) return;
        requireReceipt(data, "workspace_file_receipt_invalid", value => value.path === full && typeof value.content === "string" && value.chars === value.content.length && typeof value.truncated === "boolean");
      }
      catch (caught) {
        if (cached?.content == null) throw caught;
        if (!lifecycle.isCurrent() || request !== fileRequestRef.current) return null;
        setError(`已打开本账号的离线副本；云端暂不可用，恢复连接后可重新读取文件。${failureMessage(caught)}`);
        return { path: full, content: String(cached.content), truncated: false };
      }
      if (!lifecycle.isCurrent() || request !== fileRequestRef.current) return;
      if (data.ok) {
        updateDraft(full, data.content);
        setCachedAt("");
        setPreviewTruncated(data.truncated);
        if (data.truncated) {
          setReadOnly(true);
          setError("文件较长，当前只显示前 200,000 字符；编辑已停用，避免覆盖完整文件。");
          void workspaceCacheDelete(accountScope, full).then(refreshCacheInfo).catch(() => { if (lifecycle.isCurrent()) setCacheWarning("截断预览没有写入缓存，但旧离线副本清理失败。请清理缓存后核对。（错误代码：workspace_cache_failed）"); });
        } else {
          setReadOnly(false);
          cacheFile(full, data.content);
          acceptCheckedFile(data);
        }
        return { path: full, content: String(data.content || ""), truncated: data.truncated === true };
      }
    } catch (caught) {
      if (lifecycle.isCurrent() && request === fileRequestRef.current) setError(failureMessage(caught));
    } finally {
      if (lifecycle.isCurrent() && request === fileRequestRef.current) { openingRef.current = false; setBusy(""); }
    }
  }

  function beginNewFile() {
    if (!discardAllowed()) return;
    const raw = window.prompt("新建文件（输入文件名，可含子目录如 docs/note.md）：");
    if (raw == null) return;
    let full;
    try { full = checkedFilePath(raw, path); } catch (caught) { setError(failureMessage(caught)); return; }
    fileRequestRef.current += 1;
    openingRef.current = false;
    setReadOnly(false);
    updateDraft(full, "");
    setCachedAt("（新文件）");
    setPreviewTruncated(false); setBusy(""); setError("");
    setCopied(false);
    later(() => editorRef.current?.focus?.(), 100);
    toast("已打开新文件，输入内容后点「保存」。");
  }

  function beginMutation(label) {
    if (!lifecycle.isCurrent() || mutationRef.current || openingRef.current) return false;
    if (unconfirmedRef.current && (["save", "import", "paste"].includes(label) || label.startsWith("delete:"))) return false;
    mutationRef.current = true; setBusy(label); setError(""); setMessage("");
    return true;
  }

  function endMutation() {
    mutationRef.current = false;
    if (lifecycle.isCurrent()) setBusy("");
  }

  async function readLocal(value, timeoutCode) {
    const signal = lifecycle.options.signal;
    let rejectAbort;
    const canceled = new Promise((_, reject) => { rejectAbort = () => reject(signal.reason || new DOMException("已取消", "AbortError")); });
    signal.addEventListener("abort", rejectAbort, { once: true });
    let timeout;
    const expired = new Promise((_, reject) => {
      timeout = window.setTimeout(() => reject(workspaceError(timeoutCode)), 15_000);
    });
    try { if (signal.aborted) rejectAbort(); return await Promise.race([value, canceled, expired]); }
    finally { window.clearTimeout(timeout); signal.removeEventListener("abort", rejectAbort); }
  }

  async function confirmedWrite(target, text) {
    if (new Blob([text]).size > 5 * 1024 * 1024) throw workspaceError("workspace_import_too_large");
    try {
      let data = await workspaceWriteFile({ path: target, content: text }, lifecycle.options);
      if (!lifecycle.isCurrent()) return false;
      if (data?.ok === false && data.code === "confirmation_required") {
        if (!window.confirm(`云端已经存在「${target}」。确认用本次内容覆盖？取消会保留原云端文件和当前草稿。`)) {
          toast("已取消覆盖，云端文件和当前草稿仍保留。"); return false;
        }
        data = await workspaceWriteFile({ path: target, content: text, confirm: true }, lifecycle.options);
        if (!lifecycle.isCurrent()) return false;
      }
      requireReceipt(data, "workspace_write_receipt_invalid", value => value.path === target && value.mode === "overwrite" && value.chars === new Blob([text]).size);
      setUnconfirmedOperation(null);
      cacheFile(target, text); refreshStats(); void loadTree(path, { clearError: false });
      return true;
    } catch (caught) {
      if (lifecycle.isCurrent()) {
        const operation = { kind: "write", path: target, content: text, checked: false };
        if (resultUnconfirmed(caught)) rememberUnconfirmed(operation);
        else setUnconfirmedOperation({ ...operation, rejected: true, released: true });
      }
      throw caught;
    }
  }

  async function saveFile() {
    if (!openPath || readOnly || !draftRef.current.dirty || !beginMutation("save")) return;
    const submitted = { ...draftRef.current };
    try {
      if (!await confirmedWrite(submitted.path, submitted.content) || !lifecycle.isCurrent()) return;
      if (draftRef.current.revision === submitted.revision) { draftRef.current.dirty = false; setDirty(false); }
      toast(`已保存 ${submitted.path}（${formatBytes(new Blob([submitted.content]).size)}）${draftRef.current.dirty ? "；新输入的内容仍待保存。" : ""}`);
    } catch (caught) {
      if (lifecycle.isCurrent()) setError(failureMessage(caught, { write: true }));
    } finally { endMutation(); }
  }

  async function rereadCurrentFile() {
    const submitted = { ...draftRef.current };
    if (!submitted.dirty) return openFile({ name: submitted.path.split("/").pop(), path: submitted.path });
    if (!submitted.path || !beginMutation("verify")) return;
    const request = ++fileRequestRef.current;
    try {
      const data = await workspaceReadFile(submitted.path, lifecycle.options);
      if (!lifecycle.isCurrent() || request !== fileRequestRef.current) return;
      requireReceipt(data, "workspace_file_receipt_invalid", value => value.path === submitted.path && typeof value.content === "string" && value.chars === value.content.length && typeof value.truncated === "boolean");
      setCloudSnapshot({ path: data.path, content: data.content, truncated: data.truncated });
      const checkingOperation = unconfirmedRef.current?.kind === "write" && unconfirmedRef.current.path === data.path;
      acceptCheckedFile(data);
      if (!data.truncated && draftRef.current.revision === submitted.revision && draftRef.current.content === data.content) {
        draftRef.current.dirty = false; setDirty(false);
        cacheFile(data.path, data.content);
        if (!checkingOperation) toast("云端完整正文与当前草稿一致，保存结果已核对。没有重复提交。");
      } else if (!checkingOperation || data.truncated) toast("已读取云端快照，当前草稿保持原样。可以展开快照核对；暂勿重复保存。", 6000);
    } catch (caught) {
      if (lifecycle.isCurrent() && request === fileRequestRef.current) setError(failureMessage(caught));
    } finally { endMutation(); }
  }

  async function removeFile(name) {
    if (!beginMutation(`delete:${name}`)) return;
    const target = path ? `${path}/${name}` : name;
    let submitted = false;
    try {
      if (!window.confirm(`确认删除工作区文件「${target}」？删除后不可恢复。${draftRef.current.path === target && draftRef.current.dirty ? "当前文件还有未保存草稿，也会关闭；可取消后先下载。" : ""}`)) return;
      submitted = true;
      const data = await workspaceDeleteFile({ path: target, confirm: true }, lifecycle.options);
      if (!lifecycle.isCurrent()) return;
      requireReceipt(data, "workspace_delete_receipt_invalid", value => value.path === target);
      setUnconfirmedOperation(null);
      toast(`已删除 ${target}`);
      if (draftRef.current.path === target) { fileRequestRef.current += 1; updateDraft("", ""); }
      try { await workspaceCacheDelete(accountScope, target); }
      catch { if (lifecycle.isCurrent()) setCacheWarning("云端已确认删除，但本地离线副本清理失败。请使用“清理缓存”重试。（错误代码：workspace_cache_failed）"); }
      if (!lifecycle.isCurrent()) return;
      refreshCacheInfo(); await loadTree(path, { clearError: false });
    } catch (caught) {
      if (lifecycle.isCurrent()) {
        if (submitted && resultUnconfirmed(caught)) rememberUnconfirmed({ kind: "delete", path: target, directory: path, checked: false });
        setError(failureMessage(caught));
      }
    } finally { endMutation(); }
  }

  async function verifyUnconfirmedOperation() {
    const pending = unconfirmedRef.current;
    if (!pending || !beginMutation("verify")) return;
    try {
      if (pending.kind === "write") {
        const data = await workspaceReadFile(pending.path, lifecycle.options);
        if (!lifecycle.isCurrent() || unconfirmedRef.current !== pending) return;
        requireReceipt(data, "workspace_file_receipt_invalid", value => value.path === pending.path && typeof value.content === "string" && value.chars === value.content.length && typeof value.truncated === "boolean");
        if (data.truncated) { toast("目标文件仅返回部分预览，不能用来核对提交副本。当前草稿和操作保护仍保留。", 6000); return; }
        acceptCheckedFile(data);
        cacheFile(data.path, data.content);
      } else {
        const data = await workspaceTree(pending.directory, lifecycle.options);
        if (!lifecycle.isCurrent() || unconfirmedRef.current !== pending) return;
        const name = pending.path.split("/").pop();
        requireReceipt(data, "workspace_tree_receipt_invalid", value => value.path === (pending.directory || "/") && Array.isArray(value.entries) && value.entries.every(entry => typeof entry?.name === "string" && fileLabel(entry) && !fileLabel(entry).includes("/") && !entry.name.includes("\\") && fileLabel(entry) !== "." && fileLabel(entry) !== ".." && ["file", "dir"].includes(entry.type) && Number.isFinite(entry.size) && entry.size >= 0));
        const exists = data.entries.some(entry => entry.type === "file" && fileLabel(entry) === name);
        if (!exists && data.entries.length >= 200) { toast("目录列表达到 200 项，未列出目标文件不能证明它已不存在。操作保护仍保留，请先核对完整目录。", 6000); return; }
        rememberUnconfirmed({ ...pending, checked: true, exists });
      }
    } catch (caught) {
      if (lifecycle.isCurrent()) setError(failureMessage(caught));
    } finally { endMutation(); }
  }

  function continueAfterCheck() {
    const pending = unconfirmedRef.current;
    if (!lifecycle.isCurrent() || mutationRef.current || !pending?.checked || pending !== unconfirmedOperation) return;
    unconfirmedRef.current = null;
    setUnconfirmedOperation({ ...pending, released: true });
    setError("");
    toast("已恢复手动操作。读取只反映目标当前现状，不保证前次请求未执行；提交副本和当前草稿仍保留。", 6000);
  }

  async function clearLocalCache() {
    if (!beginMutation("clear-cache")) return;
    try {
      if (!window.confirm("确认清理当前账号的工作区离线副本？云端文件和其他账号的缓存不会被删除。")) return;
      await workspaceCacheClear(accountScope);
      if (!lifecycle.isCurrent()) return;
      setCacheWarning(""); refreshCacheInfo();
      if (offline) await loadTree(path, { clearError: false });
      toast("本地缓存已清理。");
    } catch {
      if (lifecycle.isCurrent()) setError(failureMessage(workspaceError("workspace_cache_failed")));
    } finally { endMutation(); }
  }

  async function loadAgentsMd() {
    if (!lifecycle.isCurrent() || mutationRef.current) return;
    if (agentsMd) { setAgentsMd(null); return; }
    if (!beginMutation("agents-md")) return;
    try {
      const data = await workspaceAgentsMd(lifecycle.options);
      if (!lifecycle.isCurrent()) return;
      requireReceipt(data, "workspace_agents_receipt_invalid", value => value.file === "agents.md" && typeof value.content === "string" && value.chars === value.content.length);
      setAgentsMd({ chars: data.chars, content: data.content });
    } catch (caught) {
      if (lifecycle.isCurrent()) setError(failureMessage(caught));
    } finally { endMutation(); }
  }

  // —— 导入：从本地文件上传到当前目录 ——
  async function importFromFile(file) {
    if (!file?.name || !beginMutation("import")) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw workspaceError("workspace_import_too_large");
      const full = checkedFilePath(file.name, path);
      let text;
      try { text = await readLocal(file.text(), "workspace_import_read_timeout"); } catch (caught) { throw caught?.code === "workspace_import_read_timeout" || caught?.name === "AbortError" ? caught : workspaceError("workspace_import_read_failed"); }
      if (!lifecycle.isCurrent()) return;
      if (typeof text !== "string" || (text === "" && file.size > 0)) throw workspaceError("workspace_import_read_failed");
      if (new Blob([text]).size > 5 * 1024 * 1024) throw workspaceError("workspace_import_too_large");
      if (await confirmedWrite(full, text)) toast(`已导入 ${full}（${formatBytes(new Blob([text]).size)}）`);
    } catch (caught) {
      if (lifecycle.isCurrent()) setError(failureMessage(caught));
    } finally {
      endMutation();
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // —— 导出：把已打开文件下载到本地 ——
  function exportOpenFile(file = null) {
    if (!lifecycle.isCurrent()) return;
    const current = file?.path ? file : { ...draftRef.current, truncated: previewTruncated };
    if (!current.path) return;
    const name = current.path.split("/").pop() || "workspace-file.txt";
    try { downloadTextFile(name, current.content); toast(`已发起下载 ${name}${current.truncated ? "（仅当前预览）" : ""}`); }
    catch { setError(failureMessage(workspaceError("workspace_download_failed"))); }
  }

  // —— 复制：把编辑器内容复制到剪贴板 ——
  async function copyContent() {
    const current = { ...draftRef.current };
    if (!current.path || !lifecycle.isCurrent()) return;
    const request = fileRequestRef.current;
    try {
      await navigator.clipboard.writeText(current.content);
      if (!lifecycle.isCurrent() || request !== fileRequestRef.current || current.revision !== draftRef.current.revision) return;
      setCopied(true);
      later(() => setCopied(false), 1800);
    } catch {
      if (!lifecycle.isCurrent() || request !== fileRequestRef.current || current.revision !== draftRef.current.revision) return;
      try {
        editorRef.current?.select?.();
        if (!document.execCommand("copy")) throw workspaceError("workspace_clipboard_failed");
        setCopied(true);
        later(() => setCopied(false), 1800);
      } catch {
        setError("复制失败，请手动选择后复制。");
      }
    }
  }

  // —— 粘贴：从剪贴板建一个新文件 ——
  async function pasteFromClipboard() {
    if (!beginMutation("paste")) return;
    try {
      let text;
      try { text = await readLocal(navigator.clipboard.readText(), "workspace_clipboard_timeout"); } catch (caught) { throw caught?.code === "workspace_clipboard_timeout" || caught?.name === "AbortError" ? caught : workspaceError("workspace_clipboard_failed"); }
      if (!lifecycle.isCurrent()) return;
      if (!text) { setError("剪贴板是空的，没有上传任何内容。"); return; }
      if (new Blob([text]).size > 5 * 1024 * 1024) throw workspaceError("workspace_import_too_large");
      const raw = window.prompt("粘贴为文件（输入文件名，可含子目录）：", "clipboard.txt");
      if (raw == null) return;
      const full = checkedFilePath(raw, path);
      if (await confirmedWrite(full, text)) toast(`已粘贴保存 ${full}（${formatBytes(new Blob([text]).size)}）`);
    } catch (caught) {
      if (lifecycle.isCurrent()) setError(failureMessage(caught));
    } finally { endMutation(); }
  }

  return (
    <div className="fun-view workspace-view">
      <header className="fun-view-header">
        <h2>📁 工作区</h2>
        <p>你和 AI 共用的文本文件空间。修改后点“保存”才写入云端；查看过的完整文件会留一份本账号离线副本。</p>
      </header>

      <div className="notification-feature-panel device-activity-panel">
        <div className="device-activity-heading">
          <div>
            <strong>存放位置</strong>
            <span>云端用户工作区（Supabase Storage）</span>
          </div>
          <div className="device-activity-actions">
            <button type="button" onClick={() => { void loadTree(path); refreshStats(); refreshCacheInfo(); }} disabled={loading || Boolean(busy)}>刷新</button>
            <button type="button" onClick={() => void clearLocalCache()} disabled={Boolean(busy)}>清理缓存</button>
          </div>
        </div>
        <p className="workspace-stats-line">
          云端 {stats ? `${stats.files} 个文件 · ${formatBytes(stats.bytes)}${stats.partial ? "（部分统计）" : ""}` : statsError ? "统计未读到" : "统计读取中…"}；本账号离线副本 {cacheInfo.files == null ? cacheInfo.error ? "未读到" : "读取中…" : `${cacheInfo.files} 个 · ${formatBytes(cacheInfo.totalBytes)}`}
        </p>
        {(statsError || cacheInfo.error) && <p className="workspace-storage-warning" role="status">{statsError || cacheInfo.error}</p>}
      </div>

      <p className="workspace-capacity-note">文本文件最多 5MiB；超过 200,000 字符单位的云端正文显示只读预览。导入同名文件前会询问是否覆盖。</p>

      <div className="workspace-toolbar">
        <button type="button" onClick={beginNewFile} disabled={Boolean(busy)}>＋ 新建文件</button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy) || operationUnconfirmed}>
          ⬆ 导入文件
        </button>
        <button type="button" onClick={() => void pasteFromClipboard()} disabled={Boolean(busy) || operationUnconfirmed}>
          📋 粘贴为文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFromFile(file);
          }}
        />
        <span aria-hidden="true" className="workspace-toolbar-path">
          {path ? `当前目录：/${path}` : "当前目录：/（根目录）"}
        </span>
      </div>

      <button
        type="button"
        className="workspace-agents-md-toggle"
        onClick={() => void loadAgentsMd()}
        disabled={Boolean(busy)}
      >
        {agentsMd ? "收起" : "预览"}每轮注入的 agents.md（个性化指令 + 记忆详情）
      </button>
      {agentsMd && (
        <div className="workspace-agents-md-preview">
          <pre>{agentsMd.content}</pre>
          <small>共 {agentsMd.chars} 字符 · 与聊天时注入到系统提示词最前的内容一致</small>
        </div>
      )}

      {error && <div className="media-settings-error" role="alert">{error}</div>}
      {unconfirmedOperation && <div className="workspace-storage-warning" role="status">
        <p>{unconfirmedOperation.rejected ? `「${unconfirmedOperation.path}」的写入明确未完成，提交副本仍保留，可核对原因后手动重试。` : <>{unconfirmedOperation.released ? "已核对目标现状，可继续手动操作。" : `「${unconfirmedOperation.path}」的${unconfirmedOperation.kind === "write" ? "写入" : "删除"}结果尚未确认；新的云端写入和删除暂缓。`}读取现状不能证明前次请求未执行。</>}当前草稿保持原样。本页核对记录{unconfirmedOperation.kind === "write" ? "和提交副本" : ""}只留在当前页面，离开或刷新后需重新核对云端再操作。</p>
        {unconfirmedOperation.checked && unconfirmedOperation.kind === "delete" && <p>{unconfirmedOperation.exists ? "目标文件目前仍列在它的目录中。" : "本次完整目录列表未列出目标文件。"}这不是前次删除回执。</p>}
        {unconfirmedOperation.kind === "write" && <>
          <button type="button" disabled={Boolean(busy)} onClick={() => exportOpenFile(unconfirmedOperation)}>{unconfirmedOperation.rejected ? "下载提交副本" : "下载未确认内容"}</button>
          {unconfirmedOperation.checked && <details><summary>核对目标文件的云端快照</summary><textarea value={unconfirmedOperation.cloudContent} readOnly aria-label={`未确认文件云端快照 ${unconfirmedOperation.path}`} /></details>}
        </>}
        {!unconfirmedOperation.released && <button type="button" disabled={Boolean(busy)} onClick={() => void verifyUnconfirmedOperation()}>{unconfirmedOperation.kind === "write" ? "核对未确认文件" : "核对删除目标目录"}</button>}
        {unconfirmedOperation.checked && !unconfirmedOperation.released && <button type="button" disabled={Boolean(busy)} onClick={continueAfterCheck}>已核对现状，继续手动操作</button>}
      </div>}
      {cacheWarning && <div className="workspace-storage-warning" role="status">{cacheWarning}</div>}
      {message && <div className="workspace-saved-note" role="status">{message}</div>}
      {busy && <p className="workspace-capacity-note" role="status">{busy.startsWith("open:") ? "正在读取文件…" : busy === "save" ? "正在核对保存回执；可以继续编辑新内容。" : busy === "import" ? "正在读取并导入本地文本文件…" : busy === "paste" ? "正在读取剪贴板并核对保存回执…" : busy === "clear-cache" ? "正在清理本账号离线副本…" : busy === "agents-md" ? "正在读取 agents.md 预览…" : "正在核对文件操作回执…"}</p>}

      <nav className="workspace-breadcrumbs" aria-label="工作区路径">
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.target}>
            {index > 0 && <span className="workspace-breadcrumb-sep">/</span>}
            <button type="button" disabled={path === crumb.target || Boolean(busy)} onClick={() => navigate(crumb.target)}>
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <section className="workspace-files" aria-busy={loading}>
        {loading && <p className="notification-feature-feedback busy" role="status">加载中…</p>}
        {entries === null ? null : entries.length === 0 ? (
          <p className="media-empty-state">{offline ? "这个目录没有本账号的离线副本。连接恢复后点“刷新”。" : "这个目录还是空的。可以让 AI 写代码或记笔记到这里。"}</p>
        ) : (
          <ul className="workspace-file-list">
            {entries.map((entry) => {
              const name = fileLabel(entry);
              const isDir = String(entry.type) === "dir" || name.endsWith("/");
              return (
                <li key={name} className="workspace-file-row">
                  <button
                    type="button"
                    className="workspace-file-name"
                    disabled={Boolean(busy)}
                    onClick={() => (isDir ? navigate(path ? `${path}/${name}` : name) : void openFile(entry))}
                  >
                    <span aria-hidden="true">{isDir ? "📂" : "📄"}</span>
                    <strong>{name}</strong>
                    {!isDir && <small>{formatBytes(entry.size)}</small>}
                  </button>
                  {!isDir && (
                    <div className="workspace-file-actions">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => openFile(entry).then((file) => { if (file) exportOpenFile(file); })}
                      >
                        下载
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={Boolean(busy) || operationUnconfirmed}
                        onClick={() => void removeFile(name)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!offline && entries?.length >= 200 && <p className="workspace-capacity-note">当前接口最多返回目录中的前 200 项；列表达到上限，不能据此确认已显示全部文件。</p>}
      </section>

      {openPath && (
        <section className="workspace-editor">
          <div className="workspace-editor-heading">
            <div>
              <strong>{openPath}</strong>
              <small>{cachedAt || (readOnly && !previewTruncated ? "内容尚未完整读取；当前仅供查看" : "云端读取内容")}{dirty ? " · 有未保存修改" : ""}</small>
            </div>
            <div className="workspace-editor-actions">
              <button type="button" onClick={() => void copyContent()} disabled={Boolean(busy) || !openPath}>
                {copied ? "已复制 ✓" : "复制"}
              </button>
              <button type="button" onClick={exportOpenFile} disabled={Boolean(busy) || !openPath}>下载当前内容</button>
              <button type="button" onClick={() => void rereadCurrentFile()} disabled={Boolean(busy)}>重新读取文件</button>
              <button type="button" disabled={Boolean(busy) || operationUnconfirmed || readOnly || !dirty} onClick={() => void saveFile()}>
                {busy === "save" ? "保存中…" : "保存"}
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => { if (!discardAllowed()) return; fileRequestRef.current += 1; updateDraft("", ""); setCopied(false); }}>关闭</button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            value={content}
            readOnly={readOnly}
            onChange={(event) => updateDraft(openPath, event.target.value, true)}
            spellCheck={false}
            placeholder="在这里输入或粘贴文件内容…"
            aria-label={`编辑 ${openPath}`}
          />
          <div className="workspace-editor-status">
            <span>{content.length.toLocaleString()} 字符</span>
            {dirty && <span className="workspace-editor-dirty">● 未保存</span>}
          </div>
          {cloudSnapshot?.path === openPath && <details className="workspace-cloud-snapshot">
            <summary>核对云端快照{cloudSnapshot.truncated ? "（仅部分预览）" : ""}</summary>
            <p>只读快照；编辑器中的内容保持原样。{cloudSnapshot.truncated ? "内容未完整读取，不能用来确认保存。" : "可比较内容，再决定下一步。"}</p>
            <textarea value={cloudSnapshot.content} readOnly aria-label={`云端快照 ${openPath}`} />
          </details>}
        </section>
      )}
    </div>
  );
}

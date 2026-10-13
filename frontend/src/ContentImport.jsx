import { useEffect, useMemo, useRef, useState } from "react";
import { commitContentImport, getContentImport, resolveContentImport, contentImportResolutionReceipt, listContentImports, previewContentImport, previewContentImportPage, CONTENT_IMPORT_PAGED_EXTENSIONS, CONTENT_IMPORT_ERROR_FEEDBACK, translatedImportError, importCommitRecovery } from "./content-import-api.js";
import WorldBookManager from "./WorldBookManager.jsx";
import ChatErrorLog from "./ChatErrorLog.jsx";
import { funLabsDiagnostic } from "./fun-labs-refresh.js";
import { createImportRequestClient } from "./import-request-scope.js";
import { importCheckpointKey, readImportCheckpoint, saveImportCheckpoint, clearImportCheckpoint, importCommitReceipt } from "./import-checkpoint.js";
import { readImportFingerprint } from "./import-fingerprint-reader.js";
import { createImportAttempt, importAttemptPrefix, readImportAttempts, saveImportAttempt, clearImportAttempt } from "./import-attempt-receipt.js";

const TYPE_META = Object.freeze({
  memory: {
    label: "稳定记忆",
    defaultTarget: "memories",
    targets: [["memories", "稳定记忆"], ["user_details", "你的详情"]],
  },
  style: {
    label: "表达风格",
    defaultTarget: "unified_system_prompt",
    targets: [["unified_system_prompt", "个性化指令"]],
  },
  world_book: {
    label: "世界书",
    defaultTarget: "world_book_entries",
    targets: [["world_book_entries", "世界书条目"]],
  },
  calendar: {
    label: "日历线索",
    defaultTarget: "memory_calendar",
    targets: [["memory_calendar", "记忆日历"]],
  },
});

function collectionOf(data, keys) {
  for (const key of keys) {
    const value = data?.[key] ?? data?.preview?.[key] ?? data?.result?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeImportPreview(data = {}) {
  const candidates = collectionOf(data, ["candidates", "items"]).map((item, index) => {
    const candidateType = item.type ?? item.candidate_type;
    const type = TYPE_META[candidateType] ? candidateType : "memory";
    const truncation = item.metadata?.content_truncation;
    return {
      ...item,
      clientKey: String(item.id ?? item.candidate_id ?? `${type}-${index}`),
      candidateId: item.id ?? item.candidate_id ?? index,
      type,
      source: String(item.source || item.source_label || "导入内容"),
      title: String(item.title || "未命名候选"),
      content: String(item.content ?? item.text ?? ""),
      target: String(item.target || TYPE_META[type].defaultTarget),
      keywords: Array.isArray(item.keywords ?? item.metadata?.keywords) ? [...(item.keywords ?? item.metadata.keywords)] : [],
      enabled: (item.enabled ?? item.metadata?.enabled) !== false,
      priority: Number(item.priority ?? item.metadata?.priority ?? 100),
      constant: (item.constant ?? item.metadata?.constant) === true,
      match_mode: String(item.match_mode ?? item.metadata?.match_mode ?? "any"),
      case_sensitive: (item.case_sensitive ?? item.metadata?.case_sensitive) === true,
      position: String(item.position ?? item.metadata?.position ?? "dynamic_context"),
      sort_order: Number(item.sort_order ?? item.metadata?.sort_order ?? index),
      decision: "pending",
      contentTruncation: truncation?.truncated === true && [truncation.source_characters, truncation.retained_characters, truncation.omitted_characters].every(Number.isSafeInteger) ? truncation : null,
    };
  });
  return {
    id: data.id ?? data.import_id ?? data.import?.id ?? data.preview?.id ?? data.result?.id ?? data.result?.import?.id,
    candidates,
    counts: data.counts ?? data.preview?.counts ?? data.result?.counts ?? (data.result?.count == null ? {} : { total: data.result.count }),
    warnings: collectionOf(data, ["warnings"]),
    digest: String(data.digest ?? data.preview?.digest ?? data.result?.digest ?? ""),
  };
}

function recentImportsOf(data) {
  return Array.isArray(data) ? data : collectionOf(data, ["imports", "items", "results"]);
}

function countText(counts) {
  const labels = { accepted: "接受", rejected: "拒绝", total: "候选" };
  const entries = Object.entries(counts || {}).filter(([, value]) => Number.isFinite(Number(value)));
  return entries.length
    ? entries.map(([key, value]) => `${TYPE_META[key]?.label || labels[key] || key} ${value}`).join(" · ")
    : "后端未返回分类计数";
}

function committedResult(data) {
  const value = data?.result || data || {};
  if (value.counts || value.stats) return value.counts || value.stats;
  return {
    accepted: value.accepted_count,
    rejected: value.rejected_count,
  };
}

export default function ContentImport({ api, accountScope = "", companionScope = "" }) {
  const client = useMemo(() => api || createImportRequestClient({ accountScope, companionScope }), [api, accountScope, companionScope]);
  const [activeTab, setActiveTab] = useState("import");
  const [kind, setKind] = useState("world_book");
  const [format, setFormat] = useState("auto");
  const [inputMode, setInputMode] = useState("file");
  const [file, setFile] = useState(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(null);
  const [recentImports, setRecentImports] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(null);
  const [emptyPage, setEmptyPage] = useState(null);
  const [resume, setResume] = useState(null);
  const [progress, setProgress] = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [uncertainImportId, setUncertainImportId] = useState(null);
  const receiptPrefix = importAttemptPrefix(accountScope, companionScope);
  const [attempts, setAttempts] = useState(() => readImportAttempts(receiptPrefix));
  const scopeRef = useRef(receiptPrefix);
  useEffect(() => { scopeRef.current = receiptPrefix; }, [receiptPrefix]);
  const operationRef = useRef({ alive: true, task: null });
  const fingerprintRef = useRef(null);

  useEffect(() => {
    const operation=operationRef.current; operation.alive=true;
    return () => { operation.alive=false; operation.task?.controller.abort(); operation.task=null; };
  }, []);
  function begin(label) {
    if (!operationRef.current.alive || operationRef.current.task) return null;
    const task={controller:new AbortController(),scope:receiptPrefix}; operationRef.current.task=task;
    setBusy(label);setError("");setDiagnostic(null);setRecoveryNote(""); return task;
  }
  function current(task) { return operationRef.current.alive && operationRef.current.task===task && task.scope===scopeRef.current && !task.controller.signal.aborted; }
  function finish(task) { if(current(task)){operationRef.current.task=null;setBusy("");setProgress(null);} }
  function fail(error) {
    setError(translatedImportError({code:error?.code},"导入请求未能完成，请查看诊断后重试。"));
    setDiagnostic(funLabsDiagnostic(error,"import_operation_failed",CONTENT_IMPORT_ERROR_FEEDBACK));
  }
  function remember(key,record) {
    setResume({key,record});
    if(!saveImportCheckpoint(key,record))setRecoveryNote("当前设备未能保存进度；请保持此面板打开，已提交内容不受影响。");
  }
  function settlePage(key,record) {
    if(record?.pending)remember(key,{...record,nextByte:record.pending.endByte,pending:null});
  }
  function removeAttempt(importId) {
    clearImportAttempt(receiptPrefix,importId);
    setAttempts(values=>values.filter(row=>row.importId!==importId));
  }
  useEffect(() => {
    const reload=event=>{if(!event || event.key===null || event.key?.startsWith(receiptPrefix || "invalid-scope."))setAttempts(readImportAttempts(receiptPrefix));};
    reload();globalThis.window?.addEventListener?.("storage",reload);
    return ()=>globalThis.window?.removeEventListener?.("storage",reload);
  }, [receiptPrefix]);
  const commitBlocked = Boolean(uncertainImportId || resume?.record.pending?.commitAttempted || attempts.length);
  function stopReading() {
    operationRef.current.task?.controller.abort();operationRef.current.task=null;
    setBusy("");setProgress(null);setRecoveryNote("读取已停止，原文件和已确认的进度仍保留。");
  }

  async function refreshRecent(task) {
    try {
      const data=await listContentImports(client);
      if(current(task))setRecentImports(recentImportsOf(data));
    } catch (loadError) {
      if(current(task))fail(loadError);
    }
  }

  useEffect(() => {
    let active = true;
    listContentImports(client).then(
      (data) => {
        if (active) setRecentImports(recentImportsOf(data));
      },
      (loadError) => {
        if (active) fail(loadError);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  const summary = useMemo(() => (preview?.candidates || []).reduce(
    (value, item) => ({
      accepted: value.accepted + Number(item.decision === "accepted"),
      rejected: value.rejected + Number(item.decision === "rejected"),
      pending: value.pending + Number(item.decision === "pending"),
    }),
    { accepted: 0, rejected: 0, pending: 0 },
  ), [preview]);

  function updateCandidate(clientKey, patch) {
    setPreview((current) => ({
      ...current,
      candidates: current.candidates.map((item) => item.clientKey === clientKey ? { ...item, ...patch } : item),
    }));
  }

  function decideAll(decision) {
    setPreview((current) => ({
      ...current,
      candidates: current.candidates.map((item) => ({ ...item, decision })),
    }));
  }

  async function handlePreview(startByte = 0) {
    if (commitBlocked) return;
    const task=begin("preview");if(!task)return;
    setResult(null);
    let pagedContext = null;
    try {
      let data;
      if (inputMode === "file" && file?.size > 1024 * 1024 && CONTENT_IMPORT_PAGED_EXTENSIONS.test(file.name)) {
        let fingerprint=fingerprintRef.current?.file===file ? fingerprintRef.current.fingerprint : null;
        if(!fingerprint) {
          fingerprint=await readImportFingerprint(file,{signal:task.controller.signal,onProgress:value=>{if(current(task))setProgress(value);}});
          if(!current(task))return;fingerprintRef.current={file,fingerprint};setProgress(null);
        }
        const key=importCheckpointKey(accountScope,companionScope,kind,fingerprint);
        let record=readImportCheckpoint(key,file.size) || {version:1,totalBytes:file.size,nextByte:0,pending:null};
        if(!startByte && record.pending) {
          const restored=await getContentImport(record.pending.importId,client);
          if(!current(task))return;
          const value=restored?.result || restored;
          if(value?.import?.id!==record.pending.importId)throw Object.assign(new Error(),{code:"import_preview_receipt_invalid"});
          setPage({startByte:record.pending.startByte,endByte:record.pending.endByte,totalBytes:file.size});
          remember(key,record);
          if(value.import.status==="committed") {
            importCommitReceipt(restored,record.pending.importId);settlePage(key,record);setResult(committedResult(value.import));setPreview(null);
            setRecoveryNote("服务器确认这一段已提交，无需重复写入，可以继续下一段。");return;
          }
          if(value.import.status!=="preview" || !Array.isArray(value.candidates))throw Object.assign(new Error(),{code:"import_preview_receipt_invalid"});
          setPreview(normalizeImportPreview(restored));
          if(value.import.commit_protocol===null){fail({code:"import_legacy_preview"});return;}
          setRecoveryNote(record.pending.commitAttempted ? "这一段曾尝试提交，请先检查提交结果；不会自动重复写入。" : "已恢复未提交的预览，请重新核对候选；上次未提交的页面编辑未保留。");return;
        }
        startByte=startByte || record.nextByte;
        if(startByte>=file.size){remember(key,record);setPreview(null);setPage({startByte:file.size,endByte:file.size,totalBytes:file.size});setRecoveryNote("这份文件已处理到末尾，包含你主动放弃的分段。");return;}
        pagedContext = { key, record, startByte };
        const paged = await previewContentImportPage({ file, kind, startByte,signal:task.controller.signal }, client);
        if(!current(task))return;
        data = paged.data;
        setEmptyPage(null);
        setPage(paged.page);
        const parsed=normalizeImportPreview(data);
        if(!parsed.id)throw Object.assign(new Error(),{code:"import_preview_receipt_invalid"});
        record={...record,nextByte:startByte,pending:{importId:String(parsed.id),startByte,endByte:paged.page.endByte,commitAttempted:false}};
        remember(key,record);
      } else {
        data = await previewContentImport({
        kind,
        format,
        file: inputMode === "file" ? file : null,
        content: inputMode === "paste" ? content : "",
        signal:task.controller.signal,
      }, client);
        if(!current(task))return;
        setPage(null);
        setEmptyPage(null);
        setResume(null);
      }
      setPreview(normalizeImportPreview(data));
    } catch (previewError) {
      if(current(task)) {
        const range=previewError?.page;
        if (!preview && pagedContext && previewError.code === "import_no_candidates" && previewError.status === 422
            && range?.startByte === pagedContext.startByte && range.totalBytes === file.size
            && Number.isSafeInteger(range.endByte) && range.endByte > range.startByte && range.endByte <= file.size) {
          setPage(range);setEmptyPage(range);
          remember(pagedContext.key,{...pagedContext.record,nextByte:range.startByte,pending:null});
        }
        fail(previewError);
      }
    } finally {
      finish(task);
    }
  }

  async function handleCommit() {
    if (!preview?.id || summary.pending > 0 || commitBlocked) return;
    const task=begin("commit");if(!task)return;
    const committing=resume?.record.pending ? {...resume.record,pending:{...resume.record.pending,commitAttempted:true}} : null;
    if(committing)remember(resume.key,committing);
    else {
      const receipt=createImportAttempt(preview.id,kind);
      const persisted=saveImportAttempt(receiptPrefix,receipt);
      setAttempts(values=>[...values.filter(row=>row.importId!==receipt.importId),receipt]);
      if(!persisted)setRecoveryNote("当前设备无法持久保存待核对编号；请保持此页面打开，刷新或退出后可能无法自动恢复。");
    }
    setUncertainImportId(preview.id);
    try {
      const decisions = preview.candidates.map((item) => ({
        id: item.candidateId,
        candidate_id: item.candidateId,
        decision: item.decision,
        accepted: item.decision === "accepted",
        title: item.title,
        content: item.content,
        target: item.target,
        ...(item.type === "world_book" ? {
          keywords: item.keywords,
          enabled: item.enabled,
          priority: Number(item.priority),
          constant: item.constant,
          match_mode: item.match_mode,
          case_sensitive: item.case_sensitive,
          position: item.position,
          sort_order: Number(item.sort_order),
        } : {}),
      }));
      const committed = await commitContentImport(preview.id, decisions, client,{signal:task.controller.signal});
      if(!current(task))return;
      importCommitReceipt(committed,preview.id);
      setUncertainImportId(null);
      removeAttempt(preview.id);
      if(committing)settlePage(resume.key,committing);
      setResult(committedResult(committed));
      setPreview(null);
      window.dispatchEvent(new CustomEvent("dengta:memories-imported", { detail: committed.result || committed }));
      await refreshRecent(task);
    } catch (commitError) {
      if(current(task)) {
        if(importCommitRecovery(commitError?.code)==="retry") {
          setUncertainImportId(null);
          removeAttempt(preview.id);
          if(committing)remember(resume.key,{...committing,pending:{...committing.pending,commitAttempted:false}});
          setRecoveryNote("本轮没有写入，可以核对候选后再次提交。");
        }
        fail(commitError);
      }
    } finally {
      finish(task);
    }
  }

  async function checkCommit(requestedId) {
    const pending=resume?.record.pending;
    const importId=requestedId || uncertainImportId || (pending?.commitAttempted ? pending.importId : null);
    if(!importId)return;
    const task=begin("check");if(!task)return;
    setUncertainImportId(importId);
    try {
      const data=await getContentImport(importId,client);if(!current(task))return;
      const stored=data?.result || data;
      if(stored?.import?.id!==importId)throw Object.assign(new Error(),{code:"import_commit_receipt_invalid"});
      if(stored.import.status==="preview") {
        if(!preview)setPreview(normalizeImportPreview(data));
        fail({code:stored.import.commit_protocol===null ? "import_legacy_preview" : "import_commit_pending"});return;
      }
      const value=importCommitReceipt(data,importId);
      setUncertainImportId(null);
      removeAttempt(importId);
      settlePage(resume?.key,resume?.record);setResult(committedResult(value.import));setPreview(null);
      window.dispatchEvent(new CustomEvent("dengta:memories-imported", {detail:value}));
      setRecoveryNote("服务器已确认提交成功，没有重复写入。");await refreshRecent(task);
    } catch(error) {if(current(task))fail(error?.code==="import_not_found" ? {...error,code:"import_receipt_missing"} : error);} finally {finish(task);}
  }
  function discardPage() {
    if(commitBlocked)return;
    settlePage(resume?.key,resume?.record);setPreview(null);setResult(null);
  }
  function continueEmptyPage() {
    if(busy || commitBlocked || !emptyPage || !resume?.key || preview)return;
    const nextByte=emptyPage.endByte;
    remember(resume.key,{...resume.record,nextByte,pending:null});
    setEmptyPage(null);setError("");setDiagnostic(null);
    setPage({startByte:nextByte,endByte:nextByte,totalBytes:emptyPage.totalBytes});
    if(nextByte===emptyPage.totalBytes) {
      setRecoveryNote("已确认末段没有候选，文件读取到末尾；本段没有写入任何内容。");
      return;
    }
    void handlePreview(nextByte);
  }

  async function resolvePendingCommit() {
    const importId=uncertainImportId || resume?.record.pending?.importId;
    if(!importId || diagnostic?.error_code!=="import_commit_pending")return;
    const task=begin("resolve");if(!task)return;
    try {
      const data=await resolveContentImport(importId,client,{signal:task.controller.signal});if(!current(task))return;
      const value=contentImportResolutionReceipt(data,importId);
      removeAttempt(importId);setUncertainImportId(null);setPreview(null);
      if(value.resolution==="discarded") {
        if(resume?.record.pending)remember(resume.key,{...resume.record,nextByte:resume.record.pending.startByte,pending:null});
        setPage(null);setResult(null);setRecoveryNote("旧候选已全部放弃，没有写入用户内容；可以重新选择原文件或粘贴文本，生成新预览。");
      } else {
        settlePage(resume?.key,resume?.record);setResult(committedResult(value.import));
        setRecoveryNote("原提交已经完成，保留原结果，没有重复写入或删除已保存内容。");
        window.dispatchEvent(new CustomEvent("dengta:memories-imported",{detail:value}));
      }
      await refreshRecent(task);
    } catch(error) {if(current(task)){fail(error);setRecoveryNote("结束旧候选的请求未确认；旧提交编号仍保留，请先检查提交结果，再决定下一步。");}} finally {finish(task);}
  }

  function reviewLegacyPage() {
    if(busy || importCommitRecovery(diagnostic?.error_code)!=="legacy")return;
    if(resume?.record.pending)remember(resume.key,{...resume.record,nextByte:resume.record.pending.startByte,pending:null});
    removeAttempt(uncertainImportId || preview?.id);
    setPreview(null);setResult(null);setUncertainImportId(null);setError("");setDiagnostic(null);
    setRecoveryNote("请重新生成本段预览；已保存的记忆、指令或世界书不会删除，请拒绝已经导入的候选。");
  }

  function resetSource() {
    setPage(null);setEmptyPage(null);setPreview(null);setResult(null);setResume(null);setUncertainImportId(null);setRecoveryNote("");setError("");setDiagnostic(null);
  }

  const decisionsLocked = Boolean(busy || commitBlocked);

  const groupedCandidates = useMemo(() => Object.keys(TYPE_META).map((type) => ({
    type,
    items: (preview?.candidates || []).filter((item) => item.type === type),
  })), [preview]);

  return (
    <section className="content-import" aria-labelledby="content-import-title">
      <header className="content-import-hero">
        <span className="eyebrow">把旧故事带回灯塔</span>
        <h3 id="content-import-title">世界书与聊天记录</h3>
        <p>先生成预览，再逐项决定去留。未经你的明确确认，任何候选都不会写入。</p>
      </header>

      <div className="content-import-tabs" role="tablist" aria-label="世界书与导入功能">
        <button type="button" role="tab" aria-selected={activeTab === "import"} onClick={() => setActiveTab("import")}>导入新内容</button>
        <button type="button" role="tab" aria-selected={activeTab === "manage"} onClick={() => setActiveTab("manage")}>世界书管理</button>
      </div>

      {activeTab === "manage" ? <WorldBookManager api={client} /> : <>
        {attempts.length > 0 && <section className="content-import-receipt content-import-attempts" aria-label="待核对导入">
          <strong>有 {attempts.length} 次导入结果待核对</strong>
          <p>关闭面板后仍保留导入编号。先核对服务器结果，再继续导入，避免重复追加。</p>
          <ul>{attempts.map(row=><li key={row.importId}><span>{row.kind==="world_book" ? "世界书" : "聊天记录"} · {new Date(row.startedAt).toLocaleString()}</span><code>{row.importId}</code><button className="content-import-secondary" type="button" disabled={Boolean(busy)} onClick={()=>void checkCommit(row.importId)}>核对这次导入</button></li>)}</ul>
        </section>}
        <div className="content-import-source settings-card">
        <fieldset className="content-import-segments">
          <legend>导入内容类型</legend>
          <button type="button" disabled={Boolean(busy) || commitBlocked} aria-pressed={kind === "world_book"} onClick={() => {setKind("world_book");resetSource();}}>世界书</button>
          <button type="button" disabled={Boolean(busy) || commitBlocked} aria-pressed={kind === "chat_history"} onClick={() => {setKind("chat_history");resetSource();}}>聊天记录</button>
        </fieldset>
        <div className="content-import-fields">
          <label><span>输入方式</span><select aria-label="输入方式" disabled={Boolean(busy) || commitBlocked} value={inputMode} onChange={(event) => {setInputMode(event.target.value);resetSource();}}><option value="file">上传文件</option><option value="paste">粘贴文本</option></select></label>
          <label><span>内容格式</span><select aria-label="内容格式" disabled={Boolean(busy) || commitBlocked} value={format} onChange={(event) => {setFormat(event.target.value);resetSource();}}><option value="auto">自动识别</option><option value="sillytavern">SillyTavern</option><option value="generic_json">通用 JSON</option><option value="plain_text">纯文本</option></select></label>
        </div>
        {inputMode === "file" ? (
          <label className="content-import-dropzone"><span>{file ? file.name : "选择聊天记录、世界书或文档"}</span><small>TXT、Markdown、日志、CSV、TSV、JSONL 最大 1GB，分段预览并逐段确认；重新选择原文件可恢复进度。完整 JSON 最大 100MB（解析最多 100 万字），PDF、DOCX、邮件最大 20MB。模型上下文仍由所选接口决定。</small><input aria-label="选择导入文件" type="file" accept=".json,.txt,.text,.md,.markdown,.log,.csv,.tsv,.jsonl,.ndjson,.html,.htm,.srt,.vtt,.eml,.pdf,.docx,.xml,.yaml,.yml,.ini,.conf" disabled={Boolean(busy) || commitBlocked} onChange={(event) => {setFile(event.target.files?.[0] || null);resetSource();}} /></label>
        ) : (
          <label className="content-import-paste"><span>粘贴原始内容</span><textarea aria-label="粘贴导入内容" disabled={Boolean(busy) || commitBlocked} value={content} onChange={(event) => setContent(event.target.value)} rows={8} placeholder="内容会按原文发送，不进行关键词过滤。" /></label>
        )}
        <button className="content-import-primary" type="button" disabled={Boolean(busy) || commitBlocked || (inputMode === "file" ? !file : !content)} onClick={() => void handlePreview()}>{busy === "preview" ? "正在读入故事…" : "生成导入预览"}</button>
        {busy==="preview" && <button className="content-import-secondary" type="button" onClick={stopReading}>停止读取</button>}
        {progress && <p role="status">正在校验原文件：{Math.round(progress.readBytes / progress.totalBytes * 100)}% · 分块读取，不整份载入内存。</p>}
        {recoveryNote && <p role="status">{recoveryNote}</p>}
        {(uncertainImportId || resume?.record.pending?.commitAttempted) && <button className="content-import-secondary" type="button" disabled={Boolean(busy)} onClick={()=>void checkCommit()}>{busy==="check" ? "正在核对…" : "检查提交结果"}</button>}
        {(diagnostic?.error_code==="import_commit_pending" || busy==="resolve") && <section className="content-import-receipt" aria-label="结束旧候选">
          <p>放弃尚未提交的全部旧候选；已经保存的内容保留。如果原提交先完成，将显示原结果。</p>
          <button className="content-import-secondary" type="button" disabled={Boolean(busy)} onClick={()=>void resolvePendingCommit()}>{busy==="resolve" ? "正在核对并结束…" : "放弃旧候选并核对结果"}</button>
        </section>}
        {importCommitRecovery(diagnostic?.error_code)==="legacy" && <button className="content-import-secondary" type="button" disabled={Boolean(busy)} onClick={reviewLegacyPage}>已核对旧结果，重新预览本段</button>}
        {page && <div role="status"><p>本段：{page.startByte.toLocaleString()}–{page.endByte.toLocaleString()} 字节 / 共 {page.totalBytes.toLocaleString()} 字节。预览不会自动写入记忆。</p>
          <div className="content-import-page-actions">
          {emptyPage ? <><p>本段没有可导入候选，尚未写入；确认后才会推进文件进度。</p><button className="content-import-secondary" type="button" disabled={Boolean(busy) || commitBlocked} onClick={continueEmptyPage}>{emptyPage.endByte < emptyPage.totalBytes ? "确认本段无候选，继续下一段" : "确认末段无候选，结束读取"}</button></> : page.endByte < page.totalBytes && <button className="content-import-secondary" type="button" disabled={Boolean(busy) || Boolean(preview)} onClick={() => void handlePreview(page.endByte)}>读取下一段</button>}
          {preview && <button className="content-import-secondary" type="button" disabled={Boolean(busy) || commitBlocked} onClick={discardPage}>放弃本段候选</button>}
          {!busy && !preview && resume?.key && !resume.record.pending && <button className="content-import-secondary" type="button" onClick={()=>{clearImportCheckpoint(resume.key);setResume(null);setPage(null);setRecoveryNote("进度已重置；再次提交之前，请核对是否会重复导入。");}}>重新从头预览</button>}
          </div>
        </div>}
        </div>

      {error && <div className="content-import-error" role="alert">{error}{diagnostic && <><small>错误代码：{diagnostic.error_code}{diagnostic.http_status ? ` · HTTP ${diagnostic.http_status}` : ""}</small><ChatErrorLog key={diagnostic.error_log_id || diagnostic.error_code} logId={diagnostic.error_log_id} diagnostic={diagnostic} feedbackByCode={CONTENT_IMPORT_ERROR_FEEDBACK}/></>}</div>}
      {result && <div className="content-import-success" role="status"><strong>导入完成</strong><span>{countText(result)}</span></div>}

      {preview && (
        <section className="content-import-preview" aria-label="导入候选预览">
          <div className="content-import-receipt"><strong>预览回执</strong><span>{countText(preview.counts)}</span>{preview.digest && <p>{preview.digest}</p>}{preview.warnings.length > 0 && <ul aria-label="导入警告">{preview.warnings.map((warning, index) => <li key={`${String(warning)}-${index}`}>{String(warning?.message || warning)}</li>)}</ul>}</div>
          <div className="content-import-bulk" aria-label="批量决策"><button type="button" disabled={decisionsLocked} onClick={() => decideAll("accepted")}>全选接受</button><button type="button" disabled={decisionsLocked} onClick={() => decideAll("rejected")}>全选拒绝</button></div>
          {preview.candidates.length === 0 ? <div className="content-import-empty">没有生成可导入的候选项，请尝试其他格式。</div> : groupedCandidates.map(({ type, items }) => items.length > 0 && (
            <section className="content-import-group" key={type} aria-labelledby={`import-group-${type}`}>
              <h4 id={`import-group-${type}`}>{TYPE_META[type].label}<span>{items.length}</span></h4>
              <div className="content-import-grid">{items.map((item) => (
                <article className={`content-import-candidate is-${item.decision}`} key={item.clientKey}>
                  <div className="content-import-candidate-meta"><span>{item.source}</span><em>{TYPE_META[item.type].label}</em></div>
                  {item.contentTruncation && <p role="alert">此候选仅含部分正文：源条目 {item.contentTruncation.source_characters.toLocaleString()} 字符，预览保留 {item.contentTruncation.retained_characters.toLocaleString()}，另有 {item.contentTruncation.omitted_characters.toLocaleString()} 未纳入。确认提交只保存当前候选；完整内容请拆条重新导入。</p>}
                  <label><span>标题</span><input disabled={decisionsLocked} aria-label={`${item.title}的标题`} value={item.title} onChange={(event) => updateCandidate(item.clientKey, { title: event.target.value })} /></label>
                  <label><span>内容</span><textarea disabled={decisionsLocked} aria-label={`${item.title}的内容`} value={item.content} onChange={(event) => updateCandidate(item.clientKey, { content: event.target.value })} rows={5} /></label>
                   <label><span>写入位置</span><select disabled={decisionsLocked} aria-label={`${item.title}的写入位置`} value={item.target} onChange={(event) => updateCandidate(item.clientKey, { target: event.target.value })}>{TYPE_META[item.type].targets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                   {item.type === "world_book" && <div className="content-import-world-book-fields">
                     <label><span>关键词</span><input disabled={decisionsLocked} aria-label={`${item.title}的关键词`} value={item.keywords.join(", ")} onChange={(event) => updateCandidate(item.clientKey, { keywords: event.target.value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) })} /></label>
                     <label><span>优先级</span><input disabled={decisionsLocked} aria-label={`${item.title}的优先级`} type="number" min="-100000" max="100000" value={item.priority} onChange={(event) => updateCandidate(item.clientKey, { priority: event.target.value })} /></label>
                     <label><span>排序值</span><input disabled={decisionsLocked} aria-label={`${item.title}的排序值`} type="number" value={item.sort_order} onChange={(event) => updateCandidate(item.clientKey, { sort_order: event.target.value })} /></label>
                     <label><span>匹配方式</span><select disabled={decisionsLocked} aria-label={`${item.title}的匹配方式`} value={item.match_mode} onChange={(event) => updateCandidate(item.clientKey, { match_mode: event.target.value })}><option value="any">命中任一关键词</option><option value="all">命中全部关键词</option></select></label>
                     <label><span>上下文位置</span><select disabled={decisionsLocked} aria-label={`${item.title}的上下文位置`} value={item.position} onChange={(event) => updateCandidate(item.clientKey, { position: event.target.value })}><option value="dynamic_context">动态本轮背景</option><option value="before_memory">稳定记忆之前</option></select></label>
                     <div className="world-book-switches"><label><input disabled={decisionsLocked} type="checkbox" checked={item.enabled} onChange={(event) => updateCandidate(item.clientKey, { enabled: event.target.checked })} /><span>启用</span></label><label><input disabled={decisionsLocked} type="checkbox" checked={item.constant} onChange={(event) => updateCandidate(item.clientKey, { constant: event.target.checked })} /><span>常驻</span></label><label><input disabled={decisionsLocked} type="checkbox" checked={item.case_sensitive} onChange={(event) => updateCandidate(item.clientKey, { case_sensitive: event.target.checked })} /><span>区分大小写</span></label></div>
                   </div>}
                  <div className="content-import-decision" role="group" aria-label={`${item.title}的导入决策`}><button type="button" disabled={decisionsLocked} aria-pressed={item.decision === "accepted"} onClick={() => updateCandidate(item.clientKey, { decision: "accepted" })}>接受</button><button type="button" disabled={decisionsLocked} aria-pressed={item.decision === "rejected"} onClick={() => updateCandidate(item.clientKey, { decision: "rejected" })}>拒绝</button></div>
                </article>
              ))}</div>
            </section>
          ))}
          {preview.candidates.length > 0 && <div className="content-import-commit-summary" role="status"><div><strong>提交前确认</strong><span>接受 {summary.accepted} 项 · 拒绝 {summary.rejected} 项 · 未决定 {summary.pending} 项</span></div><button className="content-import-primary" type="button" disabled={Boolean(busy) || commitBlocked || summary.pending > 0} onClick={() => void handleCommit()}>{busy === "commit" ? "正在写入…" : summary.pending > 0 ? "请先逐项决定" : "确认并提交"}</button></div>}
        </section>
      )}

      <section className="content-import-recent" aria-labelledby="recent-import-title">
        <div><span className="eyebrow">导入手记</span><h4 id="recent-import-title">最近导入记录</h4></div>
        {recentImports.length === 0 ? <p className="content-import-empty">还没有导入记录。</p> : <ul>{recentImports.map((item, index) => <li key={item.id || index}><strong>{item.title || item.filename || item.source_name || "未命名导入"}</strong><span>{item.status || item.kind || item.source_type || "已记录"}</span><time dateTime={item.created_at || item.createdAt}>{item.created_at || item.createdAt ? new Date(item.created_at || item.createdAt).toLocaleString("zh-CN") : ""}</time></li>)}</ul>}
      </section>
      </>}
    </section>
  );
}

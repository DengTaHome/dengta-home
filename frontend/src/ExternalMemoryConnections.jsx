import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { invalidMemoryReceipt, memoryCount, memoryUiFailure, useMemoryUiRequest } from "./memory-ui-feedback.js";

const CONNECTION_TYPES = Object.freeze({
  supabase_memory: {
    label: "Supabase 专用记忆库",
    description:
      "高级可选：只适合专用项目中的匿名只读专用表。公开密钥不等于私密授权，请勿存放敏感记忆。",
  },
  ombre_brain_mcp: {
    label: "Ombre Brain MCP",
    description:
      "连接你购买或自行部署的 Ombre Brain HTTPS MCP 服务，用于读取外部记忆。",
  },
});

function emptyDraft(connectionType) {
  if (connectionType === "supabase_memory") {
    return {
      name: "我的 Supabase 记忆库",
      project_url: "",
      table_name: "dengta_memories",
      credential: "",
      enabled: true,
    };
  }
  return {
    name: "我的 Ombre Brain",
    endpoint: "",
    credential: "",
    enabled: true,
  };
}

function connectionTypeOf(value = {}) {
  return String(value.connection_type || value.type || "").trim();
}

function normalizeConnection(value, connectionType) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    connection_type: connectionTypeOf(value) || connectionType,
    credential_configured: value.credential_configured === true,
    credential_reentry_required:
      value.credential_reentry_required === true ||
      value.credential_state === "needs_reentry",
  };
}

function draftFromConnection(connectionType, connection) {
  const fallback = emptyDraft(connectionType);
  if (!connection) return fallback;
  if (connectionType === "supabase_memory") {
    return {
      ...fallback,
      name: String(connection.name || fallback.name),
      project_url: String(
        connection.project_url || connection.endpoint || connection.server || ""
      ),
      table_name: String(connection.table_name || fallback.table_name),
      credential: "",
      enabled: connection.enabled !== false,
    };
  }
  return {
    ...fallback,
    name: String(connection.name || fallback.name),
    endpoint: String(
      connection.endpoint || connection.project_url || connection.server || ""
    ),
    credential: "",
    enabled: connection.enabled !== false,
  };
}

function responseConnection(data, connectionType) {
  const candidate = data?.connection;
  if (data?.ok !== true || !validConnection(candidate, connectionType)) throw invalidMemoryReceipt();
  return normalizeConnection(candidate, connectionType);
}

function safeTestSummary(connectionType, data = {}) {
  const result = data.result;
  if (data.ok !== true || result?.connection_type !== connectionType) throw invalidMemoryReceipt();
  if (connectionType === "supabase_memory") {
    if (result.table_name !== "dengta_memories" || !memoryCount(result.record_count)) throw invalidMemoryReceipt();
    return `专用表只读连接通过，统计 ${result.record_count} 条记录；尚未导入，实际聊天召回仍待验证。`;
  }
  if (!Array.isArray(result.tools) || !Array.isArray(result.read_tools) || !result.read_tools.every(tool => typeof tool === "string" && result.tools.some(item => item?.name === tool))) throw invalidMemoryReceipt();
  return result.read_tools.length
    ? `MCP 服务已响应，识别出 ${result.read_tools.length} 个只读记忆工具（工具总数 ${result.tools.length}）；实际聊天召回仍待验证。`
    : `MCP 服务已响应（工具总数 ${result.tools.length}），没有受支持的只读记忆工具；请核对服务工具清单，聊天召回未通过。`;
}

function validConnection(connection, type = connection?.connection_type) {
  return Boolean(connection && typeof connection === "object" && !Array.isArray(connection) && typeof connection.id === "string" && connection.id && connection.connection_type === type && CONNECTION_TYPES[type] && typeof connection.enabled === "boolean" && typeof connection.credential_configured === "boolean" && typeof connection.last_status === "string" && typeof (type === "supabase_memory" ? connection.project_url : connection.endpoint) === "string");
}

function connectionList(data) {
  if (data?.ok !== true || !Array.isArray(data.connections)) throw invalidMemoryReceipt();
  const result = {};
  for (const item of data.connections) {
    const type = connectionTypeOf(item);
    if (!CONNECTION_TYPES[type]) continue;
    if (!validConnection(item, type) || result[type]) throw invalidMemoryReceipt();
    result[type] = normalizeConnection(item, type);
  }
  return result;
}

function statusLabel(connection) {
  if (!connection) return "未配置";
  if (connection.credential_reentry_required) return "需要重新填写凭据";
  if (connection.enabled === false) return "已保存 · 未启用";
  if (connection.last_status === "connected") return "上次检测通过";
  if (connection.last_status === "error") return "上次检测未通过";
  return "已保存 · 待测试";
}

function statusClass(connection) {
  if (connection?.enabled && !connection.credential_reentry_required && connection.last_status === "connected") return "online";
  return "pending";
}

function payloadFor(connectionType, draft) {
  const shared = {
    name: String(draft.name || "").trim(),
    enabled: draft.enabled !== false,
    ...(String(draft.credential || "").trim()
      ? { credential: String(draft.credential).trim() }
      : {}),
  };
  if (connectionType === "supabase_memory") {
    return {
      ...shared,
      project_url: String(draft.project_url || "").trim(),
      table_name: String(draft.table_name || "").trim(),
    };
  }
  return {
    ...shared,
    endpoint: String(draft.endpoint || "").trim(),
  };
}

function requiredFieldsReady(connectionType, draft, connection) {
  const endpointReady =
    connectionType === "supabase_memory"
      ? Boolean(draft.project_url.trim() && draft.table_name.trim())
      : Boolean(draft.endpoint.trim());
  const credentialReady =
    Boolean(draft.credential.trim()) ||
    (connection?.credential_configured === true &&
      connection?.credential_reentry_required !== true);
  return Boolean(draft.name.trim() && endpointReady && credentialReady);
}

export default function ExternalMemoryConnections({ scopeKey = settingsSaveScope(authSession.getSnapshot()) }) {
  const [stateScope, setStateScope] = useState(scopeKey);
  const [connections, setConnections] = useState({});
  const [drafts, setDrafts] = useState(() => ({
    supabase_memory: emptyDraft("supabase_memory"),
    ombre_brain_mcp: emptyDraft("ombre_brain_mcp"),
  }));
  const [loaded, setLoaded] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState({});
  const [supabasePreview, setSupabasePreview] = useState(null);
  const [expandedTypes, setExpandedTypes] = useState({});
  const readRef = useRef(null);
  const actionRef = useRef(null);
  const readVersion = useRef(0);
  const editVersions = useRef({ supabase_memory: 0, ombre_brain_mcp: 0 });
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  if (stateScope !== scopeKey) {
    setStateScope(scopeKey);
    setConnections({});
    setDrafts({ supabase_memory: emptyDraft("supabase_memory"), ombre_brain_mcp: emptyDraft("ombre_brain_mcp") });
    setLoaded(false); setReading(false); setBusy(""); setFeedback({}); setSupabasePreview(null); setExpandedTypes({});
  }
  useLayoutEffect(() => {
    readRef.current = null;
    actionRef.current = null;
    readVersion.current += 1;
    editVersions.current = { supabase_memory: 0, ombre_brain_mcp: 0 };
  }, [scopeKey]);

  const loadConnections = useCallback(async () => {
    if (readRef.current || actionRef.current || !isCurrent()) return false;
    const operation = {};
    const version = ++readVersion.current;
    const edits = { ...editVersions.current };
    readRef.current = operation;
    setReading(true);
    try {
      const data = await request("/api/external-memory/connections");
      if (!isCurrent() || version !== readVersion.current) return false;
      const nextConnections = connectionList(data);
      setConnections(nextConnections);
      setDrafts(current => {
        const next = { ...current };
        for (const type of Object.keys(CONNECTION_TYPES)) {
          if (edits[type] === 0 && editVersions.current[type] === 0) next[type] = draftFromConnection(type, nextConnections[type]);
        }
        return next;
      });
      setLoaded(true);
      setFeedback(current => { const next = { ...current }; delete next.general; return next; });
      return true;
    } catch (error) {
      if (isCurrent() && version === readVersion.current) setFeedback(current => ({ ...current, general: { kind: "error", message: memoryUiFailure(error) } }));
      return false;
    } finally {
      if (isCurrent() && readRef.current === operation) { readRef.current = null; setReading(false); }
    }
  }, [request, isCurrent]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  const configuredCount = useMemo(() => Object.values(connections).filter(Boolean).length, [connections]);

  function updateDraft(connectionType, field, value) {
    editVersions.current[connectionType] += 1;
    setDrafts(current => ({ ...current, [connectionType]: { ...current[connectionType], [field]: value } }));
    setFeedback(current => { const next = { ...current }; delete next[connectionType]; return next; });
  }

  function setTypeFeedback(connectionType, message, kind = "success") {
    setFeedback(current => ({ ...current, [connectionType]: { kind, message } }));
  }

  function beginAction(connectionType, action) {
    if (actionRef.current || !isCurrent()) return null;
    const operation = { connectionType, editVersion: editVersions.current[connectionType] };
    actionRef.current = operation;
    // A pending list response predates the mutation and must not restore its old connection.
    readVersion.current += 1;
    setBusy(action + "-" + connectionType);
    setTypeFeedback(connectionType, "");
    return operation;
  }

  const actionCurrent = operation => isCurrent() && actionRef.current === operation;
  function finishAction(operation) {
    if (actionCurrent(operation)) { actionRef.current = null; setBusy(""); }
  }
  function actionError(operation, error, mutation = false) {
    if (actionCurrent(operation)) setTypeFeedback(operation.connectionType, memoryUiFailure(error, { mutation }), "error");
  }

  async function testDraft(connectionType) {
    const operation = beginAction(connectionType, "draft-test");
    if (!operation) return;
    const payload = { connection_type: connectionType, ...payloadFor(connectionType, drafts[connectionType]) };
    try {
      const data = await request("/api/external-memory/connections/test", { method: "POST", body: payload });
      if (actionCurrent(operation)) setTypeFeedback(connectionType, safeTestSummary(connectionType, data) + (operation.editVersion === editVersions.current[connectionType] ? "" : " 检测的是提交时的填写，当前新输入尚未检测。"));
    } catch (error) { actionError(operation, error); }
    finally { finishAction(operation); }
  }

  async function saveConnection(connectionType) {
    const operation = beginAction(connectionType, "save");
    if (!operation) return;
    const submitted = drafts[connectionType];
    try {
      const data = await request("/api/external-memory/connections/" + connectionType, { method: "PUT", body: payloadFor(connectionType, submitted) });
      if (!actionCurrent(operation)) return;
      const connection = responseConnection(data, connectionType);
      setConnections(current => ({ ...current, [connectionType]: connection }));
      const draftUnchanged = operation.editVersion === editVersions.current[connectionType];
      setDrafts(current => ({ ...current, [connectionType]: draftUnchanged
        ? draftFromConnection(connectionType, connection)
        : { ...current[connectionType], ...(current[connectionType].credential === submitted.credential ? { credential: "" } : {}) } }));
      if (connectionType === "supabase_memory") setSupabasePreview(null);
      if (draftUnchanged) editVersions.current[connectionType] = 0;
      setTypeFeedback(connectionType, "连接已按当前账号加密保存，旧凭据不会显示在页面；实际聊天召回仍待验证。" + (draftUnchanged ? "" : " 等待期间的新输入已保留，尚未保存。"));
    } catch (error) { actionError(operation, error, true); }
    finally { finishAction(operation); }
  }

  async function testSaved(connectionType) {
    const operation = beginAction(connectionType, "saved-test");
    if (!operation) return;
    try {
      const data = await request("/api/external-memory/connections/" + connectionType + "/test", { method: "POST" });
      if (!actionCurrent(operation)) return;
      const summary = safeTestSummary(connectionType, data);
      setConnections(current => ({ ...current, [connectionType]: { ...current[connectionType], last_status: "connected", ...(connectionType === "ombre_brain_mcp" ? { read_tools: data.result.read_tools } : {}) } }));
      setTypeFeedback(connectionType, summary);
    } catch (error) { actionError(operation, error); }
    finally { finishAction(operation); }
  }

  async function removeConnection(connectionType) {
    if (actionRef.current || !isCurrent() || !window.confirm("移除“" + CONNECTION_TYPES[connectionType].label + "”连接及后端保存的加密凭据？外部数据库中的原始数据不会被删除。")) return;
    const operation = beginAction(connectionType, "remove");
    if (!operation) return;
    try {
      const data = await request("/api/external-memory/connections/" + connectionType, { method: "DELETE" });
      if (!actionCurrent(operation)) return;
      if (data?.ok !== true || data.deleted !== true || data.connection_type !== connectionType) throw invalidMemoryReceipt();
      setConnections(current => { const next = { ...current }; delete next[connectionType]; return next; });
      const draftUnchanged = operation.editVersion === editVersions.current[connectionType];
      if (draftUnchanged) {
        setDrafts(current => ({ ...current, [connectionType]: emptyDraft(connectionType) }));
        editVersions.current[connectionType] = 0;
      }
      if (connectionType === "supabase_memory") setSupabasePreview(null);
      setTypeFeedback(connectionType, "连接和加密凭据已移除；你的外部数据库内容没有被删除。" + (draftUnchanged ? "" : " 等待期间的新输入已保留，尚未保存。"));
    } catch (error) { actionError(operation, error, true); }
    finally { finishAction(operation); }
  }

  async function previewSupabaseMemory() {
    const operation = beginAction("supabase_memory", "preview");
    if (!operation) return;
    try {
      const data = await request("/api/external-memory/connections/supabase_memory/preview?limit=20");
      if (!actionCurrent(operation)) return;
      const result = data?.result;
      if (data?.ok !== true || result?.connection_type !== "supabase_memory" || result.read_only !== true || !Array.isArray(data.items) || !memoryCount(data.total) || !data.items.every(item => item && typeof item.id === "string" && typeof item.summary === "string")) throw invalidMemoryReceipt();
      setSupabasePreview({ items: data.items, total: data.total });
      setTypeFeedback("supabase_memory", "只读预览成功，共发现 " + data.total + " 条可导入记忆；尚未复制任何数据。");
    } catch (error) { actionError(operation, error); }
    finally { finishAction(operation); }
  }

  async function importSupabaseMemory() {
    if (actionRef.current || !isCurrent() || !window.confirm("把最多 100 条预览合格的外部记忆复制到当前 DengTa 账号？重复导入会幂等更新，不会修改 Supabase 外库，也不会建立自动双向同步。")) return;
    const operation = beginAction("supabase_memory", "import");
    if (!operation) return;
    try {
      const data = await request("/api/external-memory/connections/supabase_memory/import", { method: "POST", body: { limit: 100 } });
      if (!actionCurrent(operation)) return;
      const result = data?.result;
      if (data?.ok !== true || result?.connection_type !== "supabase_memory" || result.read_only_source !== true || !memoryCount(result.skipped) || !memoryCount(result.total)) throw invalidMemoryReceipt();
      if (result.count_mode === "synchronized") {
        if (!memoryCount(result.synchronized)) throw invalidMemoryReceipt();
        setTypeFeedback("supabase_memory", "同步完成：已同步 " + result.synchronized + " 条（新增与更新合并计数；重复导入会覆盖更新，不会重复新增）。外部 Supabase 未被写入。");
      } else {
        if (!memoryCount(result.imported) || !memoryCount(result.updated)) throw invalidMemoryReceipt();
        setTypeFeedback("supabase_memory", "导入完成：新增 " + result.imported + " 条，更新 " + result.updated + " 条，跳过 " + result.skipped + " 条，共检查 " + result.total + " 条。外部 Supabase 未被写入。");
      }
      window.dispatchEvent(new CustomEvent("dengta:memories-imported"));
    } catch (error) { actionError(operation, error, true); }
    finally { finishAction(operation); }
  }

  return (
    <section
      id="external-memory-connections"
      className="settings-card external-memory-connections"
      aria-labelledby="external-memory-title"
    >
      <div className="external-memory-heading">
        <div>
          <span className="eyebrow">BYO MEMORY</span>
          <h3 id="external-memory-title">连接你自己的记忆数据库</h3>
          <p className="card-hint">
            这是可选的外部记忆源，不会替换 DengTa 登录、聊天记录或主 Supabase
            数据库。每个 DengTa 账号分别保存自己的连接。
          </p>
        </div>
        <span
          className={`status-chip ${configuredCount ? "online" : "pending"}`}
        >
          {reading ? "读取中" : loaded ? `${configuredCount} 个已配置` : "尚未读取成功"}
        </span>
        <button type="button" className="secondary-button" disabled={reading || Boolean(busy)} onClick={() => void loadConnections()}>
          {reading ? "读取中…" : "重新读取连接"}
        </button>
      </div>

      <div className="external-memory-security" role="note">
        <strong>凭据不会回显 · Credentials stay hidden</strong>
        <p>
          密钥只发送给 DengTa
          后端，并按当前账号加密保存；页面和接口不会返回旧密钥或密文。更新时留空会保留已保存值，只有轮换或迁移后无法解密时才重新填写。
        </p>
        <p>
          Supabase 仅接受 publishable/anon
          公钥并只读固定专用表；公钥本身不是私密授权。如果专用表允许 anon
          SELECT，同项目的其他匿名客户端也可能读取。请只使用专用项目、配置最小
          SELECT RLS，且不要放入敏感记忆；禁止填写
          service_role、数据库密码，也不支持任意 SQL。
        </p>
      </div>

      {feedback.general && (
        <div className="external-memory-feedback error" role="alert">
          {feedback.general.message}
        </div>
      )}

      <div className="external-memory-grid">
        {Object.entries(CONNECTION_TYPES).map(
          ([connectionType, definition]) => {
            const connection = connections[connectionType] || null;
            const draft = drafts[connectionType];
            const typeBusy = busy.endsWith(connectionType);
            const saveReady = requiredFieldsReady(
              connectionType,
              draft,
              connection
            );
            const draftTestReady = requiredFieldsReady(
              connectionType,
              draft,
              null
            );
            const needsCredential =
              !connection?.credential_configured ||
              connection?.credential_reentry_required;
            const expanded = expandedTypes[connectionType] === true;
            return (
              <article className="external-memory-card" key={connectionType}>
                <div className="external-memory-card-heading">
                  <div>
                    <h4>{definition.label}</h4>
                    <p>{definition.description}</p>
                  </div>
                  <span className={`status-chip ${statusClass(connection)}`}>
                    {statusLabel(connection)}
                  </span>
                </div>

                <button
                  type="button"
                  className="external-memory-expand secondary-button"
                  aria-expanded={expanded}
                  aria-controls={`external-memory-form-${connectionType}`}
                  onClick={() =>
                    setExpandedTypes((current) => ({
                      ...current,
                      [connectionType]: !expanded,
                    }))
                  }
                >
                  {expanded
                    ? "收起高级连接设置"
                    : connection
                    ? `管理${definition.label}（可选）`
                    : connectionType === "supabase_memory"
                    ? "新建自己的 Supabase 记忆连接（可选）"
                    : "连接自己的 Ombre Brain（可选）"}
                </button>

                {expanded && (
                  <div
                    id={`external-memory-form-${connectionType}`}
                    className="external-memory-form-panel"
                  >
                    {connection?.credential_reentry_required && (
                      <div className="external-memory-recovery" role="note">
                        <strong>保存的凭据无法由当前后端解密</strong>
                        <p>
                          重新填写密钥并保存即可恢复连接；数据库中的原始记忆不会因此丢失
                          / Re-enter the credential and save. Your source data
                          remains untouched.
                        </p>
                      </div>
                    )}

                    <div className="external-memory-fields">
                      <label>
                        显示名称
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            updateDraft(
                              connectionType,
                              "name",
                              event.target.value
                            )
                          }
                          autoComplete="off"
                        />
                      </label>

                      {connectionType === "supabase_memory" ? (
                        <>
                          <label>
                            Supabase Project URL
                            <input
                              type="url"
                              inputMode="url"
                              value={draft.project_url}
                              onChange={(event) =>
                                updateDraft(
                                  connectionType,
                                  "project_url",
                                  event.target.value
                                )
                              }
                              placeholder="https://your-project.onrender.com/mcp"
                              autoCapitalize="none"
                              spellCheck="false"
                            />
                          </label>
                          <label>
                            固定只读专用表
                            <input
                              value="dengta_memories"
                              readOnly
                              aria-readonly="true"
                            />
                            <small>
                              DengTa
                              只读取这个固定专用表。请仅在专用项目中使用，并配置最小
                              SELECT RLS policy；允许 anon SELECT
                              的内容也可能被同项目其他匿名客户端读取，请勿放入敏感记忆。
                            </small>
                          </label>
                          <label>
                            Publishable / anon public key
                            <input
                              type="password"
                              value={draft.credential}
                              onChange={(event) =>
                                updateDraft(
                                  connectionType,
                                  "credential",
                                  event.target.value
                                )
                              }
                              placeholder={
                                needsCredential
                                  ? "必填；不要填写 service_role"
                                  : "已加密保存；留空保留旧值"
                              }
                              autoComplete="new-password"
                              spellCheck="false"
                            />
                            <small>
                              公钥只限制权限范围，不保证数据私密。更私密的连接应使用可撤销只读
                              Token 或 Edge Function；当前 MVP
                              暂不支持这两种方式。
                            </small>
                          </label>
                        </>
                      ) : (
                        <>
                          <label>
                            完整 HTTPS MCP 地址
                            <input
                              type="url"
                              inputMode="url"
                              value={draft.endpoint}
                              onChange={(event) =>
                                updateDraft(
                                  connectionType,
                                  "endpoint",
                                  event.target.value
                                )
                              }
                              placeholder="https://你的-ombre.example.com/mcp"
                              autoCapitalize="none"
                              spellCheck="false"
                            />
                          </label>
                          <label>
                            Bearer Token
                            <input
                              type="password"
                              value={draft.credential}
                              onChange={(event) =>
                                updateDraft(
                                  connectionType,
                                  "credential",
                                  event.target.value
                                )
                              }
                              placeholder={
                                needsCredential
                                  ? "填写 Ombre Brain 访问令牌"
                                  : "已加密保存；留空保留旧值"
                              }
                              autoComplete="new-password"
                              spellCheck="false"
                            />
                          </label>
                        </>
                      )}

                      <label className="external-memory-enable">
                        <input
                          type="checkbox"
                          checked={draft.enabled !== false}
                          onChange={(event) =>
                            updateDraft(
                              connectionType,
                              "enabled",
                              event.target.checked
                            )
                          }
                        />
                        <span>
                          <strong>启用此连接</strong>
                          <small>关闭后保留配置，但不会读取它的记忆。</small>
                        </span>
                      </label>
                    </div>

                    {feedback[connectionType]?.message && (
                      <div
                        className={`external-memory-feedback ${feedback[connectionType].kind}`}
                        role={
                          feedback[connectionType].kind === "error"
                            ? "alert"
                            : "status"
                        }
                      >
                        {feedback[connectionType].message}
                      </div>
                    )}

                    <div className="external-memory-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={Boolean(busy) || !loaded || !draftTestReady}
                        onClick={() => testDraft(connectionType)}
                      >
                        {busy === `draft-test-${connectionType}`
                          ? "测试中…"
                          : "测试当前填写（不保存）"}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={Boolean(busy) || !loaded || !saveReady}
                        onClick={() => saveConnection(connectionType)}
                      >
                        {busy === `save-${connectionType}`
                          ? "保存中…"
                          : "加密保存"}
                      </button>
                      {connection && (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={Boolean(busy) || !loaded}
                            onClick={() => testSaved(connectionType)}
                          >
                            {busy === `saved-test-${connectionType}`
                              ? "测试中…"
                              : "测试已保存连接"}
                          </button>
                          {connectionType === "supabase_memory" && (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={
                                  Boolean(busy) || !loaded || connection.enabled === false
                                }
                                onClick={previewSupabaseMemory}
                              >
                                {busy === "preview-supabase_memory"
                                  ? "预览中…"
                                  : "只读预览"}
                              </button>
                              <button
                                type="button"
                                className="primary-button"
                                disabled={
                                  Boolean(busy) || !loaded ||
                                  connection.enabled === false ||
                                  connection.last_status !== "connected"
                                }
                                onClick={importSupabaseMemory}
                              >
                                {busy === "import-supabase_memory"
                                  ? "导入中…"
                                  : "导入当前账号"}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="danger-outline-button"
                            disabled={Boolean(busy) || !loaded}
                            onClick={() => removeConnection(connectionType)}
                          >
                            {busy === `remove-${connectionType}`
                              ? "移除中…"
                              : "移除连接"}
                          </button>
                        </>
                      )}
                    </div>
                    {connectionType === "supabase_memory" &&
                      supabasePreview && (
                        <div className="external-memory-preview">
                          <div>
                            <strong>
                              只读预览 · {supabasePreview.total} 条
                            </strong>
                            <small>
                              这里只显示摘要预览；点击导入才会显式复制到当前
                              DengTa 账号，之后不会自动双向同步。
                            </small>
                          </div>
                          {supabasePreview.items.length === 0 ? (
                                <p>固定专用表中暂时没有可导入的记忆。</p>
                          ) : (
                            <ul>
                              {supabasePreview.items
                                .slice(0, 5)
                                .map((item, index) => (
                                  <li key={String(item.id || index)}>
                                    <span>
                                      {String(item.summary || "无摘要").slice(
                                        0,
                                        180
                                      )}
                                    </span>
                                    {item.updated_at && (
                                      <time dateTime={item.updated_at}>
                                        {Number.isNaN(new Date(item.updated_at).getTime()) ? "时间未知" : new Date(item.updated_at).toLocaleString("zh-CN")}
                                      </time>
                                    )}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </div>
                      )}
                    {typeBusy && <span className="sr-only">正在处理连接</span>}
                  </div>
                )}
              </article>
            );
          }
        )}
      </div>
    </section>
  );
}

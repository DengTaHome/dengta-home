import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { invalidMemoryReceipt, memoryUiFailure } from "./memory-ui-feedback.js";
import { createOmbreMemoryReads } from "./ombre-memory-read.js";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "dynamic", label: "动态", type: "dynamic" },
  { key: "permanent", label: "永久", type: "permanent" },
  { key: "archived", label: "归档", type: "archived" },
  { key: "pinned", label: "已固定", state: "pinned" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function typeLabel(type) {
  const labels = {
    dynamic: "动态",
    permanent: "永久",
    archived: "归档",
    archive: "归档",
  };
  return labels[String(type || "").toLowerCase()] || type || "记忆";
}

export default function OmbreMemories({ onManageConnections }) {
  const snapshot = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot, authSession.getSnapshot);
  const scopeKey = settingsSaveScope(snapshot);
  return <ScopedOmbreMemories key={scopeKey} scopeKey={scopeKey} onManageConnections={onManageConnections} />;
}

function ScopedOmbreMemories({ scopeKey, onManageConnections }) {
  const reads = useMemo(() => createOmbreMemoryReads(scopeKey), [scopeKey]);
  useLayoutEffect(() => reads.mount(), [reads]);
  const [connection, setConnection] = useState(null);
  const [mcpConnection, setMcpConnection] = useState(null);
  const [accountOmbreConnection, setAccountOmbreConnection] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [semanticSearch, setSemanticSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [error, setError] = useState("");

  const loadItems = useCallback(async (nextFilter = "all", query = "") => {
    const operation = reads.start("list");
    if (!reads.current(operation)) return;
    setLoading(true);
    setItems([]);
    setError("");
    try {
      let data;
      if (query) {
        data = await reads.request(operation,
          `/api/ombre/search?q=${encodeURIComponent(query)}`,
        );
      } else {
        const selectedFilter =
          FILTERS.find((item) => item.key === nextFilter) || FILTERS[0];
        const params = new URLSearchParams();
        if (selectedFilter.type) params.set("type", selectedFilter.type);
        if (selectedFilter.state) params.set("state", selectedFilter.state);
        const suffix = params.toString() ? `?${params.toString()}` : "";
        data = await reads.request(operation, `/api/ombre/buckets${suffix}`);
      }
      if (!reads.current(operation)) return;
      if (!Array.isArray(data?.items)) throw invalidMemoryReceipt();
      setItems(data.items);
      setSemanticSearch(data.semanticSearch || "");
    } catch (loadError) {
      if (!reads.current(operation)) return;
      setError(memoryUiFailure(loadError));
    } finally {
      if (reads.current(operation)) setLoading(false);
    }
  }, [reads]);

  const loadConnection = useCallback(async () => {
      const operation = reads.start("connection");
      const apiRequest = path => reads.request(operation, path);
      reads.cancel("list");
      reads.cancel("detail");
      setSelected(null);
      setFilter("all");
      setSearch("");
      setActiveQuery("");
      setConnectionLoading(true);
      setLoading(true);
      setError("");
      if (!reads.current(operation)) { setConnectionLoading(false); setLoading(false); return; }
      try {
        const [config, accountConnections] = await Promise.all([
          apiRequest("/api/ombre/config"),
          apiRequest("/api/external-memory/connections").catch(() => ({
            connections: [],
          })),
        ]);
        if (!reads.current(operation)) return;
        if (typeof config?.configured !== "boolean") throw invalidMemoryReceipt();
        const accountOmbre = (accountConnections.connections || []).find(
          (item) =>
            String(item.connection_type || item.type || "") ===
            "ombre_brain_mcp",
        );
        setAccountOmbreConnection(accountOmbre || null);
        const mcpStatus = accountOmbre
          ? {
              configured: true,
              available: accountOmbre.last_status === "connected",
              auth_configured: accountOmbre.credential_configured === true,
              message:
                (accountOmbre.last_status === "connected"
                  ? "当前账号的 Ombre Brain 已接入聊天记忆"
                  : "当前账号的 Ombre Brain 已保存，等待连接测试"),
              tools: accountOmbre.tools || [],
            }
          : await apiRequest("/api/ombre/mcp/status").catch(
              (mcpError) => ({
                ...(config.mcp || {}),
                available: false,
                message: memoryUiFailure(mcpError),
                tools: [],
              }),
            );
        if (!reads.current(operation)) return;
        setMcpConnection({ ...(config.mcp || {}), ...mcpStatus, message: mcpStatus.available ? "" : "服务器已填写，但握手暂时失败，请重新读取连接。" });
        if (!config.configured) {
          setConnection({
            ...config,
            available: false,
            total: 0,
            message: "尚未连接记忆服务器",
          });
          setLoading(false);
          return;
        }
        const status = await apiRequest("/api/ombre/status");
        if (!reads.current(operation)) return;
        if (typeof status?.configured !== "boolean" || typeof status?.available !== "boolean") throw invalidMemoryReceipt();
        setConnection({ ...status, message: status.available ? "" : "外部记忆服务暂时不可用，请重新读取连接。" });
        setConnectionLoading(false);
        if (status.available) await loadItems();
        else setLoading(false);
      } catch (connectionError) {
        if (reads.current(operation)) {
          setConnection((current) => ({
            ...(current || {}),
            configured: true,
            available: false,
            total: 0,
            message: memoryUiFailure(connectionError),
          }));
          setLoading(false);
        }
      } finally {
        if (reads.current(operation)) {
          setConnectionLoading(false);
          reads.cancel("connection");
        }
      }
  }, [loadItems, reads]);

  useEffect(() => { loadConnection(); }, [loadConnection]);

  function closeDetail() {
    reads.cancel("detail");
    setSelected(null);
    setDetailLoading(false);
    setDetailError("");
  }

  async function selectFilter(nextFilter) {
    closeDetail();
    setFilter(nextFilter);
    setSearch("");
    setActiveQuery("");
    if (connection?.available) await loadItems(nextFilter, "");
  }

  async function submitSearch(event) {
    event.preventDefault();
    closeDetail();
    const query = search.trim();
    setActiveQuery(query);
    if (connection?.available) await loadItems(filter, query);
  }

  async function openDetail(item) {
    const operation = reads.start("detail");
    if (!reads.current(operation)) return;
    setDetailLoading(true);
    setDetailError("");
    setSelected(item);
    try {
      const detail = await reads.request(operation,
        `/api/ombre/buckets/${encodeURIComponent(item.id)}`,
      );
      if (!reads.current(operation)) return;
      if (detail?.id !== item.id || typeof detail.name !== "string") throw invalidMemoryReceipt();
      setSelected(detail);
    } catch (detailError) {
      if (reads.current(operation)) setDetailError(memoryUiFailure(detailError));
    } finally {
      if (reads.current(operation)) setDetailLoading(false);
    }
  }

  const statusClass = connection?.available
    ? "connected"
    : connection?.configured
      ? "unavailable"
      : "unconfigured";
  const mcpStatusClass = mcpConnection?.available
    ? "connected"
    : mcpConnection?.configured
      ? "unavailable"
      : mcpConnection
        ? "unconfigured"
        : "checking";
  const mcpTools = Array.isArray(mcpConnection?.tools)
    ? mcpConnection.tools.slice(0, 6)
    : [];

  if (!connectionLoading && connection && !connection.configured && !accountOmbreConnection) {
    return (
      <section
        className="ombre-optional-entry"
        aria-labelledby="external-memory-optional-title"
      >
        <div>
          <span className="eyebrow">DENGTA MEMORY</span>
          <strong id="external-memory-optional-title">
            DengTa 主记忆库已启用
          </strong>
          <p>
            新账号默认使用 DengTa 的 Supabase
            保存长期记忆，不需要填写任何外部数据库，聊天和记忆功能都可正常使用。
          </p>
        </div>
        {typeof onManageConnections === "function" && (
          <button type="button" onClick={onManageConnections}>
            连接自己的外部记忆库（可选）
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="ombre-memory-section" aria-labelledby="ombre-title">
      <div className="memory-source-heading">
        <div>
          <span className="eyebrow">OMBRE BRAIN</span>
          <h3 id="ombre-title">外部记忆库</h3>
        </div>
        <div className={`ombre-status ${statusClass}`}>
          <span aria-hidden="true" />
          {connection?.available
            ? `${connection.total || 0} 条记忆`
            : connection?.configured
              ? "连接不可用"
              : "未连接服务器"}
        </div>
        <button type="button" onClick={loadConnection}>重新读取连接</button>
      </div>

      <div className={`ombre-mcp-strip ${mcpStatusClass}`}>
        <span className="ombre-mcp-dot" aria-hidden="true" />
        <div>
          <strong>MCP 记忆协议</strong>
          <small>
            {mcpConnection?.available
              ? `已握手${mcpTools.length ? ` · ${mcpTools.join(" / ")}` : ""}`
              : mcpConnection?.configured
                ? mcpConnection.message || "服务器已填写，但握手暂时失败"
                : mcpConnection
                  ? "客户端已准备，等待 OMBRE_BRAIN_URL"
                  : "正在检查 MCP 客户端…"}
          </small>
        </div>
        {typeof onManageConnections === "function" && (
          <button type="button" onClick={onManageConnections}>
            管理我的连接
          </button>
        )}
      </div>

      {connectionLoading ? (
        <div className="ombre-list-placeholder" role="status">正在读取外部记忆连接…</div>
      ) : !connection?.configured ? (
        <div className="ombre-empty-state">
          <strong>
            {accountOmbreConnection
              ? "Ombre Brain 已接入当前账号"
              : "还没有可读取的外部记忆"}
          </strong>
          {accountOmbreConnection ? (
            <p>
              MCP
              只读工具已提供给当前账号的聊天运行时；本页档案列表只显示已显式导入
              DengTa 的摘要，不会把 Ombre 数据自动复制或双向同步。
            </p>
          ) : (
            <p>
              可以连接当前账号自己的 Ombre Brain MCP，或从自己的 Supabase
              专用只读表预览并显式导入；这不会替换 DengTa 的登录数据库。
            </p>
          )}
          {typeof onManageConnections === "function" ? (
            <button type="button" onClick={onManageConnections}>
              设置外部记忆连接
            </button>
          ) : (
            <code>OMBRE_BRAIN_URL</code>
          )}
        </div>
      ) : !connection?.available ? (
        <div className="ombre-empty-state error-state">
          <strong>暂时无法读取外部记忆</strong>
          <p>{connection?.message || "请稍后重试。"}</p>
        </div>
      ) : (
        <>
          <form className="ombre-toolbar" onSubmit={submitSearch}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索外部记忆"
              aria-label="搜索外部记忆"
            />
            <button type="submit">搜索</button>
            <button type="button" onClick={() => loadItems(filter, activeQuery)}>重新读取记忆</button>
          </form>
          <div className="ombre-filters" aria-label="记忆筛选">
            {FILTERS.map((item) => (
              <button
                type="button"
                className={filter === item.key && !activeQuery ? "active" : ""}
                key={item.key}
                onClick={() => selectFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {activeQuery && (
            <div className="ombre-search-summary">
              <span>“{activeQuery}” · {items.length} 条</span>
              {semanticSearch && semanticSearch !== "enabled" && (
                <span>语义检索：{semanticSearch}</span>
              )}
            </div>
          )}
          {error && <div className="ombre-inline-error">{error}</div>}
          <div className="ombre-memory-list">
            {loading ? (
              <div className="ombre-list-placeholder">正在读取记忆…</div>
            ) : error ? (
              <div className="ombre-list-placeholder">本次读取未完成，请重新读取记忆。</div>
            ) : items.length === 0 ? (
              <div className="ombre-list-placeholder">这里还没有记忆。</div>
            ) : (
              items.map((item) => (
                <button
                  type="button"
                  className="ombre-memory-item"
                  key={item.id}
                  onClick={() => openDetail(item)}
                >
                  <span className="ombre-item-topline">
                    <strong>{item.name}</strong>
                    <span>{typeLabel(item.type)}</span>
                  </span>
                  <span className="ombre-item-preview">
                    {item.contentPreview || "暂无预览"}
                  </span>
                  <span className="ombre-item-meta">
                    <span>重要度 {item.importance ?? 5}</span>
                    <span>{formatDate(item.lastActiveAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {selected && (
        <div className="ombre-detail-backdrop" onMouseDown={closeDetail}>
          <article
            className="ombre-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ombre-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="ombre-detail-close"
              aria-label="关闭记忆详情"
              onClick={closeDetail}
            >
              ×
            </button>
            <span className="eyebrow">{typeLabel(selected.type)}</span>
            <h3 id="ombre-detail-title">{selected.name}</h3>
            {detailLoading ? (
              <p className="ombre-detail-loading">正在读取完整内容…</p>
            ) : detailError ? (
              <div role="alert">
                <p>{detailError}</p>
                <button type="button" onClick={() => openDetail(selected)}>重新读取详情</button>
              </div>
            ) : (
              <>
                <div className="ombre-detail-meta">
                  <span>重要度 {selected.importance ?? 5}</span>
                  {selected.score !== null && selected.score !== undefined && (
                    <span>得分 {Number(selected.score).toFixed(3)}</span>
                  )}
                  <span>{formatDate(selected.lastActiveAt)}</span>
                </div>
                <div className="ombre-detail-content">
                  {selected.displayContent || selected.content || "暂无正文"}
                </div>
                {selected.tags?.length > 0 && (
                  <div className="ombre-detail-tags">
                    {selected.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

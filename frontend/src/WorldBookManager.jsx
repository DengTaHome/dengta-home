import { useCallback, useEffect, useState } from "react";
import {
  createWorldBookEntry,
  deleteWorldBookEntry,
  listWorldBookEntries,
  reorderWorldBookEntries,
  updateWorldBookEntry,
} from "./world-book-api.js";

const PAGE_SIZE = 20;

function emptyEntry(sortOrder = 0) {
  return {
    title: "",
    content: "",
    keywords: [],
    enabled: true,
    priority: 100,
    constant: false,
    match_mode: "any",
    case_sensitive: false,
    position: "dynamic_context",
    sort_order: sortOrder,
  };
}

function normalizeEntry(entry = {}) {
  return {
    ...emptyEntry(),
    ...entry,
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
  };
}

function collectionOf(data) {
  const entries = data?.entries ?? data?.result?.entries ?? data?.items ?? data?.result?.items;
  return Array.isArray(entries) ? entries.map(normalizeEntry) : [];
}

function paginationOf(data, entries) {
  const pagination = data?.pagination ?? data?.result?.pagination ?? {};
  return {
    total: Number(pagination.total ?? entries.length),
    limit: Number(pagination.limit ?? PAGE_SIZE),
    offset: Number(pagination.offset ?? 0),
  };
}

function payloadOf(entry) {
  return {
    title: String(entry.title || "").trim(),
    content: String(entry.content || "").trim(),
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    enabled: Boolean(entry.enabled),
    priority: Number(entry.priority),
    constant: Boolean(entry.constant),
    match_mode: entry.match_mode,
    case_sensitive: Boolean(entry.case_sensitive),
    position: entry.position,
    sort_order: Number(entry.sort_order),
  };
}

function EntryEditor({ entry, busy, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => normalizeEntry(entry));

  function patch(value) {
    setDraft((current) => ({ ...current, ...value }));
  }

  return (
    <form className="world-book-editor settings-card" onSubmit={(event) => { event.preventDefault(); void onSave(payloadOf(draft)); }}>
      <div className="world-book-section-heading"><div><span className="eyebrow">条目书页</span><h4>{entry.id ? "编辑世界书" : "写下新条目"}</h4></div><button type="button" onClick={onCancel}>取消</button></div>
      <div className="world-book-form-grid">
        <label><span>标题</span><input aria-label="世界书标题" value={draft.title} maxLength={240} onChange={(event) => patch({ title: event.target.value })} /></label>
        <label><span>关键词</span><input aria-label="世界书关键词" value={draft.keywords.join(", ")} onChange={(event) => patch({ keywords: event.target.value.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean) })} placeholder="多个关键词用逗号分隔" /></label>
        <label><span>优先级</span><input aria-label="世界书优先级" type="number" min="-100000" max="100000" value={draft.priority} onChange={(event) => patch({ priority: event.target.value })} /></label>
        <label><span>排序值</span><input aria-label="世界书排序值" type="number" value={draft.sort_order} onChange={(event) => patch({ sort_order: event.target.value })} /></label>
        <label><span>匹配方式</span><select aria-label="世界书匹配方式" value={draft.match_mode} onChange={(event) => patch({ match_mode: event.target.value })}><option value="any">命中任一关键词</option><option value="all">命中全部关键词</option></select></label>
        <label><span>上下文位置</span><select aria-label="世界书上下文位置" value={draft.position} onChange={(event) => patch({ position: event.target.value })}><option value="dynamic_context">动态本轮背景</option><option value="before_memory">稳定记忆之前</option></select></label>
      </div>
      <label><span>正文</span><textarea aria-label="世界书正文" rows={8} required value={draft.content} onChange={(event) => patch({ content: event.target.value })} /></label>
      <div className="world-book-switches">
        <label><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span>启用条目</span></label>
        <label><input type="checkbox" checked={draft.constant} onChange={(event) => patch({ constant: event.target.checked })} /><span>常驻上下文</span></label>
        <label><input type="checkbox" checked={draft.case_sensitive} onChange={(event) => patch({ case_sensitive: event.target.checked })} /><span>区分大小写</span></label>
      </div>
      <button className="content-import-primary" type="submit" disabled={Boolean(busy) || !String(draft.content).trim()}>{busy ? "正在保存…" : "保存条目"}</button>
    </form>
  );
}

export default function WorldBookManager({ api }) {
  const client = api || undefined;
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, limit: PAGE_SIZE, offset: 0 });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [enabled, setEnabled] = useState("");
  const [constant, setConstant] = useState("");
  const [position, setPosition] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const hasFilters = Boolean(search || enabled || constant || position);

  const loadEntries = useCallback(async (offset = 0) => {
    setBusy("load");
    setError("");
    try {
      const data = await listWorldBookEntries({
        search,
        enabled: enabled === "" ? undefined : enabled === "true",
        constant: constant === "" ? undefined : constant === "true",
        position: position || undefined,
        limit: PAGE_SIZE,
        offset,
      }, client);
      const nextEntries = collectionOf(data);
      setEntries(nextEntries);
      setPagination(paginationOf(data, nextEntries));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setBusy("");
    }
  }, [client, constant, enabled, position, search]);

  useEffect(() => {
    void Promise.resolve().then(() => loadEntries(0));
  }, [loadEntries]);

  async function saveEntry(payload) {
    setBusy("save");
    setError("");
    try {
      if (editing?.id) await updateWorldBookEntry(editing.id, payload, client);
      else await createWorldBookEntry(payload, client);
      setEditing(null);
      setNotice(editing?.id ? "世界书条目已更新。" : "世界书条目已创建。");
      window.dispatchEvent(new CustomEvent("dengta:world-book-updated"));
      await loadEntries(editing?.id ? pagination.offset : 0);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function duplicateEntry(entry) {
    setBusy(entry.id);
    setError("");
    setNotice("");
    try {
      await createWorldBookEntry({
        ...payloadOf(entry),
        title: `${entry.title || "未命名条目"} · 副本`.slice(0, 240),
        enabled: false,
        sort_order: Number(entry.sort_order) + 1,
      }, client);
      setNotice("已创建停用状态的条目副本，确认内容后即可启用。");
      window.dispatchEvent(new CustomEvent("dengta:world-book-updated"));
      await loadEntries(pagination.offset);
    } catch (duplicateError) {
      setError(duplicateError.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleEntry(entry, field) {
    setBusy(entry.id);
    setError("");
    try {
      const data = await updateWorldBookEntry(entry.id, { [field]: !entry[field] }, client);
      const updated = normalizeEntry(data?.entry ?? data?.result?.entry ?? { ...entry, [field]: !entry[field] });
      setEntries((current) => current.map((item) => item.id === entry.id ? updated : item));
      window.dispatchEvent(new CustomEvent("dengta:world-book-updated"));
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusy("");
    }
  }

  async function removeEntry(entry) {
    if (!window.confirm(`删除“${entry.title || "未命名条目"}”？此操作无法撤销。`)) return;
    setBusy(entry.id);
    setError("");
    try {
      await deleteWorldBookEntry(entry.id, client);
      setNotice("世界书条目已删除。");
      window.dispatchEvent(new CustomEvent("dengta:world-book-updated"));
      await loadEntries(entries.length === 1 ? Math.max(0, pagination.offset - PAGE_SIZE) : pagination.offset);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusy("");
    }
  }

  async function moveEntry(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    if (hasFilters || entries[index].priority !== entries[target].priority) return;
    const reordered = [...entries];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setBusy("reorder");
    setError("");
    try {
      const updates = reordered.map((entry, itemIndex) => ({ id: entry.id, sort_order: pagination.offset + itemIndex }));
      await reorderWorldBookEntries(updates, client);
      setEntries(reordered.map((entry, itemIndex) => ({ ...entry, sort_order: pagination.offset + itemIndex })));
    } catch (reorderError) {
      setError(reorderError.message);
    } finally {
      setBusy("");
    }
  }

  if (editing) return <EntryEditor key={editing.id || "new"} entry={editing} busy={busy === "save"} onCancel={() => setEditing(null)} onSave={saveEntry} />;

  const pageStart = pagination.total === 0 ? 0 : pagination.offset + 1;
  const pageEnd = Math.min(pagination.offset + entries.length, pagination.total);
  const pageStats = entries.reduce((stats, entry) => ({
    enabled: stats.enabled + Number(entry.enabled),
    constant: stats.constant + Number(entry.constant),
    keywordDriven: stats.keywordDriven + Number(!entry.constant),
  }), { enabled: 0, constant: 0, keywordDriven: 0 });

  return (
    <section className="world-book-manager" aria-labelledby="world-book-manager-title">
      <div className="world-book-toolbar settings-card">
        <div className="world-book-section-heading"><div><span className="eyebrow">伴侣的世界档案</span><h4 id="world-book-manager-title">世界书条目</h4><p>关键词条目会按优先级和上下文容量动态启用，常驻条目始终参与对话。</p></div><button className="content-import-primary" type="button" onClick={() => setEditing(emptyEntry(pagination.total))}>新建条目</button></div>
        <form className="world-book-filters" onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }}>
          <label><span>搜索</span><input aria-label="搜索世界书" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="标题或正文" /></label>
          <label><span>启用状态</span><select aria-label="筛选启用状态" value={enabled} onChange={(event) => setEnabled(event.target.value)}><option value="">全部</option><option value="true">已启用</option><option value="false">已停用</option></select></label>
          <label><span>常驻状态</span><select aria-label="筛选常驻状态" value={constant} onChange={(event) => setConstant(event.target.value)}><option value="">全部</option><option value="true">常驻</option><option value="false">关键词激活</option></select></label>
          <label><span>上下文位置</span><select aria-label="筛选上下文位置" value={position} onChange={(event) => setPosition(event.target.value)}><option value="">全部</option><option value="dynamic_context">动态本轮背景</option><option value="before_memory">稳定记忆之前</option></select></label>
          <button type="submit">搜索</button>
        </form>
        <div className="world-book-summary" aria-label="当前页世界书统计"><span><strong>{pagination.total}</strong> 条总计</span><span><strong>{pageStats.enabled}</strong> 条启用</span><span><strong>{pageStats.constant}</strong> 条常驻</span><span><strong>{pageStats.keywordDriven}</strong> 条关键词激活</span>{hasFilters && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setEnabled(""); setConstant(""); setPosition(""); }}>清除筛选</button>}</div>
      </div>
      {error && <div className="content-import-error" role="alert">{error}</div>}
      {notice && <div className="content-import-success" role="status">{notice}</div>}
      {busy === "load" && entries.length === 0 ? <div className="content-import-empty">正在翻阅世界书…</div> : entries.length === 0 ? <div className="content-import-empty world-book-empty">没有符合条件的世界书条目。</div> : (
        <div className="world-book-list">{entries.map((entry, index) => (
          <article className={`world-book-entry${entry.enabled ? "" : " is-disabled"}`} key={entry.id}>
            <div className="world-book-entry-head"><div><span className="world-book-order">{pagination.offset + index + 1}</span><h5>{entry.title || "未命名条目"}</h5></div><div className="world-book-badges"><span>{entry.constant ? "常驻" : entry.match_mode === "all" ? "全部匹配" : "任一匹配"}</span><span>{entry.position === "before_memory" ? "记忆之前" : "动态背景"}</span><span>优先级 {entry.priority}</span></div></div>
            <p>{entry.content}</p>
            <div className="world-book-keywords">{entry.keywords.length > 0 ? entry.keywords.map((keyword) => <span key={keyword}>{keyword}</span>) : <em>未设置关键词</em>}</div>
            <div className="world-book-entry-actions"><button type="button" title={hasFilters ? "清除筛选后可调整顺序" : entries[index - 1] && entries[index - 1].priority !== entry.priority ? "不同优先级由优先级数值决定顺序" : "向上移动"} disabled={Boolean(busy) || hasFilters || index === 0 || entries[index - 1]?.priority !== entry.priority} onClick={() => void moveEntry(index, -1)}>上移</button><button type="button" title={hasFilters ? "清除筛选后可调整顺序" : entries[index + 1] && entries[index + 1].priority !== entry.priority ? "不同优先级由优先级数值决定顺序" : "向下移动"} disabled={Boolean(busy) || hasFilters || index === entries.length - 1 || entries[index + 1]?.priority !== entry.priority} onClick={() => void moveEntry(index, 1)}>下移</button><button type="button" disabled={Boolean(busy)} onClick={() => void toggleEntry(entry, "enabled")}>{entry.enabled ? "停用" : "启用"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void toggleEntry(entry, "constant")}>{entry.constant ? "取消常驻" : "设为常驻"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEditing(entry)}>编辑</button><button type="button" disabled={Boolean(busy)} onClick={() => void duplicateEntry(entry)}>复制</button><button className="is-danger" type="button" disabled={Boolean(busy)} onClick={() => void removeEntry(entry)}>删除</button></div>
          </article>
        ))}</div>
      )}
      <nav className="world-book-pagination" aria-label="世界书分页"><span>{pageStart}–{pageEnd} / {pagination.total}</span><button type="button" disabled={pagination.offset === 0 || Boolean(busy)} onClick={() => void loadEntries(Math.max(0, pagination.offset - PAGE_SIZE))}>上一页</button><button type="button" disabled={pagination.offset + pagination.limit >= pagination.total || Boolean(busy)} onClick={() => void loadEntries(pagination.offset + PAGE_SIZE)}>下一页</button></nav>
    </section>
  );
}

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Search, X } from "lucide-react";
import {
  buildSettingsGroups,
  SETTINGS_QUICK_LINKS,
  SETTINGS_QUICK_LINK_LIMIT,
  SETTINGS_STARTER_STEPS,
  normalizeSettingsQuickLinks,
  readSettingsQuickLinks,
  writeSettingsQuickLinks,
} from "./settings-navigation.js";
import "./settings-home.css";

export default function SettingsHome({ categories = [], onSelectCategory, preferenceScope = "" }) {
  const [query, setQuery] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [showQuickEditor, setShowQuickEditor] = useState(false);
  const [quickLinkEdits, setQuickLinkEdits] = useState(null);
  const [quickLinkFeedback, setQuickLinkFeedback] = useState(null);
  const searchRef = useRef(null);
  const guideToggleRef = useRef(null);
  const quickEditRef = useRef(null);
  const currentScopeRef = useRef(preferenceScope);
  const searchId = useId();
  const guideId = useId();
  const quickEditorId = useId();
  const quickLimitId = useId();
  const storedQuickIds = useMemo(() => readSettingsQuickLinks(categories, preferenceScope), [categories, preferenceScope]);
  const quickIds = normalizeSettingsQuickLinks(quickLinkEdits?.scope === preferenceScope ? quickLinkEdits.ids : storedQuickIds, categories);
  const quickIdsRef = useRef(quickIds);
  const quickCategoriesRef = useRef(categories);
  const groups = buildSettingsGroups(categories, query);
  const isSearching = query.trim().length > 0;
  const resultCount = groups.reduce((total, group) => total + group.categories.length, 0);
  const availableIds = new Set(categories.map((category) => category.id));
  const quickLinks = quickIds.map((id) => ({
    categoryId: id,
    label: SETTINGS_QUICK_LINKS.find((link) => link.categoryId === id)?.label || categories.find((category) => category.id === id)?.label,
  })).filter((link) => availableIds.has(link.categoryId));
  const guideSteps = SETTINGS_STARTER_STEPS.filter((step) => availableIds.has(step.categoryId));

  useLayoutEffect(() => {
    currentScopeRef.current = preferenceScope;
    quickIdsRef.current = quickIds;
    quickCategoriesRef.current = categories;
    return () => { currentScopeRef.current = null; };
  }, [preferenceScope, quickIds, categories]);

  function clearSearch() {
    setQuery("");
    searchRef.current?.focus();
  }

  function handleSearchKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape" && query) {
      event.preventDefault();
      clearSearch();
    } else if (event.key === "Enter" && isSearching && resultCount === 1) {
      event.preventDefault();
      onSelectCategory?.(groups[0].categories[0].id, event.currentTarget);
    }
  }

  function handlePanelKeyDown(event, closePanel, toggleRef) {
    if (event.key !== "Escape" || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    closePanel(false);
    toggleRef.current?.focus();
  }

  function saveQuickIds(ids) {
    if (currentScopeRef.current !== preferenceScope) return;
    const saved = writeSettingsQuickLinks(ids, quickCategoriesRef.current, preferenceScope);
    quickIdsRef.current = saved.ids;
    setQuickLinkEdits({ scope: preferenceScope, ids: saved.ids });
    setQuickLinkFeedback({ scope: preferenceScope, message: saved.persisted ? "常用入口已保存。" : "本次已调整；此设备暂时无法保存，重新打开可能恢复默认。" });
  }

  function toggleQuickId(id) {
    if (currentScopeRef.current !== preferenceScope || !quickCategoriesRef.current.some(category => category.id === id)) return;
    const current = quickIdsRef.current;
    const selected = current.includes(id);
    if (!selected && current.length >= SETTINGS_QUICK_LINK_LIMIT) return;
    saveQuickIds(selected ? current.filter(value => value !== id) : [...current, id]);
  }

  return (
    <div className="settings-home">
      <div className="settings-home-search">
        <label htmlFor={searchId}>查找设置</label>
        <div className="settings-home-search-field">
          <Search aria-hidden="true" />
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={query}
            placeholder="试试“记忆”“语音”或“备份”"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {query ? (
            <button type="button" aria-label="清空设置搜索" onClick={clearSearch}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {!isSearching && categories.length > 0 ? (
        <div className="settings-home-shortcuts">
          <div className="settings-home-shortcuts-heading">
            <span>常用入口</span>
            <button ref={quickEditRef} className="settings-home-quick-edit" type="button" aria-expanded={showQuickEditor} aria-controls={quickEditorId} onClick={() => setShowQuickEditor((current) => !current)}>整理常用入口</button>
          </div>
          {quickLinks.length > 0 ? (
            <nav className="settings-home-quick-links" aria-label="常用设置入口">
              {quickLinks.map((link) => (
                <button key={link.categoryId} type="button" data-settings-quick-link={link.categoryId} onClick={event => onSelectCategory?.(link.categoryId, event?.currentTarget)}>
                  {link.label}<ArrowRight aria-hidden="true" />
                </button>
              ))}
            </nav>
          ) : <p className="settings-home-shortcuts-empty">可以在“整理常用入口”中固定需要的设置。</p>}
          {showQuickEditor ? (
            <div id={quickEditorId} className="settings-home-quick-editor" onKeyDown={(event) => handlePanelKeyDown(event, setShowQuickEditor, quickEditRef)}>
              <p>最多固定 {SETTINGS_QUICK_LINK_LIMIT} 个入口，仅保存在此设备的当前账号与伴侣中。</p>
              <p id={quickLimitId} className="settings-home-quick-count" role="status">已固定 {quickIds.length} / {SETTINGS_QUICK_LINK_LIMIT} 个入口{quickIds.length >= SETTINGS_QUICK_LINK_LIMIT ? " · 取消一项后可添加新入口" : ""}</p>
              <div className="settings-home-quick-options" role="group" aria-label="选择常用设置入口" aria-describedby={quickLimitId}>
                {categories.map(({ id, label }) => {
                  const selected = quickIds.includes(id);
                  return <button key={id} type="button" data-settings-quick-toggle={id} aria-pressed={selected} disabled={!selected && quickIds.length >= SETTINGS_QUICK_LINK_LIMIT} onClick={() => toggleQuickId(id)}>
                    <span className="settings-home-quick-check" aria-hidden="true">{selected ? <Check /> : null}</span>{label}
                  </button>;
                })}
              </div>
              <div className="settings-home-quick-actions">
                <button type="button" onClick={() => saveQuickIds(null)}>恢复默认入口</button>
                <button type="button" className="settings-home-quick-done" onClick={() => { setShowQuickEditor(false); quickEditRef.current?.focus(); }}>完成整理</button>
              </div>
            </div>
          ) : null}
          {quickLinkFeedback?.scope === preferenceScope ? <p className="settings-home-quick-feedback" role="status">{quickLinkFeedback.message}</p> : null}
        </div>
      ) : null}

      {isSearching ? (
        <p className="settings-home-results" role="status" aria-live="polite">
          {resultCount > 0 ? `找到 ${resultCount} 个入口` : "没有找到匹配的设置，换个关键词试试。"}
        </p>
      ) : null}

      <div className="settings-home-groups" aria-label="设置分类">
        {groups.map((group) => (
          <section className="settings-home-group" key={group.id} aria-labelledby={`${searchId}-${group.id}`}>
            <div className="settings-home-group-heading">
              <h3 id={`${searchId}-${group.id}`}>{group.label}</h3>
              <p>{group.description}</p>
            </div>
            <div className="settings-home-entries">
              {group.categories.map(({ id, label, description, Icon }) => (
                <button
                  className="settings-home-entry"
                  key={id}
                  type="button"
                  data-settings-category={id}
                  onClick={event => onSelectCategory?.(id, event?.currentTarget)}
                >
                  {Icon ? <span className="settings-home-entry-icon" aria-hidden="true"><Icon /></span> : null}
                  <span className="settings-home-entry-text"><strong>{label}</strong><small>{description}</small></span>
                  <ArrowRight className="settings-home-entry-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {isSearching && resultCount === 0 ? (
        <button type="button" className="settings-home-reset" onClick={clearSearch}>查看全部设置</button>
      ) : null}

      {!isSearching && guideSteps.length > 0 ? (
        <aside className="settings-home-guide">
          <button
            className="settings-home-guide-toggle"
            ref={guideToggleRef}
            type="button"
            aria-expanded={showGuide}
            aria-controls={guideId}
            onClick={() => setShowGuide((current) => !current)}
          >
            <span><strong>从哪里开始？</strong><small>按需查看的上手建议</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
          {showGuide ? (
            <div id={guideId} className="settings-home-guide-content" onKeyDown={(event) => handlePanelKeyDown(event, setShowGuide, guideToggleRef)}>
              <p>挑一项你现在需要的设置，其他功能可以随时回来看看。</p>
              <ol>
                {guideSteps.map((step) => (
                  <li key={step.categoryId}>
                    <button type="button" onClick={event => onSelectCategory?.(step.categoryId, event?.currentTarget)}>{step.label}<ArrowRight aria-hidden="true" /></button>
                    <p>{step.description}</p>
                  </li>
                ))}
              </ol>
              <button type="button" className="settings-home-guide-close" onClick={() => { setShowGuide(false); guideToggleRef.current?.focus(); }}>收起建议</button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

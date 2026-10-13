import { useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import "./feature-navigation.css";

import { FEATURE_GROUPS, FEATURE_LABELS, FEATURE_DETAILS, filterFeatures } from "./feature-navigation.js";

const groupedFeatureIds = new Set(FEATURE_GROUPS.flatMap(group => group.ids));

export default function FeatureNavigation({ items = [], activeView, onNavigate }) {
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const searchId = useId();
  const visible = filterFeatures(items, search);
  const isSearching = search.trim().length > 0;
  const otherEntries = visible.filter(item => !groupedFeatureIds.has(item.id));
  const groups = FEATURE_GROUPS.map(group => ({ ...group, entries: visible.filter(item => group.ids.includes(item.id)) }));
  if (otherEntries.length) groups.push({ label: "更多功能", entries: otherEntries });

  function clearSearch() {
    setSearch("");
    searchRef.current?.focus();
  }

  function handleSearchKeyDown(event) {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape" && search) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    } else if (event.key === "Enter" && isSearching && visible.length === 1) {
      event.preventDefault();
      onNavigate?.(visible[0].id);
    }
  }

  return <div className="feature-navigation">
    <div className="feature-navigation-search">
      <label htmlFor={searchId}>找个玩法</label>
      <div className="feature-navigation-search-field">
        <Search aria-hidden="true" />
        <input id={searchId} ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="聊天、听歌、小棉花…" maxLength={60} autoComplete="off" aria-describedby={isSearching ? `${searchId}-results` : undefined} />
        {search ? <button type="button" aria-label="清空玩法搜索" onClick={clearSearch}><X aria-hidden="true" /></button> : null}
      </div>
    </div>
    {isSearching ? <p id={`${searchId}-results`} className="feature-navigation-results" role="status">{visible.length ? `找到 ${visible.length} 个玩法` : "没有找到匹配的玩法"}</p> : null}
    <nav className="primary-nav" aria-label="主要功能">
      {groups.map((group, index) => {
        return group.entries.length ? <div className="feature-navigation-group" key={group.label} role="group" aria-labelledby={`${searchId}-group-${index}`}>
          <p id={`${searchId}-group-${index}`}>{group.label}</p>
          {group.entries.map(item => <button type="button" className={activeView === item.id ? "active" : ""} aria-current={activeView === item.id ? "page" : undefined} key={item.id} onClick={() => onNavigate?.(item.id)}><span aria-hidden="true">{item.icon}</span><span>{FEATURE_LABELS[item.id] || item.label}{FEATURE_DETAILS[item.id]?.hint ? <small>{FEATURE_DETAILS[item.id].hint}</small> : null}</span></button>)}
        </div> : null;
      })}
      {!visible.length && <p className="feature-navigation-empty">{isSearching ? "换个词试试，或清空搜索查看全部玩法。" : "暂时没有可用玩法。"}</p>}
    </nav>
  </div>;
}

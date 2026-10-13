import { useState } from "react";

export default function MusicPagedList({ items = [], renderItem, label = "歌曲", listTag = "div" }) {
  const [requestedPage, setRequestedPage] = useState(0);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requestedPage, totalPages - 1);
  const start = page * pageSize;
  const List = listTag;
  return <div className="music-paged-list">
    <List className="music-paged-items">{items.slice(start, start + pageSize).map((item, index) => renderItem(item, start + index))}</List>
    {totalPages > 1 && <nav className="music-list-pager" aria-label={`${label}分页`}>
      <button type="button" disabled={page === 0} onClick={() => setRequestedPage(page - 1)}>上一页</button>
      <label>第 <select aria-label={`${label}页码`} value={page} onChange={event => setRequestedPage(Number(event.target.value))}>{Array.from({ length: totalPages }, (_, index) => <option key={index} value={index}>{index + 1} / {totalPages}</option>)}</select> 页</label>
      <button type="button" disabled={page + 1 >= totalPages} onClick={() => setRequestedPage(page + 1)}>下一页</button>
      <small role="status">{start + 1}–{Math.min(start + pageSize, items.length)} / {items.length} 首</small>
    </nav>}
  </div>;
}

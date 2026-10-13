import { useState } from "react";
import { Clapperboard, ExternalLink, MessageCircleMore, Search, ShoppingBag } from "lucide-react";
import "./activity-query-panels.css";

export function WatchQueryPanel({ initialQuery = "", active = false }) {
  const [query, setQuery] = useState(initialQuery);
  const keyword = query.trim();
  return <details className="activity-query-panel activity-watch-query" aria-label="找想看的影片" open={Boolean(initialQuery) && !active}>
    <summary className="activity-query-heading"><Clapperboard aria-hidden="true" size={20} /><div><strong>找想看的影片</strong><small>选好后复制分享链接，回到「网页一起看」。</small></div></summary>
    <label><span>影片或视频关键词</span><input type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="电影名、纪录片或想看的主题" /></label>
    <div className="activity-query-actions">{keyword ? <>
      <a href={`https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`} target="_blank" rel="noopener noreferrer"><Search aria-hidden="true" size={16} />B站搜索<ExternalLink aria-hidden="true" size={13} /></a>
      <a href={`https://so.iqiyi.com/so/q_${encodeURIComponent(keyword)}`} target="_blank" rel="noopener noreferrer"><Search aria-hidden="true" size={16} />爱奇艺搜索<ExternalLink aria-hidden="true" size={13} /></a>
    </> : <small>输入关键词后可打开平台搜索。</small>}</div>
    {active && <p>当前共看会继续播放，搜索不会替换本场内容。</p>}
  </details>;
}

export function TakeoutQueryPanel({ initialQuery = "", onPrepare }) {
  const [query, setQuery] = useState(initialQuery);
  return <section className="activity-query-panel" aria-label="这次想吃什么">
    <div className="activity-query-heading"><ShoppingBag aria-hidden="true" size={20} /><div><strong>这次想吃什么？</strong><small>可以补充店名、口味和预算。</small></div></div>
    <label><span>外卖需求</span><textarea rows={3} maxLength={1000} value={query} onChange={event => setQuery(event.target.value)} placeholder="例如：附近的烧烤，不吃辣，预算 30 元" /></label>
    <div className="activity-query-actions"><button type="button" disabled={!query.trim()} onClick={() => onPrepare?.(query.trim())}><MessageCircleMore aria-hidden="true" size={16} />带到聊天，请 AI 搜店</button></div>
    <p>先放进聊天草稿，由你发送；不会自动下单或付款。</p>
  </section>;
}

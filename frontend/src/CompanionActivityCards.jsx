import { Clapperboard, Music2, ShoppingBag, ExternalLink, Palette } from "lucide-react";
import { normalizeCompanionActivities } from "./companion-activities.js";
import "./companion-activities.css";

const labels = { music: "一起听歌", watch: "一起看", takeout: "打开外卖", art: "打开涂鸦画室" };
const icons = { music: Music2, watch: Clapperboard, takeout: ShoppingBag, art: Palette };

export default function CompanionActivityCards({ actions, onOpen }) {
  const normalized = normalizeCompanionActivities(actions);
  if (!normalized.length) return null;
  return <div className="companion-activity-cards" aria-label="伴侣准备的活动">{normalized.map(action => {
    if (action.kind === "bilibili") return <section key={action.id} className="companion-activity-card"><strong>B站首页推荐</strong><small>当前账号这次读取的推荐</small>{action.videos.map(video => <div key={video.bvid} className="companion-video-entry"><a href={video.pageUrl} target="_blank" rel="noopener noreferrer">{video.title}<ExternalLink aria-hidden="true" size={13} /></a>{video.creator && <small>{video.creator}</small>}{typeof onOpen === "function" && <button type="button" onClick={() => onOpen({ ...action, kind: "watch", pageUrl: video.pageUrl })}>一起看这条</button>}</div>)}</section>;
    const Icon = icons[action.kind];
    return <section key={action.id} className="companion-activity-card"><div><Icon aria-hidden="true" size={18} /><strong>{labels[action.kind]}</strong></div>{action.query && <p>{action.query}</p>}{action.kind === "takeout" && <small>打开平台后自行选餐、下单</small>}{typeof onOpen === "function" && <button type="button" onClick={() => onOpen(action)}>{labels[action.kind]}</button>}</section>;
  })}</div>;
}

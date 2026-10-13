import { ArrowRight, Clapperboard, Music2, X } from "lucide-react";
import "./activity-return.css";

export default function ActivityReturnBar({ activity, onOpen, onDismiss }) {
  if (!activity) return null;
  const Icon = activity.view === "music" ? Music2 : Clapperboard;
  return <section className="activity-return-bar" aria-label="回到本次活动">
    <Icon className="activity-return-symbol" aria-hidden="true" size={18} />
    <div className="activity-return-copy">
      <strong>{activity.title || activity.label}</strong>
      <small>{activity.label} · 返回后核对播放进度</small>
    </div>
    <button type="button" className="activity-return-open" onClick={onOpen} aria-label={`回到${activity.label}`}>
      返回<ArrowRight aria-hidden="true" size={15} />
    </button>
    <button type="button" className="activity-return-dismiss" onClick={onDismiss} aria-label="收起活动入口" title="只收起入口，活动不受影响">
      <X aria-hidden="true" size={17} />
    </button>
  </section>;
}

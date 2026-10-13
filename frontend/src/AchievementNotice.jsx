import { useEffect } from "react";
import "./achievement-guide.css";

export default function AchievementNotice({ items, onDismiss, onView }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [items, onDismiss]);
  return <aside className="achievement-notice" aria-label="成就小纪念">
    <div role="status" aria-live="polite"><strong>又留下一份小纪念</strong>{items.slice(0, 3).map(item => <p key={item.code || item.id}>{item.emoji || "✧"} {item.title}<small>{item.description}</small></p>)}</div>
    <div><button type="button" onClick={onView}>看看成就</button><button type="button" onClick={onDismiss} aria-label="收起成就提示">收起</button></div>
  </aside>;
}

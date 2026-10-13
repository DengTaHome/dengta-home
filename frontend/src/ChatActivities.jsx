import { useId, useState } from "react";
import { ACTIVITY_CATEGORIES, CHAT_ACTIVITIES, pickActivity } from "./chat-activities.js";
import "./chat-activities.css";

export default function ChatActivities({ onChoose, disabled = false }) {
  const [category, setCategory] = useState("story");
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState("");
  const draftId = useId();
  return <details className="chat-activities">
    <summary><span aria-hidden="true">✧</span><strong>一起玩</strong><small>给今天一点新鲜感</small></summary>
    <div className="chat-activities-body">
      <button type="button" className="chat-activity-use" onClick={() => {
        const item = pickActivity(selected);
        setCategory(item.category); setSelected(item.id); setDraft(item.prompt);
      }}>✧ 灵感盲盒 · 帮我挑一个</button>
      <p className="chat-activity-hint">只帮你挑个开场，喜欢了再发出去。</p>
      <div className="chat-activity-categories" aria-label="互动类型">
        {ACTIVITY_CATEGORIES.map((item) => <button type="button" key={item.id} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </div>
      <div className="chat-activity-cards">
        {CHAT_ACTIVITIES.filter((item) => item.category === category).map((item) => <button type="button" className="chat-activity-card" key={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setDraft(item.prompt); }}>
          <span className="chat-activity-icon" aria-hidden="true">{item.icon}</span>
          <strong>{item.title}</strong><small>{item.detail}</small>
        </button>)}
      </div>
      {selected ? <div className="chat-activity-preview">
        <label htmlFor={draftId}>这次想这样开场</label>
        <textarea id={draftId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
        <p>可以改成你的说法。放进输入框后，再由你发送。</p>
        <button type="button" className="chat-activity-use" disabled={disabled || !draft.trim()} onClick={() => onChoose(draft)}>放进输入框</button>
      </div> : <p className="chat-activity-hint">挑一个开场，和熟悉的伴侣一起接着玩。</p>}
    </div>
  </details>;
}

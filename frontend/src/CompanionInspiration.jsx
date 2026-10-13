import { useEffect, useId, useRef, useState } from "react";
import { drawCompanionInspiration, INSPIRATION_CATEGORIES } from "./companion-inspiration.js";

export default function CompanionInspiration({ onUse, disabled = false }) {
  const [card, setCard] = useState(null);
  const [used, setUsed] = useState(false);
  const [category, setCategory] = useState("all");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const history = useRef({});
  const pendingRef = useRef(false);
  const mounted = useRef(false);
  const titleId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function draw() {
    if (pendingRef.current) return;
    const next = drawCompanionInspiration({ category, previousId: card?.id, seenIds: history.current[category] });
    history.current[category] = next.seenIds;
    setCard(next.card);
    setUsed(false);
    setFeedback(next.restarted ? "这一组重新洗牌了。" : "");
  }
  async function handleUseCard() {
    if (!card || disabled || used || pendingRef.current || typeof onUse !== "function") return;
    pendingRef.current = true;
    setPending(true);
    setFeedback("");
    try {
      const accepted = await onUse(card.draft);
      if (!mounted.current) return;
      if (accepted === false) setFeedback("暂时没能放入聊天草稿，请再试一次。");
      else setUsed(true);
    } catch {
      if (mounted.current) setFeedback("暂时没能放入聊天草稿，请再试一次。");
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return <section className="companion-inspiration" aria-labelledby={titleId}>
    <div className="companion-inspiration-heading"><div><h3 id={titleId}>陪伴灵感签</h3><p>挑一种心情，和伴侣一起把它展开。</p></div>
      <button type="button" className="inspiration-draw" disabled={pending} onClick={draw}>{card ? "换一张" : "抽一张"}</button>
    </div>
    <div className="companion-inspiration-categories" role="group" aria-label="选择灵感类型">
      {INSPIRATION_CATEGORIES.map(item => <button key={item.id} type="button" aria-pressed={category === item.id} disabled={pending} onClick={() => {
        if (pendingRef.current || item.id === category) return;
        setCategory(item.id); setCard(null); setUsed(false); setFeedback("");
      }}>{item.label}</button>)}
    </div>
    {card && <div className="companion-inspiration-result" aria-live="polite"><span className="inspiration-symbol" aria-hidden="true">{card.symbol}</span><div><small className="inspiration-category-label">{INSPIRATION_CATEGORIES.find(item => item.id === card.category)?.label}</small><strong>{card.title}</strong><p>{card.hint}</p></div>
      <button type="button" className="inspiration-use" disabled={disabled || used || pending || typeof onUse !== "function"} onClick={() => void handleUseCard()}>{pending ? "正在带入…" : used ? "已带入草稿" : "带到聊天"}</button>
    </div>}
    {card && <small>只放入草稿，由你决定是否发送。</small>}
    {feedback && <small role="status">{feedback}</small>}
  </section>;
}

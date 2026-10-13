import { useEffect, useRef, useState } from "react";
import { achievementFailure, validateAchievementReceipt } from "./achievement-action.js";
import { GUIDE_STEPS, readGuidePreferences, saveGuidePreferences } from "./achievement-guide.js";
import "./achievement-guide.css";

export default function AchievementGuide({ storageKey, achievements = [], loading = false, startExpanded = false, onOpenHandled, onAction, onClaim }) {
  const [preferences, setPreferences] = useState(() => ({ ...readGuidePreferences(storageKey), ...(startExpanded ? { collapsed: false } : {}) }));
  const [claim, setClaim] = useState("idle");
  const [claimError, setClaimError] = useState("");
  const pendingClaim = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (startExpanded) onOpenHandled?.(); }, [startExpanded, onOpenHandled]);
  const firstChat = achievements.some(item => item.code === "first_chat" && item.unlocked);
  const graduated = achievements.some(item => item.code === "onboarding_1" && item.unlocked);
  const collapsed = preferences.collapsed;
  const current = GUIDE_STEPS.find(item => item.id === preferences.step);
  function update(patch) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveGuidePreferences(storageKey, next);
  }
  function next() {
    const index = GUIDE_STEPS.findIndex(item => item.id === current.id);
    update({ step: GUIDE_STEPS[(index + 1) % GUIDE_STEPS.length].id, visited: [...new Set([...preferences.visited, current.id])] });
  }
  async function collect() {
    if (pendingClaim.current || loading || !firstChat || graduated || claim === "success") return;
    pendingClaim.current = true;
    setClaim("busy");
    setClaimError("");
    try {
      validateAchievementReceipt("onboarding", await onClaim());
      if (mounted.current) setClaim("success");
    } catch (error) {
      if (mounted.current) { setClaim("error"); setClaimError(achievementFailure(error).message); }
    } finally { pendingClaim.current = false; }
  }
  return <section className="achievement-guide" aria-label="轻松上手">
    <div className="achievement-guide-heading">
      <div><strong>✧ {graduated ? "已经迈出第一步" : "从这里开始，慢慢来"}</strong><small>{graduated ? "随时可以回来看使用方法。" : "不用一次学会，也不用按顺序。"}</small></div>
      <button type="button" aria-expanded={!collapsed} onClick={() => update({ collapsed: !collapsed })}>{collapsed ? "看看路线" : "先自己逛逛"}</button>
    </div>
    {!collapsed && <div className="achievement-guide-body">
      <nav aria-label="选择入门步骤">{GUIDE_STEPS.map((step, index) => <button type="button" key={step.id} aria-current={current.id === step.id ? "step" : undefined} onClick={() => update({ step: step.id })}>{index + 1} · {step.title}{(step.id === "hello" && firstChat) || (step.id === "keepsake" && graduated) ? " ✓" : ""}</button>)}</nav>
      <h3>{current.title}</h3><p>{current.text}</p>
      {firstChat && <p className="achievement-guide-positive">💌 已点亮「初次相遇」。第一步已经留下来了，接下来按你的节奏。</p>}
      {current.id === "keepsake" ? <>
        <button type="button" aria-busy={claim === "busy"} disabled={loading || !firstChat || graduated || claim === "busy" || claim === "success"} onClick={() => void collect()}>{graduated || claim === "success" ? "纪念已收好" : claim === "busy" ? "正在保存…" : current.action}</button>
        {!firstChat && <small>第一次对话完成后会在这里点亮；你也可以先探索其他功能。</small>}
        {claim === "error" && <p role="status">{claimError} 其他功能照常使用。</p>}
      </> : <button type="button" onClick={() => onAction(current.id)}>{current.action}</button>}
      <button type="button" className="achievement-guide-skip" onClick={next}>换一步看看</button>
      <small>收起后，可在「成就」页随时回来。成就是纪念，不是作业。</small>
    </div>}
  </section>;
}

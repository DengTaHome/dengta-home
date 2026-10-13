import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SessionDialog from "../src/SessionDialog.jsx";
import MusicImportDialog from "../src/MusicImportDialog.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/App.css";
import "../src/cozy-theme.css";
import "../src/auth.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/jelly-motion.css";
import "../src/sun-glass-chat.css";
import "../src/typography.css";
import "../src/apple-high.css";
import "../src/room-invite.css";
import "../src/settings-media-polish.css";
import "../src/together.css";
import "../src/interaction-polish.css";
import "../src/interface-polish.css";

applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), "day"), document.documentElement);

export default function Preview() {
  const [dialog, setDialog] = useState(null), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const [fail, setFail] = useState(false), [title, setTitle] = useState("虚构对话"), [music, setMusic] = useState(false), [notice, setNotice] = useState("");
  const [night, setNight] = useState(false);
  const timer = useRef(null), pending = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), night ? "night" : "day"), document.documentElement); }, [night]);
  function open(type) { if (!pending.current) { setFeedback(""); setDialog({type, value:title, session:{title}}); } }
  function confirm(event) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy(true);
    timer.current = window.setTimeout(() => {
      pending.current = false; setBusy(false);
      if (fail) setFeedback("名称尚未确认保存。先刷新列表核对，再重试。错误代码：session_receipt_invalid。");
      else { if (dialog.type === "rename") setTitle(dialog.value.trim()); setNotice("虚构回执已完成。没有访问账号或删除真实数据。"); setDialog(null); }
    }, 1200);
  }
  return <main style={{minHeight:"100dvh",padding:20,background:"var(--theme-background)",color:"var(--theme-ink)"}}>
    <h1>弹窗交互验收</h1><p>实际组件、虚构回执。没有接口请求、真实删除、音乐播放或账号访问。</p><button onClick={()=>setNight(current=>!current)}>{night ? "切换日间" : "切换夜间"}</button>
    <p>当前标题：{title}</p><nav style={{display:"flex",flexWrap:"wrap",gap:10}}><button onClick={()=>open("rename")}>重命名虚构对话</button><button onClick={()=>open("delete")}>删除虚构对话</button><button onClick={()=>setMusic(true)}>打开虚构歌曲导入</button></nav>
    <label><input type="checkbox" checked={fail} onChange={event=>setFail(event.target.checked)} />模拟失败回执</label>
    <output role="status">{notice}</output>
    {dialog && <SessionDialog dialog={dialog} busy={busy} feedback={feedback} onChange={value=>setDialog(current=>({...current,value}))} onClose={()=>{if (!pending.current) setDialog(null);}} onConfirm={confirm} onInspect={()=>{setDialog(null);setNotice("虚构日志：DT-SESSIONS / session_receipt_invalid；没有上游原文。");}} />}
    {music && <MusicImportDialog onClose={()=>setMusic(false)}><label>虚构歌曲名称<input aria-label="虚构歌曲名称" defaultValue="夜航" /></label><audio controls aria-label="虚构音频控件，无音源" /><button type="button" onClick={()=>{setMusic(false);setNotice("虚构歌曲导入已关闭，没有保存请求。");}}>完成虚构导入</button></MusicImportDialog>}
  </main>;
}
const root = import.meta.hot?.data.previewRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.previewRoot = root;
root.render(<Preview />);

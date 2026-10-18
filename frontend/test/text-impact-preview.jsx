import { useState } from "react";
import ChatTranscript from "../src/ChatTranscript.jsx";

const initial = [
  { id: "1001", role: "assistant", content: "今天的海风把云吹成了一封信，我想把它寄给你。", created_at: "2026-10-16T00:00:00Z" },
  { id: "1002", role: "user", content: "那就让这些字替你跑过来吧~", created_at: "2026-10-16T00:00:05Z" },
  { id: "1003", role: "assistant", content: "接住！这些字想排着队，轻轻跳进你的输入框里。晚安、海风、月亮，还有一点点想念。", created_at: "2026-10-16T00:00:10Z" },
];
export default function Preview() {
  const [messages, setMessages] = useState(initial), [text, setText] = useState("");
  return <main className="impact-demo">
    <style>{`
      body { margin:0; background:#eeeae5; }
      .impact-demo { width:min(100%,390px); height:100dvh; max-height:900px; margin:auto; background:#f8f4ee; color:#3d3338; display:flex; flex-direction:column; --ink:#3d3338; --paper:#fffdfb; }
      .impact-demo header { padding:20px 20px 12px; border-bottom:1px solid #e5dad5; }
      .impact-demo h1 { margin:0; font-size:20px; color:#3d3338; }
      .impact-demo header p { margin:6px 0 0; font-size:12px; color:#75656b; }
      .impact-demo .message-list { padding:18px 12px; min-height:0; flex:1; overflow:auto; background:#f8f4ee; }
      .impact-demo .message-row { margin:14px 0; }
      .impact-demo .message-avatar { width:34px; height:34px; flex:0 0 34px; object-fit:cover; border-radius:50%; }
      .impact-demo .message-row.assistant .message-bubble { color:#3d3338; background:#fffdfb; }
      .impact-demo .message-content { font-size:17px; line-height:1.6; }
      .impact-demo .message-bubble { border-radius:18px; }
      .impact-demo .composer { margin:12px; padding:10px 14px; background:white; border:1px solid #ded3cf; border-radius:24px; }
      .impact-demo .composer textarea { display:block; width:100%; min-height:50px; resize:none; background:transparent; color:#43363b; border:0; outline:0; font:16px/1.5 inherit; }
      .impact-demo .preview-actions { display:flex; gap:8px; padding:0 12px 10px; }
      .impact-demo .preview-actions button { flex:1; min-height:36px; border:1px solid #ded3cf; border-radius:10px; background:#fffaf6; color:#614856; }
    `}</style>
    <header><h1>文字弹弹乐</h1><p>虚构聊天 · 点消息旁“弹字”选择动效 · 不调用模型</p></header>
    <section className="message-list" aria-label="虚构聊天"><ChatTranscript messages={messages}
      preferences={{ skin: "classic-glass", reduceMotion: false }} textImpactScope="fictional-motion-preview"
      userName="你" aiName="小灯" companionAvatar="/app-icon-192.png" onReference={() => {}} /></section>
    <div className="composer" data-text-impact-scope="fictional-motion-preview"><textarea aria-label="输入消息" placeholder="试试看，原输入内容会保留" value={text} onChange={event => setText(event.target.value)} /></div>
    <div className="preview-actions"><button type="button" onClick={() => setMessages(current => [...current, { id: String(1000 + current.length + 1), role: "assistant", content: "我又捡到一颗小星星，想把它放在你的掌心。", monologueAutoOpen: true, created_at: new Date().toISOString() }])}>模拟收到新回复</button>
      <button type="button" onClick={() => { document.documentElement.dataset.dengtaReducedMotion = document.documentElement.dataset.dengtaReducedMotion !== "true" ? "true" : "false"; }}>切换减少动效</button></div>
  </main>;
}

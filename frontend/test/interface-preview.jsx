import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrainCircuit, DatabaseZap, FileDown, Mic2, MonitorSmartphone, Music, Palette, ScrollText, ServerCog, Trophy } from "lucide-react";
import SettingsHome from "../src/SettingsHome.jsx";
import { useSettingsCategoryNavigation } from "../src/useSettingsCategoryNavigation.js";
import PersonalizationEditor from "../src/PersonalizationEditor.jsx";
import CompanionInspiration from "../src/CompanionInspiration.jsx";
import CelestialBackdrop from "../src/CelestialBackdrop.jsx";
import OperationErrorHelp from "../src/OperationErrorHelp.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/cozy-theme.css";
import "../src/App.css";
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
import "../src/interaction-polish.css";
import "../src/interface-polish.css";
const snapshot = getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), "day");
applyThemePreferences(DEFAULT_THEME_PREFERENCES, snapshot, document.documentElement);
const categories = [
  {id:"appearance",label:"外观与聊天",Icon:Palette}, {id:"persona",label:"个性化与记忆",Icon:BrainCircuit},
  {id:"services",label:"模型与服务",Icon:ServerCog}, {id:"voice",label:"语音与情绪",Icon:Mic2},
  {id:"devices",label:"设备与共看",Icon:MonitorSmartphone}, {id:"fun",label:"成就与新玩法",Icon:Trophy},
  {id:"data-import",label:"数据导入",Icon:DatabaseZap}, {id:"data-export",label:"数据导出",Icon:FileDown},
  {id:"music-import",label:"音乐导入",Icon:Music}, {id:"logs",label:"错误日志",Icon:ScrollText},
];
export default function Preview() {
  const [page,setPage]=useState(null),[value,setValue]=useState("保留原文的空格与换行。\n  这是虚构的长文本编辑预览。"),[draft,setDraft]=useState("我原来的草稿。"),[scope,setScope]=useState("preview-a");
  const scrollRef = useRef(null);
  const navigation = useSettingsCategoryNavigation({ isOpen: true, category: page, scopeKey: scope, scrollRef, focusTarget: "", onSelect: setPage });
  const [sky,setSky] = useState(snapshot);
  function setTheme(mode) {
    const next = getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), mode);
    applyThemePreferences(DEFAULT_THEME_PREFERENCES, next, document.documentElement);
    setSky(next);
  }
  return <div className="app-shell" style={{display:"block",minHeight:"100dvh"}}><CelestialBackdrop snapshot={sky} /><main ref={scrollRef} className="feature-page settings-page" style={{maxWidth:960,margin:"auto",padding:20,position:"relative",zIndex:1,height:"100dvh",overflowY:"auto"}}>
    <div className="section-intro settings-intro"><div><span className="eyebrow">界面操作预览</span><h2>AI 与应用设置</h2><p>实际组件，虚构数据。没有账号、模型或保存服务请求。</p></div></div>
    <div style={{display:"flex",gap:8,marginBottom:16}}><button type="button" onClick={()=>setTheme("day")}>日间预览</button><button type="button" onClick={()=>setTheme("night")}>夜间预览</button></div>
    <div hidden={Boolean(page)}><SettingsHome key={scope} categories={categories} onSelectCategory={navigation.selectCategory} preferenceScope={scope} /></div>
    {page && <button type="button" className="settings-category-back" onClick={navigation.returnHome}>返回设置分类</button>}
    {page && (page === "persona" ? <div className="settings-card prompt-settings-card"><div className="prompt-layer"><h3>个性化指令</h3>
      <button onClick={()=>{setScope(previous=>previous==="preview-a"?"preview-b":"preview-a");setValue("另一个虚构伴侣的草稿。");}}>切换虚构伴侣</button>
      <button onClick={()=>setValue("虚构长文样例。\n".repeat(25000))}>装入 200000 字符样例</button>
      <PersonalizationEditor field="unified_system_prompt" label="个性化指令" scopeKey={scope} value={value} onChange={setValue} />
      <output id="preview-length">原文 UTF-16 长度：{value.length}</output></div></div> : page === "fun" ? <><CompanionInspiration onUse={text=>setDraft(previous=>`${previous}\n${text}`)} /><label>聊天草稿<textarea aria-label="聊天草稿" value={draft} onChange={event=>setDraft(event.target.value)} /></label></> : page === "logs" ? <div className="settings-card"><h3>虚构错误说明</h3><OperationErrorHelp diagnostic={{code:"provider_balance_insufficient"}} onOpenSettings={setPage} /><details><summary>错误代码与技术详情</summary><code>provider_balance_insufficient</code></details></div> : <div className="settings-card"><p>入口：{categories.find(item=>item.id===page)?.label}</p><p>这个独立预览只展示已修改的设置、长文本、灵感和错误说明组件。</p></div>)}
    {page ? <div style={{minHeight:1000,paddingTop:20}}><p>用于核对长页面进入、返回位置的虚构占位区域。</p></div> : null}
  </main></div>;
}
const root=import.meta.hot?.data.previewRoot||createRoot(document.getElementById("root"));
if(import.meta.hot)import.meta.hot.data.previewRoot=root;
root.render(<Preview />);

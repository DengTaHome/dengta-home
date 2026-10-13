import { useEffect,useState } from "react";
import StoryChapters from "../src/StoryChapters.jsx";
import IntimateDuel from "../src/IntimateDuel.jsx";
import CottonPet from "../src/CottonPet.jsx";
import { applyThemePreferences,DEFAULT_THEME_PREFERENCES,getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/App.css";
import "../src/cozy-theme.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/jelly-motion.css";
import "../src/sun-glass-chat.css";
import "../src/typography.css";
import "../src/apple-high.css";
import "../src/interface-polish.css";

const ACCOUNT="round15-fictional-account",COMPANION="round15-fictional-companion";
const DUEL_KEY=`dengta_intimate_duel_v3:${JSON.stringify([ACCOUNT,COMPANION])}`;
export default function Preview(){
  const [night,setNight]=useState(false),[view,setView]=useState("stories"),[generation,setGeneration]=useState(0),[reduced,setReduced]=useState(false),[archiveCheck,setArchiveCheck]=useState("");
  useEffect(()=>{applyThemePreferences(DEFAULT_THEME_PREFERENCES,getCelestialSnapshot(new Date("2026-10-09T04:00:00Z"),night?"night":"day"),document.documentElement);},[night]);
  useEffect(()=>{document.documentElement.dataset.dengtaReducedMotion=reduced?"true":"false";return()=>{delete document.documentElement.dataset.dengtaReducedMotion;};},[reduced]);
  return <main className="interaction-recovery-fixture">
    <header><small>灯塔 · 第十五轮本地验收</small><h1>片段、互动与安静陪伴</h1><p>真实组件和模型副本，接口回执与账号均为本地虚构数据；没有声音或真实模型调用。</p>
      <nav aria-label="预览操作"><button onClick={()=>setNight(!night)}>{night?"切换日间":"切换夜间"}</button><button aria-pressed={reduced} onClick={()=>setReduced(!reduced)}>{reduced?"关闭减少动态":"开启减少动态"}</button>{[["stories","故事章节"],["duel","互动挑战"],["cotton","小棉花副本"]].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>
    </header>
    {view==="stories"&&<StoryChapters accountScope={ACCOUNT} companionScope={COMPANION}/>}
    {view==="duel"&&<><div className="fixture-actions"><button onClick={()=>{localStorage.setItem(DUEL_KEY,"{FICTIONAL_CORRUPT_SAVE");setGeneration(value=>value+1);}}>用异常存档重开</button><button onClick={()=>{localStorage.removeItem(DUEL_KEY);setGeneration(value=>value+1);}}>准备空白测试存档</button><button onClick={()=>setArchiveCheck(localStorage.getItem(DUEL_KEY)==="{FICTIONAL_CORRUPT_SAVE"?"虚构异常存档原文仍保留":"虚构异常存档已变化")}>核对虚构存档</button><output aria-label="虚构存档核对结果">{archiveCheck}</output></div><IntimateDuel key={generation} accountScope={ACCOUNT} companionScope={COMPANION} aiName="虚构星灯" userName="虚构旅人"/></>}
    {view==="cotton"&&<CottonPet accountScope={ACCOUNT} companionScope={COMPANION}/>}
  </main>;
}

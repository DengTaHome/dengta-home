import { useEffect,useState } from "react";
import { createRoot } from "react-dom/client";
import StoryChapters from "../src/StoryChapters.jsx";
import CompanionDiary from "../src/CompanionDiary.jsx";
import Nursery from "../src/Nursery.jsx";
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

export default function Preview(){
  const [night,setNight]=useState(false),[view,setView]=useState("stories"),[diaryGeneration,setDiaryGeneration]=useState(0);
  useEffect(()=>{applyThemePreferences(DEFAULT_THEME_PREFERENCES,getCelestialSnapshot(new Date("2026-10-08T04:00:00Z"),night?"night":"day"),document.documentElement);},[night]);
  return <main className="product-flow-fixture">
    <header><small>灯塔 · 第十三轮本地验收</small><h1>留住一段属于你们的故事</h1><p>真实组件与本地虚构回执，不登录真实账号、不调用模型、不播放声音。</p>
      <nav aria-label="预览操作"><button onClick={()=>setNight(!night)}>{night?"切换日间":"切换夜间"}</button>{[["stories","故事章节"],["diary","记忆手记"],["family","Family"]].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</nav>
    </header>
    {view==="stories"&&<StoryChapters accountScope="preview-fictional-account" companionScope="preview-fictional-companion"/>}
    {view==="diary"&&<><button onClick={async()=>{await fetch("/_fixture/control",{method:"POST",body:JSON.stringify({diaryMalformed:true})});setDiaryGeneration(value=>value+1);}}>用异常条目重开日记</button><CompanionDiary key={diaryGeneration} aiName="虚构伴侣"/></>}
    {view==="family"&&<><button onClick={()=>fetch("/_fixture/control",{method:"POST",body:JSON.stringify({nurseryMalformed:true})})}>下一次照护返回未确认回执</button><Nursery aiName="虚构伴侣"/></>}
  </main>;
}
const style=document.createElement("style");style.textContent=`html,body,#root{height:auto!important;min-height:100%;overflow:visible}body{background:var(--theme-background);color:var(--theme-ink);margin:0}#root{background:transparent}.product-flow-fixture{max-width:900px;margin:auto;padding:16px}.product-flow-fixture header{padding:8px 0 18px}.product-flow-fixture nav{display:flex;flex-wrap:wrap;gap:8px}.product-flow-fixture>button,.product-flow-fixture nav button{min-height:44px;border:1px solid var(--theme-control-border);background:rgb(var(--theme-card-rgb)/.9);color:inherit;border-radius:12px;padding:8px 12px;font:inherit}`;document.head.append(style);
const root=import.meta.hot?.data.root||createRoot(document.getElementById("root"));if(import.meta.hot)import.meta.hot.dispose(data=>{data.root=root;style.remove();});root.render(<Preview/>);

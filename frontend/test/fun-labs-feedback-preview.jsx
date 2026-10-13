import { useRef, useState } from "react";
import FunLabsFeedback from "../src/FunLabsFeedback.jsx";
import { emptyFunLabsState, refreshFunLabsSections } from "../src/fun-labs-refresh.js";

export default function Preview() {
  const [token]=useState(()=>({requestId:0})), failures=useRef(true);
  const [state,setState]=useState(() => ({ ...emptyFunLabsState(),scope:token,dates:[{id:"example",title:"一起看日落",event_date:"2026-10-01"}],shots:{today:{id:"sample",note:"虚构示例照片"},recent:[]} }));
  function refresh(sections) {
    return refreshFunLabsSections({token,currentToken:()=>token,isMounted:()=>true,update:setState,sections,
      request:async path=>{
        await new Promise(resolve=>setTimeout(resolve,path.includes("achievements")?1500:250));
        if(path.includes("shots")&&failures.current)throw Object.assign(new Error("Synthetic failure"),{code:"daily_shots_read_failed",status:503});
        if(path.includes("special-dates"))return {dates:[{id:"example",title:"一起看日落",event_date:"2026-10-01"}]};
        if(path.includes("achievements"))return {achievements:[]};
        return {today:{id:"sample",note:"虚构示例照片"},recent:[]};
      }});
  }
  return <main><h1>日常小事</h1><p>本地模拟预览，不读取账号和私人记录。</p><button onClick={()=>{failures.current=true;void refresh();}}>模拟照片失败与慢成就</button>
    {["dates","achievements","shots"].map(key=><section key={key}><h2>{{dates:"纪念日",achievements:"成就",shots:"每日一拍"}[key]}</h2>
      <FunLabsFeedback title={{dates:"纪念日",achievements:"成就",shots:"照片"}[key]} section={state.sections[key]} hasSavedData={key!=="achievements"} onRetry={()=>{failures.current=false;void refresh([key]);}} />
      {key==="dates"&&state.dates.map(row=><p key={row.id}>{row.title} · {row.event_date}</p>)}
      {key==="shots"&&<p>{state.shots.today?.note}</p>}
      {state.sections[key].status==="success"&&<small>已更新</small>}
    </section>)}</main>;
}

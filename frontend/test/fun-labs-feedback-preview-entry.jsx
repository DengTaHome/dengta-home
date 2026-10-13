import { createRoot } from "react-dom/client";
import Preview from "./fun-labs-feedback-preview.jsx";

const root=createRoot(document.getElementById("root"));
root.render(<Preview/>);
const style=document.createElement("style");style.textContent=`*{box-sizing:border-box}body{margin:0;background:#f7f5f1;color:#29272b;font:15px/1.7 system-ui,sans-serif}main{max-width:550px;margin:auto;padding:20px 16px}h1{font-size:28px}h2{font-size:19px}section{margin:18px 0;padding:16px;background:white;border-radius:20px;min-width:0}button{font:inherit;min-height:44px;border:1px solid #dedad3;border-radius:12px;background:#fff;padding:8px 12px;cursor:pointer}.chat-error-log-detail{overflow-wrap:anywhere}small{color:#635d66}`;document.head.append(style);
if(import.meta.hot)import.meta.hot.dispose(()=>{root.unmount();style.remove();});

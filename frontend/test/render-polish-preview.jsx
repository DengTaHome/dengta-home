import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import SettingsFlowField from "../src/SettingsFlowField.jsx";
import StatusFlowField from "../src/StatusFlowField.jsx";
import CelestialBackdrop from "../src/CelestialBackdrop.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/cozy-theme.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/jelly-motion.css";
import "../src/sun-glass-chat.css";
import "../src/typography.css";
import "../src/interaction-polish.css";
import "../src/interface-polish.css";

// Instrument only this disposable preview's real canvas submissions, without changing shaders or scheduling.
const metrics = {settings:[], status:[]}, wrapped = new WeakSet(), extensions = new WeakMap();
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (...args) {
  const gl = originalGetContext.apply(this, args);
  const kind = this.classList.contains("settings-flow-canvas") ? "settings" : this.classList.contains("status-flow-canvas") ? "status" : "";
  if (!kind || !gl || !String(args[0]).startsWith("webgl") || wrapped.has(gl)) return gl;
  wrapped.add(gl);
  const record = {draws:0, errors:[], firstDraw:null, lastDraw:null, created:{}, deleteRequested:{}, gl};
  metrics[kind].push(record);
  for (const name of ["drawArrays", "drawElements"]) {
    const original = gl[name];
    gl[name] = function (...values) {
      const result = original.apply(gl, values), now = performance.now();
      record.draws++; record.firstDraw ??= now; record.lastDraw = now;
      const error = gl.getError(); if (error && !record.errors.includes(error)) record.errors.push(error);
      return result;
    };
  }
  for (const resource of ["Shader", "Program", "Buffer", "Texture", "Framebuffer"]) {
    for (const operation of ["create", "delete"]) {
      const name = operation + resource, original = gl[name];
      gl[name] = function (...values) {
        const result = original.apply(gl, values);
        const counts = operation === "create" ? record.created : record.deleteRequested;
        if (operation === "delete" ? values[0] : result) counts[resource] = (counts[resource] || 0) + 1;
        return result;
      };
    }
  }
  return gl;
};
if (import.meta.hot) import.meta.hot.dispose(() => { HTMLCanvasElement.prototype.getContext = originalGetContext; });

const snapshot = getCelestialSnapshot(new Date("2026-10-06T04:00:00Z"), "day");
applyThemePreferences(DEFAULT_THEME_PREFERENCES, snapshot, document.documentElement);
const stageStyle = {position:"relative",inset:"auto",width:"100%",height:270,minHeight:270,maxHeight:270,overflow:"hidden",borderRadius:22,transform:"none",opacity:1,visibility:"visible"};

function readMetrics() {
  return Object.fromEntries(Object.entries(metrics).map(([kind, records]) => [kind, records.map(({gl,...record}) => ({...record,contextLost:gl.isContextLost()}))]));
}
function contextAction(kind, restore) {
  const gl = metrics[kind].at(-1)?.gl, extension = gl && (extensions.get(gl) || gl.getExtension("WEBGL_lose_context"));
  if (!extension) return "此浏览器没有提供上下文模拟扩展。";
  extensions.set(gl, extension);
  if (restore) extension.restoreContext(); else extension.loseContext();
  return restore ? "已请求恢复实际 WebGL 上下文。" : "已请求丢失实际 WebGL 上下文。";
}

export default function Preview() {
  const [settings, setSettings] = useState(true), [status, setStatus] = useState(true), [scrolling, setScrolling] = useState(false), [reduced, setReduced] = useState(false);
  const [measurement, setMeasurement] = useState({}), [notice, setNotice] = useState("");
  const scrollTimer = useRef(null);
  useEffect(() => {
    const root = document.documentElement, previous = root.dataset.dengtaReducedMotion;
    root.dataset.dengtaReducedMotion = reduced ? "true" : "false";
    return () => { if (previous === undefined) delete root.dataset.dengtaReducedMotion; else root.dataset.dengtaReducedMotion = previous; };
  }, [reduced]);
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);
  const buttonStyle = {minHeight:44,padding:"8px 12px"};
  return <><style>{`html,body,#root { height:auto!important; min-height:100%; overflow:visible!important; } #render-probe-fixture .sun-glass-floating-status-panel { position:relative!important; inset:auto!important; width:100%!important; transform:none!important; margin:0!important; }`}</style><CelestialBackdrop snapshot={snapshot} /><main id="render-probe-fixture" style={{position:"relative",zIndex:1,width:"min(100%,900px)",margin:"auto",padding:20,boxSizing:"border-box",color:"var(--theme-ink)"}}>
    <h1 style={{fontSize:24}}>图形运行验收</h1><p>实际图形组件与 shader；独立预览，没有账号、模型、声音或保存请求。计数是图形提交次数，不是手机屏幕帧率。</p>
    <nav style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
      <button style={buttonStyle} onClick={()=>setSettings(value=>!value)}>{settings ? "卸载设置背景" : "挂载设置背景"}</button>
      <button style={buttonStyle} onClick={()=>setStatus(value=>!value)}>{status ? "卸载状态背景" : "挂载状态背景"}</button>
      <button style={buttonStyle} aria-pressed={reduced} onClick={()=>setReduced(value=>!value)}>{reduced ? "恢复动态" : "减少动态"}</button>
      <button style={buttonStyle} aria-pressed={scrolling} onClick={()=>setScrolling(value=>!value)}>{scrolling ? "结束滚动状态" : "模拟持续滚动"}</button>
      <button style={buttonStyle} onClick={()=>setMeasurement(readMetrics())}>读取绘制计数</button>
    </nav>
    <h2 style={{fontSize:18}}>设置材质</h2>
    {settings && <section className={`settings-sheet${scrolling ? " is-scrolling" : ""}`} style={stageStyle} aria-label="实际设置背景">
      <SettingsFlowField /><div style={{position:"relative",zIndex:2,padding:18}}><h3>缓慢流动的色彩</h3><p>滚动时停绘，保留已有画面。</p><div className="settings-sheet-scroll" style={{height:130,overflowY:"auto"}} onScroll={()=>{setScrolling(true);window.clearTimeout(scrollTimer.current);scrollTimer.current=window.setTimeout(()=>setScrolling(false),180);}}><p style={{height:500}}>可滚动的虚构设置区域。</p></div></div>
    </section>}
    <h2 style={{fontSize:18}}>互动流体</h2>
    {status && <div className="main-panel view-chat" style={{position:"relative",height:270,padding:0,overflow:"visible"}}><div className="sun-glass-floating-status-shell expanded" style={{position:"relative",inset:"auto",width:"100%",maxWidth:"100%",height:270,transform:"none",margin:0}}><section className="sun-glass-floating-status-panel is-open" style={{...stageStyle,background:"#050507",color:"#f7f4fa"}} aria-label="实际互动流体背景"><StatusFlowField active /><div style={{position:"relative",zIndex:2,padding:18}}><h3>触摸后的色彩轨迹</h3><button style={buttonStyle}>触摸试验</button><p>在面板上触摸，观察轨迹逐渐消散。</p></div></section></div></div>}
    <nav style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>{["settings","status"].flatMap(kind=>[false,true].map(restore=><button key={`${kind}:${restore}`} style={buttonStyle} onClick={()=>setNotice(contextAction(kind,restore))}>{`${restore ? "恢复" : "模拟丢失"}${kind === "settings" ? "设置" : "状态"}上下文`}</button>))}</nav>
    <p role="status">{notice}</p><pre aria-label="实际图形测量" style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap",fontSize:12,padding:12,borderRadius:12,background:"rgb(var(--theme-card-rgb) / .9)"}}>{JSON.stringify(measurement,null,2)}</pre>
  </main></>;
}
const root = import.meta.hot?.data.previewRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.previewRoot = root;
root.render(<Preview />);

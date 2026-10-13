import { lazy, Suspense } from "react";
import FeatureAtmosphere from "./FeatureAtmosphere.jsx";

const Library = lazy(() => import("./CompanionCreativeStudio").then(module => ({ default: module.CompanionArtworkLibrary })));

export default function CompanionArtStudio({ aiName, scopeKey, onNotice, onOpenImageProviderSettings }) {
  return <section className="feature-page art-studio-page">
    <FeatureAtmosphere kind="art" />
    <div className="section-intro">
      <span className="eyebrow">留给你的灵感</span>
      <h2>涂鸦画室</h2>
      <p>看看{aiName || "伴侣"}想画什么，也可以自己上传图片。开启自主创作后，伴侣会在后台到期检查时决定是否画一张，再把完成的作品发进聊天。</p>
      <button type="button" onClick={onOpenImageProviderSettings}>自主涂鸦与图片接口设置</button>
      <small>需要启用图片接口与“自主创作”。图片调用会使用该接口的额度，可以设置调用上限，也可以随时关闭。</small>
    </div>
    <Suspense fallback={<p role="status">正在打开涂鸦画册…</p>}>
      <Library key={scopeKey} aiName={aiName} onNotice={onNotice} onOpenImageProviderSettings={onOpenImageProviderSettings} />
    </Suspense>
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { mountSurpriseMap } from "./surprise-map-display.js";

const MESSAGES = {
  loading: "正在加载地图…",
  ready: "可拖动地图、双指缩放，点击圆圈查看来信。圆圈是模糊范围，不是精确落点。",
  unavailable: "部分地图未能加载。可切回方位图，信件与领取功能仍保留。（map_tiles_unavailable）",
  timeout: "地图加载超时，可切回方位图后重新开启。（map_tiles_timeout）",
  failed: "地图组件未能加载，可切回方位图后重新开启。（map_display_failed）",
};
export default function SurpriseLetterMap({ items, position, selectedId, onSelect, mount = mountSurpriseMap }) {
  const host = useRef(null), runtime = useRef(null), select = useRef(onSelect);
  const [status, setStatus] = useState("loading");
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const controller = mount(host.current, { onStatus: setStatus, onSelect: id => select.current?.(id) });
    runtime.current = controller;
    return () => { controller.destroy(); if (runtime.current === controller) runtime.current = null; };
  }, [mount]);
  useEffect(() => { runtime.current?.update({ items, position, selectedId }); }, [items, position, selectedId]);
  return <section className="surprise-map-interactive" aria-label="沿途信件地图">
    <div className="surprise-map-canvas" ref={host} role="region" aria-label="可拖动缩放的地理地图" />
    <p role="status" className="surprise-map-map-status">{MESSAGES[status] || MESSAGES.failed}</p>
    <button type="button" onClick={() => runtime.current?.fit()}>查看全部信件范围</button>
  </section>;
}

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { boxKey, measureIndicator } from "./sliding-indicator-geometry.js";
import "./sliding-indicator.css";

/**
 * SlidingIndicator —— 从一个容器里索要「当前激活项」的位置，画一块会滑动的底衬。
 *
 * 本文件是**从生产前端产物逆向还原**的（assets/SlidingIndicator-*.js，1.9 KB）。
 * 编译后的代码逐字对读得到的行为如下，未做任何推测性增强：
 *   - 位置 = 激活项相对容器内容盒的偏移（含容器自身 scrollLeft/scrollTop）；
 *   - 容器或激活项尺寸 < 1px 时不显示（避免布局未完成时闪一下）；
 *   - 首次落位时临时关掉 transition，避免从左上方飞进来；
 *   - 监听 ResizeObserver / MutationObserver / window resize / 容器 scroll / 字体加载完成；
 *   - activeKey 或 revision 变化时重新落位；
 *   - 全程 requestAnimationFrame 合并，位置以传入的 ref 为准，不按选择器查 DOM。
 *
 * 与产物唯一的结构差异：几何计算抽到 sliding-indicator-geometry.js，便于测试。
 */

const RAF = globalThis.requestAnimationFrame || ((callback) => globalThis.setTimeout(callback, 16));
const CAF = globalThis.cancelAnimationFrame || globalThis.clearTimeout;

export default function SlidingIndicator({
  containerRef,
  activeRef,
  activeKey = "",
  revision = "",
  className = "",
}) {
  const indicatorRef = useRef(null);
  const paintedRef = useRef(false);
  const frameRef = useRef(0);
  const lastBoxRef = useRef("");

  const apply = useCallback(() => {
    const indicator = indicatorRef.current;
    const container = containerRef?.current;
    const active = activeRef?.current;

    if (!indicator || !container || !active) {
      if (indicator) indicator.style.opacity = "0";
      return undefined;
    }
    if (!indicator.style) return undefined;

    const box = measureIndicator(container, active);
    if (!box) {
      indicator.style.opacity = "0";
      return undefined;
    }

    const key = boxKey(box);
    const moved = key !== lastBoxRef.current;
    lastBoxRef.current = key;

    indicator.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
    indicator.style.width = `${box.width}px`;
    indicator.style.height = `${box.height}px`;
    indicator.style.opacity = "1";

    if (!paintedRef.current) {
      paintedRef.current = true;
      // 首帧必须关掉过渡，否则第一次出现会从左上角滑过来。
      indicator.style.transition = "none";
      RAF(() => {
        if (indicatorRef.current === indicator) indicator.style.transition = "";
      });
    }

    return moved;
  }, [activeRef, containerRef]);

  const schedule = useCallback(() => {
    CAF(frameRef.current);
    frameRef.current = RAF(apply);
  }, [apply]);

  useLayoutEffect(() => {
    schedule();
  }, [activeKey, revision, schedule]);

  useEffect(() => {
    paintedRef.current = false;
    lastBoxRef.current = "";
    schedule();

    const container = containerRef?.current;
    const active = activeRef?.current;

    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (container) resizeObserver?.observe(container);
    if (active) resizeObserver?.observe(active);

    const mutationObserver =
      typeof MutationObserver === "function" && container
        ? new MutationObserver(schedule)
        : null;
    mutationObserver?.observe(container, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    globalThis.window?.addEventListener?.("resize", schedule, { passive: true });
    container?.addEventListener?.("scroll", schedule, { passive: true });
    globalThis.document?.fonts?.ready?.then?.(schedule).catch?.(() => {});

    return () => {
      CAF(frameRef.current);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      globalThis.window?.removeEventListener?.("resize", schedule);
      container?.removeEventListener?.("scroll", schedule);
    };
  }, [activeRef, containerRef, schedule, revision]);

  return (
    <span
      ref={indicatorRef}
      className={`sliding-indicator${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    />
  );
}

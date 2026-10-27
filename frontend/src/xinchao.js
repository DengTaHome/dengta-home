import { useEffect, useState } from "react";
import { apiRequest } from "./api.js";

/**
 * 心潮 (xinchao) 前端数据层。
 *
 * 与后端契约一一对应（见 backend/docs/xinchao.md）：
 *   GET /api/v2/xinchao/state -> { configured: boolean, state: object|null }
 *
 * 纯函数放在前面，方便在不渲染 React 的情况下测。
 */

export const DRIVE_LIMIT = 5;
export const POLL_INTERVAL_MS = 60_000;
export const XINCHAO_STATE_PATH = "/api/v2/xinchao/state";

const CALM_LABEL = "平静";
// 花瓣最矮也要看得见，和样式里的 --xinchao-level 默认值保持一致。
const MIN_PETAL_LEVEL = 0.08;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampLevel(value) {
  if (!isFiniteNumber(value)) return MIN_PETAL_LEVEL;
  return Math.min(1, Math.max(MIN_PETAL_LEVEL, value));
}

export function formatPercent(value) {
  if (!isFiniteNumber(value)) return "0";
  // 线上实测的胶囊标题是「想靠近80」这种整数，不带百分号。
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}`;
}

export function percentWidth(value) {
  if (!isFiniteNumber(value)) return 0;
  return Math.min(1, Math.max(0, value)) * 100;
}

/**
 * 只保留结构完整、value 合法的驱动项，按 value 降序取前 5 个。
 * 后端多给几项是允许的（现在是 6 项），前端只画 5 片花瓣。
 */
export function sortDrives(drives) {
  if (!Array.isArray(drives)) return [];
  return drives
    .filter((drive) => drive && typeof drive.key === "string" && isFiniteNumber(drive.value))
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, DRIVE_LIMIT)
    .map((drive) => ({
      ...drive,
      label: typeof drive.label === "string" && drive.label ? drive.label : drive.key,
    }));
}

export function emotionLabel(state) {
  const label = state?.emotion?.label;
  return typeof label === "string" && label ? label : CALM_LABEL;
}

/**
 * 胶囊的 title / aria-label：情绪 · 每项「标签+百分比」，用 " / " 连接。
 * 没有驱动项时退化成「情绪 · 心潮」。
 */
export function capsuleTitle(state) {
  const drives = sortDrives(state?.drives);
  const label = emotionLabel(state);
  if (!drives.length) return `${label} · 心潮`;
  return `${label} · ${drives.map((drive) => `${drive.label}${formatPercent(drive.value)}`).join(" / ")}`;
}

/**
 * consciousness 只可能是 'awake' 或 null。
 * 后端若误传了别的英文枚举，这里也必须吞掉——否则界面会直接印出 "drowsy"。
 */
export function consciousnessLabel(value) {
  return value === "awake" ? "此刻醒着" : "心潮流动";
}

export function formatLastConversation(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 校验并归一化响应。configured !== true 或 state 缺失都视为「功能未启用」。
 */
export function normalizeXinchaoPayload(payload) {
  if (!payload || payload.configured !== true) return null;
  const state = payload.state;
  if (!state || typeof state !== "object") return null;
  return {
    emotion: { label: emotionLabel(state) },
    drives: sortDrives(state.drives),
    consciousness: state.consciousness === "awake" ? "awake" : null,
    revision: isFiniteNumber(state.revision) ? state.revision : 0,
    lastConversationAt: typeof state.lastConversationAt === "string" ? state.lastConversationAt : null,
  };
}

export function petalStyle(drive, index) {
  return {
    "--xinchao-level": clampLevel(drive?.value),
    "--xinchao-index": index,
  };
}

/**
 * 轮询心潮状态。
 *
 * 行为对齐生产前端：
 *   - 页面隐藏时不请求（省电、省流量）；
 *   - 默认 60 秒一次；
 *   - 失败不抛给界面，保留上一次成功值 —— 心潮是装饰性信息，不能因为挂掉就弹错。
 */
export function useXinchaoState({
  enabled = true,
  intervalMs = POLL_INTERVAL_MS,
  request = apiRequest,
} = {}) {
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const tick = async () => {
      if (globalThis.document?.visibilityState === "hidden") return;
      try {
        const payload = await request(XINCHAO_STATE_PATH);
        if (cancelled) return;
        setState(normalizeXinchaoPayload(payload));
        setFailed(false);
      } catch {
        if (cancelled) return;
        // 保留上一次的 state，只标记失败。
        setFailed(true);
      }
    };

    tick();
    const timer = globalThis.setInterval?.(tick, intervalMs);
    return () => {
      cancelled = true;
      if (timer) globalThis.clearInterval(timer);
    };
  }, [enabled, intervalMs, request]);

  // 关闭时直接对外表现为「没有状态」，而不是在 effect 里同步 setState(null)
  // —— 那会触发级联渲染，eslint 的 react-hooks/set-state-in-effect 也会拦下来。
  return {
    state: enabled ? state : null,
    failed: enabled ? failed : false,
  };
}

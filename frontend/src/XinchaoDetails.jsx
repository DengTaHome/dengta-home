import { X } from "lucide-react";
import {
  consciousnessLabel,
  emotionLabel,
  formatLastConversation,
  formatPercent,
  percentWidth,
  sortDrives,
} from "./xinchao.js";
import "./xinchao.css";

/**
 * 心潮详情：每条驱动项一根进度条 + 底部元信息。
 *
 * inline=true 时不再做成悬浮卡片，而是嵌进状态面板里（生产前端就是这么用的，
 * 对应 .xinchao-details.is-inline）。inline 时是 region，否则是 dialog。
 */
function XinchaoDetails({
  state,
  aiName = "伴侣",
  onClose,
  inline = false,
  anchorStyle,
}) {
  const drives = sortDrives(state?.drives);
  const label = emotionLabel(state);
  const lastSeen = formatLastConversation(state?.lastConversationAt);

  return (
    <div
      className={`xinchao-details${inline ? " is-inline" : ""}`}
      style={anchorStyle}
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : false}
      aria-label={`${aiName}的心潮状态`}
    >
      <header className="xinchao-details-header">
        <div>
          <small>心潮</small>
          <strong>{label}</strong>
        </div>
        {typeof onClose === "function" ? (
          <button type="button" aria-label="关闭心潮详情" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="xinchao-details-drives">
        {drives.map((drive) => (
          <div className="xinchao-details-drive" key={drive.key}>
            <span>{drive.label}</span>
            <span className="xinchao-details-track" aria-hidden="true">
              <span style={{ width: `${percentWidth(drive.value)}%` }} />
            </span>
            <b>{formatPercent(drive.value)}</b>
          </div>
        ))}
      </div>

      <footer className="xinchao-details-meta">
        <span>{consciousnessLabel(state?.consciousness)}</span>
        {lastSeen ? <span>上次聊天 {lastSeen}</span> : null}
        {state?.revision ? <span>第 {state.revision} 次变化</span> : null}
      </footer>
    </div>
  );
}

export default XinchaoDetails;

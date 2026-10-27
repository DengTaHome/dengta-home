import { memo } from "react";
import {
  capsuleTitle,
  emotionLabel,
  petalStyle,
  sortDrives,
} from "./xinchao.js";
import "./xinchao.css";

/**
 * 心潮胶囊：五片会呼吸的花瓣 + 「情绪 / 主导驱动项」+ 版本号。
 *
 * 结构对齐生产前端：.xinchao-capsule > .xinchao-capsule-petals(5×petal)
 *                                  + .xinchao-capsule-copy(small+strong)
 *                                  + .xinchao-capsule-revision
 */
function XinchaoCapsule({ state, onOpen, className = "", as = "button" }) {
  const drives = sortDrives(state?.drives);
  const label = emotionLabel(state);
  const dominant = drives[0] || null;
  const title = capsuleTitle(state);

  const Tag = as;
  const interactive = typeof onOpen === "function";
  const extra = Tag === "button" ? { type: "button", onClick: onOpen } : { onClick: onOpen };

  return (
    <Tag
      className={`xinchao-capsule${className ? ` ${className}` : ""}`}
      title={title}
      aria-label={title}
      {...(interactive ? extra : {})}
    >
      <span className="xinchao-capsule-petals" aria-hidden="true">
        {drives.map((drive, index) => (
          <span
            key={drive.key}
            className="xinchao-capsule-petal"
            style={petalStyle(drive, index)}
          />
        ))}
      </span>
      <span className="xinchao-capsule-copy">
        <small>{label}</small>
        <strong>{dominant ? dominant.label : "心潮"}</strong>
      </span>
      {state?.revision ? (
        <span className="xinchao-capsule-revision" aria-hidden="true">
          {state.revision}
        </span>
      ) : null}
    </Tag>
  );
}

export default memo(XinchaoCapsule);

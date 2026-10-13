import ChatErrorLog from "./ChatErrorLog.jsx";
import { FUN_LABS_ERROR_FEEDBACK } from "./fun-labs-refresh.js";
import "./fun-labs-feedback.css";

export default function FunLabsFeedback({ section, title, hasSavedData = false, onRetry }) {
  if (!section || !["busy", "error"].includes(section.status)) return null;
  const busy = section.status === "busy";
  const code = section.diagnostic?.error_code;
  const reason = section.diagnostic?.http_status === 401 || section.diagnostic?.http_status === 403
    ? "请检查登录状态与当前伴侣，再重试。"
    : FUN_LABS_ERROR_FEEDBACK[code]?.reason || "具体原因尚未确认，请重试并查看日志。";
  return <div className={`fun-labs-feedback ${busy ? "is-busy" : "is-error"}`}>
    <div className="fun-labs-feedback-row">
      <p role="status">{busy ? `正在更新${title}…` : `${title}暂时无法读取。`}
        {hasSavedData && <span>保留上次加载成功的记录。</span>}
      </p>
      {!busy && <button type="button" className="fun-labs-retry" onClick={onRetry} aria-label={`重试${title}`}>↻ 重试</button>}
    </div>
    {!busy && <><small>{reason} {code && `错误代码：${code}`} {section.diagnostic?.http_status && `HTTP：${section.diagnostic.http_status}`}</small>
      <ChatErrorLog key={section.diagnostic?.error_log_id || code} logId={section.diagnostic?.error_log_id} diagnostic={section.diagnostic} feedbackByCode={FUN_LABS_ERROR_FEEDBACK} />
    </>}
  </div>;
}

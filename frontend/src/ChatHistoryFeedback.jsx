import "./chat-history-feedback.css";

export default function ChatHistoryFeedback({ state, onRetry, onInspect }) {
  const loading = state?.status === "loading";
  return <div className="chat-history-feedback" role={loading ? "status" : "alert"} aria-busy={loading}>
    <strong>{loading ? "正在读取聊天记录…" : "聊天记录暂时没有读取成功"}</strong>
    {loading ? <p>记录确认后会显示在这里。</p> : <>
      <p>{state.error.code === "session_receipt_invalid" ? "服务器返回的聊天记录格式不完整，请重新读取；这不代表记录已经丢失。" : `${state.error.reason} ${state.error.action}`}</p>
      <small>错误代码：{state.error.code}{state.error.status ? ` · HTTP ${state.error.status}` : ""} · DT-SESSIONS</small>
      <div>
        <button type="button" onClick={onRetry}>重新读取</button>
        <button type="button" onClick={onInspect}>查看操作日志</button>
      </div>
      <small>这里只重新读取记录，不会再次发送消息。</small>
    </>}
  </div>;
}

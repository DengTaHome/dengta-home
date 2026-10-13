import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CHAT_SEND_PREPARATION_LABELS } from "../src/chat-send-preparation.js";
import { prepare } from "./chat-send-preparation-preview-operation.js";
import "../src/index.css";
import "../src/native-feel.css";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
export default function Preview() {
  const [text, setText] = useState("虚构消息：一起看今天的云。"), [stage, setStage] = useState("");
  const [notice, setNotice] = useState(""), [sending, setSending] = useState(false), [calls, setCalls] = useState(0);
  const request = useRef(null), lock = useRef({ current: false }), settings = useRef(null), model = useRef(null);
  const session = useRef({ current: "a" });
  function send() {
    if (lock.current.current) return;
    settings.current = deferred(); model.current = deferred(); setNotice("");
    void prepare({
      isSendingRef: lock.current, setIsSending: setSending, activeSessionIdRef: session.current,
      abortChatRequest: (ref, reason) => { if (ref.current) { ref.current.cancelReason = reason; ref.current.controller.abort(reason); } },
      chatRequestRef: request, preserveComposer: false, attachmentsToSend: [],
      refreshDeviceActivityContext: () => Promise.resolve(), setSendPreparationStage: setStage,
      flushLatestSettingsDraft: () => settings.current.promise,
      sessionModelSaveQueueRef: { current: model.current.promise }, componentMountedRef: { current: true },
      releaseChatRequestAttachments: () => {}, setNotice,
      onReady: () => { setCalls(value => value + 1); setNotice("模拟发送一次，无真实模型或账号请求。"); lock.current.current = false; setSending(false); request.current = null; },
    });
  }
  return <main><h1>发送准备验收</h1><p>运行从 App 提取的实际准备代码，无账号、无网络请求。</p>
    <label>虚构消息<textarea value={text} onChange={event => setText(event.target.value)} rows={4} /></label>
    <div className="composer-wrap">{stage && <small className="composer-send-preparation" role="status" aria-live="polite">{CHAT_SEND_PREPARATION_LABELS[stage]}</small>}
      <button onClick={() => sending ? request.current?.controller.abort("user-cancel") : send()}>{sending ? "停止等待" : "发送虚构消息"}</button>
    </div><div className="controls">
      <button onClick={() => settings.current?.resolve(true)}>设置保存成功</button>
      <button onClick={() => settings.current?.resolve(false)}>设置保存失败</button>
      <button onClick={() => model.current?.resolve()}>模型确认成功</button>
      <button onClick={() => { session.current.current = "b"; request.current?.controller.abort("session-change"); }}>切换虚构会话</button>
    </div><p role="status" aria-label="本次结果">{notice}</p><output aria-label="模拟发送次数">模拟发送次数：{calls}</output>
  </main>;
}
const previewRoot = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.root = previewRoot;
previewRoot.render(<Preview />);

import { useSyncExternalStore } from "react";
import { readOperationFailures, clearOperationFailures, subscribeOperationFailures } from "./operation-diagnostics.js";
import "./error-log-ui.css";

export default function LocalDiagnostics({ scope }) {
  const entries = useSyncExternalStore(subscribeOperationFailures, () => readOperationFailures(scope), () => readOperationFailures(scope));
  return <section className="settings-card error-logs-card" aria-label="本机操作诊断">
    <h3>本机操作诊断</h3>
    <p className="card-hint">记录本次打开期间的接口失败，供排查网络和操作入口。只保留编号、时间及技术状态，不记录输入内容；没有记录不代表所有功能都已验收。</p>
    <button type="button" disabled={!entries.length} onClick={() => clearOperationFailures(scope)}>清空本机诊断</button>
    {!entries.length ? <p>本次打开尚未记录接口失败。</p> : <ul className="error-logs-list">{entries.map(entry => <li className="error-log-item" key={entry.id}>
      <strong>{entry.code} · {entry.label}</strong><p>{entry.kind}{entry.status ? ` · HTTP ${entry.status}` : ""}</p>
      {entry.reasonCode && <p>具体代码：{entry.reasonCode}</p>}
      <small>{new Date(entry.at).toLocaleTimeString("zh-CN")} · {entry.source}</small>
      {entry.logId && <p>服务端日志编号：{entry.logId}</p>}
    </li>)}</ul>}
  </section>;
}

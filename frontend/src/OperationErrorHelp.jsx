import { describeOperationError } from "./operation-error-help.js";

export default function OperationErrorHelp({ diagnostic, onOpenSettings }) {
  const detail = describeOperationError(diagnostic);
  return <div className="operation-error-help">
    <p><strong>发生了什么</strong><span>{detail.reason}</span></p>
    <p><strong>下一步</strong><span>{detail.action}</span></p>
    {detail.settingsCategory && onOpenSettings && <button type="button" onClick={() => onOpenSettings(detail.settingsCategory)}>检查相关设置</button>}
  </div>;
}

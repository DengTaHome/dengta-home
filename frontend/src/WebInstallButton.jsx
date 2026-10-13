import { useState, useSyncExternalStore } from "react";
import { pwaInstallController } from "./pwa-install.js";

export default function WebInstallButton({
  controller = pwaInstallController,
  className = "web-install-button",
  promptLabel = "安装到这部手机",
  guidanceLabel = "添加网页版本到手机",
  onFeedback,
  showFeedback = true,
}) {
  const canPrompt = useSyncExternalStore(
    controller.subscribe,
    controller.canPrompt,
    () => false,
  );
  const [feedback, setFeedback] = useState("");

  if (controller.isInstalled()) return null;

  async function install() {
    const result = await controller.install();
    setFeedback(result.message);
    onFeedback?.(result.message);
  }

  return (
    <div className="web-install">
      <button type="button" className={className} onClick={install}>
        {canPrompt ? promptLabel : guidanceLabel}
      </button>
      {showFeedback && feedback && (
        <p className="web-install-guidance" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

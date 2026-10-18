import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authSession } from "./auth-session.js";
import { settingsSaveScope } from "./settings-save-scope.js";
import { readWhereaboutsConsent, setWhereaboutsConsent, subscribeWhereaboutsConsent } from "./whereabouts-consent.js";
import { requestWhereaboutsPermissions, whereaboutsPluginAvailable } from "./whereabouts.js";

export default function WhereaboutsConsentSettings({ scopeKey, session = authSession, storage,
  supported = whereaboutsPluginAvailable(), requestPermissions = requestWhereaboutsPermissions }) {
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState("");
  const alive = useRef(false), pending = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current = null; }; }, []);
  const snapshot = useCallback(() => settingsSaveScope(session.getSnapshot()) === scopeKey && readWhereaboutsConsent(scopeKey, storage), [scopeKey, session, storage]);
  const subscribe = useCallback(listener => {
    const unsubscribe = subscribeWhereaboutsConsent(listener), unsubscribeSession = session.subscribe?.(listener);
    window.addEventListener?.("storage", listener);
    return () => { unsubscribe(); unsubscribeSession?.(); window.removeEventListener?.("storage", listener); };
  }, [session]);
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false);

  async function toggle() {
    if (pending.current || !supported || settingsSaveScope(session.getSnapshot()) !== scopeKey) return;
    const token = {}; pending.current = token; setFeedback("");
    const current = () => alive.current && pending.current === token && settingsSaveScope(session.getSnapshot()) === scopeKey;
    try {
      if (enabled) {
        setWhereaboutsConsent(scopeKey, false, storage);
        if (current()) setFeedback("已停止新增行踪记录，已保存的历史不会自动删除。");
      } else {
        setBusy(true);
        const permission = await requestPermissions();
        if (!current()) return;
        if (permission?.granted !== true) {
          setFeedback("未获得精确定位权限，定期记录仍然关闭。（location_permission_denied）");
          return;
        }
        setWhereaboutsConsent(scopeKey, true, storage);
        if (current()) setFeedback("已为当前账号和伴侣开启本设备的定期记录；可随时关闭。");
      }
    } catch {
      if (current()) setFeedback("本设备未能确认保存授权，定期记录保持关闭。（whereabouts_consent_unavailable）");
    } finally {
      if (current()) { pending.current = null; setBusy(false); }
    }
  }

  return <div className="notification-feature-panel device-activity-panel">
    <div className="device-activity-heading"><div><strong>定期记录行踪</strong><span>{supported ? "当前账号与伴侣 · 仅此设备" : "Android 功能 · 网页不采集"}</span></div>
      <button type="button" className={`privacy-switch${enabled ? " is-on" : ""}`} role="switch" aria-label="定期记录行踪" aria-checked={enabled} disabled={busy || !supported} onClick={() => void toggle()}><span aria-hidden="true" /></button>
    </div>
    <p>默认关闭。开启后，灯塔在前台每 20 分钟及返回前台时读取精确位置和电量，并将行踪记录保存到当前账号与伴侣的服务器空间。</p>
    <small>藏宝信的一次定位、天气定位及系统定位授权都不会自动开启此功能。关闭后停止新增记录，已保存历史不自动删除。</small>
    {feedback && <p className="notification-feature-feedback" role="status" aria-live="polite">{feedback}</p>}
  </div>;
}

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { deviceActivityPluginAvailable, openNotificationAccessSettings, readNotificationAccessState } from "./device-activity";
import { createNotificationAccessMonitor } from "./notification-access-monitor";

export function useNotificationAccess() {
  const [state, setState] = useState(() => ({ supported: deviceActivityPluginAvailable(), granted: false, checking: deviceActivityPluginAvailable(), opening: false, errorCode: "", errorMessage: "" }));
  const [monitor] = useState(() => createNotificationAccessMonitor({ supported: deviceActivityPluginAvailable(), read: () => readNotificationAccessState({ strict: true }), open: openNotificationAccessSettings, listen: callback => App.addListener("appStateChange", callback), onState: setState }));
  useEffect(() => monitor.start(), [monitor]);
  return { state, request: monitor.request, refresh: monitor.refresh };
}

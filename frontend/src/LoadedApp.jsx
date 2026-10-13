import { useEffect } from "react";
import App from "./LazyApp.jsx";
import { markAppLoaded } from "./app-startup-recovery.js";

export default function LoadedApp(props) {
  useEffect(() => {
    markAppLoaded();
  }, []);
  return <App {...props} />;
}

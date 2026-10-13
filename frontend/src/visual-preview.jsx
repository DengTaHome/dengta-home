import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import "./index.css";
import "./cozy-theme.css";
import "./auth.css";
import "./native-feel.css";
import "./apple-ui.css";
import "./sun-glass-ui.css";
import "./jelly-motion.css";
import "./sun-glass-chat.css";
import "./typography.css";
import "./apple-high.css";
import App from "./App.jsx";

function setRangeValue(selector, value) {
  const input = document.querySelector(selector);
  if (!input || !Number.isFinite(value)) return;
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function VisualPreview() {
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const timerId = window.setTimeout(() => {
      if (search.has("time")) {
        setRangeValue(
          ".sun-glass-time-slider",
          Number(search.get("time")),
        );
      }
      if (search.has("glass")) {
        setRangeValue(
          '.sun-glass-tuner input[type="range"]',
          Number(search.get("glass")),
        );
      }
      const weather = search.get("weather");
      if (weather) {
        const labels = {
          cloudy: "微云",
          rain: "雨幕",
          storm: "晴雷",
          clear: "晴空",
        };
        document
          .querySelector(`.sun-glass-weather-options [aria-label="${labels[weather]}"]`)
          ?.click();
      }
      if (search.get("status") === "open") {
        document.querySelector(".sun-glass-status-ribbon")?.click();
      }
    }, 240);
    return () => window.clearTimeout(timerId);
  }, []);

  return <App accountControl={null} userName="桃桃" visualPreview />;
}

createRoot(document.getElementById("root")).render(
  <VisualPreview />,
);

// Browser-only fixture: no real credentials, account, model, or service requests.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import App from "../src/App.jsx";
import AuthGate from "../src/AuthGate.jsx";
import { authSession, createAuthSessionManager } from "../src/auth-session.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";
import LocalMemorySummaries from "../src/LocalMemorySummaries.jsx";
import { applyThemePreferences, DEFAULT_THEME_PREFERENCES, getCelestialSnapshot } from "../src/dengta-theme.js";
import "../src/index.css";
import "../src/cozy-theme.css";
import "../src/auth.css";
import "../src/native-feel.css";
import "../src/apple-ui.css";
import "../src/sun-glass-ui.css";
import "../src/jelly-motion.css";
import "../src/sun-glass-chat.css";
import "../src/typography.css";
import "../src/apple-high.css";
import "../src/room-invite.css";
import "../src/settings-media-polish.css";
import "../src/interaction-polish.css";
import "../src/interface-polish.css";
import "../src/startup-recovery.css";
import "../src/voice-composer.css";
import "../src/login-experience.css";
import "../src/animation-budget.css";
import "../src/ios.css";

const anonymousManager = createAuthSessionManager({
  supabaseUrl: "https://fictional.example.test",
  supabaseAnonKey: "fictional-public-placeholder",
  storage: undefined,
  createClientFn: () => ({ auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  } }),
});

const mode = new URLSearchParams(location.search).get("view");
if (mode === "memory") {
  applyThemePreferences(DEFAULT_THEME_PREFERENCES, getCelestialSnapshot(new Date("2026-11-01T04:00:00Z"), "day"), document.documentElement);
}
export function MemoryFixture() {
  const [items, setItems] = useState([{ id: "20000000-0000-4000-8000-000000000001", summary: "这是一条虚构的长期记忆。周末一起去看海，把沿途的故事写进手记。", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" }]);
  const [drafts, setDrafts] = useState({});
  return <div className="app-shell" style={{ display: "block" }}><main className="feature-page memory-page" style={{ height: "var(--app-height)", overflowY: "auto", background: "var(--theme-background)", color: "var(--theme-ink)" }}><div className="section-intro"><span className="eyebrow">虚构数据 · 组件布局验收</span><h2>长期记忆</h2></div><LocalMemorySummaries scopeKey={settingsSaveScope(authSession.getSnapshot())} items={items} drafts={drafts} onItemsChange={setItems} onDraftsChange={setDrafts} /></main></div>;
}

const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(mode === "auth"
  ? <AuthGate sessionManager={anonymousManager}><p>仅供虚构 UI 验证</p></AuthGate>
  : mode === "memory" ? <MemoryFixture /> : <App accountControl={null} userName="虚构测试用户" visualPreview />);

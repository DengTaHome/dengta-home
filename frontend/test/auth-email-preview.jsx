import { createRoot } from "react-dom/client";
import { GoTrueClient } from "@supabase/auth-js";
import AuthGate from "../src/AuthGate.jsx";
import { createAuthSessionManager } from "../src/auth-session.js";
import "../src/index.css";

const auth = new GoTrueClient({
  url: "https://auth.example.test/auth/v1", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  fetch: async (url) => {
    if (!String(url).endsWith("/verify")) throw new Error("fixture only verifies fictional links");
    return new Response(JSON.stringify({
      access_token: "fictional-access", refresh_token: "fictional-refresh", token_type: "bearer", expires_in: 3600,
      user: { id: "fictional-user", email: "fixture@example.test", email_confirmed_at: "2026-10-01T00:00:00Z" },
    }), { headers: { "content-type": "application/json" } });
  },
});
const manager = createAuthSessionManager({
  supabaseUrl: "https://auth.example.test", supabaseAnonKey: "fictional-public-key", storage: undefined,
  createClientFn: () => ({ auth }),
});
export default function Preview() {
  return <AuthGate sessionManager={manager}><p role="status">虚构邮箱验证成功。无真实账号、邮件或认证服务请求。</p></AuthGate>;
}
const root = import.meta.hot?.data.root || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Preview />);

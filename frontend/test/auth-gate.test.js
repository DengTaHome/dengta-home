import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(here, "..", "src", "AuthGate.jsx"),
  "utf8",
);
const main = fs.readFileSync(
  path.join(here, "..", "src", "main.jsx"),
  "utf8",
);
const lazyApp = fs.readFileSync(
  path.join(here, "..", "src", "LazyApp.jsx"),
  "utf8",
);
const app = fs.readFileSync(
  path.join(here, "..", "src", "App.jsx"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(here, "..", "src", "auth.css"),
  "utf8",
);

assert.match(main, /<AuthGate>/);
assert.match(
  lazyApp,
  /lazy\(\(\) => import\("\.\/App\.jsx"\)\)/,
  "the authenticated application must not inflate the login/loading bundle",
);
assert.match(main, /<App[\s\S]*accountControl=\{accountControl\}/);
assert.match(main, /<LoadedApp key=\{JSON\.stringify\(\[snapshot\.user\?\.id, snapshot\.activeCompanionId\]\)\}/,
  "the application must remount when either the account or companion changes");
assert.match(main, /accountScope=\{snapshot\.user\?\.id \|\| ""\}/);
assert.match(main, /userName=\{snapshot\.user\?\.displayName\}/);
assert.match(
  app,
  /function App\(\{ accountControl = null, accountScope = "", userName = "" \}\)/,
);
assert.match(app, /className="sidebar-account-slot"/);

assert.match(source, /sessionManager\.initialize\(\)/);
assert.match(source, /sessionManager\.subscribe\(setSnapshot\)/);
assert.match(source, /sessionManager\.signIn\(\{ email, password \}\)/);
assert.match(source, /sessionManager\.signUp\(/);
assert.match(source, /sessionManager\.resendVerification\(/);
assert.match(source, /sessionManager\.requestPasswordReset\(/);
assert.match(source, /sessionManager\.updatePassword\(/);
assert.match(source, /sessionManager\.signOut\(\)/);
assert.match(source, /emailVerificationRequired/);
assert.match(
  source,
  /Capacitor\.isNativePlatform\(\)/,
  "native signup must not send the WebView localhost origin as an email redirect",
);
assert.match(source, /AUTH_STATUS\.expired/);
assert.match(source, /VITE_SUPABASE_URL/);
assert.match(source, /VITE_SUPABASE_ANON_KEY/);
assert.match(source, /publishable\/anon key/);
assert.match(source, /不能填写 service role/);
assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);

assert.match(source, /type="email"/);
assert.match(source, /type="password"/);
assert.match(source, /"current-password"/);
assert.match(source, /"new-password"/);
assert.match(
  source,
  /minLength=\{\s*\["register", "reset"\]\.includes\(mode\) \? 8 : undefined\s*\}/,
);
assert.match(source, /role="alert"/);
assert.match(source, /aria-busy="true"/);
assert.match(source, /aria-expanded=\{open\}/);
assert.match(source, /忘记密码/);
assert.match(source, /发送重置邮件/);
assert.match(source, /保存新密码/);
assert.match(source, /AUTH_STATUS\.recovery/);

assert.match(css, /\.auth-page\s*\{/);
assert.match(css, /\.account-menu-popover\s*\{/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /@media \(max-width: 820px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(
  css,
  /font-size:\s*clamp\([^;]*vw/,
  "authentication text must not resize continuously with viewport width",
);

console.log("可见认证门、邮箱验证与退出入口测试通过。");

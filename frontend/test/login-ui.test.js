// 登录页体验的静态守卫（真机行为由 tools/browser-verify/verify-login.mjs 覆盖）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

const gate = read("AuthGate.jsx");
const css = read("login-experience.css");
const main = read("main.jsx");

// 密码可见切换：移动端长密码必须能肉眼校验
assert.match(gate, /function PasswordInput\(/, "登录页需要密码可见切换组件");
assert.match(gate, /aria-label=\{visible \? "隐藏密码" : "显示密码"\}/, "切换按钮需要可读标签");
assert.match(gate, /type=\{visible \? "text" : "password"\}/, "切换必须真的改变输入类型");
assert.match(gate, /<PasswordInput/, "两个密码输入都要使用该组件");

// 自动填充与键盘提示：name/autocomplete/inputmode/enterkeyhint
assert.match(gate, /name="email"/, "邮箱字段需要 name 供密码管理器识别");
assert.match(gate, /name=\{mode === "login" \? "password" : "new-password"\}/, "密码字段需要稳定的 name");
assert.match(gate, /enterKeyHint="next"/, "移动键盘需要“下一项”提示");
assert.match(gate, /autoComplete=\{mode === "login" \? "username" : "email"\}/, "登录态应标记 username 供自动填充");

// 触摸目标：登录/注册切换曾是 34px
assert.match(css, /\.auth-mode-switch button \{[^}]*min-height: 44px;/s, "登录/注册切换按钮需要 44px");

// 键盘顶起：短视口从顶部排布 + 输入框滚动余量
assert.match(css, /@media \(max-height: 560px\)[\s\S]*?align-content: start;/, "短视口需要从顶部排布");
assert.match(css, /scroll-margin-bottom: 120px;/, "输入框需要滚动余量，避免键盘遮挡");

// 样式必须最后导入
const cssImport = main.indexOf('import "./login-experience.css";');
const voiceImport = main.indexOf('import "./voice-composer.css";');
assert.ok(cssImport > voiceImport, "login-experience.css 应最后导入以覆盖登录样式");

console.log("login-ui: 结构断言通过");

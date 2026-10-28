// 动画预算的结构守卫（真机行为由 tools/browser-verify/verify-animation-budget.mjs 覆盖）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

const app = read("App.jsx");
const main = read("main.jsx");
const css = read("animation-budget.css");

// 滚动/隐藏都必须暂停常驻动画
assert.match(css, /html\[data-dengta-scrolling="1"\][^{]*\{[^}]*animation-play-state:\s*paused\s*!important;/s, "滚动期间必须暂停动画");
assert.match(css, /html\[data-dengta-hidden="1"\][^{]*\{[^}]*animation-play-state:\s*paused\s*!important;/s, "切后台时必须暂停动画");

// App 必须真的设置这两个属性（capture 监听所有滚动容器 + visibilitychange）
assert.match(app, /document\.addEventListener\("scroll",\s*makeScrolling|document\.addEventListener\("scroll",\s*markScrolling/, "需要监听滚动");
assert.match(app, /data\.dengtaScrolling\s*=\s*"1"|dataset\.dengtaScrolling\s*=\s*"1"/, "需要设置滚动中标记");
assert.match(app, /data\.dengtaHidden\s*=\s*"1"|dataset\.dengtaHidden\s*=\s*"1"/, "需要设置隐藏标记");
assert.match(app, /capture:\s*true/, "滚动监听需要 capture 才能覆盖内层滚动容器");
assert.match(app, /\}, 160\);/, "滚动停止后需要延时恢复动画");

// 录音倒计时：按钮显示剩余秒数，最后 10 秒加警示类
assert.match(app, /formatVoiceRemainingSeconds\(voiceElapsedMs\)/, "计时必须换成剩余秒数");
assert.match(app, /is-ending/, "最后 10 秒需要警示状态");
assert.match(css, /\.chat-voice-timer\.is-ending\s*\{[^}]*color:/s, "警示态需要可见样式");

// 动画预算样式必须最后导入
const budget = main.indexOf('import "./animation-budget.css";');
const login = main.indexOf('import "./login-experience.css";');
assert.ok(budget > login, "animation-budget.css 应最后导入");

console.log("animation-budget: 结构断言通过");

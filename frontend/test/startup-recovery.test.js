// 启动恢复状态的层叠/可见性回归测试
//
// 背景（2026-10-28 实测）：后端休眠时应用会显示「正在唤醒 DengTa 后端…」横幅，
// 但浮动的顶部状态胶囊会压在横幅上，把说明文字和「重新发起连接」按钮盖住。
// 修复包含三件事，这里逐条钉死：
//   1. main-panel 在恢复期带上 startup-recovering 类
//   2. 恢复期隐藏浮动状态区，并抬高横幅层级
//   3. 修复样式必须来自最后导入的顶层 CSS 文件
//      （曾经把规则追加到 apple-ui.css 尾部，结果落进未闭合的 @media 里，等于没修）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

const app = read("App.jsx");
const main = read("main.jsx");
const css = read("startup-recovery.css");

assert.match(
    app,
    /showStartupRecovery\s*\?\s*"\s*startup-recovering"\s*:\s*""/,
    "main-panel 必须在启动恢复期间带上 startup-recovering 类"
);

assert.match(
    css,
    /\.main-panel\.startup-recovering\s+\.chat-presence-stack\s*\{[^}]*display:\s*none;/,
    "恢复期间必须隐藏浮动状态区，否则会与唤醒横幅叠压"
);

assert.match(
    css,
    /\.main-panel\.startup-recovering\s+\.connection-recovery\s*\{[^}]*z-index:\s*30;/,
    "恢复横幅必须在恢复期间抬高层级"
);

assert.match(
    main,
    /import\s+"\.\/interface-polish\.css";\s*import\s+"\.\/startup-recovery\.css";/,
    "startup-recovery.css 必须在 interface-polish.css 之后导入（保持规则为本文件内唯一的顶层规则）"
);

// 结构守卫：该 CSS 文件不能有未闭合的块（否则规则会被吞进 @media/其他规则里）
const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
assert.equal(opens, closes, "startup-recovery.css 的花括号必须配平");

// 规则必须出现在文件顶层：文件末尾不能停在 @media 内部
let depth = 0;
for (const char of css) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    assert.ok(depth >= 0, "startup-recovery.css 出现了多余的 }");
}
assert.equal(depth, 0, "startup-recovery.css 结束时必须回到顶层");

// 冷启动健康检查失败必须退避重试，否则麦克风整场不可用
assert.match(
    app,
    /refreshServiceHealth\.retryTimer = window\.setTimeout/,
    "健康检查重试需要把定时器挂在回调自身（vm harness 无法访问外部 ref）"
);
assert.match(
    app,
    /const retryDelays = \[2_000, 5_000, 10_000, 20_000\];/,
    "健康检查必须按 2/5/10/20 秒退避"
);
assert.match(
    app,
    /refreshServiceHealth\(\{ attempt: healthAttempt \+ 1 \}\)/,
    "失败后应以递增 attempt 重新调用自己"
);
assert.match(
    app,
    /window\.clearTimeout\(refreshServiceHealth\.retryTimer\)/,
    "成功或卸载时必须清掉待重试的定时器"
);

console.log("startup-recovery: 4 项结构断言通过");
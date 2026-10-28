// 刘海 / 安全区适配的静态守卫
//
// 说明：headless 浏览器里 env(safe-area-inset-*) 恒为 0，无法在没有刘海的设备上
// 真实验证；这里保证三件事：
//   1. viewport 声明 viewport-fit=cover（否则 env() 恒为 0，写了也白写）
//   2. 贴底承载内容的操作条必须给手势条留让位
//   3. 全站安全区覆盖量不许倒退（当前基线：≥ 70 处 env() 引用）
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const html = read("index.html");
assert.match(
  html,
  /viewport-fit=cover/,
  "viewport 必须声明 viewport-fit=cover，否则 env(safe-area-inset-*) 恒为 0"
);

const cast = fs.readFileSync(path.join(SRC, "cast-player.css"), "utf8");
assert.match(
  cast,
  /\.cast-actions\s*\{[^}]*margin-bottom:\s*max\(16px,\s*calc\(env\(safe-area-inset-bottom\)/s,
  "放映室贴底操作条必须让开手势条区域"
);

const together = fs.readFileSync(path.join(SRC, "together.css"), "utf8");
assert.match(
  together,
  /\.netease-qr-modal\s*\{[^}]*padding-bottom:\s*max\(2rem,\s*calc\(env\(safe-area-inset-bottom\)/s,
  "网易云登录弹窗必须给底部手势条留让位"
);

const cssFiles = fs.readdirSync(SRC).filter((name) => name.endsWith(".css"));
const safeAreaCount = cssFiles.reduce(
  (sum, name) =>
    sum +
    (fs.readFileSync(path.join(SRC, name), "utf8").match(/env\(safe-area-inset-/g) || [])
      .length,
  0
);
assert.ok(
  safeAreaCount >= 70,
  `安全区覆盖量不应倒退（当前 ${safeAreaCount} 处，基线 70）`
);

console.log(`safe-area: 结构断言通过（env 引用 ${safeAreaCount} 处）`);
// 语音入口与输入框布局的回归测试
//
// 背景（2026-10-28）：
//   1. 麦克风原本只存在于「+」菜单第二层，用户要先点加号才看得到
//   2. 把按钮插到输入框后，因为没有网格定位掉到了第二行最左边
//   3. 长按录音前没有预热，语音理解服务冷启动时首句要等很久
//
// 这里把三件事的结构约束钉死，避免以后重构时悄悄退回。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (name) => fs.readFileSync(path.join(SRC, name), "utf8");

const app = read("App.jsx");
const main = read("main.jsx");
const css = read("voice-composer.css");

// 输入框一级的麦克风按钮，并复用同一套长按处理函数
assert.match(app, /className=\{`chat-voice-button\$\{/, "输入框一级必须有语音按钮");
assert.match(app, /onPointerDown=\{beginVoiceCapture\}/, "语音按钮必须复用长按开始处理");
assert.match(app, /onPointerUp=\{endVoiceCapture\}/, "语音按钮必须复用松手处理");
assert.match(
  app,
  /onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/,
  "语音按钮要阻止长按弹出的上下文菜单"
);

// 按下即预热：调用必须出现在设置指针之后、长按计时器之前
const pressIdx = app.indexOf("voicePointerIdRef.current = event.pointerId;");
const warmupIdx = app.indexOf('apiRequest("/voice/warmup"', pressIdx);
const timerIdx = app.indexOf("voiceLongPressTimerRef.current = window.setTimeout", pressIdx);
assert.ok(pressIdx > 0 && warmupIdx > pressIdx, "按下后应及早预热语音服务");
assert.ok(timerIdx > warmupIdx, "预热必须发生在长按门控之前（否则起不到预热作用）");
assert.match(app, /voiceWarmupAtRef/, "预热需要节流状态，避免每次按下都打请求");

// 松手震动反馈
assert.match(app, /navigator\.vibrate\?\.\(12\)/, "松手发送要有震动反馈");

// 4 列网格：附件 / 输入 / 语音 / 发送，且语音有明确网格定位
assert.match(
  css,
  /\.main-panel\.view-chat \.composer \{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 44px 44px;/,
  "输入框必须为语音按钮扩成 4 列"
);
assert.match(
  css,
  /\.main-panel\.view-chat \.composer \.chat-voice-button \{[^}]*grid-column:\s*3;/,
  "语音按钮必须显式放在第 3 列，否则会掉到第二行"
);
assert.match(
  css,
  /\.main-panel\.view-chat \.composer \.send-button \{[^}]*grid-column:\s*4;/,
  "加入语音按钮后发送按钮必须挪到第 4 列"
);
assert.match(css, /@media \(max-width: 380px\)/, "窄屏要单独收窄语音按钮，保证输入区宽度");

// 样式导入顺序：voice-composer 必须在最后，确保覆盖前面的网格定义
assert.match(
  main,
  /import "\.\/voice-composer\.css";/,
  "voice-composer.css 必须在 main.jsx 中导入"
);
const startupIdx = main.indexOf('import "./startup-recovery.css";');
const voiceCssIdx = main.indexOf('import "./voice-composer.css";');
assert.ok(voiceCssIdx > startupIdx, "voice-composer.css 应最后导入以覆盖布局");

// 首屏缓存读取必须 memo 化：直接写在渲染体里会让每个流式增量都 JSON.parse
assert.match(app, /const initialChatCache = useMemo\(/, "首屏缓存读取必须用 useMemo 包裹");
assert.match(
  app,
  /\[visualPreview, accountStorageScope, companionScope\]/,
  "缓存 memo 的依赖必须包含视觉预览与作用域"
);

// 麦克风授权超时 + 授权期间松手不能开始无人按着的录音
assert.match(app, /麦克风授权超时/, "getUserMedia 必须有超时提示");
assert.match(
  app,
  /voiceCaptureRunRef\.current !== captureRun \|\|\s*\n\s*!voicePointerHeldRef\.current/,
  "拿到麦克风后必须再次校验指针是否仍按住"
);
assert.match(app, /已经松开了，这次没有录音/, "授权期间松手要给用户明确提示");

// 减少动画时弹层不能停在起始变形：最终位置必须由 CSS 终态给出
assert.match(
  css,
  /\.sun-glass-jelly-popover\.is-open,[\s\S]*?\.sun-glass-time-menu\.is-open \{[\s\S]*?transform:\s*translateY\(0\) scale\(1\);/,
  "桌面弹层终态必须显式写 transform"
);
assert.match(
  css,
  /@media \(max-width: 820px\)[\s\S]*?transform:\s*none;/,
  "移动端弹层终态应为 transform: none"
);

// 点按未达长按阈值：必须给轻反馈，不能完全沉默
assert.match(app, /navigator\.vibrate\?\.\(8\)/, "点按未达阈值需要一次轻震动");
assert.match(app, /按住麦克风说话，说完再松手/, "点按未达阈值需要文字提示");

// 60 秒到点自动发送：必须明确告知
assert.match(app, /已经达到 60 秒上限/, "60 秒自动发送需要提示用户");
// 语音处理中必须有一级取消入口：此前取消按钮只在「+」菜单里，
// 而上传时该菜单按钮被禁用，用户最长 75 秒没有任何出口。
assert.match(app, /chat-voice-button chat-voice-cancel/, "语音处理中要在一级显示取消按钮");
assert.match(app, /aria-label="取消语音处理"/, "取消按钮需要可读标签");
// 直接匹配「一级取消按钮」这一整块，避免被菜单里旧取消按钮的同名调用满足。
const cancelEntryBlock = app.match(
  /chat-voice-button chat-voice-cancel[\s\S]{0,700}?cancelVoiceCapture\(\{/,
);
assert.ok(cancelEntryBlock, "cancel-entry-block 一级取消按钮必须绑定取消处理，而不是只渲染文案");
assert.match(css, /\.chat-voice-button\.chat-voice-cancel/, "取消按钮需要独立样式");
console.log("voice-composer: 结构断言通过");
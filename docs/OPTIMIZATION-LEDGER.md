# DengTa Home 优化长跑账本（Elephant）

> 这份文件是**跨轮次、跨模型、跨会话的长期记忆**。
> 每轮开始先读它；每轮结束把「已验证的事实 / 已修的 / 已知误报 / 下一步」写回它。
> 原则：只写**有证据**的结论（命令输出、文件行号、截图路径、测试结果），不写猜测。
> Goldfish 规则：任何"看起来没问题"的结论都要用新上下文复核一次；**永远不要自己裁判自己**。

最后更新：2026-10-28 · HEAD `f1fa2c9`

---

## 1. 仓库与运行方式（事实）

- 仓库：`D:\GZdeepseek\dengta-home`，公开仓库 `DengTaHome/dengta-home`
- 前端：React 19 + Vite 8，源码 `frontend/src`，构建产物 `frontend/dist`（不入库）
- 后端：Node 24 + Express 5，单文件 `backend/server.js`（约 6.8k 行），服务在 `backend/services`
- 线上：前端 `https://www.dengtahome.com`（Vercel），后端 `https://dengta-home-backend-rkmq.onrender.com`（Render）
- **重要**：线上后端版本 0.29.76 **不是**这个仓库的代码构建出来的；本仓库的后端改动要生效必须另行部署
- 数据库：Supabase（生产 schema 与仓库 migration 不同源，详见 `docs/QUALITY-AUDIT-2026-10.md` 第七节）

### 工具链（都在 `_tools`，不要用系统 PATH 里的旧版本）

```powershell
$env:PATH = 'D:\GZdeepseek\_tools\node;' + $env:PATH
& 'D:\GZdeepseek\_tools\node\node.exe' ...
& 'D:\GZdeepseek\_tools\node\npm.cmd' run build / test
git: D:\GZdeepseek\_tools\git\cmd\git.exe
```

### 验证命令（改完必须跑）

```powershell
# 全量单测
cd D:\GZdeepseek\dengta-home\backend;  node npm.cmd test
cd D:\GZdeepseek\dengta-home\frontend; node npm.cmd test

# 真机体检（9 项，约 10 分钟；端口 5173 必须空闲）
cd D:\GZdeepseek\dengta-home
node node.exe tools/browser-verify/run-all.mjs

# 单项
node ...\tools\browser-verify\verify-layout-matrix.mjs      # 6 个安卓视口布局
node ...\verify-startup-recovery.mjs                         # 唤醒横幅可见性
node ...\verify-voice-ui.mjs                                 # 语音链路（假麦克风）
node ...\verify-streaming.mjs                                # 流式契约
```

真机验证的公共约定：HTTP 代理 `127.0.0.1:10809`（`bypass: 127.0.0.1,localhost`）、
SOCKS `127.0.0.1:10808`、Playwright Edge、登录态从 `_audit/browser/auth.json` 注入、
脚本自己起 5173 静态服务器。

---

## 2. 硬约束（改动前先确认不会碰到）

1. **AI 回复必须逐字即时可见、不可撤回、不可等全部生成完才显示；已生成内容要立刻保存**
2. **完全没有任何拒答过滤**（不做内容过滤，不恢复任何过滤逻辑）
3. **不要删 admin-client 的 17 处 fallback**（会让 17 个接口匿名访问从「能用」变「401」）
4. 唯一备份目录 `D:\GZdeepseek\backup\`，改完代码要刷新 bundle 并 `git bundle verify`
5. 凭据只在 `D:\GZdeepseek\_credentials\`，**永不入库、不进备份 bundle、不贴聊天**
6. 生产库迁移：不要执行仓库 migration 062/063/064（已查证不适用，见 QUALITY-AUDIT 第七节）
7. 仓库里已有大量源码切片测试（读 `server.js`/`App.jsx` 文本断言结构）。
   改结构时要么保持被断言的形状，要么同步改测试；**不要为了让测试过而删断言**

---

## 3. 已知误报 / 不要重复踩的坑

| 现象 | 真相 | 证据 |
| --- | --- | --- |
| 布局扫描报「交互元素在屏幕外」 | off-canvas 抽屉收起状态，正常 | `verify-layout-matrix.mjs` 已排除 |
| 截图空白（启动 3 秒内） | `DengTaPrelude` 开场动画（3180ms），刻意设计 | 等动画退场再截图 |
| 语音按钮"暂不可用" | 打开 App 时若遇 Render 冷启动，`/health` 失败会整场不可用 | 线上 `/health` 现为 `hervoice_proxy_configured: true`；真实缺口是**失败后不重试** |
| `aria-label*="发送"` 选中麦克风 | 麦克风标签曾含「发送」二字 | 已改为「长按说话」；验证脚本用 `.send-button` |
| 追加 CSS 到 `apple-ui.css` 尾部无效 | 落进未闭合 `@media` | 顶层新文件 + 花括号配平测试 |
| CLS 突然变好 | 常是 token 过期/页面没渲染 | 必须同时看伴随指标 |
| Supabase anon 探针 PGRST205 | 无法区分「表不存在」与「无权限」 | 不能据此判断表不存在 |

---

## 4. 本轮（2026-10-28）已完成且已验证

| 改动 | 证据 |
| --- | --- |
| 唤醒/重连横幅被浮动状态胶囊叠压 → 恢复期隐藏胶囊 + 抬层级 | `verify-startup-recovery` 3 视口全过；截图 `_audit/browser/recovery-360x640.png` |
| 麦克风从「+」菜单提到输入框一级 | `verify-voice-ui`：按钮可见、命中 `chat-voice-icon` |
| 输入框 3 列 → 4 列（附件/输入/语音/发送），窄屏 40px | 布局扫描 6 视口 0 问题；含「输入框 ≥120px」断言 |
| 按下即 `/voice/warmup` 预热（30s 节流） | `verify-voice-ui`：拦截到请求 |
| 松手震动 12ms（录音开始已有 18ms） | `verify-voice-ui`：两次震动都被记录 |
| 后端 `/voice/turn`：设置/会话并行；四个收尾任务移到 `res.json` 之后 | 单测 + 源码断言；`memory_compression` 改 null（前端从不消费） |
| 情绪软区间 0.45–0.62 + 中文/同义词归一（未知仍拒绝） | `backend/test/voice-turn.test.js` 断言 |
| 安卓 WebView 无 `type` 的录音 → 前端补 `audio/webm`，后端按扩展名兜底 | 单测 `uploadedTypes[0] === "audio/webm"` |
| 完整体检 9/9；前后端全量测试 exit 0 | `_audit/verify-run-63.log`、`fe-test63.log`、`be-test63.log` |

**当前基线**：HEAD `f1fa2c9`，体检 9/9，备份 bundle 23.45 MB 与 HEAD 同步。

---

## 5. 已知未解（下一轮候选，按价值排序）

1. **启动期 `/health` 失败无重试**：冷启动时语音按钮整场"暂不可用"。应接进启动恢复流程
   （唤醒成功 → 重试 `refreshServiceHealth`），并验证。
2. **刘海/安全区**：`env(safe-area-inset-*)` 使用情况未系统检查；需在带刘海视口（如 390×844
   模拟 safe-area）验证顶部胶囊与底部输入框不被遮挡。
3. **动画打磨**：`prefers-reduced-motion` 覆盖是否完整（当前只抽查了几处）。
4. **语音体验增强**：录音时长上限 60s 的提示是否够早、录音中打断（来电/切后台）行为、
   语音转写卡片的信息密度。
5. **生产后端未部署本仓库改动**：所有后端改动目前只对自托管生效，需明确告知用户。
6. 线上没有 MiniMax TTS（`expressive_tts_configured: false`），AI 语音回复不可用。

---

## 6. 写账本模板（每轮追加）

```markdown
## 轮次 N（日期时间）· HEAD <sha>
### 发现（要带证据）
### 改动（文件:行 + 为什么）
### 验证（命令 + 结果摘要）
### Goldfish 复核结论（谁复核、翻了什么、还剩什么争议）
### 下一步
```
---

## 轮次 1（2026-10-28 · 多智能体审计 + Goldfish 复核）

### 方法
- 8 路并行审计（语音前端 / 语音后端 / 情绪 / 安卓适配 / 动画 / 首屏性能 / 后端延迟 / 测试工具），
  共 42 条原始发现；
- 14 条送 Goldfish（全新上下文）独立复核，全部给出判决；其中 6 条本轮动手修。

### 本轮已修（均已验证）

| ID | 问题 | 修法 | 证据 |
| --- | --- | --- | --- |
| A | 空转写被降级成 `text:''`，落库空用户消息并对空输入生成回复 | 降级只在文本非空时生效，否则继续抛 502 | `backend/test/voice-turn.test.js` 新增断言；`analyzeVoiceWithHervoice` 抛「没有识别出文字」 |
| B | 预热在 try 外构造地址：抛错时 inFlight 永久卡死；Node 24 未处理 rejection 退出进程；`/health` 绝对路径丢掉前缀 | 地址构造进 try；清理改到外挂 `tracked` promise（保证 await 后已清理、并接住 rejection）；新增 `hervoiceHealthEndpoint` 保留路径前缀 | 新增单测：非法 URL → completion=false 且能再次 start；前缀 URL → 请求 `https://…/prefix/health` |
| C | 减少动画时弹层停在起始变形（缩小/错位） | `.is-open` 显式写终态 transform（桌面 `translateY(0) scale(1)`，移动端 `none`） | `frontend/test/voice-composer.test.js` 结构断言 |
| D | `readChatHistoryCache` 写在渲染体，流式每增量都 JSON.parse 最多 160KB | `useMemo` 按 [visualPreview, accountStorageScope, companionScope] 记忆化 | 结构断言 + 构建通过 |
| E | 授权期间松手仍会开始无人按着的录音，60s 后自动发送 | getUserMedia 加 8s 超时（迟到流立即 release）；resolve 后再校验 `voicePointerHeldRef`，松手则回到 idle 并提示 | `verify-voice-ui` 新增两检查（延迟麦克风场景）12/12 全过 |

### 验证
- 后端单测：`voice-turn.test.js` 通过；
- 前端构建通过，lint 0 error；
- 真机：`verify-voice-ui` 12/12、`verify-layout-matrix` 6 视口 0 问题、
  `verify-streaming` 全过、`verify-startup-recovery` 全过；
- 全量前后端测试见本轮尾部记录。

### 审计中确认但仍待修（按价值）
1. **语音面板不可达**（P1）：取消按钮/内联错误/转写卡片都在默认关闭且上传中被禁用的「+」菜单里，
   uploading 最长 75s 无任何取消入口。
2. **移动端「+」菜单 fixed bottom:72px**（P1）：多行输入被盖、网页版键盘弹出后落到可视区外
   （Goldfish 提示：改回 absolute 会被 `.main-panel` 的 `overflow:hidden` 裁剪，需配 max-height 复验）。
3. **关闭情绪理解后仍展示/存储/返回情绪与声学特征**（P1）：开关只影响提示词。
4. **降级被展示成「中性 · 置信度 0%」**（P1）：后端自己判定不可用，用户却看到确定结论。
5. **聊天收尾 4~10 次串行 await 挡在 done 前**（P1）：含一次额外 LLM 摘要；且非关键失败会把成功一轮变成错误。
6. **520KB App chunk 未预加载**（P1）：登录态解析完后才 lazy 拉取，首屏关键路径多一段串行下载。
7. **/health、/models、chat-skin、voice-output 排队在 bootstrap 之后**（P1）：冷启动时麦克风长时间显示「语音暂不可用」。
8. 测试工具三处假通过风险（media-e2e 上传失败仍 exit 0、头像断言不校验资产、触摸脚本 0 元素也算通过）。
9. 横屏/短视口断点不一致（状态浮卡压住消息列表）。
10. TTS 未做进行中取消（录音开始后 AI 语音可能突然响起）。

### 下一步（轮次 2）
优先 1、7、4：都是用户可直接感知、且能用现有真机脚本验证的；
2 需要先解决 overflow 裁剪再动；3 涉及产品口径，需与用户确认后再改。
---

## 轮次 2（2026-10-28 · 健康检查重试）

### 已完成
- `refreshServiceHealth` 支持 attempt 计数与退避重试（2/5/10/20 秒，最多约 37 秒），
  新调用/卸载都会清定时器；`frontend/test/startup-recovery.test.js` 结构断言通过；lint 0。
- 提交 `c9a8c49`，备份同步。

### 浏览器验证（已通过 · 根因是脚本自己的端口选错）
- 之前记录 0 次 `/health` 的根因：验证脚本把静态服务器起在 **5174/5175**，
  而生产后端 CORS 白名单只放行 **5173** → 所有 API 被 CORS 拦截、bootstrap 失败、
  自然没有 health 请求。**看起来像产品 bug，其实是测试环境错误**（已写进 tools README）。
- 改回 5173 后实测：`/health` 共 3 次（前 2 次 503 → 退避重试 → 第 3 次成功），
  麦克风按钮出现、页面没有整页刷新。`verify-health-retry.mjs` 3/3 通过，已加入 run-all。
- 刘海/安全区适配：未开始。
- 动画细节打磨：未开始（待办清单见轮次 1 尾部第 3、4、5 条）。
---

## 轮次 3（2026-10-28 · 刘海/安全区）

### 审计结论
- 安全区不是空白区：9 个 CSS 文件共 70+ 处 `env(safe-area-inset-*)`，
  `index.html` 已有 `viewport-fit=cover`（没有它 env 恒为 0）。
- 规则级扫描出 15 条「贴边固定/吸顶但未写 safe-area」的规则，绝大多数是
  全屏遮罩（本身不需要 padding），真正承载内容且缺让位的只有两处：
  `.cast-actions`（放映室贴底操作条）与 `.netease-qr-modal`（网易云登录弹窗）。

### 已修
- `.cast-actions`：`margin-bottom: max(16px, calc(env(safe-area-inset-bottom) + 8px))`
- `.netease-qr-modal`：`padding-bottom: max(2rem, calc(env(safe-area-inset-bottom) + 1rem))`
- 新增 `frontend/test/safe-area.test.js`：守卫 `viewport-fit=cover`、
  两处让位规则、以及「全站 env() 覆盖数不得低于 70」的基线。
- 构建通过；布局扫描 6 视口 0 问题（零 inset 下无回归）。

### 验证边界（必须诚实标注）
headless 浏览器里 `env(safe-area-inset-*)` 恒为 0，**没有带刘海的设备就无法真实
验证刘海遮挡**。本轮只做到：静态覆盖审计 + 零 inset 回归 + 规则守卫。
真机验证需要用户在带刘海/挖孔手机上打开一次，或后续用 Chrome DevTools 的
「设备边框 / 显示刘海」模拟（Playwright 目前没有直接暴露该能力）。
---

## 轮次 4（2026-10-28 · 动画与交互反馈，部分完成）

### 已修并验证
- **点按麦克风（未达 300ms 长按阈值）不再完全沉默**：补 8ms 震动 + 提示「按住麦克风说话，说完再松手。」
  （旧注释原文就是"不提示"，实测像按钮坏了）。
- **60 秒到点自动发送时给出明确提示**：此前静默截断，用户分不清是自己说完还是被截断。
- 结构测试断言两条行为；`verify-voice-ui` 12/12 仍全过；构建/lint 通过。

### 本轮未做（下一轮）
- 录音最后 15 秒倒计时预警：CSS 已试写但 JSX 未接线，为避免死代码已撤掉样式，留到下一轮一起做。
- 滚动暂停覆盖其余常驻动画（彩虹流 / shimmer）：需先确认现有暂停钩子的类名与作用域。
- 启动动画的 `will-change` 数量与后台标签页暂停（visibilitychange）。

### 方法提醒
本轮两次因**缩进猜错**导致 patcg 锚点失败（App.jsx 同一文件里不同块缩进不同）。
以后对 App.jsx 的补丁一律先用 node 打印目标行 JSON、再按行号插入，不再猜空格数。
### 轮次 4 收尾：harness 兼容
`refreshServiceHealth` 的重试定时器原本放在新加的 `healthRetryTimerRef`（组件外部 ref），
但 `startup-service-scope.test.js` 用 vm 执行从 App.jsx 抽出的回调源码，
vm 上下文里没有这个 ref → ReferenceError → 表现为「请求一次都没发出」。
修法：把定时器挂到回调函数自身（`refreshServiceHealth.retryTimer`），
不新增外部绑定，vm harness 与真实组件都能用。
更新了 `startup-recovery.test.js` 的两条结构断言；前端全量测试回到 exit 0，
`verify-health-retry` 仍 3/3 通过。
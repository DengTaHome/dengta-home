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
---

## 轮次 5（2026-10-28 · MMTR × kiwi-mem 融合调研）

### 做了什么
- 找到并拉取截图里的项目 `CRTNET8866/MMTR`（TS、零依赖、node:sqlite）；
- 读透 MMTR 的 decay/promise/relation/config 源码，提取全部公式与默认参数；
- 确认 kiwi-mem 与 MMTR 不可代码级合并（Python/Postgres vs TS/sqlite，且都是完整记忆系统），
  确定「算法级融合」路线：把 MMTR 脑层移植进 kiwi-mem；
- **P0 原型已跑通**：`_refs/kiwi-mem-dengta/mmtr_brain/brain.py` + `test_brain.py`，
  31 条不变量测试全过（三通道衰减/地板/回血递减/压缩阶梯/约定曲线/关系约束/检索降权）；
- 方案文档：`docs/MMTR-KIWI-FUSION.md`（数据层映射、P0–P4 计划、不搬清单、待拍板事项）。

### 待办
- 用户拍板：改哪个 kiwi 仓库、部署形态；
- P1：kiwi Postgres 加列 + 回填 + consolidate 定时任务；
- P2：`/memory/recall` 返回通道权重/约定/关系，DengTa 侧消费。
---

## 轮次 6（2026-10-28 · 语音处理中的一级取消 + 四轮 Goldfish 审查）

### 问题（第一轮审计 P1）
上传/理解阶段没有任何一级取消入口：取消按钮只在「+」菜单里，而上传时该菜单按钮被禁用，
用户最长 75 秒无出口。

### 最终改动
- 输入框一级：uploading/thinking 时用「取消」替换麦克风按钮，不依赖 voiceServiceAvailable；
- `cancelVoiceCapture` 可中止 `voice/turn`、清定时器/录音器/流、回 idle + 提示；
- `submitVoiceBlob` 增加贯穿式取消令牌（finish 传入），在 preflight 每个 await 后、
  promise 之后、插入消息前、朗读前校验；`/api/v2/sessions` POST 带 AbortSignal，
  取消发生在 UI mutation 之前；
- `createVoiceTurnRequest.abort()` 在未 send 时也 reject 且阻止后续 open/send；
- `finally` 拆成「引用清理（按对象身份）」+「状态复位（按 run token 归属）」两段；
- 切后台：只在语音活跃时取消并复位，纯文字聊天不再被误提示；授权期切后台提示改为准确文案；
- CSS 窄屏取消按钮保持 44px。

### 验证（真机模拟：Playwright + 假麦克风）
- `verify-voice-ui.mjs` 19 项全过，含：上传中可取消、取消中止请求（requestfailed
  ERR_ABORTED）、取消后无红色错误、晚到 500 不污染、后端立即 500 给出可读错误；
- `verify-layout-matrix` 6 视口 0 问题；streaming / startup-recovery 全过；
- 前端全量测试 exit 0；
- 单测新增 abort-before-send 行为断言（未 send 时取消必须 reject 且不发送）。

### Goldfish 四轮审查（外部裁判，均未参与实现）
1. 第一轮：驳回——取消只对已发出请求有效（preflight/响应后/未 send 三窗口），验证 settled 假通过；
2. 第二轮：驳回——新建会话 UI mutation 在取消校验前、finish→submit 换 token、finally 清新状态、
   settled bubbles OR 等；
3. 第三轮：驳回——**本轮修复自身引入的 P1**：切后台 cancel(updateState:false) + finally 归属校验
   导致 UI 卡在取消按钮/录音态；P2 stale 引用；fake XHR 假通过；
4. 第四轮：P1 已修，另指出切后台无条件提示（纯文字聊天也被提示）与 verify 未覆盖 notice；
   两处小修后，全量测试与 19 项真机断言全绿。

教训：**取消/竞态类改动必须让外部裁判评审，且验证必须先做"删掉实现会不会红"的负向检查**。
---

## 轮次 7（2026-10-28 · 登录页 + 使用界面体验）

### 登录页（网页版与 APK 共用同一 WebView 逻辑）
审计出并修复：
- **密码可见切换缺失**：移动端长密码无法肉眼校验 → 新增 PasswordInput（显示/隐藏，44×44，aria-pressed）；
- **自动填充不可靠**：输入框没有 name → 补 name=email / password / display-name / confirm-password，
  并补 enterKeyHint=next（移动键盘"下一项"）；
- **登录/注册切换仅 34px 高** → 44px；
- **错误提示带技术噪音**：已翻译成中文的错误码不再附加「（错误代码：auth_error）」，
  未知错误仍保留代码便于排查；
- **键盘顶起风险**：短视口（≤560px 高）从顶部排布、输入框 scroll-margin 120px；
- 新增 `tools/browser-verify/verify-login.mjs`：3 视口 + 短屏键盘模拟，检查字段语义、
  密码切换、切换按钮 44px、触摸目标、错误中文化、忙碌态、无水平溢出；已接入 run-all（10→11 项）。

### 使用界面
- 本轮回归全部覆盖：布局 6 视口、流式、启动恢复、语音 19 项、健康检查重试；
- run-all 一次 10/11：`verify-media-e2e` 失败为**环境抖动**（单独复跑全通过，
  上传/偏好/目录/渲染/清理均 ok），已记入已知误报。

### 验证
- 前端全量测试 exit 0（含新增 login-ui 结构断言、mobile-layout 样式顺序更新）；
- verify-login 全绿；run-all 其余 10 项全绿。

### APK 边界（诚实标注）
本机没有 adb/emulator，**无法真机/模拟器跑 APK**。APK 侧已确认：
`android:windowSoftInputMode="adjustResize"`、`viewport-fit=cover` + `env(safe-area-inset-top)`
最小 40px 顶部让位；但 Android 15 强制 edge-to-edge 之后的真实表现仍需在手机上验一次。
---

## 轮次 8（2026-10-28 · 首屏：App chunk 预加载 + 启动请求并行）

### 改动
- `main.jsx`：非接收端路由在启动最早期 `performance.mark("dengta:app-prefetch")` 后
  `void import("./App.jsx")`——聊天主界面 520KB 不再等登录态解析完才 lazy 加载，
  下载与登录校验并行；mark 让真机验证能证明"先于登录态"而不是只看请求存在。
- `App.jsx`：`refreshServiceHealth` / `refreshVoiceOutputStatus` / `loadChatSkinPreferences`
  从 bootstrap 成功之后移到启动 effect 开头，与 bootstrap 并行（健康检查自带退避重试）；
  三个回调改用 `privateMediaScopeRef` 读作用域，身份稳定，启动 effect 不会因伴侣 ID
  被发现而清理重跑。
- 新增 `tools/browser-verify/verify-startup-timeline.mjs`（已接入 run-all）：
  注入真实登录态 + 伴侣 ID，记录 App chunk / bootstrap / health / 首条消息时间线，
  断言预加载 mark ≤800ms、health 在 bootstrap 结束前发出、bootstrap 只 1 次、首条消息 <12s。

### 验证
- 时间线实测：prefetch mark 47-52ms、App chunk 55-64ms 开始；health 与 bootstrap 同刻
  （561ms / 562ms）；bootstrap 1 次；首条消息 6.9-10s（跨境后端冷启动）。
- 布局 6 视口 0 问题；流式全过；前端全量测试 exit 0（17 个 vm harness 同步更新作用域 ref）。

### 过程中的教训
- 探针一开始看到 2 次 bootstrap、2 个 App chunk，误判为产品 bug；实际是**注入的登录态
  缺伴侣 ID**：真实登录用户本地同步存着伴侣 ID，测试注入不会。注入后 bootstrap=1。
  结论：探针要先复刻真实登录态，否则会把"首次发现伴侣"当成 App 重挂。
- 改启动回调签名后，4 个 vm 测试 harness 的 ref 初始化会把预设 ref 覆盖成 null
  （`context[name] = { current: null }`），表现为 `createScopedSettingsSession(null)` 抛错。
  修法：`if (!(name in context))` 再初始化——测试工具自身的坑，已一并加固。
---

## 轮次 9（2026-10-28 · 动画预算 + 录音倒计时）

### 改动
- **滚动/切后台暂停常驻动画**：App 在 document 上 capture 监听所有滚动容器，
  滚动期间给 `<html data-dengta-scrolling="1">`，160ms 无滚动后移除；
  visibilitychange 同步 `data-dengta-hidden`。新增 `animation-budget.css`
  （最后导入）：两个属性下 `* { animation-play-state: paused !important; }`。
  聊天页当前有 2 个 infinite 装饰动画，滚动路径上不再持续绘制。
- **录音倒计时**：新增纯函数 `formatVoiceRemainingSeconds(elapsed, max=60s)`；
  按钮内由「1.2s」改为剩余秒数「58s」，最后 10 秒加 `.is-ending` 警示色
  （`prefers-reduced-motion` 下不加脉冲）；输入区提示改为「松开发送 · 还能说 N 秒」。
- 新增 `tools/browser-verify/verify-animation-budget.mjs`（已接入 run-all）：
  验证滚动属性/暂停/恢复、切后台暂停/恢复、倒计时递减与警示态。
- 新增 `frontend/test/animation-budget.test.js` + voice 倒计时纯函数断言。

### 验证
- `verify-animation-budget` 13 项全过；滚动用注入高占位块 + 合成冒泡 scroll
  验证「监听 → 属性 → CSS 暂停」链路（真实滚动手感仍留给真机，账本记录该限制）。
- `verify-voice-ui` 19 项全过（计时断言同步改为倒计时格式）。
- 布局 6 视口 0 问题；启动时间线全过；前端全量测试 exit 0。

### 已知限制
- 测试会话消息很少，聊天容器没有真实溢出，无法在自动化里产生真实滚动；
  用合成 scroll 事件验证链路，滚动时的实际掉帧需要真机确认。
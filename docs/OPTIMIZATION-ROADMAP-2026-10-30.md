# DengTa 优化路线图（2026-10-30 起，轮次 125 第一轮产出）

> 产出者：Elephant（架构/验证）。本轮为只读基线 + 架构审查，未改产品源码、未提交、未跑写库测试。
> 证据与逐项记录见 `D:\GZdeepseek\_audit\ELEPHANT.md` 的「轮次 125」章节。
> 适用仓库：`D:\GZdeepseek\_refs\frontend-gh`（HEAD `fcb0c5c`）、`_refs\backend-prod`（HEAD `f328bea`）。
> 注意：这是 2026-10-29 深夜快照，工作树可能在他人手中变动；执行任何一步前先重新 `git status` + 重测。

## 0. 结论先行

- 当前**没有可信的“全绿”基线**：frontend HEAD `fcb0c5c` 的 `npm test` 有**两个独立 P0 回归**，
  Goldfish 本轮复跑已在 `test:co-watch-experience` 中止（`_audit/round125-full-after-flakefix.log`，
  pass 8 / fail 1），第二个由我独立复现：
  - (a) `test/cast-receiver.test.js:172` 要求 feed 指向 Supabase object storage，实际被 round124
    改成站内 `https://www.dengtahome.com/downloads/DengTa-2.13.47.apk`，并把 36,536,695B APK
    提交进 `public/downloads/`（进 git、进每次 Vercel 部署；直连 supabase.co 在本网络 TLS 被重置，
    但正解是同源代理/对象存储，不是塞仓库）；
  - (b) `test/mobile-layout.test.js:106` 期望 CSS 顺序缺 `force-mobile.css`（round124 `e28e195`
    给 `src/main.jsx:21` 加了 import 未更新测试）。
  CI `android-apk.yml:70` 会跑 `npm test`，推 main 即红。**(b) 已于 23:34 在工作树修复并复测通过
  （未提交）；(a) 仍红，是当前唯一剩余 P0。**
- 后端单测本身健康：`test:module-coverage` 126/126、voice/health 定向 6/6；但**后端没有 CI 测试门**，
  Render `autoDeploy: true` 直接上线。
- 语音链路是当前最大的架构债：`/voice/turn` 是一条复制自聊天、串行执行、非流式、无幂等、
  无取消的 320 行管线（`server.js:6410-6728`）。
- Redmi/桌面模式兜底（`src/force-mobile.css`）只重排了外壳；全站移动样式与性能预算仍是
  `@media`/`innerWidth` 判定，在 980px 布局视口下不生效。
- 首屏预算测试只算 JS（121.9KB gzip 通过），实际首屏压缩传输 ≈230KB，其中 CSS 单文件 103KB。

## 1. 已验证基线（本轮实测）

| 项 | 值 | 证据 |
|---|---|---|
| frontend HEAD | `fcb0c5c`（main） | `git log` |
| backend HEAD | `f328bea`（main），线上 revision 一致 | `/health.revision` |
| backend `/health` | 200，0.40s TTFB（复用连接）；数据库 `not_checked` | curl |
| backend `/health/database` | up，`latencyMs=366` | curl |
| backend 模块覆盖 | **126/126 pass**（旧账 124 已过期） | `npm run test:module-coverage` |
| backend 全量 | 各子套件 fail=0（Goldfish 本轮日志） | `_audit/round125-backend-tests.log` |
| frontend 定向 | voice / voice-output / visual-viewport(7/7) 通过；lint 0 error | 本地运行 |
| frontend 全量 | 原红两处：F1a(mobile-layout，23:34 工作树已修+复测通过) / F1b(cast-receiver feed，**仍红**) | `_audit/round125-full-after-flakefix.log` + 独立复现 |
| frontend 初始 JS 预算 | 394,639 raw / **121,876 gzip** / 9 chunks，通过 | `test:initial-bundle-budget` |
| frontend 首屏实际传输 | **≈230KB 压缩**；CSS 528,587 raw / **103,195 压缩**；DCL 1.66s(desktop)/2.10s(mobile) | headless Edge 生产实测 |
| 线上 APK feed | 305 / 2.13.47，APK 200 | `www.dengtahome.com/updates/android.json` |
| 触摸目标 | main 213 / statusPanel 16 / settings 52 / music 53，0 个 <44px | `_audit/verify-touch-targets3.log` |
| 动画预算 | 滚动/切后台暂停+恢复通过，聊天页 infinite 元素 1 个 | `_audit/verify-animation-budget5.log` |

## 2. 五个最高优先级风险

### R1 [P0] 主分支红（两条独立回归）：基线不可信
- 证据：`test/cast-receiver.test.js:172-176`（feed 必须 object storage；实际站内 URL + 仓库内 36.5MB APK）；
  `test/mobile-layout.test.js:106`（CSS 顺序缺 `force-mobile.css`；`src/main.jsx:21` 已 import）；
  CI `android-apk.yml:70` 跑 `npm test`。
- 当前状态（23:34）：(b) 已由他人修在工作树（未提交，`node --test test/mobile-layout.test.js` 1/1 通过）；
  (a) 仍红（`node --test test/cast-receiver.test.js` 1 fail），是唯一剩余 P0，需先决策 APK 托管方式。
- 修复：
  1) (a) 把 APK 放 Supabase object storage（或 VPS），feed 指回；从 git 删 `public/downloads/DengTa-2.13.47.apk`；
     若坚持站内托管，则改成“同源 `/supabase/...` rewrite 代理 + 不落仓库”，并同步改 `cast-receiver.test.js`
     契约允许代理 URL。**不推荐**让 36.5MB 二进制进 git/每次部署。
  2) (b) `test/mobile-layout.test.js` 期望数组补 `'force-mobile.css'`（不涉及产品源码）。
  3) 修完串行跑一次全量 `npm test` 并归档日志（确认无 ENOTEMPTY）。
- 测试：保留这两条守卫（它们本轮正确抓到漏测）；失败信息写明“改 feed 位置需同步 release 契约”。
- 收益：恢复可信绿基线（后续优化才有对照）；避免 CI 红、仓库/部署体积膨胀；恢复旧版 App 更新可靠性。

### R2 [P0] 语音轮次：非流式串行复制管线，无幂等/无取消
- 证据：`server.js:6410-6728`（该区间 0 个 `Promise.all`）；对照主聊天
  `server.js:4407`（生成租约）、`:4417`（幂等+settings 并行）、`:4685`（context+MCP 并行）。
  前端 `voice.js:6/280-294` 75s 一次性 XHR，`App.jsx:4103` 等整轮；
  `render.yaml:61-62 HERVOICE_TIMEOUT_MS=90000` 被 `services/voice-turn.js:16-17,405-408` 的 30s 硬顶覆盖。
- 修复（分两轮）：
  126：后端并行化（HerVoice/settings/conversation/context/MCP）、`client_message_id` 幂等 +
  生成租约复用、`req.on("close")` 中止、超时配置对齐；前端只需最小配合。
  127：transcript-first + 复用 `/chat/stream` 的 SSE 管线（语音回复流式化）。
- 测试：voice-turn 并发/幂等/断开中止/config 契约测试；指标=转写可见时间、首字时间。
- 收益：去 1+ 次串行 DB（DB RTT 实测 366ms/次）、重试不双写/不双计费、最坏等待可控。

### R3 [P1] Android 桌面模式兜底只覆盖外壳（含动画/模糊/触摸预算）
- 证据：`index.html:17-35` 检测写 `data-dengta-force-mobile`；`src/force-mobile.css:8-125` 只有 shell；
  `index.css:12258/12300` 的全局 blur-off 与大量 ≤820 规则是 media 查询；`status-fluid-engine.js:543`
  仍读 `innerWidth<=820`；`MainActivity.java:131-132` 仍 `setUseWideViewPort(true)`。
  `sun-glass-chat.css:3670` 的 `(pointer: coarse)` 会命中，属部分缓解。
- 修复：移动/性能预算规则加 `html[data-dengta-force-mobile="true"]` 同义选择器；原生侧评估
  `setUseWideViewPort(false)` 根因修复（需真机）；JS 断点统一读检测结果；删死代码
  `--dengta-visible-height`（`android-compat.js:22` 写、全仓库无消费）。
- 测试：980×2178 viewport + screen 393 的**全页面**矩阵（当前只有 shell 截图）；
  真机 2.13.47 回归（受 APK 签名/设备可用性约束）。
- 收益：MIUI/HyperOS 桌面模式用户设置/一起听/音乐页不再错乱，模糊/动画预算真正生效。

### R4 [P1] 首屏载荷与预算盲区（CSS 是最大单块）
- 证据：`test:initial-bundle-budget.test.js:37-75` 只统计入口 JS；生产首屏 CSS 压缩 103KB、
  raw 528,587B；`main.jsx:3-21` 静态 import 全部 CSS（源 990,772B），含 223 处 backdrop-filter、
  194 个 animation。字体不是问题（7s 内 0 请求，`font-display: optional`）。
- 修复：按首屏/路由拆 CSS；装饰主题 CSS 延迟；关键样式内联；预算测试纳入 CSS 与首屏总传输。
- 测试：预算断言 JS+CSS gzip（建议 ≤200KB、CSS ≤80KB）；CI 资源体积检查。
- 收益：关键路径 CSS 预计可减 20–40%，弱网 FCP 改善（以预算守卫防回退）。

### R5 [P1] 后端部署/健康语义 + 语音情绪可观测性
- 证据：backend 5 个 workflow 均不跑 `npm test`，`render.yaml:8 autoDeploy:true`、
  `:11 healthCheckPath:/health`、`server.js:5295 database:not_checked`；
  `voice-turn.js:6-15/175-209/462-466` 情绪校验失败静默降级 neutral/0 且无标记；
  `server.js:5298 text_emotion_understanding:true` 与 `docs/prompt-instruction-audit.md:35`
  （文字情绪理解固定块已删除）矛盾；24+14 个孤儿测试（含 `openai-voice-provider`、
  `openai-speech`、`voice-retention-ui`）。
- 修复：后端 CI（至少模块覆盖+语音/健康定向）；liveness/readiness 分离并接监控；
  降级写结构化日志 + 响应标 `degraded`（前端不显示“中性 0%”伪结果）；修正/移除过时 feature flag；
  孤儿测试接线。
- 收益：回归可在合并前拦截；DB 故障可被发现；情绪降级可度量；测试资产不再沉睡。

## 3. 建议实施顺序（轮次 126–130）

| 轮次 | 内容 | 验收 | 依赖 |
|---|---|---|---|
| 126-0 | 修 R1a（feed/仓库 APK）+ R1b（CSS 顺序）；串行跑全量 `npm test` 拿绿基线；收编在途 `package.json` 串行化改动 | `npm test` exit 0；无 ENOTEMPTY；日志归档；`git ls-files public/downloads` 为空（或 feed 契约已同步更新） | 测试/发布文件写权限（非 Elephant 范围）+ object storage 上传通道 |
| 126-1 | R2 后端：并行化 + 幂等 + close 中止 + 超时对齐 | 新增 voice-turn 用例全过；阶段耗时日志 | 基线绿 |
| 127 | R2 流式化：transcript-first SSE 复用主聊天流 | 转写可见/首字时间下降；取消后无后续模型调用 | 126-1 |
| 128 | R3 force-mobile 扩展 + 全页面 980 模拟；原生 viewport 评估 | 全页面矩阵 0 failure；真机回归通过 | APK 构建/设备可用性、浏览器审计脚本 |
| 129 | R4 CSS 拆分/延迟 + 预算测试扩展 | 新预算通过且不回退；首屏传输下降 | 128 或并行 |
| 130 | R5 后端 CI/readiness/情绪观测/孤儿测试 | CI 跑通；降级可观测；孤儿测试接入 | 仓库写权限 |

- 孤儿测试接线（24+14 个）零产品风险，可并入任意一轮。
- 每轮结束必须更新 `_audit/ELEPHANT.md` 与 `_audit` 日志；结论必须带 HEAD + 工作树快照。

## 4. 执行约束（本轮踩过的坑）

1. **同一 checkout 只允许一个 Vite 相关写入者**：并发跑前端测试/构建会触发
   `ENOTEMPTY node_modules/.vite/deps` 假失败（本轮 music-cookie-* 两连败即此）。所有“失败”先看错误路径。
2. npm script 内会调用 `node`：运行前 `$env:PATH = 'D:\GZdeepseek\_tools\node;' + $env:PATH`。
3. 生产健康探测用 curl 复用一个连接量 TTFB，避免把 TLS 握手算进服务端延迟。
4. 只读验证也可用 headless Edge（`_tools/pw/node_modules/playwright-core` + `channel:"msedge"`），
   输出到 stdout、不落文件；不要并发跑会写 `_audit/` 截图目录的旧脚本。
5. 语音/情绪 E2E 需要登录态+真实录音且会写库：不属于只读审计，需单独授权窗口执行。

## 5. 待确认问题（下一轮开头先答）

1. `package.json` 的 music-cookie 串行化改动由谁收尾、是否连同 R1 一起提交？
2. R1a 选哪条路：Supabase object storage、同源 rewrite 代理、还是 VPS 托管？（决定 feed 契约测试怎么改）
3. 是否允许给 backend 增加 CI workflow（需要仓库写权限；本 agent 无提交权）？
4. APK 真机验证窗口：vivo V2454A 是否仍连接、Actions 额度是否恢复？
5. HerVoice 上游真实 p95 与情绪标签词表能否拿到（决定 R5 的降级策略）？
6. Vercel 生产 SHA 核对方式（有 token 时补验）。

## 6. 轮次 125 修复复核结果（2026-10-30 00:40）

- 基线：frontend HEAD `7a79cbb`（00:16 提交，含全部修复；工作树仅 cap sync 生成 gradle）；backend HEAD
  `4df3049`（已上线 `revision=4df3049`）。本地 dist 构建（00:01:16）与 7a79cbb 源码一致（之后无 src 改动）。
- 测试：backend 全量绿（00:03:22 完成，fail 计数全 0）；frontend 全量绿（`round125-full-green2.log`，
  00:13:34 完成，fail 计数全 0）。00:05 的 2 条红为旧测试断言（warmup 自动触发），已随 00:06 测试更新
  消除（10/10），非产品回归。
- 已验证修复：feed/仓库 APK 移除 + 契约测试 10/10；voice abort 竞态；TTS SSRF 基础加固（IPv6/私网/DNS，
  已上线）；危机话题不走 quiet_refusal；voice 错误脱敏；scroll pause 手势门控；回复选项初始历史不自动生成；
  启动 0 写请求（本地新构建 4 上下文）；侧栏关闭 inert（移动正确）；一级 44×44 语音按钮；
  844×390 message-list 200px；音乐工作室按钮 44px；Redmi 980 关闭按钮命中（模拟）；320 dock 避让 CSS。
- 剩余 P1：
  1) **侧栏 inert 过度应用**：coarse pointer 的 1280/1100/1024 宽屏侧栏可见却 inert+aria-hidden 且无菜单按钮
     （`App.jsx:1586-1601/10743`）；修复=inert 仅按 drawer 模式（≤820 或 force-mobile），补 1280/1024 coarse 测试。
  2) **feed apk_url 直连 supabase.co 在 CN 网络 TLS 重置**（本机实测直连失败；同源 `/supabase` 代理 200/36.5MB）；
     修复=feed 改同源代理 + 同步 `test/cast-receiver.test.js:172` 契约 + 真实手机网络复测。
  3) **TTS redirect 未禁**：`services/openai-speech.js:130` fetch 默认 follow，可 302→内网；修复=`redirect:"manual"`
     + 拒绝 3xx + 补 redirect/DNS-private 测试。
- 剩余 P2：①844×390 + connection-recovery 横幅时 composer 第二行越出视口 33px；②音乐工作室 iframe
  `onLoad` 仍 noop，帧内失败无反馈；③命令面板 Esc/对比度本轮 diff 未见改动，且审计账号 0 sessions/0 messages
  限制了 320 弹层与真实消息态端到端复验。
- 部署状态：`7a79cbb` 已于 00:16 提交 / 00:17 push / 00:18 生产部署（入口 `index-gG5gJtEf.js`、
  CSS `index-a3pHUSyD.css`，与本地审计构建一致）。生产复验：844×390 message-list=200、一级语音按钮
  可见且 enabled、启动未交互 startupWrites=[]；同时 **P1-1（1280 coarse 侧栏可见但 inert）与
  P2-1（844×390 + recovery 横幅 composerBottom=429）已在生产复现**。
- 建议 round 126 顺序调整：先修 P1-1（改动小、用户面大）→ P1-2 feed 同源代理（feed+契约）→ P1-3 redirect；
  P2 穿插；语音流式化/R3/R4/R5 按原计划后移。

## 7. 轮次 125 二次复核（2026-10-30 00:35–00:58）

- 基线：frontend `74ca38f`（00:43 提交，origin/main 已同步；生产入口 `index-D9uY4h1-.js`、
  CSS `index-Cj2EJUlh.css`）；backend `cf02b7f`（TTS redirect 拒绝，**生产 `revision=cf02b7f4…` 已上线**）。
- 测试：frontend 全量 `round125-full-green4.log`（00:41:53 完成，0 fail）；backend 全量
  `round125-backend-green4.log`（00:36:49 完成，0 fail）；cast-receiver+app-updates 14/14、openai-speech 1/1。
- 已关闭（上轮 3 个 P1）：①侧栏 inert 范围（触控桌面 1280/1100 可见且 **not inert**，菜单隐藏；
  force-mobile 设备仍走抽屉，正确）；②feed 同源代理（HEAD 200、36,536,695B、sha256 与 feed 一致；
  app-updates/cast-receiver 契约同步）；③TTS redirect（`redirect:"manual"`+3xx 拒绝，已上线）。
- 逐项通过：启动无写请求（生产新构建、userActivation 模拟、空闲 12s → `writes=[]`，28 条消息）；
  844×390+recovery（message-list=120、composer bottom=359、语音/回复/发送 44px 全在视口内、无横向溢出）；
  Redmi 抽屉（打开焦点=关闭按钮、main inert、scrim tabIndex=-1、Tab 5/5 留在侧栏、Esc 关闭并移除 inert）；
  音乐工作室 overlay（延迟 iframe 时“正在连接播放器” → 12s 后“播放器加载较慢”+重试/浏览器打开 44px）。
- 剩余 P2：①`data-dengta-reduced-motion` 仍被 `App.jsx:10679-10683` 应用内偏好覆盖为 "false"
  （CSS 媒体规则已停 9s 动画；修=OR OS reduce + 行为测试）；②iframe HTTP 401 仍 onLoad → overlay 提前消失
  （已知限制）；③视觉/焦点类修复无 npm test 自动化用例，孤儿测试仍未接线；④同源 APK 下载本机 ~206KB/s
  （能下但慢，非代码缺陷）。
- 生产验证结论：本轮 7 项修复在生产构建上 6.5/7 通过（reduce 根属性部分通过），P0=0。
- 下一步（round 126 起）：先补 reduce 根属性 + 视觉/焦点自动化测试 → 回到语音流式化 R2、R3 全页面、
  R4 CSS 预算、R5 后端 CI/readiness；孤儿测试接线零风险可随时插入。

## 8. 轮次 125 最终事实 / 收尾（2026-10-30 01:15）

- 基线：frontend **9e15621**（origin/main 同步；生产入口 `index-B0qk7gbP.js`）；backend **cf02b7f**
  （生产 revision 已上线）；生产 feed 同源、APK HEAD 200（36,536,695B）。
- Goldfish-R3 独立复核：**P0=0、P1=0、P2=2**；OS reduce 下根 attr `data-dengta-reduced-motion="true"`、
  9s 彩虹 `animationName=none/0s`；Redmi 抽屉打开焦点/关闭按钮、main inert、Esc 关闭通过；
  1280 coarse 侧栏不 inert；同源 APK HEAD 200。
- 随后 P2 修复（frontend 3b653f0 + 9e15621）：
  ①844×390 + recovery 多行 composer：`max-height:148px` + `overflow-y:auto` 内部滚动；
    生产实测未滚动时 voice/reply bottom=406（部分出视口），滚动 16px 后 bottom=390 且 hit=true，
    `.composer-wrap` bottom=390；
  ②短横屏隐藏 `.mobile-command-dock`（display:none）避免遮挡 send；
  ③reduce 根属性 OR OS 偏好（bafa9e2），生产实测 attr="true"。
- 测试：frontend 全量 `round125-full-green5.log` **0 fail**；backend 全量 `round125-backend-green4.log` **0 fail**。
- 备份：`dengta-home` HEAD **ce54993**；`backup\dengta-home-full-20261030.bundle` 27.33MB；
  `web-dist` 复核 200 文件/31.09MB（lead 报 197/31.07MB，计数时点差异）；releases 新增 2.13.47
  （`-305-feed.apk` 36,536,695B / `-305-release.apk` 36,540,791B）；`backup\README.md` 01:09 刷新。
- 剩余 P2（最终、不阻塞）：
  1) 多行 composer 按钮滚动前部分不可见，需内部滚动 16px 才 fully visible（可滚动命中，建议下轮折叠
     recovery 横幅/单行工具条彻底消除）；
  2) 音乐工作室 iframe HTTP 401 仍触发 onLoad → overlay 提前消失（已知限制）；
  3) 视觉/焦点类修复无 `npm test` 自动化用例、24+14 孤儿测试未接线。
- 125 轮结论：P0=0、P1=0、P2=3，生产与备份基线已锁定；下一轮按原计划从语音流式化 R2、R3 全页面、
  R4 CSS 预算、R5 后端 CI/readiness 继续。

## 9. 轮次 126 语音链路复核（2026-10-30 01:15–01:45）

- 改动（**未提交、未部署**）：backend `/voice/turn` 加 `client_message_id` 幂等（重放已有 assistant /
  无 assistant 409）、HERVOICE 上限 30s→90s 对齐 render env、HerVoice caller AbortSignal/断线取消、
  模型校验先于转写、保存后 context/listening/MCP/贴纸/特殊日期/xinchao 并行、assistant 写
  `reply_to_client_message_id`；前端每次语音生成 UUID `client_message_id`；voice-turn 测试补 parser/
  timeout/abort/route contract。生产仍为上一构建（frontend `index-B0qk7gbP`、backend `cf02b7f`）。
- 测试：backend 全量 `round126-backend.log` **0 fail**（01:17:34 完成）；定向 voice-turn 1/1、
  chat-idempotency 1/1、module-coverage 126/126；frontend `voice.test.js` 通过；
  frontend 全量 `round126-frontend.log` **0 fail**（01:23:03 完成）。两全量均跑在未提交工作树上。
- 浏览器（生产旧构建，只读 + 非 GET 拦截）：启动空闲 12s `writes=[]`；一级语音按钮 44×44 / enabled /
  aria 正确；短按只触发 `POST /voice/warmup`（伪 200）；长按触发 `getUserMedia`（mock 拒绝）并显示
  权限提示；全程 0 次 `/voice/turn`、0 真实音频、0 写库；29 条历史消息。
- **P1-1 前后端超时不一致**：后端 HerVoice 单项上限 90s + 生成/保存，前端 XHR 总超时硬顶 75s
  （`voice.js:6/305-308`，测试仍断言 ≤75s）→ 慢转写时前端先超时、后端可能已保存；重试用新 UUID →
  重复 user+assistant/重复计费。建议前端 120–150s 或后端收紧 ≤50s 或 transcript-first 流式。
- P2：①并发同 client id 无 unique-conflict 捕获（chat 路径有，voice 无）→ 可能 500 + 浪费模型调用；
  ②取消只覆盖 HerVoice（generateReply 无 signal，断线后仍生成并落库）；③幂等实际收益有限（每次提交
  新 UUID，人工重试不复用；孤儿 user 消息会永久 409，无租约/TTL）；④route contract 测试是源码正则，
  缺 DB-mock 行为测试；前端新字段无断言。
- 建议 round 127：先修 P1-1（超时常量一致性 + 测试）→ P2-1 并发 catch-and-replay → 语音 transcript-first
  流式（R2 原计划）；随后 R3 全页面 980、R4 CSS 预算、R5 后端 CI/readiness。孤儿测试接线可随时插入。

## 10. 轮次 126 P1 修复复核（2026-10-30 01:26–01:40）

- 基线：frontend **c226868**、backend **4dc24f0**（均 01:26:09 提交且**已部署**：生产入口
  `index-C4FrfWn0.js`（App chunk 含 `client_message_id`/`12e4`/`randomUUID`/`reply_to_client_message_id`）、
  生产 backend revision=`4dc24f0`）。
- 修复验证：①超时 `VOICE_TURN_TIMEOUT_MS=120_000`（测试断言 ≤120k），相对 HerVoice 90s 上限留约
  30s 生成余量；②user 消息 save 增加 23505 catch：查 winner→conversation 断言→查 assistant→
  replay（deduplicated）或 409，不再 500；catch 位于生成之前 → **loser 不会重复模型生成**，但 loser
  仍重复一次 HerVoice 转写（残余成本）；③生产 e2e（假麦克风 + `/voice/turn` 本地伪造）：启动空闲
  `writes=[]`，长按后请求 multipart 含合法 UUIDv4 `client_message_id` + file，未触达真实后端/DB。
- 证据更正：lead 引用的 `round126-frontend.log` 结束于 01:23:03，早于最终文件修改（01:23:37）与
  commit（01:26:09），**不覆盖最终提交**；Elephant 已对 c226868 重跑 `npm test`：**exit 0、0 fail**
  （01:35:20 完成）。backend `round126-backend-final2.log` 0 fail 有效（源文件 mtime 早于运行开始）。
- 剩余 P2：①23505 catch 无 DB-mock 行为测试；②loser 重复 HerVoice 成本（可先预留 client id）；
  ③user 已存/assistant 缺失时同 UUID 永久 409（无 TTL）；④人工重试不复用 UUID（超时后重复风险仍在，
  但 120s 已降低触发面）；⑤取消仍只覆盖 HerVoice（generateReply 无 signal）；⑥超时断言 ≤120k 过宽
  （不防被改小到低于 90s）；⑦前端 UUID/字段无单测（已用生产 e2e 补证）。
- 结论：126 P0=0、P1=0；建议 127 先补 23505 行为测试/预留 id，再进入语音 transcript-first 流式，
  随后 R3/R4/R5。

## 11. 轮次 126 超时预算复核（Goldfish-R4 P1 后，2026-10-30 01:38–01:52）

- 基线：frontend **008da05**、backend **8903116**（01:45:31 提交/push，**均已部署**：生产入口
  `index-DZW8phdA.js`、语音 chunk `inner-monologue-sync-CEq-pjKc.js` 含 `15e4`；
  backend `/health` revision=`8903116`）。
- 测试：frontend `round126-frontend-final2.log` **0 fail**（01:45:06 完成）、backend
  `round126-backend-final3.log` **0 fail**（01:40:01 完成），两者均严格覆盖最终提交（mtime/commit 已核对）；
  定向 voice-turn+chat-idempotency 2/2、frontend voice.test pass。
- 本次修复：HerVoice 上限 90→60s（代码+render.yaml 60000）、voice route 对 `generateReply` 的
  `request_timeout_ms` clamp ≤60s、前端 120→150s（测试 ≤150k）。
- **预算判定（150 > 60+60+冷启动余量？）**：仅在“单轮生成+暖启动+无记忆压缩”的常见路径成立
  （典型 40–90s，余量充足）；**结构性最坏路径仍不成立**：
  ①tool loop 每轮 60s、默认 3 轮（retryable 6 / takeout 4）→ 生成最坏 180–360s
  （`ai-service.js:1537-1541/2223/2246/2365`，单次 requestJson 硬顶 300s `:1647-1650`）；
  ②记忆压缩在响应前 await 且用未 clamp 的原始 settings（`server.js:6852-6856`），触发时再加一次
  provider 调用；③冷启动（历史 ~24s）+上传+DB 未计入 30s 余量。
  → 前端 150s 仍可能先超时、服务端继续生成落库（voice route 无总 deadline，abort 仅 HerVoice 前后）；
  建议 route 总 deadline(~140s)+生成/保存前 abort 检查+signal 下传，或压缩移出响应路径，或 transcript-first。
- 其余 P2：HerVoice 60s 提高慢转写 504 概率（观察 p95）；取消仅 HerVoice；409 无 TTL；并发残差；
  测试只有常量断言、无总 deadline/tool-round/clamp/并发行为测试。
- 部署注意：`render.yaml` 60000 不等于 Render 运行时 env 生效（需控制台确认，/health 不暴露）；
  生产 App chunk 里的 `12e4` 是其他模块常量，语音 chunk 以 `15e4` 为准。
- 建议 127：先做 route 总 deadline/abort 收口（唯一剩余结构性 P1 类），再 transcript-first 流式；
  随后 R3 全页面 980、R4 CSS 预算、R5 后端 CI/readiness。

## 12. 轮次 127 语音响应后置复核（2026-10-30 02:00–02:12）

- 基线：backend **40ea725**（01:58:28 提交，**生产 `/health` revision=40ea725 已上线**）；
  frontend 008da05 未改。backend 仅 `server.js` + `test/voice-turn.test.js`。
- 测试：`round127-backend.log` **0 fail**（01:58:06 完成；server/test mtime 早于运行开始、commit 晚于运行结束
  → 严格覆盖最终提交）；定向 voice-turn **1/1** pass。
- 已验证：`res.json`（server.js:6842，`memory_compression:null`）先发；四个后置任务
  `void touchConversation / tryScheduleProactiveMessageEvaluation / tryScheduleAutonomousContentEvaluations /
  tryCompressMemory` 全部带 `.catch` 在响应后执行；压缩改用 effectiveSettings（60s clamp）；
  前端不消费 `memory_compression`；`memoryCompressionLocks` 防与下一轮双跑；生产 revision 对得上。
- P1 预算变化：压缩/触达/主动评估移出关键路径 → 典型响应省 0.5–2s，触发压缩的轮次最多省 ~60s
  （“压缩拉长语音响应”已关闭）；**结构性 P1 仍在**：生成超时仍是每次 provider 调用 ≤60s，
  tool loop 默认 3 轮（retryable 6 / takeout 4）→ 最坏生成 180–360s，150s 客户端仍可能先超时。
  建议 128 首项：route 总 deadline(~140s)+生成/保存前 abort 检查+generateReply signal，或 transcript-first。
- 新增 P2/P3：后置任务 touch/proactive/autonomous 失败被静默吞（建议补日志/后台 job 化，避免主动消息
  调度丢失）；进程重启窗口后置任务可能丢；测试仍仅源码正则断言（无行为/异常/顺序测试）。
- 结论：127 P0=0；P1 结构性问题收窄但未清零（生成总量无上限）；其余为 P2/P3。

## 13. 轮次 128 语音总 deadline 复核（2026-10-30 02:08–02:22）

- 基线：backend **b843e7f**（02:06:46 提交，**生产 `/health` revision=b843e7f 已上线**）；
  frontend 008da05 未改。改动：`VOICE_TURN_DEADLINE_MS`（clamp 30–300s、默认 140s、render.yaml
  140000）；server.js deadline 定时器 + close/finish 清理 + generation 用 `raceWithAbort(turnAbort.signal)`；
  raceWithAbort helper + 测试。
- 测试：`round128-backend-final.log` **0 fail**（02:06:17 完成；mtime/运行窗口/commit 已核对，覆盖最终提交）；
  定向 voice-turn 复跑 **1/1** pass（含 raceWithAbort abort→504 / resolve 直通）。
- 已验证：deadline 到点 abort → generation race 返回 504 `VOICE_TURN_DEADLINE`；客户端断开 → 499
  `VOICE_TURN_CANCELLED`；race 先 reject → **assistant 不保存**、后置任务不执行；`finish`/`close`
  都清定时器；raceWithAbort 两侧 handler 齐全（被放弃的 generation 不会 unhandledRejection）。
- 覆盖缺口：**deadline 只 race generation 段**，prefix（settings/conversation/context/MCP/worldBook/
  chatTools）无 race/信号（HerVoice 另有 60s）；prefix 卡住可越过 140s。且 deadline 在 prefix 阶段触发时，
  代码仍会先启动 `generateReply` 再 race 立即 504 → 一次无效模型调用 + 可能工具副作用。
- P1 状态：**客户端可见的 generation 等待已关闭**（正常路径 ≤140s 返回 504，150s 客户端不再先超时）。
- 剩余 P2：①模型/tool 未被取消（abort 后仍可能写库副作用）；②孤儿 user 消息 + 同 UUID 永久 409
  （无 TTL；人工重试新 UUID 会多一条 user 消息）；③前端 150s vs deadline 140s 仅 10s 余量
  （上传/冷启动排队可先断；env 可调到 300s 而前端 150s 静默错位，建议 180s 或 deadline 120s + 一致性测试）；
  ④prefix 无 deadline（见上）；⑤测试仍偏源码正则，race 断言在顶层 IIFE、route 行为/清理未覆盖。
- 建议 129：先修 ②（orphan 清理/lease）与 ①（signal 下传 + executeTool 闸门），再 transcript-first；
  随后 R3 全页面 980、R4 CSS 预算、R5 后端 CI/readiness。
- 部署注意：`/health` 不暴露 `VOICE_TURN_DEADLINE_MS`，运行时 env 值需 Render 控制台确认
  （默认 140000 与 render.yaml 一致，未同步时默认值仍对齐）。

## 14. 轮次 129 unhandledRejection 修复复核（2026-10-30 02:18–02:32）

- 基线：frontend **4debff4**（FE 180s；生产入口 `index-BezGkGb9.js`、语音 chunk 含 `18e4`）；
  backend **0706312**（生产 `/health` revision 已核对；含 e076009 生成前 abort guard）。
- 测试：`round129-backend.log` **0 fail**（02:16:27 完成，mtime/运行窗口/commit 已核对覆盖最终提交）；
  定向 voice-turn 复跑 **1/1**（pre-aborted + late reject）；`round129-frontend.log` **0 fail**
  （02:25:47 完成）。
- 已验证：raceWithAbort 早期 abort 路径先 `promise.catch(()=>{})` → Node24 unhandledRejection 不再发生
  （测试用 setImmediate 留出检测窗口，全量 0 fail 证明）；e076009 在 generateReply 前加 abort guard
  （deadline 504/断线 499，避免无效模型调用）；正常 abort 路径两侧 handler 齐全。
- **与 lead 描述不符（重要）**：e076009 commit message 称“clamp deadline below client”，但代码未改：
  `server.js:6472-6475` 仍 `Math.min(300_000, ...)`，全仓无 `170_000`；env 可调到 141–300s 并超过
  FE 180s → 错位可复发（当前生产 env=140000 无影响）。建议补 clamp 170_000 + 配置契约测试。
- 剩余 P2：①orphan user/同 UUID 409（无 TTL/lease）；②模型/tool 未取消（abort 后仍可能写库副作用）；
  ③assistant 保存窄窗口无 abort 再检查；④504/499 code 未映射给客户端（safeCode/白名单过滤，前端只能
  靠 message）；⑤prefix（DB/context）不在 deadline race 内；⑥route 行为/清理/clamp 无自动化测试。
- 建议 130：先补 clamp 170s + 504/499 code 映射（小改动），再 orphan/lease 与 signal 下传；
  之后 transcript-first / R3/R4/R5。

## 15. 轮次 130 clamp / 语音 code 映射复核（2026-10-30 02:33–02:45）

- 基线：backend **cd618cd**（02:31:25 提交，生产 `/health` revision 已核对一致）；frontend **4debff4**
  未改（180s；生产入口 `index-BezGkGb9.js`、语音 chunk 含 `18e4`）。
- 测试：`round129-backend-final2.log` **0 fail**（02:31:03 完成；server/test mtime 早于运行开始、
  commit 晚于运行结束 → 覆盖最终提交）；定向 voice-turn 复跑 **1/1**。
- 已验证：①deadline clamp 真正改为 `170_000`（默认 140000、env 可配、上限 170s），旧 300s 移除，
  测试含负向断言；②`voiceLifecycleCode` 对 `VOICE_TURN_DEADLINE`/`VOICE_TURN_CANCELLED` 绕过
  safeCode/白名单过滤并置于 publicErrorCode 最前 → voice 504/499 响应现在带可识别 `code`，
  其他路由映射不变（isVoiceRequest 门控）；③FE 180s > BE 上限 170s > 默认 140s，env 误配也会被
  clamp → “客户端先超时”的结构性错位关闭。
- 剩余 P2：①orphan user/同 UUID 永久 409（无 TTL/lease）；②模型/tool 未取消（abort 后仍可能写库副作用）；
  ③assistant 保存窄窗口无 abort 再检查；④prefix（DB/context）不在 deadline race 内；
  ⑤clamp/code 无行为测试、race 断言在顶层 IIFE、无前后端常量一致性测试；⑥前端仍未消费 code（P3，
  可做差异化提示/UUID 复用）；XHR 计时含上传/冷启动，env=170 时仅 ~10s 余量（默认 140 时 ~40s，P3 观察）。
- 结论：130 P0=0、P1=0（clamp/code 收口）；建议 131 优先 orphan/lease + signal 下传，再 transcript-first；
  Goldfish-R9 复核进行中。

## 16. 轮次 131 orphan resume 复核（2026-10-30 02:45–03:00）

- 基线：backend **66ea928**（02:43:58 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round131-backend.log` **0 fail**（02:43:34 完成；server/voice-turn/test mtime 早于运行开始、
  commit 晚于运行结束 → 覆盖最终提交）；定向 voice-turn 复跑 **1/1**。
- 已验证：同 client_message_id 的 stale user（默认 ≥160s，env `VOICE_ORPHAN_RESUME_MS` clamp 60–300s；
  fresh 仍 409）可恢复：复用 conversation_id、原 content 与 stored voice_analysis，**跳过 HerVoice 与
  user 插入**，assistant 仍写 reply_to_client_message_id（后续同 UUID 走 replay）；`created_at` 非法 → 409。
- 新发现 P2：①TTL 默认 160s 与 deadline clamp 上限 170s/env 下限 60s 可能重叠 → 双 generation，
  assistant unique 冲突时 saveMessage **无 try/catch**（server.js:6876-6894）→ 500；建议 TTL 与 deadline
  联动 + 23505 catch→replay；②并发无 clientMessageQueue/lease；③无 `is_voice` 守卫（chat 也共用
  client_message_id 列）；④恢复仍强制 multipart 文件（音频未用，浪费上行）；⑤`VOICE_ORPHAN_RESUME_MS`
  未写进 render.yaml（生产默认 160s，/health 不可核验）；⑥前端人工重试仍新 UUID，恢复逻辑吃不到；
  ⑦测试仅 helper 单测+源码正则，无路由行为/并发测试。
- 遗留 P2：assistant save 窄窗口、模型/tool 未取消、prefix 不受 deadline。
- 建议 132：先做 assistant 23505 catch→replay + TTL/deadline 联动 + `is_voice` 守卫（小改动、风险低），
  再考虑前端保留 UUID/blob；Goldfish-R10 复核中。

## 17. 轮次 132 orphan 硬化复核（2026-10-30 02:52–03:05）

- 基线：backend **fcdc13f**（02:50:23 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round132-backend.log` **0 fail**（02:50:01 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终提交）；定向 voice-turn 复跑 **1/1**。⚠ 本 commit **无测试文件改动**，新逻辑无断言（绿≠覆盖）。
- 已验证：①TTL clamp 180–600s 默认 200s（<180 被抬到 180），helper 同步；直接调用验证 200s→true、
  170s→false，默认 200s > deadline 170s → 生成中恢复窗口关闭；②`is_voice` 守卫对非语音同 UUID
  返回 409 CLIENT_MESSAGE_NOT_VOICE（buildVoiceMessageMetadata 恒带 is_voice，正常语音不误伤）；
  ③assistant save 23505 catch→find assistant→voiceReplayPayload，不再 500（找不到才 rethrow）；
  ④并发冲突仅解决“500/replay”，两请求在冲突前的 generation/tool 仍双跑。
- 重要不符：**render.yaml 实际未加 `VOICE_ORPHAN_RESUME_MS`**（只有 line 63 的 VOICE_TURN_DEADLINE_MS）；
  生产未在控制台设置时用代码默认 200s，`/health` 不可核验。另 TTL 200s > FE 180s → 前端即使复用 UUID，
  180–200s 即时重试仍 409（建议 TTL 185–190s 或 FE 退避）。
- 剩余 P2：并发无 lease/queue（重复 generation/tool）；FE 重试不复用 UUID；模型未取消；save 窄窗口；
  CLIENT_MESSAGE_NOT_VOICE code 未映射（408/409 响应只有 message）；render.yaml 未补 env；测试缺口。
- 遗留：stored analysis 缺字段默认 neutral/0（P3 伪分析）、恢复仍强制 multipart 文件、prefix 不受 deadline。
- 建议 133：先补 per-client-id lease/queue（从根上消除重复 generation）与 FE UUID 复用+重试时序；
  再补 render.yaml env 与行为测试；Goldfish-R11 复核中。

## 18. 轮次 133 same-client guard 复核（2026-10-30 03:05–03:18）

- 基线：backend **6a658d9**（03:03:57 提交，生产 `/health` revision 已核对一致；含 87c735d：
  render.yaml 补 `VOICE_ORPHAN_RESUME_MS=200000`、`CLIENT_MESSAGE_NOT_VOICE` 加入 voiceLifecycleCode
  ——上轮两处 P2 关闭）；frontend 4debff4 未改。
- 测试：`round133-backend.log` **0 fail**（03:03:35 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**。⚠ 新 guard 仅源码正则断言，无并发/清理行为测试。
- 已验证：`activeVoiceTurns` Map 在 file+parse 后、replay/orphan 预检前 claim；同 normalized id 在途
  （<200s）→ 原始 409 `{code:"VOICE_TURN_IN_PROGRESS"}`（code 直接响应体，不经错误映射过滤）；
  get→set 无 await（单线程原子）→ 单进程内 fresh/orphan 重复请求被串行化；`finally` 在所有 claim
  后路径清理，guard 自身 409 在 claim 前返回；与 orphan TTL 判定互不替代。
- 结论：**P0=0、P1=0（单实例前提）**。
- 剩余 P2：①仅单进程（`activeVoiceTurns` 模块级 Map），跨实例/滚动部署无 DB lease → 仍可能双 generation
  （assistant conflict 可 replay 但模型/tool 双跑）；②guard TTL 硬编码 200s，未与 deadline/env 联动
  （prefix 卡 >200s 可重复 claim）；③key 未加租户作用域（同 UUID 跨账号可互相 409，碰撞概率≈0）；
  ④FE 重试仍新 UUID，且 TTL 200s > FE 180s → 180–200s 即时重试仍 409；⑤模型未取消/tool 副作用；
  ⑥save 窄窗口无 abort 再检查；⑦guard 无并发/清理行为测试。
- 遗留 P3：stored analysis 缺字段默认 neutral/0、恢复仍强制 multipart 文件、prefix 不受 deadline。
- 建议 134：优先决定“单实例+部署窗口文档化”还是补 DB lease；同时做 guard key${userId}:${clientId}、
  TTL 与 deadline 联动、FE UUID/退避时序；Goldfish-R12 复核中。

## 19. 轮次 134 guard 抽取与租户作用域复核（2026-10-30 03:18–03:30）

- 基线：backend **3012f33**（03:16:33 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round134-backend.log` **0 fail**（03:16:12 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**；本轮 guard 单测已真实落地（注入时钟的 claim/重复 claim/
  expiry/release/其它 key/size，且 `test:voice-turn` 在 npm test 链中，非孤儿）。
- 已验证：`createVoiceTurnGuard({now})` 抽取完成（Map + claim/release/has/size）；server key 改为
  `${userId}:${companionId}:${clientMessageId}`（上轮 P2-3 关闭）；claim TTL = `deadlineMs+30_000`
  （deadline clamp 30–170s → TTL 60–200s，上轮 P2-2 基本关闭）；`activeVoiceTurns` 已完全移除；
  claim 仍在 replay/orphan 预检前，失败不设置 claimed、成功 finally release，语义与上轮一致。
- 仍存 P2/P3：①跨实例无 DB lease（单实例有效；滚动部署/多实例仍可双 generation，assistant 冲突可 replay
  但模型/tool 双跑）；②release 无 token：若 handler 超过 TTL（prefix 卡 >30s）且同 key 被重新 claim，
  旧 finally 会删新 claim → 可再进第三个请求，建议 claim 返回 token+release 校验；③TTL=deadline+30s
  未覆盖 prefix 长尾，建议 max(deadline+60s, prefix p99 余量)；④FE 重试仍新 UUID + TTL 200>FE 180；
  ⑤模型未取消/tool 副作用；⑥save 窄窗口；⑦claim-before-replay 瞬时 409；⑧route 级并发/租户隔离测试
  仍缺（helper 单测已补）。
- 遗留 P3：stored analysis 缺字段默认 neutral/0、恢复仍强制 multipart 文件、prefix 不受 deadline。
- 建议 135：先补 release token + TTL/prefix 配比（小改动，消除 guard 自身竞态），再决定单实例文档化
  vs DB lease；FE UUID 复用与超时/退避一起做；Goldfish-R13 复核中。

## 20. 轮次 135 guard ownership token 复核（2026-10-30 03:29–03:40）

- 基线：backend **3743dd5**（03:28:07 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round135-backend.log` **0 fail**（03:27:45 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**（fake token+clock：claim/重复/过期 reclaim/旧 token release
  不删新 claim/新 token release/其它 key/size）。
- 已验证：①`claim` 返回 token（默认 randomUUID，可注入），失败/空 key 返回 `""`；
  `release(key, token)` 校验 token，旧 handler 的 finally 不会删除过期后重 claim 的新条目（单测断言）；
  ②server `voiceTurnClaimed={key,token}`，finally `release(key,token)`，失败 claim 不 release；
  ③TTL 提升为 `deadlineMs+60_000`（默认 200s、上限 230s）；④409 带 `Retry-After:5` +
  `code:"VOICE_TURN_IN_PROGRESS"`（raw body）；⑤租户 key 不变。
- 结论：token 竞态已修；**P0=0、P1=0（单实例）**。
- 仍存：①跨实例无 DB lease（滚动部署/多实例仍可双 generation，assistant replay 但模型/tool 双跑）；
  ②FE 重试仍新 UUID + TTL 200>FE 180；③模型未取消/tool 副作用；④save 窄窗口；
  ⑤TTL=deadline+60 仍可能被 prefix 长尾超过（旧 release 不会误删但老/新 generation 可并存）；
  ⑥release 的 token 可选（不传会删任意 claim，server 传了，但 API 应强制）；
  ⑦Retry-After 硬编码 5s 未按剩余 TTL；⑧claim-before-replay 瞬时 409；⑨route 级集成测试仍缺
  （guard 单测已真覆盖 ownership）。
- 遗留 P3：stored analysis 缺字段默认 neutral/0、恢复仍强制 multipart 文件、prefix 不受 deadline。
- 建议 136：release token 必填 + Retry-After 用剩余 TTL（小改）；然后决定单实例文档化 vs DB lease；
  FE UUID/超时退避与模型取消并行推进；Goldfish-R14 复核中。

## 21. 轮次 136 guard token 必填 / Retry-After 复核（2026-10-30 03:41–03:52）

- 基线：backend **ce596b8**（03:40:11 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round136-backend.log` **0 fail**（03:39:48 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**（fake clock：claim/重复/remaining=1000/无 token release=false
  且 claim 保留/过期 remaining=0/reclaim token-2/旧 token=false/新 token=true/其它 key/size）。
- 已验证：①`release(key, token)` token 必填，缺失或不匹配返回 false 且不删除（旧 finally 不会误删新 claim）；
  server finally 始终传 `{key,token}`；②`remainingMs(key)` 暴露，claim 失败时
  `Retry-After = max(1, ceil(remaining/1000))`（不再硬编码 5）并设 `Access-Control-Expose-Headers:
  Retry-After`（跨源可读）；③claim 存 `expiresAt`，判定 `now() < expiresAt`，过期可重 claim；
  ④测试覆盖 token 必填/剩余 TTL/旧 token；⑤生产 revision=ce596b8。
- 结论：token/Retry-After 两项收口；**P0=0、P1=0（单实例）**。
- 仍存 P2：①跨实例无 DB lease（滚动部署/多实例双 generation，assistant replay 但模型/tool 双跑）；
  ②FE 重试仍新 UUID + TTL 200>FE 180；③模型未取消/tool 副作用；④save 窄窗口；
  ⑤server wiring 仍仅源码正则，无集成/mutation 测试（删/改 finally 传 token 或 409 Retry-After 可能仍绿）。
- 仍存 P3：TTL=deadline+60 仍可能被 prefix 长尾超过（旧 release 安全但老/新 generation 可并存）；
  Expose-Headers 为 409 专属覆盖（建议加进全局 exposedHeaders）；`at` 字段已无用；claim 内 now() 调两次；
  claim-before-replay 瞬时 409；前端未消费 code/Retry-After。
- 遗留 P3：stored analysis 默认 neutral/0、恢复仍强制 multipart 文件、prefix 不受 deadline。
- 建议 137：server wiring 抽可单测函数/route 集成测试（含 mutation 检查）；决定单实例文档化 vs DB lease；
  FE UUID/退避与模型取消并行；Goldfish-R15 复核中。

## 22. 轮次 137 in-progress 响应抽取 / CORS 复核（2026-10-30 03:54–04:05）

- 基线：backend **f6cab4e**（03:52:34 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round137-backend.log` **0 fail**（03:52:12 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**（helper 行为：status/code/headers.Retry-After="5"/
  Expose-Headers/body.retry_after_seconds=5；fake clock +1s→4）。
- 已验证：①`voiceTurnInProgressResponse(guard,key)` 抽取（409 + 动态 Retry-After + body
  retry_after_seconds + Expose-Headers，header/body 一致）；server claim 失败改用它，内联计算移除；
  ②通用 voice 409 在错误中间件补 `Retry-After:5` + Expose，且 `!res.getHeader("Retry-After")` 保护
  （guard raw 409 不会被覆盖）✅；③生产 revision=f6cab4e。
- **不符/缺口**：①“全局 CORS exposedHeaders 加 Retry-After”**未落地**——server.js:704-710 仍无
  Retry-After，本轮无 CORS 改动；现状靠每响应 expose，覆盖 voice guard/通用 409，但 429（语音限流、
  expressive-speech ~3143/6165/7075）的 Retry-After 跨源仍不可读。建议加进全局 exposedHeaders 并去掉
  每响应覆盖；②mutation 缺口仍在：helper 单测 ✅，但 server 接线仅源码正则，且 Retry-After/
  Expose-Headers/retry_after_seconds 在 server.js 其它位置也出现 → 删 `res.set(inProgress.headers)`
  或接错 status/body 仍可能绿。建议抽 `applyVoiceTurnInProgressResponse(res, ...)` 对 mock res 断言，
  或 route 集成测试 + mutation；③429 与 409 的 Retry-After 响应未统一 helper。
- 剩余 P2：跨实例 DB lease；FE 新 UUID + TTL200>FE180；模型未取消/tool 副作用；save 窄窗口；
  mutation/wiring；TTL=deadline+60 的 prefix 长尾；claim-before-replay 瞬时 409。
- 遗留 P3：stored analysis 默认 neutral/0、恢复仍强制 multipart 文件、prefix 不受 deadline；前端未消费
  code/retry_after_seconds。
- 建议 138：全局 exposedHeaders + 统一 Retry-After helper + server 接线行为/mutation 测试；随后 lease/
  FE UUID/模型取消；Goldfish-R16 复核中。

## 23. 轮次 138 apply helper / CORS 复核（2026-10-30 03:59–04:10）

- 基线：backend **25c9429**（03:58:07 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round138-backend.log` **0 fail**（03:57:46 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**（mock res 断言 apply helper 的 status/headers/body）。
- 已验证：①`applyVoiceTurnInProgressResponse(res, guard, key)` 落地：res.status(409)+set 动态
  Retry-After+json(body)，server claim 失败路径直接 `return apply...`（旧内联移除）；
  ②全局 CORS `exposedHeaders` 已加 `"Retry-After"`（server.js:711）→ guard/通用 409、语音限流与
  expressive-speech 429 的 Retry-After 均可跨源读取；③每响应 `Access-Control-Expose-Headers` 已移除
  （server.js/voice-turn.js grep 0 处）；④通用 voice 409 只补 `Retry-After:5`（getHeader 保护）；
  ⑤生产 revision=25c9429。上轮“全局未落地”结论作废。
- 剩余 P2：①跨实例无 DB lease（滚动部署/多实例双 generation，assistant replay 但模型/tool 双跑）；
  ②FE 重试仍新 UUID + TTL 200>FE 180；③模型未取消/tool 副作用；④save 窄窗口；
  ⑤mutation 缺口缩小但仍在——apply helper 已行为测试（mock res），但 server 路由调用点仍靠源码正则
  （不调用但保留 import 也可能绿；`"Retry-After"\s*\n\s*\]` 断言依赖格式）。建议 route 集成测试或把
  claim-failure 分支抽函数 + mutation；⑥TTL=deadline+60 的 prefix 长尾；⑦claim-before-replay 瞬时 409。
- 遗留 P3：429 body `retry_after_seconds` 不一致（限流有、expressive-speech 无）；前端未消费
  code/retry_after_seconds；stored analysis 默认 neutral/0、恢复仍强制 multipart、prefix 不受 deadline。
- 建议 139：route 级集成测试/分支抽函数 + 429 helper 统一；然后 lease/FE UUID/模型取消；Goldfish-R16 复核中。

## 24. 轮次 139 claim-failure / Retry-After helper 复核（2026-10-30 04:07–04:18）

- 基线：backend **68d2426**（04:06:10 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round139-backend.log` **0 fail**（04:05:48 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**（两个 mock res 行为块）。
- 已验证：①`claimVoiceTurnOrRespond(res,guard,key,ttlMs)`：成功返回 token 不写 res；失败写 409/headers/
  body 返回 ""；server 改为 `const claimToken=claimVoiceTurnOrRespond(...); if(!claimToken) return;
  voiceTurnClaimed={key,token}`，claim-failure 分支有行为测试（成功 calls.length=0，失败 status/set/json）；
  ②`setRetryAfterHeader(res,ms,body?)`：min 1s + header + 可选 body.retry_after_seconds，返回秒数；
  generic voice 409 改用 `setRetryAfterHeader(res,5000)`（header 5s，getHeader 保护）；
  ③全局 CORS 暴露未回退；④生产 revision=68d2426。
- 剩余 P2：①call-site mutation 缺口仍在——helper 有行为测试，但 server 路由调用点仍只靠源码正则（停止
  调用但保留 import/传错 ttl 仍可能绿），建议 route 集成（fake req/res）或分支抽纯函数 + mutation；
  ②跨实例无 DB lease；③FE 新 UUID + TTL200>FE180；④模型未取消/tool 副作用；⑤save 窄窗口；
  ⑥TTL=deadline+60 prefix 长尾；⑦claim-before-replay 瞬时 409。
- 剩余 P3：Retry-After 逻辑重复（voiceTurnInProgressResponse 与 setRetryAfterHeader 各自 min/ceil，
  claimVoiceTurnOrRespond 与 apply helper 各自 set/status/json）；server 未使用
  applyVoiceTurnInProgressResponse import（冗余）；generic 409 body 无 retry_after_seconds（guard 有）；
  expressive-speech 429 body 无该字段；`setRetryAfterHeader` 未测 0/负/NaN/大值与 body 写入分支；
  前端未消费 retry 信息；stored analysis 默认 neutral/0、恢复仍强制 multipart、prefix 不受 deadline。
- 建议 140：route 级集成/call-site mutation + Retry-After 去重（复用 helper）；然后 lease/FE UUID/模型取消；
  Goldfish-R17 复核中。

## 25. 轮次 140 统一 Retry-After / call-site 断言复核（2026-10-30 04:20–04:32）

- 基线：backend **7d16b05**（04:19:08 提交，生产 `/health` revision 已核对一致）；frontend 4debff4 未改。
- 测试：`round140-backend.log` **0 fail**（04:18:48 完成；mtimes 早于运行开始、commit 晚于运行结束 →
  覆盖最终内容）；定向 voice-turn **1/1**。
- 已验证：①server 所有 Retry-After 生产点统一走 `setRetryAfterHeader`：语音限流（返回秒数写 body）、
  companion/interact catch、expressive-speech 429（**body 已补 `retry_after_seconds`**）、error middleware
  通用 voice 409；grep 已无裸 `res.set("Retry-After")`；②test 新增 4 条精确 call-site 源码正则
  （claimVoiceTurnOrRespond 参数、`if (!claimToken) return;`、release key/token、setRetryAfterHeader
  参数）→ mutation 面收窄；③全局 CORS 仍暴露、无每响应 Expose 回退；④生产 revision=7d16b05。
- 仍存 P2：①call-site mutation **未真正收口**——仍是源码正则、无路由 fake req/res 集成测试；
  值级变异（guardKey 组成、guardTtlMs 取值/传参）未必被覆盖，建议抽分支/集成 + mutation；
  ②跨实例无 DB lease；③FE 新 UUID + TTL200>FE180；④模型未取消/tool 副作用；⑤save 窄窗口；
  ⑥TTL=deadline+60 prefix 长尾；⑦claim-before-replay 瞬时 409。
- 仍存 P3：Retry-After 计算两份实现（voiceTurnInProgressResponse 自算 min/ceil；建议复用
  setRetryAfterHeader）；server 未使用 applyVoiceTurnInProgressResponse import 却有源码断言（冗余）；
  generic voice 409 body 仍无 retry_after_seconds（guard 有）；companion/interact 429/错误仅有 header；
  前端未消费 retry 信息；stored analysis 默认 neutral/0、恢复仍强制 multipart、prefix 不受 deadline。
- 建议 141：route 级集成测试（claim 成功/失败/finally release）+ Retry-After 去重/清理未用 import；
  然后 lease/FE UUID/模型取消；Goldfish-R18 复核中。

## 26. 轮次 141 前端语音重试复核（2026-10-30 04:39–05:05）⚠ P0

- 基线：frontend **dcf703d**（04:30:32 提交；语音相关文件 mtime 早于 commit；`round141-frontend.log`
  0 fail，04:37:18 覆盖最终内容）。backend 未变 **7d16b05**（生产 /health 一致）。
  生产入口 `index-9xpX95ig.js` → `App-C6cBHmYT.js`，含“重试这条语音”/`voice-retry-button`。
- **P0：dcf703d 缺少声明，生产语音提交会 ReferenceError**：
  ①`git grep` 全 src 只有 `lastVoiceAttemptRef`/`voiceRetryAvailable`/`setVoiceRetryAvailable` 的
  使用点（App.jsx:4095/4250/4251/4278/4298/8478），无任何 `useState/useRef` 声明，也不是 props/context；
  ②生产 App chunk 中这些标识符以**未压缩自由变量**出现 `lastVoiceAttemptRef`×4、
  `setVoiceRetryAvailable`×2、`voiceRetryAvailable`×1（与源码引用次数一致；已声明的局部 state/ref 会被
  minify 成短名）→ 运行到即 ReferenceError；
  ③每次 `submitVoiceBlob` 第一行就引用 `lastVoiceAttemptRef` → **所有语音提交**（不止失败）崩溃，
  成功路径/失败路径/错误渲染/重试按钮全受影响。生产语音链路当前不可用。
- 为什么没抓到（测试/审计盲区）：build（esbuild）不做 undeclared 检查；voice.test.js 是源码正则 +
  FakeXHR（不执行 App 运行时）；真机审计 0 pageerror 只覆盖页面加载/样式（未走语音提交交互），
  retryCss=true 只证明 CSS 存在。
- 源码设计本身正确（待修复后生效）：UUID 复用（options.clientMessageId + lastVoiceAttemptRef + 同 UUID
  formData）、失败显示“重试这条语音”、重试复用同一 blob/durationMs/UUID；voice.js 错误对象保留
  status/code/retryAfterSeconds（body 优先/header 兜底，跨源依赖后端全局 CORS expose）；CSS 44px/
  focus-visible/touch-action、原生 button 在 role=alert 内可键盘操作。
- 修复：App 组件补 `const lastVoiceAttemptRef = useRef(null);`
  `const [voiceRetryAvailable, setVoiceRetryAvailable] = useState(false);` → 重跑全量+build → 校验生产
  App chunk 中上述字面量计数为 **0**（部署门禁）→ 重新部署；补 App 层行为测试（jsdom/react-test-renderer
  失败语音→按钮→重试同 UUID/blob）或真实失败语音浏览器审计 + ESLint no-undef。
- 其余 P2：orphan TTL 200s>FE 180s 的重试时序（retryAfterSeconds 尚未在 UI 消费/倒计时）；跨实例
  DB lease；模型未取消/tool 副作用；save 窄窗口；claim-before-replay；App 重试逻辑无运行时测试。
- 遗留 P3：voice.js 错误分支假定 data 为对象（parse 兜底需复核）；stored analysis 默认 neutral/0、
  恢复仍强制 multipart、prefix 不受 deadline。
- 结论：**141 P0=1（生产语音不可用）**；修复并部署前不回收语音重试项；Goldfish-R19 复核中。

## 27. 轮次 141 P0 修复复核（2026-10-30 04:49–05:05）✅ P0 关闭

- 基线：frontend **98617a0**（04:41:43 提交，+10 行）；backend 未变 **7d16b05**（/health 一致）。
  `round141-frontend-final.log` **0 fail**（04:48:47 完成；source/test mtime 04:41:35 < commit <
  运行开始 04:47:41 < 结束，覆盖最终内容；.err 仅 deprecation 警告）。
- 修复验证：①App.jsx:1647-1650 补
  `const [voiceRetryAvailable, setVoiceRetryAvailable] = useState(false);` 与
  `const lastVoiceAttemptRef = useRef(null);`（useRef/useState 已有 import；测试补声明断言）；
  ②生产 `index-D-bsdxs-.js → App-CHhyJHVO.js`（598,745 B）三字面量 **0/0/0**（修复前 4/2/1），
  “重试这条语音”=1、`voice-retry-button`=1、`client_message_id`=2；③本地 dist `App-BAJA3700.js`
  同为 0/0/0；④定向 `node test/voice.test.js` 复跑通过。
- 生产只读审计（Edge headless、Pixel 390、拦截非 GET）：页面加载 **0 pageerror、0 非 GET**；注入
  `.voice-retry-button` 后 computed minWidth/minHeight=**44px**、fontSize 13px、touch-action
  manipulation；CSS `/assets/index-BXD6W2ow.css` 含 `.voice-retry-button`×2 + min-height:44px。
- UUID 复用（源码级，链路恢复可运行）：submitVoiceBlob 接收 options.clientMessageId；ref 保存
  {blob,durationMs,clientMessageId}；formData 同 UUID；成功清 ref/retry；失败置 retry 可用；
  retryVoiceTurn 复用同 blob/duration/UUID；voice.js 保留 status/code/retryAfterSeconds。
- 仍存 P2：①orphan TTL 200s>FE 180s 时序（重试立即点仍可能 409，retryAfterSeconds 未用于禁用/倒计时）；
  ②跨实例无 DB lease；③模型未取消/tool 副作用；④save 窄窗口；⑤TTL=deadline+60 prefix 长尾；
  ⑥claim-before-replay 瞬时 409；⑦**测试缺口**：App 重试逻辑仍无运行时行为测试（本次 P0 盲区），
  建议 jsdom/react-test-renderer 失败语音→按钮→重试同 UUID/blob，或 CI 加 ESLint no-undef +
  生产 bundle 自由标识符计数门禁（修复前 4/2/1 → 修复后 0，已验证可操作）。
- 遗留 P3：voice.js 错误分支假定 data 为对象；stored analysis 默认 neutral/0、恢复仍强制 multipart、
  prefix 不受 deadline。
- 结论：**141 P0 关闭**（生产语音链路恢复）；无新增 P0/P1；建议 142 处理 retryAfterSeconds 禁用/倒计时与
  App 运行时测试/门禁，再推进跨实例 lease/模型取消；Goldfish-R20 复核中。

## 28. 轮次 142 build no-undef 门禁复核（2026-10-30 04:53–05:10）

- 基线：frontend **a107765**（04:53:02，仅 package.json +1/-1）；backend 未变 7d16b05（/health 一致）；
  round141-final 日志仍有效（产品源码仍 98617a0）。
- 门禁：`build = eslint src/App.jsx --quiet && vite build && npm run verify:csp`；eslint 10.7.0 已装
  （lock 一致）；`eslint.config.js` = js.configs.recommended（no-undef=error）+ browser globals + JSX，
  ignores dist/android/.bugfix。
- 复现验证：①当前 App lint exit 0；②dcf703d App（git show | eslint --stdin）**精确 7 个 no-undef**
  （lastVoiceAttemptRef×4/setVoiceRetryAvailable×2/voiceRetryAvailable×1，exit 1）→ 该门禁能拦住本次 P0；
  ③全量 `npm run build` exit 0（eslint → vite built → verify:csp `{"ok":true,"htmlFiles":3,"allowedHashes":14}`）；
  ④本地 dist App 三字面量 0/0/0。
- 部署覆盖：Vercel buildCommand=`npm run build:web` → build（含门禁）✅；android-apk / publish-android-apk
  工作流用 `npm run build` ✅；直接 `vite build` 可绕过（建议文档化强制 npm build）。
- 生产：现入口 `index-CvFo_jIW.js` → `App-BAXkQACo.js`（598,745B），“重试这条语音”=1、
  client_message_id=2、三长标识符 0/0/0 → P0 保持关闭；注意与 lead 所述 App-CHhyJHVO hash 不同，
  属重新构建（产品源码仍 98617a0），内容等价。
- 仍存 P2/P3：①门禁只 lint App.jsx（实测 `eslint src` 与 `src/**/*.{js,jsx}` 均 exit 0 → 可零成本放宽）；
  ②直接 vite build 绕过；③no-undef 不覆盖运行时行为，App retry 行为测试仍缺；④orphan TTL200>FE180
  立即重试 409、retryAfterSeconds 未用于禁用/倒计时；⑤跨实例 lease、模型未取消、save 窄窗口、
  TTL/prefix、claim-before-replay；⑥build 警告 App chunk 662.97kB/gzip216.52（P3 性能）。
- 结论：142 门禁有效、P0 防回归到位；建议 143 放宽到 src 全量 + 文档化 npm build + App 运行时测试/
  retryAfterSeconds 倒计时；Goldfish-R20 复核中。

## 29. 轮次 143 语音重试倒计时 / 防抖复核（2026-10-30 05:06–05:20）

- 基线：frontend **a3be080**（04:58:44 提交，App.jsx/test +42/-5）；backend 未变 7d16b05（/health 一致）；
  `round143-frontend.log` **0 fail**（05:05:37 完成，mtime/运行窗口覆盖 commit；.err 仅 deprecation 警告）。
- 已验证：①`voiceRetryWaitSeconds`/`voiceRetryInFlight` 新 state；useEffect 每 1s 递减 max(0) +
  cleanup clearTimeout，wait=0 不建 timer；②失败读 `error.retryAfterSeconds` → `max(0, floor(...))`
  设置等待；③按钮 `disabled={inFlight || wait>0}`，wait>0 文案“X 秒后可重试”，否则“重试这条语音”；
  ④`retryVoiceTurn` 有 `!attempt || inFlight || wait>0` 守卫，try/finally 清 in-flight；⑤cancel/begin
  录音清 ref/available/wait，成功路径额外清 in-flight；⑥eslint gate exit 0 + 全量 build exit 0
  （verify:csp ok）；⑦生产 `index-BZhw5hVc.js → App-DQmsj-ir.js`（599,144B）：“秒后可重试”=1、
  “重试这条语音”=1、三长标识符 0/0/0、client_message_id=2；CSS 44px 规则仍在。
- 仍存 P2/P3：①retry attempt 缺 sessionId/turnContext/voiceModel（切换会话后同 UUID 重试会 409/错位），
  建议快照进 attempt 并在会话变更时禁用；②无真实失败语音 e2e/运行时行为测试（本轮仍只有源码断言），
  建议 jsdom/react-test-renderer 或 Playwright 拦截 409 验证倒计时/禁用/清理；③orphan TTL200>FE180：
  超时失败无 retryAfter → 按钮立即恢复，服务端 generic 409（5s 倒计时）可能反复到 TTL，建议提示/更长退避；
  ④in-flight 锁是 state 非 ref，建议 ref 兜底；⑤窄竞态：retry 在途时开始新录音，旧成功回调在 cancelled
  检查前清 lastVoiceAttemptRef，可能清掉新录音 retry 元数据（建议提前 run 比较/attempt 带 runId）；
  ⑥a11y：倒计时文本变化无 aria-live；⑦跨实例 lease、模型未取消、save 窄窗口、TTL/prefix、
  claim-before-replay；⑧门禁仅 App.jsx；App chunk 663kB（P3 性能）。
- 结论：143 倒计时/防抖/清理落地，无新增 P0/P1；建议 144 先补 sessionId 快照 + App 运行时失败语音测试
  （覆盖倒计时/禁用/竞态），再推进 orphan TTL 与跨实例 lease；Goldfish-R21 复核中。

## 30. 轮次 144 orphan recovery 剩余窗口 / lint 复核（2026-10-30 05:23–05:36）

- 基线：backend **35903b2**（05:21:59 提交，生产 `/health` revision 已核对一致；round144-backend.log
  **0 fail**，mtime/运行窗口覆盖 commit；定向 voice-turn **1/1**）。frontend **b535029**（05:19:50，
  仅 test/voice.test.js 删未用 import；生产入口 `index-WVYeb3iR.js` → `App-6XMI7ngo.js` 599,144B）。
- 已验证：①fresh orphan 未到 TTL 时改为 `voiceTurnRecoveryResponse(voiceOrphanRemainingMs(...))` 直接
  409：动态 `Retry-After`、body `code:"VOICE_TURN_RECOVERING"` + `retry_after_seconds`（不再 throw generic
  chatGenerationInProgressError）；②remaining = max(0, max(180k,resumeAfterMs) - age)，header/body 一致，
  `created_at` 非法→0（recovery 1s 边角）；③行为测试覆盖 remaining 100000/0 与 recovery status/code/
  body/header；④前端 voice.js 保留 retryAfterSeconds + App 倒计时，fresh orphan 从“固定 5s 循环”变为
  “剩余 TTL 倒计时”再 resume（源码级联动）；⑤frontend `npm run lint` exit 0、**0 error / 11 warning**
  （既有 react-hooks/exhaustive-deps）；b535029 仅测试文件变更，产品源码不变；定向 voice.test 通过；
  ⑥生产 App：倒计时/重试文案在、三长标识符 0/0/0、client_message_id=2；backend 35903b2。
- 仍存 P2/P3：①泛 409 body 不一致——server.js:6716（并发 user 插入 23505 catch）仍走错误中间件：
  仅 `Retry-After:5` header、无 body retry_after_seconds（code CHAT_GENERATION_IN_PROGRESS 可出），建议统一
  recovery/Retry-After helper；②跨实例无 DB lease；③模型未取消/tool 副作用；④save 窄窗口；⑤TTL/prefix
  长尾；⑥claim-before-replay 瞬时 409；⑦frontend retry attempt 仍缺 sessionId/turnContext/voiceModel
  （切换会话后同 UUID 重试 409/错位）；⑧fresh-orphan 路由响应与前端倒计时仍无集成/浏览器测试（本轮仅
  helper 行为测试 + 源码断言）；⑨invalid created_at→recovery 1s、DB/服务器时钟偏差影响剩余秒（边角）；
  ⑩门禁仅 App.jsx（`eslint src` 已零存量可放宽）；App chunk 663kB（P3）。
- 结论：R21 P1 修复真实落地（响应级动态剩余 TTL + 前端倒计时联动），无新增 P0/P1；建议 145 统一泛 409
  body/recovery helper + fresh-orphan 集成测试 + frontend sessionId 快照；Goldfish-R22 复核中。

## 31. 轮次 145 23505 恢复 / session pin 复核（2026-10-30 05:44–06:00）

- 基线：backend **e1c0049**（05:39:28 提交，生产 `/health` revision 已核对一致；round145-backend.log
  **0 fail**，mtime/运行窗口覆盖 commit；定向 voice-turn **1/1**）。frontend **3ab7a45**（05:39:29；
  round145-frontend.log **0 fail**；lint 0 error/11 warning；build+verify:csp 通过；生产入口
  `index-Bc8L96MZ.js → App-KbtoU_Ze.js` 599,237B）。
- 已验证：①23505 user insert 冲突且无 assistant 时不再 generic 409，改为
  `voiceTurnRecoveryResponse(voiceOrphanRemainingMs(previousUser, voiceOrphanResumeWindowMs(env)))` 直接 409：
  动态 Retry-After + body `retry_after_seconds` + `VOICE_TURN_RECOVERING`（有 previousUser 时）；仅
  “冲突后查不到 previousUser”的极窄副本延迟路径仍 generic；②抽 `voiceOrphanResumeWindowMs`
  （clamp 180k–600k、默认 200k，fresh-orphan 与 23505 共用）并加行为测试（bad/150000/900000）；
  ③`voiceOrphanRemainingMs` invalid created_at 返回完整 TTL（不再 1s 高频循环，corrupted 行会长时间
  recovery，边角取舍）；④frontend `sessionId = options.sessionId || current`，
  发送前写入 `lastVoiceAttemptRef.sessionId`，retry 传 `sessionId: attempt.sessionId` → 重试固定原会话
  （143 遗留 sessionId 项关闭）；测试加源码断言；⑤backend/frontend 全量 0 fail、lint/build/CSP 与生产
  bundle markers/字面量 0 均独立复核。
- 仍存 P2/P3：①跨实例无 DB lease；②模型未取消/tool 副作用；③assistant save 窄窗口；④TTL/prefix 长尾；
  ⑤claim-before-replay 瞬时 409；⑥**route 级集成测试仍缺**（fresh-orphan/23505 recovery 无真实 HTTP/
  fake req-res；前端倒计时无运行时测试）；⑦retry 只 pin sessionId，turnContext/voiceModel 未快照；
  ⑧残留 generic 409 body（previousUser 查不到）、invalid created_at 长恢复、时钟偏差影响剩余秒；
  ⑨门禁仅 App.jsx；App chunk ~663kB（P3）。
- 结论：145 P0=0、P1=0（23505 R21 race 与 session pin 收口）；建议 146 先补 route/前端运行时集成测试，
  再推进跨实例 lease / 模型取消 / save 窄窗口；Goldfish-R23 复核中。

## 32. 轮次 146 全量 src lint 门禁 / recovery call-site 断言复核（2026-10-30 06:00–06:12）

- 基线：frontend **21382e0**（06:00:13，仅 package.json：build 脚本 `eslint src --quiet`）；
  backend **db6ed2f**（06:00:12，仅 test/voice-turn.test.js +6 行 recovery call-site 精确断言）。
  本轮 _audit 无 round146 全量日志，以下为独立复跑。
- 已验证：①`eslint src --quiet` **exit 0**（全 src 零 error；门禁从 App-only 扩展为全 src），
  全量 `npm run build` exit 0 + verify:csp `{"ok":true,"htmlFiles":3,"allowedHashes":14}`；Vercel
  `build:web`/Android workflows 均走该 build，直接 `vite build` 仍可绕过（P3）；②backend 新增断言：
  `voiceTurnRecoveryResponse(voiceOrphanRemainingMs(previousUserMessage,resumeAfterMs))` 嵌套模式、
  `res.set(recovery.headers)`、`voiceOrphanResumeWindowMs(`；定向 voice-turn **1/1**（仍源码正则，非
  HTTP/fake req-res 行为测试）；③生产前端现为 `index-DSJNbEpH.js → App-B0e8XYhC.js`（599,237B，hash
  与上轮不同属重新构建；秒后可重试=1、重试文案=1、三长标识符 0/0/0、client_message_id=2）；
  backend db6ed2f 为测试-only，生产 `/health` 仍 e1c0049（预期，不是部署异常）。
- 仍存 P2/P3：①route/集成测试仍缺（fresh-orphan/23505 recovery 无 fake req/res/HTTP；前端倒计时无运行时
  测试）；②跨实例无 DB lease；③模型未取消/tool 副作用；④assistant save 窄窗口；⑤TTL/prefix 长尾；
  ⑥claim-before-replay 瞬时 409；⑦retry 仅 pin sessionId（turnContext/voiceModel 未快照，早失败 fallback
  当前会话）；⑧残留 generic 409 body（previousUser 查不到）、invalid created_at 长恢复、时钟偏差；
  ⑨`--quiet` 只拦 error（warnings 不进 gate）、直接 vite build 绕过；App chunk ~663kB（P3）。
- 结论：146 门禁扩展与 call-site 断言均为真实落地，P0=0、P1=0；建议 147 补 route/前端运行时集成测试 +
  下轮补全量日志对 commit，再推进跨实例 lease/模型取消/save 窄窗口；Goldfish-R24 复核中。

## 33. 轮次 147 voice DB generation lease 复核（2026-10-30 06:13–06:35）⚠ P0

- 基线：backend HEAD **60b8215**（06:12:37，tests-only）在 **3415a5a**（06:10:41，lease 产品改动）之上；
  工作区 **M server.js**（06:13:01，+3/−1，未提交修复）。生产 `/health`=**60b8215**（比 lead 所述
  3415a5a 新；60b8215 仅测试，server code 同 3415a5a）。frontend HEAD **1a1760c**（test-only +8 断言）；
  生产入口 `index-C4-5uC8g.js → App-qQW56gOk.js`（markers 不变）。`round147-backend.log` 06:08:30–06:10:18
  早于 3415a5a/60b8215 commit 与工作区修复，不能作为最终证据。
- **P0 证据链**：①saveMessage 把 `generation_lease` 写成 messages 列（state=in_progress、
  lease_expires_at=now+200s；server.js:3501-3505/6688-6691，generationLeaseFields 实测输出）；
  ②`claim_chat_generation` RPC（012:339-409，013 删 legacy；生产最终 5-arg 版）只在
  state null/failed/expired 时 claimed=true → 新插入行 state=in_progress 未过期 → **claimed=false**；
  ③HEAD 对所有 `clientMessageId && savedUserMessage` 调 claim（server.js:6749），fresh 语音必进
  409 VOICE_TURN_RECOVERING（约 200s）而不 generation；④工作区修复把条件改为
  `&& resumedUserMessage`（注释确认“新行已带未过期 lease，重复 claim 必被拒”），但**未 commit/push/
  deploy**；⑤生产 60b8215 仍跑 3415a5a server code → 线上 fresh 语音被阻塞；⑥测试为 helper/源码正则
  （recovery 计数=3），从不执行 insert+claim 路径；定向 1/1 通过也发现不了。
- 分级：P0-1 生产 fresh 语音不可用；P0-2 修复仅工作区未提交/日志不覆盖，必须尽快 commit+deploy 验证；
  P1-1 无 route/集成测试覆盖 lease claim 语义；P1-2 round147 日志早于 commit/worktree，证据无效。
- P2：①修复后 fresh 不走 DB lease（靠 unique insert+23505），跨实例 lease 实际只覆盖 resume，需文档化；
  ②claim 失败 recovery 用 pre-claim savedUserMessage（leaseClaim.message 在 recovery 后才赋值），并发 resume
  loser 可能先见 1s 再重试；建议用 `leaseClaim?.message || savedUserMessage`；③成功路径未 commit/fail/
  release lease（state 留 in_progress，卫生项）；④RPC 异常 degrade allow，跨实例 RPC 故障可双 generation；
  ⑤claim RPC 语义“仅 null/failed/expired 可抢”与“预写 lease 再 claim”冲突，未来需调顺序/RPC；
  ⑥仍缺 route/浏览器测试；跨实例 lease/模型取消/save 窄窗口/TTL/prefix 等旧项不变。
- 修复建议：立即 commit/push 工作区 `server.js` → 等 Render deploy → 核对 `/health` 新 revision →
  真实 fresh 语音验证 200 回复；加 claim 决策纯函数/集成回归（fresh 不 claim、resume 才 claim）；
  修复后重跑全量日志并记录 commit/mtime 对照。
- 修复进展（06:15–06:17 复核+）：**f936448（06:15:14）已提交**（`&& resumedUserMessage`，工作区 clean）；
  `round147-backend-final.log` 0 fail（06:13:05–06:14:54，server.js mtime 06:13:01 < 运行开始 → 覆盖修复
  内容；commit 晚于日志结束但内容一致）；定向 voice-turn 1/1。**生产 `/health` 06:17 已核对为 f936448**
  （部署完成）→ P0 代码路径关闭；剩余验收=一次真实 fresh 语音返回 200（本环境无真实音频，未代做）。
  f936448 未新增测试，现有 recovery 计数=3 断言对条件变化不敏感，仍建议补 mock lease store 行为测试。
- 结论：**147 P0=1 已修复并部署（f936448），待真实 fresh 语音 200 验收**；补 claim 回归测试与
  mtime/commit 日志对照；Goldfish-R25 复核中。

## 34. 轮次 148 P0 真实验收 + lease/路由修复复核（2026-10-30 06:36–06:55）✅ P0 关闭

- 基线：backend HEAD/生产 **5930c02**（06:32:47，`/health` 已核对一致）；`round148-backend.log` **0 fail**
  （06:30:38–06:32:29，server/voice-turn mtime 06:30:14、test 06:30:35 < 运行开始；commit 晚于日志结束 18s
  但内容一致）；定向 voice-turn **1/1**。frontend 仍 **1a1760c**（test-only；生产入口 index-C4-5uC8g）。
- P0 真实验收（lead 提供，外部证据；Elephant 未复跑真实音频）：①真实 fresh 语音 HTTP **200**，user/assistant/
  reply 正常、emotion=neutral；②同 client_message_id replay **200**，user/assistant id 相同（4810/4811），无重复；
  ③504 provider_timeout 后立即重试 **409 VOICE_TURN_RECOVERING，retry_after_seconds=127**，与 lease 剩余
  TTL 一致（200s lease − ~73s），验证恢复倒计时；④测试 session DELETE 204、音频/凭据未入库；⑤commits
  3415a5a/f936448/6c70a8a/c1531c0/5930c02 + round148 0 fail + claim 行为测试。
- 本轮新增产品修复复核：①**6c70a8a** multer `fields 9→20 / parts 21 / fieldSize 128KB`——frontend formdata
  实际 file+10 fields（voice.js:254-278），旧限制 9 会让真实 fresh 语音 `LIMIT_FIELD_COUNT`，是真阻塞修复；
  ②**c1531c0** 把 `let voiceTurnClaimed` 移到 route try 之前——原先在 try 内声明、finally 引用会 ReferenceError，
  是真回归修复；③**5930c02** 抽 `claimVoiceGenerationLease`：fresh 不调用 store、resume 才 claim，行为测试
  fresh `calls.length=0`/resume 参数断言 → **P1-1 claim 决策缺口关闭**（仍非 route 集成，P3）。
- 仍存 P2/P3：①lease 成功/失败无 commit/fail/renew（state 留 in_progress；deadline≤170<lease200 故 renew 非硬需求）；
  ②claim fail-open（RPC 异常降级放行，跨实例故障期可双 generation）；③created_at/max clamp 边角；
  ④TTL 200s>FE 180s（超时后立即重试先拿 recovery ~20s）；⑤frontend 快照/倒计时仍仅源码测试；
  ⑥模型取消/save 窄窗口、route/真实失败语音自动化 E2E 缺失；⑦仓库/密钥卫生：backend 未跟踪
  `_audit-local-server.js` + `D:/GZdeepseek/_audit/render-env.json`（2,487B 含真实 env/凭证）勿提交、建议轮换；
  ⑧multer 限制硬编码；⑨round148 日志早于 commit 18s（流程项）。
- 结论：**轮次147 P0 正式关闭**（修复部署 5930c02 + 真实 fresh/replay/恢复验收证据；Elephant 独立核对
  代码/revision/log/单测/产物）；建议 149 处理 lease 生命周期/fail-open 监控、TTL/FE 对齐、route 自动化 E2E
  与仓库密钥卫生；Goldfish-R26 复核中。

## 35. 轮次 149 voice lease 生命周期复核（2026-10-30 06:55–07:10）

- 基线：backend HEAD/生产 **be2709a**（06:50:05，`/health` 已核对一致）；`round149-backend.log` **0 fail**
  （06:47:57–06:49:45；server/voice-turn/test mtime 06:47:53 < 运行开始；commit 晚于日志结束 20s 但内容一致）；
  定向 voice-turn **1/1**。frontend 仍 **1a1760c**（test-only，生产入口 C4-5uC8g/App-qQW56gOk）；backend
  工作区 clean，轮次148 的 untracked harness/secret env 已清理。
- 真实验收（lead，外部）：fresh zh-webm **200**，user=4812/assistant=4813，**71.8s**，session DELETE 204；
  此前 fresh 200 / 同 CID replay 200 / 504→409 RECOVERING 127s 证据保留。
- 已验证：①`clientMessageIdForLease/voiceLeaseId/voiceOwnership/voiceLeaseSettled` 提升到 try 外；
  `voiceLeaseSettled=true` 在 assistant save 成功（7033）及 assistant-save 冲突 replay（7022）后设置；
  ②finally（7102-7115）`if (voiceLeaseId && !voiceLeaseSettled)` → `void store.fail(...)`；
  tenant fail RPC（012:591-624）仅更新 `state=in_progress AND lease_id=本请求 id` → 置 failed/清 lease，
  lease id 不匹配 no-op（claim-false/23505/recovery 早返回不会误伤他人 lease）；
  ③canResumeVoiceOrphan：state=failed→true、completed→false、lease_expires_at 已过→true，否则 created_at
  阈值；测试覆盖 failed/未过期/已过期三态 → 504 失败后 claim 允许 failed/expired（生命周期闭环）；
  ④真实 fresh 200 与代码 fresh 路径一致。
- 仍存 P2/P3：①**finally fail 是 fire-and-forget**：504/断线响应可能先于 fail RPC 提交到客户端 → “立即
  重试”仍可能短暂 409 recovery，直到 fail 提交；lead 本轮真实验收是 fresh 200，“504 后立即 claim”尚未在
  be2709a 后复测 → 建议 await fail 后再响应/补真实 504→立即重试 E2E；②成功 lease 无 commit/completed_at
  （state 留 in_progress，replay 可兜住但状态卫生/监控缺口）；③fail+模型未取消交互：断线/504 立即置 failed，
  重试可马上 claim，而第一次 provider/tool 可能仍在跑 → 重复工具副作用窗口；④claim fail-open（RPC 异常
  降级放行，跨实例可双 generation）；⑤TTL 200s>FE180；⑥模型取消/save 窄窗口、route/真实失败语音自动化
  E2E 缺失（测试仍 helper+源码断言；frontend 快照/倒计时无运行时测试）；⑦claim-false/23505/recovery 早返回
  会发一次 no-op fail RPC（P3）；⑧日志早于 commit 20s（流程项）。
- 结论：R26 P1 lease 生命周期闭环（finally fail + settled + failed/expired resume），无新增 P0/P1；建议 150
  先 await fail 并做 504→立即重试真实/集成验证，再处理成功 completed_at、claim fail-open 监控、TTL/FE 对齐与
  route E2E；Goldfish-R27 复核中。

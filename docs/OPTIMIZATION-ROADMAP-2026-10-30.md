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

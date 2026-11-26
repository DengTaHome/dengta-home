# DengTa（灯塔）SDD 需求版本变更台账（Changelog）

> 遵循 SDD 第四支柱「通过版本管理规范化迭代」：每次需求新增、口径调整或问题修复必须记录版本号、动机、影响范围与验证结论。

---

## `v2.13.59`（2026-11-27）— 全链路真实 KV 缓存命中可视化闭环 + 冷启动单次 RTT 首屏预热 + 设置复选框与深色回执精修

- **全链路真实 KV-Cache 遥测闭环（`ai-service.js` → `settings.js` → `PromptPipelineInspector.jsx` + `App.jsx`）**：
  - 后端补齐无工具流式 `streamOpenAiCompatible`、工具非流式 `callOpenAiCompatibleWithTools` 的 `usage` 采集；在官方 OpenAI / DeepSeek 端点自动附带 `stream_options: { include_usage: true }` 与 `prompt_cache_key`（第三方严格中转保持零入侵）。
  - 前端 `normalizePromptReceipt` 完整保留并持久化 `upstreamUsage`（兼容服务端 `snake_case` 与 `localStorage` `camelCase` 重载），并在「提示词工作台」与「最近一次模型请求回执」直接展示**最近一轮真实上游 KV 缓存命中率、命中 Token 数与缓存写入量**。
- **冷启动首屏聊天记录再砍一次网络往返（`SPEC-CHAT-SPEED` Phase 2）**：
  - `GET /api/v2/bootstrap` 在不改动请求路径、保持 100% 租户隔离的前提下，于同一次请求内顺带预取最近会话最新 40 条消息（`latest_session_messages`）；
  - 前端 `chat-history-cache.js` 新增 `seedInitialHistory()`，仅在本地 L1 内存尚无更完整缓存时预热，让新装机或清缓存冷启动在 `bootstrap` 返回瞬间 0ms 出首屏，同时后台异步校准完整 500 条记录。
- **设置面板细节收口**：将语音服务配置复选框 `.voice-provider-toggle input[type="checkbox"]` 从 `22px` 统一收敛为 `18px × 18px`，并补齐夜间模式下语音提示条与提示词回执卡片的 Night Glass 高对比样式。

---

## `v2.13.58`（2026-11-27）— `agents.md` 提示词 KV 缓存遥测闭环 + 自定义 API 控制台智能识别与测速 + 设置面板动效/SVG/深浅双主题精修

- **上游真实 KV-Cache 命中遥测（`backend-prod/services/ai-service.js`）**：新增 `extractProviderUsageMetrics()` 与 `mergeProviderUsageMetrics()`，统一解析 DeepSeek（`prompt_cache_hit_tokens`）、OpenAI Chat/Responses（`prompt_tokens_details.cached_tokens` / `input_tokens_details.cached_tokens`）、Anthropic（`cache_read_input_tokens` / `cache_creation_input_tokens`，含流式 `message_start` + `message_delta` 合并）与 Gemini（`cachedContentTokenCount`），在聊天回执中非破坏性写入 `prompt_receipt.upstream_usage`（`input_tokens / output_tokens / cached_input_tokens / cache_creation_tokens / cache_hit_ratio`），同时保持 `user-agents-md.test.js` 1:1 原文透传契约。
- **多供应商 API 控制台升级（`ai-provider-center.js` + `provider-form.js` + `AiProviderCenter.jsx`）**：
  - 后端 `testDraft()` 与 `testProfile()` 实时测量并返回 `latency_ms`，前端自动读取模型目录与手动检测均展示耗时徽章（`142 ms` / `1.28 s`）。
  - 新增 `inferProtocolFromBaseUrl()` 智能协议识别：粘贴 Anthropic / Gemini / OpenAI / DeepSeek / OpenRouter / 硅基流动 / Moonshot 地址时，若与当前协议不匹配则弹出「一键切换协议」建议条并展示协议级 KV 缓存策略标签（`双断点 Ephemeral` / `Prefix Cache Key` / `自动前缀 KV 缓存` / `1M+ 隐式长窗缓存`）。
- **`PromptPipelineInspector` 提示词工作台升级**：新增第 5 项结构化模板「实时感知与严格时间」，新增 5 维自动「提示词链路体检清单」（顶层 `agents.md` 封装、静态前缀占比、8K Token 预算、Markdown 分节、密钥自动脱敏），并在 Anthropic 下标注双断点 Ephemeral 缓存状态。
- **整体设置面板动效、SVG 精度与深浅主题视觉精修（`settings-home.css` / `settings-night-contrast.css` / `prompt-pipeline-inspector.css` / `index.css`）**：
  - 全局设置面板 SVG 统一 `shape-rendering: geometricPrecision; stroke-linecap: round; stroke-linejoin: round;`；
  - 新增 `.settings-sheet` 与 `.settings-sheet-backdrop` 轻盈入场动效、子页标题栏磨砂卡片质感与返回按钮独立胶囊，完整对齐 `prefers-reduced-motion` 与 `data-dengta-reduced-motion="true"`；
  - 补齐 Night Glass 夜间模式下设置首页卡片、`PromptPipelineInspector` 工作台与折叠预览区的深色高对比样式，并将所有内联复选框锁定为 `18px × 18px`。

---

## `v2.13.57`（2026-11-27）— 真机实测三项像素级缺陷根治 + 移动端冷启动登录态重试加固

通过 vivo V2454A (Android 15 · `1080×2376`) 真机逐页实拍验收，一次性定位并根治 4 项细节问题：
- **聊天页实时感知条防顶栏碰撞**：`LivePerceptionBar` 保持应用根节点 0px 常驻流不中断，聊天页操作条改为通过 `React createPortal` 渲染至 `.composer-wrap` 上方单行横向胶囊栏，彻底消除与移动端固定彩虹灵动岛胶囊（`.chat-presence-stack`）的重叠。
- **侧边栏「最近对话」单行防挤压**：修复 `apple-ui.css` `.session-heading button` 宽样式误伤折叠按钮导致「最近对话」竖排缩成圆圈的问题，进一步释放侧边栏纵向空间。
- **音乐工作室二维码顶边防裁切与底栏留白**：将 `.ms-login-stage` 从 `justify-content: center` 改为 `justify-content: flex-start` 根治 Flexbox 顶边溢出裁切二维码，底部增补安全留白防止说明文字被小棉花悬浮按钮遮挡。
- **移动端冷启动登录态静默重试**：`auth-session.js` 在 `initialize()` / `getSession()` 遇偶发 `auth_timeout` 时自动间隔 600ms 静默重试一次，避免弱网冷启动误退回登录页。

---

## `v2.13.56`（2026-11-27）— 全程跨页持久化多模态感知 + 离线 VAD 声纹免提直听 + AI 主动感知工具 `inspect_live_perception` + Mika 联动已连通

- **跨页面全程常驻 & 重启自动续连**：将 `LivePerceptionBar` 提升至 `<main>` 应用级挂载（不再随离开聊天页销毁摄像头/屏幕/麦克风流）；切去音乐/朋友圈/小棉花等页面时自动切换为紧凑悬浮在线徽标，且在重启 App 时按已授权限（`navigator.permissions`）无感续连已开启的常驻感知。
- **免提声纹直听 VAD 兜底（国产 Android WebView 零谷歌服务依赖）**：在 `live-perception.js` 内新增基于 Web Audio `AnalyserNode` + `MediaRecorder` 的端侧语音活动检测（VAD）；当设备不支持或报错 `SpeechRecognition`（或用户切为「声纹直听」模式）时自动切换免提收音直连 `/voice/turn`（Groq Whisper 转写 + HerVoice 情绪理解），并同步修复 `submitVoiceBlob` 硬编码上海时区问题。
- **AI 主动感知工具 `inspect_live_perception`**：在 `backend-prod/server.js` 聊天与语音双管线注册 `inspect_live_perception` 工具，让 DengTa 随时主动查询当前开启的屏幕/镜头/麦克风/应用活动状态与实时时间天气。
- **Mika 后台虚拟屏联动**：已在电脑端执行 `mika_cli.py connect --device 10AF4G1GUX002N2` 与 `doctor` 自检，`Mika v0.1.51` helper 已就绪（`ready: true`）。

---

## `v2.13.55`（2026-11-27）— 侧边栏全景重构 + 全程多模态感知（屏幕/应用/镜头/麦克风）+ 双断点 KV 缓存 + Mika 手机控制工具链就绪

### 变更 1：侧边栏比例重构与玩法列表全景展示（`SPEC-SIDEBAR-LAYOUT`）
- **变更原因**：用户反馈侧边栏底部账号、下载 App 和设置按钮占据过大比例，显得拥挤且压扁玩法列表。
- **具体改动**：
  - `App.jsx`、`index.css`、`apple-ui.css`、`auth.css`、`android-compat.css`：将底部 4 层堆叠块压缩为单行紧凑 `.sidebar-dock-footer`（左：紧凑账号芯片，右：网页专属小图标下载键 + 带在线状态绿点的紧凑设置按钮）；Android 原生 App 内自动隐藏侧边栏与设置页冗余的 APK 下载入口。
  - `feature-navigation.css`：移除 `52vh` 高度上限改为 `flex: 1 1 auto; max-height: none;`，搜索框改为不透明粘性顶栏彻底修复卡片透叠，收紧功能卡高度至 44px 并为「最近对话」加入一键折叠开关，单屏可视玩法提升约 2.5 倍。

### 变更 2：实时多模态全程感知套件（`SPEC-MULTIMODAL-PERCEPTION`）
- **变更原因**：用户希望 DengTa 在获得对应权限后，能全程随时随地通过屏幕捕获、应用活动感知、摄像头与麦克风看到和听到用户。
- **具体改动**：
  - **Android 原生**：`AndroidManifest.xml` 增补 `CAMERA` 权限与可选相机特性声明；`ScreenGlancePlugin.java` 新增非阻塞后台帧抓取接口 `captureSnapshotNow()`。
  - **前端引擎**：新增 `live-perception.js`、`LivePerceptionBar.jsx`、`live-perception.css`，在聊天输入栏上方提供「看屏幕 / 应用感知 / 开镜头 / 常开麦 / 一键全停」实时胶囊与可收起摄像头小窗，在设置 → 设备页顶部提供统一多模态权限中心 `LivePerceptionSettingsCard`；发消息时自动抓取并附带此刻屏幕/镜头临时视觉帧，应用活动感知升级为每 25s 实时轮询。
  - **后端上下文**：`backend-prod/services/environment-context.js` 新增 `sanitizeLivePerceptionSnapshot` 与 `[实时多模态感知]` 运行时提示块。

### 变更 3：`agents.md` 双断点提示词缓存强化（`SPEC-PROMPT-PIPELINE`）
- **具体改动**：`backend-prod/services/ai-service.js` 在 `buildAnthropicSystem` 启用缓存时，对达到 1024+ tokens 的前置 `agents.md` 静态块自动加注独立 `cache_control: { type: "ephemeral" }` 断点，防止尾部动态系统块变更击穿静态人设缓存。

### 变更 4：开源手机控制仓库 Mika 工具链落盘（`SPEC-MIKA-PHONE-CONTROL`）
- 克隆 `wangzan101/Mika` 至 `D:\GZdeepseek\_refs\Mika`，下载 `Mika-v0.1.51-arm64.apk` 至 `D:\GZdeepseek\apk-build\`，并通过 `mika_cli.py` 验证本机 ADB 识别已连接手机 `10AF4G1GUX002N2`。

---

## `v2.13.54`（2026-11-27）— 聊天极速加载 + 音乐工作室直连扫码修复 + 小棉花可见性 + SDD 体系落地

### 变更 1：聊天页面历史记录加载提速（`SPEC-CHAT-SPEED`）
- **变更原因**：用户反馈每次打开聊天页读取历史速度过慢。定位到后端串行 2 次数据库查询 + 前端每次清空消息等 500 条全量返回 + 首屏一次渲染 200 条 DOM。
- **具体改动**：
  - 后端 `backend-prod/routes/v2/core.js`：会话校验与消息读取改为 `Promise.all` 并行，新增 `limit` 与 `before` 游标参数并返回 `has_more`。
  - 前端 `frontend-gh/src/chat-history-cache.js`、`App.jsx`、`ChatTranscript.jsx`：实现内存 L1 + IndexedDB L2（按账号+伴侣隔离）Stale-While-Revalidate 秒开缓存，无缓存时并行 `limit=40` 首屏快拉与完整校准，首屏 DOM 初始窗口收紧至 80 条。

### 变更 2：音乐工作室手机白屏根治 & 扫码回跳登录态抓取修复（`SPEC-MUSIC-STUDIO`）
- **变更原因**：用户手机端打开音乐工作室出现白屏（`open this player with its access link`），点击浏览器打开扫码保存后切回网页无反应、未捕获登录态。
- **根因诊断**：
  1. Android 15 WebView 未开启 `setAcceptThirdPartyCookies(webView, true)`，跨站 iframe 丢弃会话 Cookie 返回 401；
  2. 原前端扫码弹窗缺少 `visibilitychange`/`pageshow`/`focus`/`appStateChange` 切回立即补查，且 120 秒自动偷换二维码导致已保存的截图失效；
  3. 后端 `netease-qr-login.js` 缺少 `803` 幂等确认缓存，且 `status()` 未合并 `cookieSession`。
- **具体改动**：
  - 前端 `MusicStudio.jsx` + `music-studio.css`：默认进入「直连扫码与歌单工作台」，未登录首屏直接展示高清白边二维码（零白屏），已登录直接提供我的歌单、每日推荐、搜歌与内置播放器，仍支持一键切换外置播放器；
  - 前端 `NeteaseQrLogin.jsx`：支持 `inline + autoStart`、一键保存二维码到相册、一键打开网易云 App、一键「我已扫码，立即检测」、`sessionStorage` 挂起键持久化、四重前台恢复自动补查、移除 120s 偷换码；
  - Android 原生 `MainActivity.java`（开启第三方 Cookie）、`DengTaFileBridge.java`（新增 `saveImageToGallery` MediaStore 零权限存相册 + `openNeteaseApp`）、`NeteaseCookieActivity.java`（自动轮询 `MUSIC_U` 登录态）；
  - 后端 `netease-qr-login.js`（`803` 3 分钟幂等缓存、`json.cookie` 兜底、800 过期防误判、`status()` 双源统一、plain `type=3` 兜底）；
  - 同步加固 `music-mcp-netease/client/index.html` 的前台恢复补查逻辑。

### 变更 3：博美犬小棉花白毛融入浅色舞台修复（`SPEC-COTTON-PET`）
- **变更原因**：用户上传截图反馈“白的啥也看不见”。定位到米白舞台底色 + 过曝白天灯光 + 默认关闭描边。
- **具体改动**：
  - `cotton-pet.css`、`cotton-desktop-pet.css`：改为高对比莫兰迪蓝灰/暮色暖粉渐变舞台并添加柔和暖棕轮廓投影；
  - `mtoon-style.js`、`pet-runtime.js`、`CottonPet.jsx`：压低白天曝光并加强冷色轮廓光、加深 MToon 阴影色阶、增加脚底接触阴影、默认启用细描边。

### 变更 4：SDD 规范体系建档（`docs/sdd/`）
- **变更原因**：基于 SDD 方法论视频，将所有历史交接文档与近十轮对话新增模块固化为可执行规格文档与验收清单，消除长对话遗忘与需求漂移。

---

## `v2.13.53`（2026-11-25）— Chronos 严格时间与自动唤醒 + 自由导入/蒸馏导出 + 剪映工作区 + 邮局定位
- **Chronos 严格时间与自动唤醒**：新增 `chronos-engine.js`、`chronos-wake-engine.js`、`routes/v2/chronos.js`、`ChronosWakeCenter.jsx`、AI 工具 `manage_wake_schedule`、Android `PushNotificationWorker` 心跳桥接；修复 `special-dates.js` UTC 跨天偏差。
- **世界书/记忆自由导入与人格蒸馏导出**：支持 45+ 文件后缀、MCP 外部记忆库导入、本机记忆整理去重蒸馏与 10 格式便携导出。
- **多端发布同步**：打包签名 APK `v2.13.53 (311)`，推送 CNB 镜像 `0b8695b0`。

---

## `v2.13.52`（2026-11-25 基线）— 账号迁移与运维交接基线
- 详见 [AI-HANDOVER-2026-11-25.md](file:///D:/GZdeepseek/dengta-home/docs/AI-HANDOVER-2026-11-25.md)：确立 `tnineninet`（Owner `Jessica-tce`）、Vercel `dengta-home`、Render `dengta-home-backend`、Supabase `nyyqyizwrlmejpfdhgrnd`、CNB `DengTaArchive2026/dengta-workspace` 归属。

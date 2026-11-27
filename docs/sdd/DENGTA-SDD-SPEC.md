# DengTa（灯塔）SDD 规范驱动开发主文档（Single Source of Truth）

> **文档版本**：`v2.13.70-sdd.10`  
> **对应应用版本**：`v2.13.70`（Android `versionCode 328`）  
> **最后更新**：`2026-11-27`  
> **方法论来源**：SDD（Specification-Driven Development · 规范驱动开发），完整吸收 PMGao《AI 产品经理不懂 SDD，你的 VibeCoding 项目就是在胡扯蛋》的核心三步闭环（先讲清楚 → 再让 AI 动手 → 照标准验收）与五大执行支柱。  
> **配套 SDD 体系文档（单一事实来源家族）**：
> - **全量需求表单总表（PRD / In-Out / 交互明细 / 状态追踪）**：[REQUIREMENTS-FORM.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/REQUIREMENTS-FORM.md)
> - **可执行验收测例库（对齐视频 `docs/测例.md`）**：[TEST-CASES.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/TEST-CASES.md)
> - **逐条验收清单（对齐视频验收 Checklist）**：[ACCEPTANCE-CHECKLIST.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/ACCEPTANCE-CHECKLIST.md)
> - **版本变更台账（变更可追溯）**：[CHANGELOG.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/CHANGELOG.md)
> - **跨平台同步台账**：[SYNC-LEDGER.md](file:///D:/GZdeepseek/dengta-home/docs/SYNC-LEDGER.md)
> - **SDD Harness 自动化门禁脚本**：[verify-sdd-compliance.mjs](file:///D:/GZdeepseek/dengta-home/tools/verify-sdd-compliance.mjs)
> - **历史运维与账号交接基线**：[AI-HANDOVER-2026-11-25.md](file:///D:/GZdeepseek/dengta-home/docs/AI-HANDOVER-2026-11-25.md)

---

## 1. SDD 三步闭环与五大落地铁律（本项目强制执行）

彻底杜绝「想到哪聊到哪 → AI 靠猜写代码 → 出问题继续糊改 → 上下文遗忘前后打架」的盲目 Vibe Coding，所有迭代严格遵守以下 5 条铁律：

1. **明确做什么（迭代思维 + In/Out 边界）**：不求一次想完整个项目，但**动代码前必须把「这一次」想透**——明确写入 `REQUIREMENTS-FORM.md` 的 `In Scope`（本版必做）与 `Out Scope`（明确暂缓/不做，严禁隐瞒）。
2. **需求保存为文档（单一事实来源，不留在聊天框）**：所有产品决策、页面点击路径、异常回退、接口契约必须落盘在 `dengta-home/docs/sdd/` 并随代码一并进入 Git 与 CNB，防止换会话、换模型、断电或隔月回顾时丢失上下文。
3. **定义「怎么才算做得好」（可执行规范，拒绝模糊形容词）**：严禁只写「页面好看一点 / 更快 / 更稳定」；每条需求必须写明 **前置条件 → 用户操作 → 系统响应 → 限制边界 → 失败回退**，读完即可想象用户在界面上一步步如何操作。
4. **版本管理规范化迭代（变更可追溯）**：每次需求新增、口径调整或架构重构必须递增版本、更新 `CHANGELOG.md` 与 `SYNC-LEDGER.md`，并与代码共同提交版本库，保证随时可查「当时为什么这样设计」。
5. **照规范验收（Harness + 测例 + Checklist 闭环）**：AI 说「做完了」不等于可交付；必须逐条对照 `TEST-CASES.md`、`ACCEPTANCE-CHECKLIST.md` 与 `node tools/verify-sdd-compliance.mjs` 检查，不合格就明确指出「哪一条未满足」直至闭环。

---

## 2. 系统架构红线与全局不变量（Global Invariants）

| 编号 | 不可违背红线 | 自动化与人工验收门禁 |
|---|---|---|
| `INV-01` | **零生产数据库破坏性迁移**：严禁擅自修改线上 Supabase 表结构或执行未核对的 062/063/064 迁移；新运行时状态（如 Chronos）存入 `companion_runtime_states.status.__chronos_v1` 并由 `preserveCapsuleKeys` 保护；严禁改动 Cloudflare DNS 或删除 `D:\GZdeepseek\backup\`。 | 代码审查 + `time-capsule-state.test.js` |
| `INV-02` | **租户与伴侣数据严格隔离**：所有 `/api/v2/*` 路由强制经过 `requireRequestScope(req)`，数据库读写经 `scope.db` 自动注入 `user_id` + `companion_id`；前端 L0/L1/L2 缓存均按 `account + companion` 严格隔离。 | 401 未登录拦截单测 + `startup-scope-lifecycle.test.js` |
| `INV-03` | **无硬编码审查/撤回逻辑，流式回复逐字可见**：保留原始模型逐字流式输出（`sentenceBubblesEnabled = false`），已生成内容立即保留，严禁恢复内容过滤或拒答拦截器。 | `npm run check` (`check-prompt-architecture.mjs`) |
| `INV-04` | **KV-Cache 前缀稳定性与 `agents.md` 1:1 原文契约**：稳定层（`<file path="agents.md">`）不得擅自插入标题或混入每轮变化的动态时间戳/天气/感知快照；动态信息仅进入运行时上下文层。 | `user-agents-md.test.js` + `prompt-pipeline-cache.test.js` |
| `INV-05` | **双主题玻璃态对比度 + 内联复选框锁死 `18px` + Reduced Motion 对齐**：所有新增模块必须同时兼容 Day 与 Night Glass（`--theme-card-rgb` / `--theme-ink-rgb` / `data-dengta-appearance="night"`），内联 checkbox 锁定 `18px × 18px`，所有动效尊重 `prefers-reduced-motion` 与 `data-dengta-reduced-motion="true"`。 | `prompt-and-settings-polish.test.js` + `verify-sdd-compliance.mjs` |
| `INV-06` | **零明文凭据入库与发布三方一致**：严禁任何密码、API Key、Cookie、PAT、Keystore 写入代码、文档、GitHub 或 CNB；每次发布必须校验 `android.json` / `download.json` / `download.html` / `vercel.json` 与实测 APK `sha256` / `size_bytes` 完全一致。 | `verify-sdd-compliance.mjs` + `verify:public-auth-build` |

---

## 3. 核心功能模块可执行规格表（Executable Specifications · v2.13.62 最新对齐）

### 模块 A · 聊天记录 0ms 瞬开与零冗余增量同步（`SPEC-CHAT-SPEED` · v2.13.54 / v2.13.59 / v2.13.61）
- **核心目标**：冷启动重开 App 与切换任意历史会话均实现 `0ms` 首屏直出，消除空白加载转圈与重复下载 500 条全量 JSON。
- **四级极速架构**：
  1. **L0 同步本地启动快照（`chat-history-cache.js` + `App.jsx`）**：按 `account + companion` 隔离保存在 `localStorage`（体积 `< 48KB`，最多 20 条瘦身会话摘要 + 当前会话最新 25 条非流式消息）；应用挂载首帧同步水合 `sessions`、`activeSessionId`、`messages` 并将 `isLoading` 置为 `false`，切账号或清空人设时立即清理。
  2. **L1 内存缓存 + 侧边栏悬停/触碰预热（`prefetchSessionHistory`）**：同一次运行切回会话 `0ms` 同步渲染；鼠标悬停、按压或聚焦侧边栏会话条目时带并发去重异步预热 IndexedDB 或 `?limit=40` 至 L1。
  3. **L2 IndexedDB 持久化缓存（`readCachedHistory`）**：单会话缓存最近 200 条消息，350ms 去抖写盘。
  4. **单次 RTT 预取 + `?after=<iso>` 零冗余增量同步**：
     - `GET /api/v2/bootstrap` 单次往返附带最近会话最新 40 条消息（`latest_session_messages`），通过 `seedInitialHistory()` 无损预热新设备冷启动；
     - `GET /api/v2/sessions/:id/messages` 并行校验会话归属与查询消息，支持 `limit` / `before` / **`after=<iso>`** 增量游标；对已标记 `full: true` 的缓存会话仅拉取 `lastCachedIso` 之后的新消息（无新消息约 ~120 字节且经 `areRawMessageListsEquivalent()` 跳过整页重绘）；
     - `<ChatTranscript key={activeSessionId || "none"}>` 切会话自动重置为轻盈的 80 行 DOM 首屏窗口，展开历史保持滚动锚点。

### 模块 B · 音乐工作室手机直连二维码与登录态同步（`SPEC-MUSIC-STUDIO` · v2.13.54 / v2.13.57）
- **可执行规范**：
  1. 进入「音乐工作室」默认直连「扫码/歌单工作台」（`mode = "direct"`），并行核对 `qr/status` 与 `cookie-session`，彻底消除 Android 15 iframe 第三方 Cookie 丢失导致的白屏 `open this player with its access link`。
  2. 未登录首屏直接呈现 `248×248` 高清白边二维码（`.ms-login-stage` 使用 `justify-content: flex-start` 防止手机屏顶边裁切 + 底部防悬浮按钮遮挡留白），固定提供四按钮：「保存二维码到相册（Android `MediaStore` 零权限弹窗 / Web 下载）」「打开网易云 App」「我已扫码，立即检测」「换一张」。
  3. 严禁 120s 自动偷换二维码；`qrKey` 持久化至 `sessionStorage`（4.5 分钟）；切回前台瞬间监听 `visibilitychange` / `pageshow` / `focus` / Capacitor `appStateChange` 在 `0ms / 1.5s / 4s` 连查登录态；后端 `netease-qr-login.js` 提供 `803` 3 分钟幂等缓存、`json.cookie` 兜底、800 过期复核与 `type=3` 明文降级。
  4. Android 原生层 `MainActivity.java` 开启第三方 Cookie，`NeteaseCookieActivity.java` 每 1.5s 自动捕获 `MUSIC_U=` 并同步回灯塔。

### 模块 C · Chronos 严格时间架构与统一自动唤醒（`SPEC-CHRONOS` · v2.13.54 / v2.13.60）
- **可执行规范**：
  1. **单一权威时钟与实时轮次时间差精准计算（`chronos-engine.js` + `environment-context.js` + `server.js`）**：服务端 UTC + 用户 IANA 时区输出统一日历锚点与时钟偏差告警（`>= 90s`）；`analyzeConversationTemporality` 通过 `excludeMessageId` 显式剔除本轮刚落库的用户消息（加 `<= 20s` 尾消息兜底），确保隔夜/多日重逢首轮绝不误判为「刚刚」。
  2. **自动唤醒状态机与防打扰退避（`chronos-wake-engine.js`）**：
     - 区分工作日/周末跨午夜/同日静默窗口，静默期内主动唤醒不触发 LLM 且自动顺延；
     - 沉默轻唤（`silence_wake`）实施未读指数退避（第 1 次按 `silence_wake_hours`，未回复第 2 次加倍 `2×`，连续 2 条未读自动暂停直至用户再次开口；显式闹钟与早晚仪式不受影响）；
     - `updateSchedule` / `deleteSchedule` 修复时区回退与暂停周期恢复时重算未来 `next_fire_at`，新增 `snooze_minutes` 精确顺延与可配置离线补发宽限（`missed_grace_minutes`）。
  3. **全功能 AI 对话调度与准秒级多端唤醒（`server.js` + `chronos-client.js` + `ChronosWakeCenter.jsx` + `PushNotificationWorker.java`）**：
     - 聊天核心工具 `manage_wake_schedule` 支持 `create` / `list` / `update` / `snooze` / `cancel` / `set_policy` 全动作；
     - 前端 `computeNextChronosHeartbeatDelayMs()` 在距下次闹钟 `< 45s` 时动态对齐目标秒 `+800ms` 触发；`dengta:chronos-refresh` 事件总线在聊天建闹钟后立即重刷并同步 Capacitor 48h 离线本地通知；
     - 设置面板支持任意自定义 IANA 时区显示、一键「`+10分`」推迟与宽限分钟设置。

### 模块 D · 博美犬小棉花 3D 立体渲染与高对比舞台（`SPEC-COTTON-PET` · v2.13.54 / v2.13.62）
- **可执行规范**：
  1. **毛绒立体顶点着色（`b1857-character.js`）**：保持 `b1857.json` 原模型与 49,853 顶点不变，按顶点空间位置与法线注入下颌/领毛折痕/爪底环境光遮蔽（AO）与奶咖阴影过渡，叠加耳尖淡杏色、耳廓淡粉、面颊腮红与嘴角笑弧，Fur 材质设为亚光 `roughness: 0.88`。
  2. **PBR & MToon 防过曝布光 + 蒙皮后法线外扩手绘细描边（`mtoon-style.js` + `pet-runtime.js`）**：
     - 校准三点布光：标准日间 `hemiLight = 0.72` / 暖主光 `1.92` / 冷轮廓光 `1.48`，MToon 模式将 `hemiLight` 压低至 `0.34` 确保 4 阶暖梅色带清晰分层不泛白；
     - `createOutlineMesh` 保持与主网格共享几何体（零额外显存），通过 `onBeforeCompile` 在 `#include <skinning_vertex>` 之后沿蒙皮空间 `objectNormal` 均匀外扩 `0.0042`，彻底消除旧版 `scale(1.016)` 导致的头部错位，且兼容大头模式与全部 5 组形态键表情；升级 `96×96` 脚底接触阴影。
  3. **摄影棚深色舞台底色与壁纸免疫控制卡（`CottonPet.jsx` + `cotton-pet.css` + `cotton-desktop-pet.css`）**：
     - 禁止浅白/浅桃色底（`#f3dccb`）；提供高对比摄影棚底色（`> 4.2:1`）并支持一键切换「雾松绿 / 暖咖绒 / 暮色蓝」（MToon 默认暮光紫，夜间为星夜深蓝）；
     - 头部与右侧控制区包裹基于 `--theme-card-rgb` 的磨砂卡片，在任何彩色壁纸与 Night Glass 夜间主题下保持清晰可读；同步强化悬浮桌宠在亮色聊天页的轮廓投影。

### 模块 E · 侧边栏比例重构与玩法列表全景展示（`SPEC-SIDEBAR-LAYOUT` · v2.13.55 / v2.13.57）
- **可执行规范**：
  1. 底部合并为单行约 `46px` 紧凑 Dock（`.sidebar-dock-footer`：账号芯片 + 在线状态绿点 + 紧凑设置按钮；原生 Android 自动隐藏侧边栏及设置页冗余「下载 Android App」按钮）。
  2. `.feature-navigation` 取消 `52vh` 截断改为 `flex: 1 1 auto; max-height: none;`，搜索栏使用纯不透明 `rgb(var(--theme-card-rgb))` 防透字，玩法卡片高度 `44px`、单屏可见数提升 2.5 倍以上。
  3. 「最近对话」默认限高 `124px` 并支持一键折叠，修复折叠按钮单行防挤压问题（`v2.13.57`）。

### 模块 F · 全程实时多模态感知架构（`SPEC-MULTIMODAL-PERCEPTION` · v2.13.55–v2.13.57）
- **可执行规范**：
  1. Android 原生声明 `CAMERA` / `RECORD_AUDIO` / `PACKAGE_USAGE_STATS` / `FOREGROUND_SERVICE_MEDIA_PROJECTION`，`ScreenGlancePlugin.java` 提供后台非阻塞 `captureSnapshotNow()`（1.8s 内抓帧）。
  2. `LivePerceptionBar.jsx` 挂载在应用根节点保持跨页 0px 常驻流不中断，聊天页操作条通过 `React createPortal` 渲染至 `.composer-wrap` 上方单行胶囊栏（杜绝与顶栏灵动岛重叠）；支持屏幕捕获、应用感知、前后摄像头切换/小窗/抓拍、离线 VAD + 语音聆听（含 TTS 防回声）与一键全停。
  3. 后端 `environment-context.js` 清洗注入 `[实时多模态感知]` 并开放 AI 主动抓拍工具 `inspect_live_perception`。

### 模块 G · `agents.md` 提示词分层缓存、自定义 API 控制台与设置面板精修（`SPEC-PROMPT-PIPELINE` · v2.13.55 / v2.13.58 / v2.13.59）
- **可执行规范**：
  1. `buildUserAgentsMdPlan` 保持 `<file path="agents.md">` 顶层 1:1 原文前置，静态前缀与动态上下文严格分层；Anthropic 启用双断点 `ephemeral` 缓存。
  2. `ai-service.js` 统一采集 DeepSeek / OpenAI Chat & Responses（官方端点附 `stream_options.include_usage` + `prompt_cache_key`）/ Anthropic / Gemini 四协议真实 KV-Cache 命中遥测，前端 `normalizePromptReceipt` 持久化并在 `PromptPipelineInspector` 与回执卡片展示实时命中率。
  3. 自定义 API 控制台支持实测 `latency_ms` 徽章、Base URL 自动协议识别与一键切换协议建议、KV 缓存策略徽章；设置面板全局 SVG 启用 `geometricPrecision` + `round`、丝滑入场动效与 `reduced-motion` 对齐、Night Glass 高对比度及全量内联复选框 `18px` 锁定。

### 模块 H · 开源安卓控制引擎 Mika 接入与合规边界（`SPEC-MIKA-PHONE-CONTROL` · v2.13.55）
- **可执行规范**：拉取 `wangzan101/Mika` 至 `D:\GZdeepseek\_refs\Mika`，配置 `Mika-v0.1.51-arm64.apk` 并通过 `mika_cli.py connect --device 10AF4G1GUX002N2 --json` 连接真机（`ready: true`）；严格遵守安全合规边界，不绕过或自动点击系统权限/安装拦截弹窗（如 vivo `PackageInterceptActivity`），夜间不向用户休息中的手机弹出交互式安装窗口。

### 模块 I · 既有成熟能力基线（汇总自历史交接与工程审计）
- **流光天幕 60fps 零闪屏 + 灵动岛中控 + 多平台点外卖 + 混合语义知识库与 28/29 种家庭常备药联用预警 + Floating UI 全局悬浮卡片**（`2026-11-25` 审计基线）。
- **记忆与人格自由导入导出**（45+ 文件格式 + MCP 外部记忆导入 + Kiwi 记忆健康与召回诊断）、**灯塔邮局（Surprise Map）**、**AI 创作者与 `dbskill` / `adudir-open` 剪映本地工作区桥接**。

### 模块 J · AI 视界与 B站/抖音/小红书多平台接入向导（`SPEC-CREATOR-ONBOARDING` · v2.13.64）
- **可执行规范**：
  1. **全站 MCP 跳转与小红书直达路由（`App.jsx`）**：所有「MCP 插件中心 / 去绑定 MCP」入口统一调用 `openMcpDeviceCenter()` 准确进入 `settingsCategory="devices"` 并聚焦 `#mcp-device-center`（彻底杜绝误开「模型与服务」）；新增 `openXhsSettings()` 直达 `settingsCategory="fun"` 并聚焦 `#xhs-login-section`。
  2. **AI 视界一站式接入向导与本机 18088 网关同步（`CreatorWorldStudio.jsx` + `creator-world-studio.css`）**：提供顶部「怎么接入？」按钮与「接入向导 · 平台入口」标签页，与 `LocalAgentStudio` 共用 `getSavedBridgeBaseUrl()` / `setSavedBridgeBaseUrl()`，支持本机 `127.0.0.1:18088` 或同 Wi-Fi 局域网 IP 一键测试连接并自动回落探测；如实展示在线/离线状态（云端 404 不再虚报已连接）；分卡清晰列出 B 站、小红书、抖音、剪映的「免配置开箱即用功能」与「进阶登录/MCP 接口位置」并提供一键直达按钮与 `cloudflared tunnel` 公网 HTTPS 隧道说明；复选框锁死 `18px × 18px`。
  3. **MCP 模板与本机网关 CORS 加固（`McpDeviceCenter.jsx` + `dengta-creator-bridge-mcp/server.js`）**：创作者模板默认 `auth_type="bearer"` 并平滑滚动至连接表单；本机网关放行精确 `https://dengta-home.vercel.app` Origin 及 `Access-Control-Allow-Private-Network: true`。

### 模块 K · QQ 通道状态可视化、真实人设记忆同步铁证与 AI 工作台滚动修复（`SPEC-QQ-SYNC-AND-SCROLL` · v2.13.65）
- **可执行规范**：
  1. **真实人设与连续记忆同步引擎（`backend-prod/routes/v2/qq-bridge.js` + `channel-sync.js` + `services/qq-cloud.js`）**：`buildChannelPersonaDetail` 完整加载伴侣个性化指令、`user_details`（脱敏）、长期记忆（修复 `memory_limit=0` 静默零条陷阱，自动默认 `15/30` 条）及最近 10 轮灯塔对话延续，并生成 8 位 SHA-256 `sync_fingerprint`；新增 `GET /api/v2/channel-sync/preview` 与保存回执；`qq-cloud.js` 拦截 6 位数字绑定码（自动核销 `channel_bindings` 或回执在线状态，不再透传给 LLM）并支持 QQ 私聊发送 `/同步状态` 实时核对指纹。
  2. **QQ 连接态醒目横幅与同步证据卡（`ChannelHub.jsx` + `QQCloudConnect.jsx` + `channel-hub.css`）**：首帧立即拉取 `/api/v2/qq-cloud` 与 `/api/v2/channel-sync/preview`，顶部展示绿/琥珀/红三态呼吸灯大横幅与同步证据卡（检测到回落普通人机时标红告警并提供「一键开启完整人设 + 最近 15 条记忆并保存」）；明确区分官方云机器人（12 位配对指令）与旧版 SnowLuma 6 位绑定码。
  3. **AI 工作台·剪映垂直滚动修复（`LocalAgentStudio.jsx` + `local-agent-studio.css`）**：根节点挂载 `feature-page local-agent-studio` 并设置 `overflow-y: auto; min-height: 0; touch-action: pan-y; flex-shrink: 0`，彻底根治在 `.view-content { overflow: hidden }` 下无法上下滑动的缺陷。

### 模块 L · X / Twitter 真实连接态检测与防误判（`SPEC-X-HUB-HONEST-STATE` · v2.13.66）
- **可执行规范**：
  1. **严格连接态判定（`x-hub-utils.js` `resolveXConnectionState`）**：严禁使用裸 `/\bx\b/i` 正则误匹配非 X 连接；只有同时满足 `enabled === true && last_status === "connected"` 且发现真实 X 工具（`search_tweets` / `post_tweet` 等）时才显示「● 已连接 · 可用」，其余明确区分为「○ 未连接」「◌ 已保存 · 未启用」「✕ 连接离线 / 不可用」。
  2. **实时连通性探测与工具按需启用（`XHub.jsx` + `x-hub.css`）**：移除硬编码「MCP 网关在线」文案；提供「实测连通性」「一键启用并实测连通」直连后端 `/api/mcp/connections/manage/:id/test`，调用遇 `409/502/504` 即时翻转真实离线/未启用态；按已发现工具动态呈现搜索、推文解析、用户资料/时间线与发帖卡片。

### 模块 M · 涂鸦画室专业提示词工程与多模型调用适配（`SPEC-CREATIVE-PROMPT-PRO` · v2.13.67）
- **可执行规范**：
  1. **专业提示词编译引擎与零 Schema 变更 V2 封套（`backend-prod/services/creative-prompt-engineer.js` + `companion-creative.js`）**：内置 8 套专业画风预设（智能匹配/水彩手账/电影胶片/日系通透/暖调厚涂油画/彩铅淡彩速写/极简杂志人像/梦幻光影绘本）、5 种标准画幅（`1:1`/`3:4`/`4:3`/`9:16`/`16:9`）与分类型构图规范（`avatar`/`doodle`/`gift`）；自动剥离对话废话与陈旧 `masterpiece/best quality/8k` 堆词，将短提示补全为具象可绘制视觉分镜与避坑词，经 `__DT_PROMPT_V2__:` 加密存入既有 `prompt_ciphertext` 列（零 DB 迁移，`INV-01`）。
  2. **模型家族感知的协议适配与渐进降级调用（`buildImageGenerationRequests` + `fetchGeneratedImage`）**：自动识别 `gpt-image`（免无效 `response_format` 报错并支持 `1024x1536`/`1536x1024` + `quality`）、`dall-e-3`（`quality`/`style`/`1792`）、`siliconflow`（`image_size` + `negative_prompt` + `batch_size`）、`zhipu`、`gemini-image` 与通用 `openai-compatible`，遇上游 `400/422` 逐级剥离可选字段重试以最大化调用成功率。
  3. **聊天专业工具契约与涂鸦画室导演台（`companion-creative-tool.js` + `tenant-companion-creative.js` + `routes/companion-creative.js` + `server.js` + `CompanionCreativeStudio.jsx`）**：`create_artwork` 工具扩展 `aspect_ratio`/`style_preset`/`quality`/`composition`/`lighting_palette`/`medium_style`/`negative_prompt` 槽位并在触发提示排除否定句；涂鸦画室提供主题输入、画风/画幅/画质/避坑词选择、直接建稿及单卡「精修提示词」与免费文字模型「AI 专业润色」（`PATCH /artworks/:id/prompt`、`POST /artworks/:id/refine-prompt`）。

### 模块 N · 聊天体验收纳重构、一次授权持久感知、Siri 语音呼唤、智能截屏依据、弹字/引用修复与灵动岛 CD 封面升级（`SPEC-PERCEPTION-UX-AND-DANZI` · v2.13.68）
- **可执行规范**：
  1. **一次授权持久感知与切应用自恢复（`MediaPermissionsPlugin.java` + `MainActivity.java` + `live-perception.js` + `LivePerceptionBar.jsx`）**：新增原生 `MediaPermissions` 插件持久化核验与申请 `CAMERA`/`RECORD_AUDIO` 系统权限，切应用时绝不清除用户 `cameraAlwaysOn`/`micAlwaysOn` 意图，回到前台通过 `visibilitychange`/`focus`/`appStateChange` 自动无感恢复。
  2. **左侧星星菜单收纳重构与单行输入框（`App.jsx` + `LivePerceptionBar.jsx` + `CottonChatDock.jsx` + `CottonDesktopPet.jsx` + `index.css` + `sun-glass-chat.css`）**：将 4 项实时感知（含清晰功能引导、完整不裁切「暂停屏幕共享」、主动「让TA看一眼聊」与最近截屏依据缩略图）、小棉花陪聊与悬浮桌宠全部收纳进左侧星星按钮抽屉（星星按钮右上角显示绿色感知数量角标）；修复语音按钮溢出换至第二行及「诊断」药丸压住聊天文字的问题，键盘弹起时输入区上方保持清爽单行。
  3. **Siri 语音呼唤与智能屏幕变化截屏依据（`voice-wake-word.js` + `screen-change-monitor.js` + `ChatMessage.jsx` + `backend-prod/services/environment-context.js` + `chat-attachments.js` + `server.js`）**：支持说「灯塔 / 嗨灯塔 / DengTa / 伴侣名」唤醒对话；32×18 亮度变化检测（`>= 18%` 或切换应用）自动截取屏幕并记录时间点、应用与变化幅度，后端提示词引导伴侣主动聊起摄像头画面并注明截屏时间依据，依据以零 Schema 变更方式存入 `messages.tool_calls.perception_evidence` 并在气泡中渲染可点击放大的「🖥️ 截屏依据 / 📷 摄像头实景依据」卡片。
  4. **手机端「弹字」与「引用」体验修复（`ChatTextImpact.jsx` + `text-impact-preferences.js` + `chat-text-impact.css` + `ChatMessage.jsx`）**：手机端隐藏头像时「弹字」无缝回退为对本条消息文字播放真实物理/弹性动效并新增「消息文字」落点、解除移动端自动播放限制、将触控抖动防误关容差提升至 `28px`；「引用」支持点击原消息丝滑跳转定位并高亮闪烁，输入框引用条压紧为单行胶囊并增加「追问」快捷按钮。
  5. **灵动岛音乐胶囊防裁切三栏布局与 CD 专辑封面（`NowPlayingCard.jsx` + `built-in-now-playing.js` + `sun-glass-chat.css` + `dynamic-island.css` + `DeviceActivityPlugin.java` + `netease-cookie-session.js` + `music-cookie.js`）**：重构灵动岛播放胶囊为防裁切三栏（左 48px 旋转 CD 专辑封面 `<img>` + 中歌名/歌手专辑两行 + 右播放/切歌/关闭按钮），彻底移除遮挡封面的 92% 不透明灰盘并重设按钮高度；网易云搜歌改走 `cloudsearch/pc` + `song/detail` 补齐 HTTPS 封面，新增 `GET /api/v2/music/providers/netease/cover` 自动补全缺封面歌曲并回填数据库，Android 原生同步读取 `METADATA_KEY_ART` 与封面 URI。

### 模块 O · 小棉花 3D 桌宠全量重塑、麦克风修复、彩虹胶囊减负去闪与真人喜怒哀乐情绪系统（`SPEC-COTTON-V2-AND-EMOTION` · v2.13.69）
- **可执行规范**：
  1. **聊天页左下角麦克风一键修复（`App.jsx` + `index.css`）**：同时支持单击录音再点发送与长按（`>= 450ms`）松手发送（根治短按静默丢弃），点击时自动请求原生 Android 麦克风权限，后端语音服务离线时自动回落浏览器/系统 `SpeechRecognition` 并带呼吸红环录音态。
  2. **灵动岛右侧精简天气胶囊 & 彩虹胶囊去杂去闪（`CompanionStatus.jsx` + `StatusFlowField.jsx` + `live-location-weather.js` + `dynamic-island.css` + `sun-glass-chat.css`）**：天气按钮移至胶囊右侧，采用彩色天气 SVG 图标 + 两字城市缩写（如 `上海 9°`）并移除时钟与天气汉字；展开面板拆分为「此刻陪伴 / 天气与工具」两页（点天气胶囊直达「天气与工具」），WebGL 流光画布仅响应空白区滑动并在首帧前清黑、取消 `scale3d` 过冲动画根治打开闪屏；位置卡片改为不透明深色底层、非裁切矩形圆角按钮与简繁归一（`黃浦區`→`黄浦区`），卫星芯片区不再压住聊天文字。
  3. **健康人类元气基线与真人感「喜怒哀乐」（`companion-status.js` + `emotion-state.js` + `backend-prod/services/companion-status.js` / `companion-interaction.js` / `companion-status-refresh.js`）**：默认、重置及旧缓存异常 0% 均恢复至正常人日常基线 `76%`（70–80 区间），闲置改为柔和昼夜节律平衡（绝不掉到 0%）；界面移除游戏式「回元气 +18%」数值，改用 `喜/怒/哀/乐` 象限徽章与情境化关怀按钮（如赌气时「认真听TA吐槽 / 服软抱抱顺毛 / 问TA怎么才肯消气」），前后端回复与状态更新均忠实人设性格与真实情绪惯性。
  4. **博美犬小棉花 3D 全面重塑（`b1857-character.js` + `mtoon-style.js` + `interaction-props.js` + `interaction-controller.js` + `gyro-controller.js` + `pet-runtime.js` + `CottonPet.jsx` + `CottonDesktopPet.jsx`）**：注入 256×256 手绘奶油杏色卡通毛绒纹理与凹凸贴图、粉嫩耳廓腮红、高光动画眼眸及可见项圈金铃（告别白膜，保持 49,853 顶点与 5 形态键契约）；24 骨骼完整驱动吃饭（3D 食盆粮粒渐减+骨头饼干）、喝水（3D 水碗涟漪）、梳毛、四足奔跑与垂吊蹬腿；接入手机陀螺仪（`DeviceOrientationEvent` / `DeviceMotionEvent`）实现满屏跑动与球体倾斜重力滚弹、手指拖拽甩飞小球追逐回拍；GPU `translate3d` 零重绘身体部位丝滑拎拖、全新精致磨砂图标菜单栏并修复「小棉花的小屋」无法上下滑动。

### 模块 P · 全端音乐无缝自动连播（`SPEC-MUSIC-AUTO-NEXT` · v2.13.70）
- **可执行规范**：
  1. **灵动岛内置随心听自动连播与防重复（`built-in-now-playing.js` + `useBuiltInNowPlaying.js` + `backend-prod/routes/v2/music-cookie.js`）**：监听当前曲目 `ended` 事件不再销毁清空播放器，而是去重后立即执行 `run("next", entry.song, { autoAdvance: true })` 无缝续播下一首；前端向 `GET /providers/netease/random-playable?exclude=` 与 `POST /providers/netease/random-fetch` 透传刚播完曲目的 `songId/title`，后端在存在其他可播歌曲时严格排除刚播完曲目（仅剩 1 首时兜底循环）；若移动端浏览器拦截新建 `Audio` 的 `play()`（`NotAllowedError`），自动复用已由用户手势解锁的旧 `Audio` 实例续播下一首；若一起听等本地音频占线（`localBlocked()`）则仅静默释放不抢声道；同步接入 `navigator.mediaSession` 元数据与锁屏/耳机 `play`/`pause`/`nexttrack` 操控。
  2. **音乐工作室直连播放器队列连播（`MusicStudio.jsx` + `music-studio.css`）**：点击「我的歌单」「每日推荐」或「搜歌」任一曲目时记录当前曲目列表与索引；`<audio>` 挂载 `onEnded` 与受连续失败次数保护的 `onError` 自动切歌，自动跳过最多 6 首 VIP/版权受限无直链曲目直至找到可播 HTTPS 直链；迷你播放条展示「自动连播 · i/N」状态徽章与「上一首 / 下一首」按钮。
  3. **一起听本地预览连播与聊天歌曲卡片续播（`TogetherMusic.jsx` + `MusicChatCard.jsx` + `App.jsx`）**：一起听未开场（`!active`）本地歌单预览在 `onEnded` 时自动递增 `localIndex`（循环取模）并在 `mediaGeneration` 完成后自动 `play()`（保持 `active === true` 服务端队列与 `repeat_mode === "off"` 契约完全不变）；聊天页 `MusicChatCard` 播完广播 `dengta:chat-music-ended` 事件，`App.jsx` 收到后自动调用 `startBuiltInNowPlaying({ exclude })` 无缝接力播放下一首。

---

## 4. 核心接口契约速查

| 接口路径 | 方法 | 作用域门禁 | 核心契约 |
|---|---|---|---|
| `/api/v2/bootstrap` | `GET` | `requireRequestScope` | 单次往返返回配置/会话并预取 `latest_session_messages`（最新 40 条） |
| `/api/v2/sessions/:id/messages?limit=&before=&after=` | `GET` | `requireRequestScope` | 并行校验会话与查询消息；支持首屏分页 `limit/before` 与零冗余增量游标 `after` |
| `/api/v2/chronos/state` / `policy` / `schedules` / `heartbeat` | `GET/PUT/POST/PATCH/DELETE` | `requireRequestScope` | 权威时钟、静默窗口、闹钟增删改推迟、未读退避心跳 |
| `/api/v2/music/providers/netease/qr/*` & `cookie-session` | `GET/POST/DELETE` | `requireRequestScope` | 网易云扫码 803 幂等确认、App Cookie 同步、歌单/日推/搜歌 |
| `/api/v2/ai-providers/test` & `profiles/:id/test` | `POST` | `requireRequestScope` | 连通性与模型目录检测，返回实测 `latency_ms` |
| `/api/errors/summary` | `GET` | `requireRequestScope` | 全链路 `X-DengTa-Trace-Id` 与 `DTF-*` 故障指纹汇总 |

# DengTa（灯塔）SDD 需求版本变更台账（Changelog）

> 遵循 SDD 第四支柱「通过版本管理规范化迭代」：每次需求新增、口径调整或问题修复必须记录版本号、动机、影响范围与验证结论。

---

## `v2.13.67`（2026-11-27）— 涂鸦画室调用链路与提示词书写逻辑专业化升级 + Windows 零乱码 GUI GitHub 同步工具 + 本机 X MCP 一键启动脚本

- **专业视觉提示词工程引擎（`backend-prod/services/creative-prompt-engineer.js` + `tenant-companion-creative.js` + `companion-creative-tool.js`）**：
  - 建立 7 层美术指导视觉编译规范（主体与动作 / 人物关系与情绪 / 构图与镜头 / 光线与色彩 / 材质与细节 / 画风与环境叙事物件 / 画面层次与成品质量），按 `avatar` / `doodle` / `gift` 自动套用差异化构图与默认画幅（`1:1` / `3:4` / `4:3`），内置 8 套专业画风预设与 5 种画幅比例。
  - 自动清洗「请帮我画一张」等对话前缀及 `masterpiece, best quality, 8k` 等陈旧堆词，把短提示智能补全为可直接交付生图模型的具象视觉画面，并通过 `__DT_PROMPT_V2__:` 加密封套无损存入既有 `prompt_ciphertext` 列（零数据库迁移，`INV-01`）。
  - 升级聊天工具 `create_artwork` Schema 与 `server.js` 触发提示（排除「别画/不要画」否定误触发，补全「出张图/做张壁纸/画个立绘」等专业表达）。
- **多模型家族感知调用与渐进降级（`backend-prod/services/companion-creative.js` + `routes/companion-creative.js`）**：
  - 自动识别 `gpt-image`、`dall-e-3`、`siliconflow`（`image_size` + `negative_prompt`）、`zhipu`、`gemini-image`、`openai-compatible`，免除 `gpt-image-1` 首次发 `response_format` 必败 400，并在上游返回 `400/422` 时逐级剥离可选字段重试。
  - 新增 `PATCH /api/v2/creative/artworks/:id/prompt` 与 `POST /api/v2/creative/artworks/:id/refine-prompt`（使用文字模型零生图扣费润色）。
- **涂鸦画室前端导演台与提示词工坊（`CompanionCreativeStudio.jsx` + `cozy-theme.css` + `native-feel.css`）**：
  - 顶栏升级为创作导演台：支持可选画面主题输入、8 套画风预设、5 种画幅胶囊、标准/高清画质、可选避坑词及「按此直接建稿」；作品卡片新增「精修提示词 / 查看提示词」抽屉与「AI 专业润色」按钮；图片接口预设扩充至 8 项并展示实时协议适配徽章。
- **运维工具体验根治**：
  - 根治 `点我一键同步GitHub-*.cmd` 中文乱码与 `Read-Host -AsSecureString` 按 `Ctrl+V` 键入 `\x16` 控制字符报错问题：改为纯 UTF-8 Windows 原生弹窗 + 一键从剪贴板读取并自动清理控制字符。
  - 补齐本机 `x-twikit-mcp` 代理适配（`127.0.0.1:7877`）与 `tools/x-mcp/start-x-mcp-tunnel.ps1` 一键启动验证脚本。

---

## `v2.13.66`（2026-11-27）— 根治 X / Twitter「未连接却虚报已连接、功能全不可用」缺陷

- **严格真实连接态机（`x-hub-utils.js` + `XHub.jsx` + `x-hub.css`）**：
  - 根治 `XHub.jsx` 旧版用 `/\bx\b/i` 误匹配非 X 连接、忽略 `enabled` / `last_status` / `discovered_tools` 且硬编码「MCP 网关在线」导致旧失效隧道或未启用连接仍显示绿色「已连接」的问题。
  - 新增 `resolveXConnectionState()` 严格区分 **未连接 / 已保存未启用 / 连接离线不可用 / 已连接可用** 四态；在未启用/离线时直接展示真实网关地址、上次测试时间、错误原因与 **「一键启用并实测连通」「立即实测连通性」「去 MCP 插件中心修改」** 按钮；工具调用遇到 `409/502/504` 自动翻转真实离线/未启用态；按实际发现工具动态渲染搜索、推文解析、用户资料/时间线与发帖卡片。

---

## `v2.13.65`（2026-11-27）— QQ 机器人高对比在线状态与同步铁证、6 位绑定码拦截、真实人设/称呼/记忆/对话延续同步、AI 工作台无法上下滑动根治 & `bili-cli` 安装

- **根治 QQ 机器人「像普通人机、发绑定码 `324116` 没反应、看不出是否同步」全链路（`qq-bridge.js` + `channel-sync.js` + `qq-cloud.js` + `ChannelHub.jsx` + `QQCloudConnect.jsx` + `channel-hub.css`）**：
  - 借鉴《把大肥鱼养进微信 QQ》（DSH-IM `@xmanrui/dsh-im`）及开源 AstrBot/LangBot 实践：
    1. **人设与连续记忆完整同步**：`buildChannelPersonaDetail` 完整读取并脱敏注入灯塔核心人设（`unified_system_prompt` / `system_prompt` / `personality`）、主人称呼与背景（`user_details`）、已确认长期记忆（彻底修复「点选最近记忆但 `memory_limit` 仍为 0 导致同步 0 条」的隐蔽陷阱，默认 `15/30` 条）以及最近 10 轮灯塔主聊天记录衔接，并以自然有温度的伴侣身份提示替代生硬的机器人免责套话；QQ 新用户默认开启人设与最近 15 条记忆同步。
    2. **可验证同步铁证（前后端 1:1 同一指纹）**：新增 `GET /api/v2/channel-sync/preview` 并在保存时直接返回 `sync_receipt`（8 位 SHA-256 指纹 + 人设/详情/小节/记忆/最近对话计数 + 真实摘录预览 + 告警）；前端「人设与记忆」顶部新增「同步生效证据」卡，若仍处于普通默认人机态立即标红警告并提供「一键开启完整人设 + 最近 15 条记忆并保存」按钮；在 QQ 私聊发送 **`/同步状态`** 即可直出服务端实时自检回执核对同一指纹。
    3. **醒目连接态大横幅 + 6 位绑定码拦截**：修复 `ChannelHub` 默认标签页未加载 `/api/v2/qq-cloud` 导致已连上却总显示「待绑定」的问题，顶部增加绿/琥珀/红呼吸灯大状态横幅；`qq-cloud.js` 拦截 6 位绑定码（如 `324116`）自动尝试核销 `channel_bindings` 并清晰告知已在线及当前同步指纹，不再傻傻透传给模型。
- **根治「AI 工作台·剪映」无法上下滑动（`LocalAgentStudio.jsx` + `local-agent-studio.css` + `creator-world-studio.css`）**：
  - 为 `LocalAgentStudio` 根容器补回缺失的 `feature-page` 类，并显式设置 `height: 100%; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; touch-action: pan-y` 及子项 `flex-shrink: 0`，彻底修复在 `.view-content { overflow: hidden }` 下的上下滚动卡死问题。
- **GitHub `kukemc/bili-cli` (`bili-agent 1.4.0`) 下载与本机安装**：
  - 克隆至 `D:\GZdeepseek\_tools\bili-cli` 并完成 Python 3.12 可编辑安装（`D:\GZdeepseek\_tools\python312\Scripts\bili.exe`）、加入用户 `PATH` 并安装 Agent Skills 至本机 `.agents` / `.claude` / `.dsh`（DeepSeek Harness）。

---

## `v2.13.64`（2026-11-27）— AI 视界 · B站/抖音/小红书一站式接入向导、修复「MCP 插件中心」全站跳转错位与本机 18088 网关直连

- **根治「MCP 插件中心」全站跳转错位大 Bug（`App.jsx`）**：
  - 修复 `CreatorWorldStudio`、`XHub`、`LocalAgentStudio`、`Together` 全部 4 处点击「MCP 插件中心 / 去绑定 MCP」误调 `openProviderRecovery()`（打开「模型与服务」而非「设备与共看」）导致找不到 MCP 接口表单的缺陷；新增 `openMcpDeviceCenter()` 准确进入 `settingsCategory="devices"` 并聚焦 `#mcp-device-center`，同步优化设置首页「设备与共看」副标题标明「MCP 插件中心（B站/抖音/X/网易云）」。
  - 新增 `openXhsSettings()` 一键直达「设置 → 成就与新玩法 → 小红书」登录与发布面板。
- **AI 视界新增「接入向导 · 平台入口」与本机 18088 网关直连（`CreatorWorldStudio.jsx` + `creator-world-studio.css` + `feature-navigation.js`）**：
  - 新增「怎么接入？」顶部按钮与「接入向导 · 平台入口」标签页，将本机/局域网 `18088` 网关连接测试（与 `LocalAgentStudio` 共享持久化地址）、B 站（免配置热门 + 去一起看登录 + MCP）、小红书（dbskill 选题 + 一键打开小红书登录/发布面板 + worker 配置说明）、抖音（9:16 分镜/成片免配置 + 开放平台/MCP）与剪映工作台集中呈现并支持一键直达。
  - 修正云端 `/api/v2/creator-bridge` 404 时虚报「后端已连接」的问题，支持自动回落本机 `127.0.0.1:18088` 与如实展示状态；消除「把 `127.0.0.1:18088/mcp` 直接填进云端 MCP 中心」的错误指引，补充 `cloudflared tunnel` 公网 HTTPS 隧道命令；锁定 `.cws-check input[type="checkbox"]` 为 `18px × 18px`。
- **MCP 模板体验与本机网关 CORS 加固（`McpDeviceCenter.jsx` + `dengta-creator-bridge-mcp/server.js`）**：
  - 点击 B 站/抖音/视频工坊/分发器模板自动预选 `bearer` 并平滑滚动到连接表单；本机网关放行 `https://dengta-home.vercel.app` 精确 Origin 与 `Access-Control-Allow-Private-Network: true`，允许桌面浏览器直连本机 `18088` 网关。

---

## `v2.13.63`（2026-11-27）— 音乐工作室手机端全量根治（零裁切二维码 + `-462` 风控识别与 App 内一键登录直出 + 网易云 HTTPS 音频直链修复）& 侧边栏比例再精修

- **音乐工作室零裁切二维码与 `-462` 风控根治（`MusicStudio.jsx` + `NeteaseQrLogin.jsx` + `music-studio.css` + `backend-prod/services/netease-qr-login.js`）**：
  - 针对实机反馈「只显示一半二维码」：移动端（`<=700px`）将二维码画布显示收紧为 `180×180px`（保持 `248×248` 高清保存像素）、操作按钮排布为 2×2 紧凑矩阵、隐藏重复底注并增加 `88px` 底部滚动余量，确保完整二维码与全部操作按钮一屏完整显示且不被悬浮桌宠遮挡。
  - 针对实机反馈「扫码后点我已扫码提示 `code -462 · 请完成验证操作` 检测失败」：前后端统一识别 `-462 / -460 / 8820 / 8821` 与验证/风控文案为 `risk_blocked`（不再死循环「等待扫码」），并在卡片主区直接置顶 **「App 内一键登录（免风控 · 推荐）」**（走手机本机网络 100% 绕开云端 IP 风控）；修复 `handleNativeCookieLogin` 漏检 `saved.ok`、补齐 `cookie_session` 模式下歌单（`/cookie/my-playlists`）、搜歌（`data.items`）与曲目直链拉取（`/cookie/song-url`）。
- **一起听 / 随机放歌「歌曲暂时无法播放」根治（`built-in-now-playing.js` + `backend-prod/services/netease-cookie-session.js` + `routes/v2/music-cookie.js`）**：
  - 前后端将网易云官方音频 CDN（`http://*.music.126.net/...`）安全升级为 `https://`，避免被客户端 HTTPS 直链校验拦截；`random-playable` 同步刷新 `netease_resolved` 过期签名，前端 `neteaseUrlFresh` 窗口由 12 小时收紧为 15 分钟。
- **侧边栏比例再精修（`FeatureNavigation.jsx` + `feature-navigation.css` + `index.css` + `android-compat.css`）**：
  - 提高 `.feature-navigation .primary-nav .feature-navigation-group-toggle` 优先级，根治分组标题被 `apple-ui.css` `.primary-nav button` 撑成 17px 巨型按钮的问题；将「找个玩法」标签收入无障碍 `sr-only` 与搜索框占位符；移动端 `44px` 方形规则收敛至 `.session-heading > button:last-child`；收紧最近对话列表至 `88px`、统一底部单行等高账号+设置 Dock，单屏可视玩法大幅增加。

---

## `v2.13.62`（2026-11-27）— 小棉花 3D 渲染与舞台高对比度重塑（根治「白的啥也看不见」：毛绒立体顶点 AO + MToon 防过曝校准 + 蒙皮后法线外扩细描边 + 摄影棚底色切换 + 磨砂控制面板）

- **毛绒立体着色与自然五官层次（`b1857-character.js`）**：在不改动 `b1857.json` 原模型与 49,853 顶点的前提下，基于每顶点位置与法线注入下颌/领毛折痕/爪底环境光遮蔽（AO）与浅奶咖过渡，增补耳尖淡杏色、耳廓淡粉、面颊微红腮红与嘴角笑弧，告别单调纯白一团糊。
- **MToon 卡通光照校准与蒙皮后法线外扩描边（`mtoon-style.js` + `pet-runtime.js`）**：
  - 根治原 `HemisphereLight(1.5)` 把 `MeshToonMaterial` 4 阶色带冲刷成纯白的过曝问题：标准日间降至 `0.72` + 暖主光 `1.92` + 冷轮廓光 `1.48`，MToon 模式降至 `0.34` 让 4 阶卡通阴影清晰分层。
  - 将原先导致头部向上偏移的 `outline.scale(1.016)` 重构为 `onBeforeCompile` 在 `#include <skinning_vertex>` 之后的蒙皮空间法线外扩（`transformed += normalize(objectNormal) * 0.0042`），耳尖、腮毛、胸毛簇与小爪子均呈现手绘动画级均匀细描边，且与大头模式、形态键表情完全同步。
  - 升级脚底接地阴影（`96×96` 柔焦接触阴影）与舞台底部深色圆弧地面。
- **高对比摄影棚舞台底色与壁纸免疫控制卡（`CottonPet.jsx` + `cotton-pet.css` + `cotton-desktop-pet.css`）**：
  - 彻底移除浅桃白 `#f3dccb` / 浅灰白底色，改为 `>4.2:1` 高对比摄影棚深色调，并新增「底色：雾松绿 / 暖咖绒 / 暮色蓝」一键切换（MToon 下默认暮光紫罗兰，夜间为星夜深蓝）。
  - 为头部标题与右侧「一起照料的小日常」包裹基于 `--theme-card-rgb` 的防壁纸透字磨砂卡片，在彩色壁纸及 Night Glass 夜间模式下均保持高可读性，同步强化悬浮桌宠在亮色聊天页的轮廓对比度；已通过实时浏览器 WebGL 0 报错渲染验收。
- **SDD 规范体系与自动化 Harness 门禁全面落地（对齐 PMGao SDD 方法论）**：
  - 完整提炼视频三步闭环与五大支柱，升级 [DENGTA-SDD-SPEC.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/DENGTA-SDD-SPEC.md) 至 `v2.13.62-sdd.2`；
  - 整合历史交接文档（`AI-HANDOVER-2026-11-25`、`ENGINEERING-AUDIT`、`OPTIMIZATION-LEDGER`）与 `v2.13.53`–`v2.13.62` 全部需求，新建结构化全量需求表单 [REQUIREMENTS-FORM.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/REQUIREMENTS-FORM.md)（含 `In/Out` 边界与可执行交互明细）与可执行验收测例库 [TEST-CASES.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/TEST-CASES.md)，刷新 [SYNC-LEDGER.md](file:///D:/GZdeepseek/dengta-home/docs/SYNC-LEDGER.md)；
  - 落地自动化合规门禁脚本 [verify-sdd-compliance.mjs](file:///D:/GZdeepseek/dengta-home/tools/verify-sdd-compliance.mjs)，自动校验 `SPEC-*` 双向追溯、多文件版本/实盘 APK SHA-256 一致性与红线防回归。

---

## `v2.13.61`（2026-11-27）— 聊天记录 0ms 秒开架构（L0 同步启动快照 + `?after=` 增量差量拉取 + 侧边栏悬停/按压预热 + 会话切换 DOM 窗口重置）

- **L0 同步本地启动快照（`chat-history-cache.js` + `App.jsx`）**：按「账号+伴侣」作用域在本地保存最近 20 个会话摘要与当前活跃会话最近 25 条精简消息（`< 48KB`）；打开 App 瞬间 `0ms` 同步还原聊天界面、消除冷启动等 `/api/v2/bootstrap` 时的空白加载转圈，同时后台静默校准设置与最新数据；人设清空或切账号时自动清除。
- **零冗余 `?after=` 增量差量同步（`routes/v2/core.js` + `chat-history-cache.js` + `App.jsx`）**：
  - `GET /api/v2/sessions/:id/messages` 新增 `?after=<iso>` 增量游标查询，仅返回晚于本地已校准最新消息的新条目（无新消息时仅 ~120 字节空数组，彻底避免重复下载 500 条全量 JSON）。
  - 新增 `mergeIncrementalMessages()` 与 `areRawMessageListsEquivalent()`，无变化时跳过 `setMessages` 整页重绘与滚动跳动。
- **侧边栏会话悬停/触碰预热（`prefetchSessionHistory`）**：鼠标悬停或手指刚触碰侧边栏会话条目时即异步预热 IndexedDB / 首屏 40 条到 L1 内存（带并发去重），点击瞬间 0ms 切换；为 `<ChatTranscript>` 绑定 `key={activeSessionId}`，切会话自动回归轻盈的 80 行 DOM 首屏窗口。

---

## `v2.13.60`（2026-11-27）— Chronos 严格时间与自动唤醒架构深度加固（实时轮次时间差防遮蔽 + 未读退避防刷屏 + AI 全功能调度 + 准秒级前台唤醒）

- **根治实时对话「自消息时间差遮蔽」核心缺陷（`chronos-engine.js` + `environment-context.js` + `server.js`）**：
  - 修复 `saveMessage(user)` 先落库导致 `loadChatContext` 末尾就是刚发的当前消息、使 `analyzeConversationTemporality` 在隔夜/多日重逢首轮误判为「刚刚」的缺陷；新增 `excludeMessageId` 显式剔除 + `<=20s` 尾消息防御识别，确保跨夜/隔天时间差 100% 准确注入。
- **自动唤醒状态机防打扰退避与周期恢复修复（`chronos-wake-engine.js`）**：
  - 沉默超时轻唤新增「连续未回复指数退避上限」：第 1 次按 `silence_wake_hours` 触发，用户未回复时第 2 次自动加倍至 `2x` 间隔，连续 2 条未读后自动暂停轻唤直至用户再次开口（显式闹钟与早晚仪式不受影响）。
  - 修复 `updateSchedule` / `deleteSchedule` 时区回退问题与暂停周期闹钟重新启用后沿用过期 `next_fire_at` 的缺陷；新增 `snooze_minutes` 精确顺延能力。
- **AI 工具 `manage_wake_schedule` 全能力升级（`server.js`）**：新增 `action="update"`（改时间/标题/启停/`snooze_minutes` 推迟）与 `action="set_policy"`（聊天内直接设置免打扰静默窗口、早晚仪式与 IANA 时区）。
- **准秒级前台精确触发与即时系统闹钟同步（`chronos-client.js` + `App.jsx` + `ChronosWakeCenter.jsx`）**：
  - 新增 `computeNextChronosHeartbeatDelayMs()`，在距离下次闹钟 `<45s` 时动态对齐至目标秒 `+800ms` 触发，告别 45 秒粗粒度轮询延迟；
  - 新增 `dengta:chronos-refresh` 事件总线，AI 聊天建闹钟或面板修改后即时重刷并重新挂载 Android/iOS 原生系统通知；
  - 控制面板支持任意自定义本机 IANA 时区显示、一键「`+10分`」贪睡推迟与离线补发宽限分钟配置。

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

# DengTa（灯塔）SDD 逐条验收清单（Acceptance Checklist）

> 遵循 SDD 第五支柱「照规范验收」：每项必须有明确自动化测试或真机实证支撑，严禁口头宣称“已完成”。

## A. 聊天记录加载速度（`SPEC-CHAT-SPEED`）
- [x] `GET /api/v2/sessions/:id/messages` 并行执行会话归属查询与消息查询，支持 `limit` / `before` 并返回 `has_more`
- [x] 内存 L1 + IndexedDB L2 缓存按 `account+companion` 作用域隔离，切回会话 0ms 秒出历史
- [x] 无本地缓存时并发请求 `limit=40` 首屏与全量校准，流式回复中不被后台回执覆盖
- [x] `ChatTranscript.jsx` 首屏 DOM 窗口缩减为 80 条，展开更早消息保持滚动位置不跳动
- [x] `GET /api/v2/bootstrap` 单次往返预取最近会话 40 条消息 + `seedInitialHistory()` 零覆盖预热，消除无本地缓存冷启动二次 RTT（`v2.13.59`）
- [x] L0 同步本地启动快照（0ms 无转圈秒开）+ `GET /api/v2/sessions/:id/messages?after=` 增量差量拉取 + 侧边栏悬停/触碰预热 + `<ChatTranscript key={activeSessionId}>` 窗口重置（`v2.13.61`）
- [ ] 真机实测：打开聊天页/切换会话瞬间显示记录、无明显白屏卡顿

## B. 音乐工作室手机白屏与二维码登录态同步（`SPEC-MUSIC-STUDIO`）
- [x] 打开音乐工作室默认直连「扫码/歌单工作台」，未登录首屏直接显示高清白边二维码，杜绝白屏 `open this player with its access link`
- [x] 二维码卡片具备「保存二维码到相册」「打开网易云 App」「我已扫码，立即检测」「换一张」四个明确按钮
- [x] Android `DengTaFileBridge.saveImageToGallery` 写入 `Pictures/DengTa`（Android 10–15 零存储权限弹窗）
- [x] 删除 120s 自动偷换二维码逻辑；`qrKey` 持久化至 `sessionStorage`；监听 `visibilitychange` / `pageshow` / `focus` / Capacitor `appStateChange` 切回立即多波次补查
- [x] 后端 `netease-qr-login.js` 具备 `803` 3 分钟幂等缓存、`json.cookie` 兜底、`status()` 统一读取 `cookieSession`
- [x] Android `MainActivity.java` 开启 `CookieManager.setAcceptThirdPartyCookies(webView, true)`；`NeteaseCookieActivity.java` 自动轮询 `MUSIC_U` 并同步返回
- [ ] 真机实测：在已连接的 vivo Android 15 手机上安装新版 APK，打开「音乐工作室」，确认首屏直接展示清晰二维码且无白屏、保存二维码按钮可用

## C. Chronos 严格时间与自动唤醒（`SPEC-CHRONOS`）
- [x] `chronos-engine.js`、`chronos-wake-engine.js`、`routes/v2/chronos.js` 与 `special-dates.js` 全部后端单测通过（含实时轮次自消息遮蔽修复、连续未读 2x 退避上限、暂停周期恢复与 `snooze_minutes`）
- [x] `manage_wake_schedule` 支持 `create` / `list` / `update` / `snooze` / `cancel` / `set_policy` 全链路对话调度
- [x] `ChronosWakeCenter.jsx` + `chronos-client.js`（准秒级动态心跳 + 自定义 IANA 时区 + 一键 `+10分` 推迟 + 离线宽限配置）+ `PushNotificationWorker.java` 前端校验与生产构建通过
- [ ] 真机实测：设置 → 人设与记忆内「Chronos 严格时间与自动唤醒」时钟实时走字、布局清晰

## D. 博美犬小棉花可见性（`SPEC-COTTON-PET`）
- [x] 重塑 49,853 顶点毛绒立体阴影（下颌/胸毛/爪底 AO + 耳廓腮红笑弧）、校准 PBR/MToon 防过曝布光、重构蒙皮后法线外扩手绘细描边与 `96×96` 脚底接触阴影（`v2.13.62`）
- [x] 高对比摄影棚舞台底色（雾松绿 / 暖咖绒 / 暮色蓝一键切换 + MToon 暮光紫 + 夜间星幕）与壁纸免疫磨砂控制卡，并完成真实浏览器 WebGL 0 报错实拍验收（`v2.13.62`）
- [ ] 真机实测：在手机端打开「小棉花」，确认白色博美犬毛绒轮廓、眼睛、鼻子与阴影清晰可见

## E. 全局工程质量门禁（Global Gates）
- [x] 后端 `npm run check` + 全量相关单测通过
- [x] 前端 `eslint src --quiet` + `vite build` + `verify:csp` + `verify:public-auth-build` + `test:initial-bundle-budget` 全部通过
- [x] Android Release APK 真机安装运行与逐页实拍验收完成（`v2.13.56` 实测发现 3 处移动端细节问题，已于 `v2.13.57 (315)` 全部根治并重新构建通过）

## F. 侧边栏重构与玩法列表展示（`SPEC-SIDEBAR-LAYOUT`）
- [x] 底部重构为单行紧凑 `.sidebar-dock-footer`（账号芯片 + 在线状态绿点 + 设置按钮）
- [x] 原生 Android App 自动隐藏侧边栏与设置页的「下载 Android App」按钮
- [x] `FeatureNavigation` 移除 `52vh` 截断并修复粘性搜索框透字重叠，「最近对话」支持折叠
- [x] 自动化单测 `test/sidebar-and-perception.test.js` 通过

## G. 实时多模态全程感知（`SPEC-MULTIMODAL-PERCEPTION`）
- [x] `AndroidManifest.xml` 声明 `CAMERA`、`RECORD_AUDIO`、`PACKAGE_USAGE_STATS`、`FOREGROUND_SERVICE_MEDIA_PROJECTION`
- [x] `ScreenGlancePlugin.java` 新增后台非阻塞 `captureSnapshotNow()` 方法
- [x] `LivePerceptionBar.jsx` 聊天栏提供看屏幕 / 应用感知 / 开镜头（含前后切换、小窗收起、抓拍）/ 常开麦（含自动填入或自动发、TTS 防回声）/ 一键全停
- [x] `App.jsx` 发送消息时自动附带已开启的实时屏幕/摄像头临时视觉帧并注入 `environment_context.live_perception`
- [x] 后端 `environment-context.js` 清洗并注入 `[实时多模态感知]` 运行时提示，`live-perception-context.test.js` 通过

## H. `agents.md` 提示词缓存、自定义 API 控制台与设置面板精修（`SPEC-PROMPT-PIPELINE` / `SPEC-MIKA-PHONE-CONTROL`）
- [x] `ai-service.js` `buildAnthropicSystem` 双断点 Ephemeral Cache + 四大协议 `extractProviderUsageMetrics` KV 缓存遥测单测通过（`prompt-pipeline-cache.test.js` + `user-agents-md.test.js`）
- [x] `ai-provider-center.js` `testDraft` / `testProfile` 返回实测 `latency_ms`，`AiProviderCenter.jsx` 支持 Base URL 协议智能识别与一键切换、KV 缓存徽章及延迟徽章
- [x] `PromptPipelineInspector.jsx` 具备 5 组结构化模板与 5 维自动提示词体检清单
- [x] 设置面板 SVG 精度、滑入动效、Night Glass 对比度、reduced-motion 兼容与 `18px` 复选框锁定通过 `test/prompt-and-settings-polish.test.js` 与 `build:web`
- [x] `wangzan101/Mika` 开源仓库与 `Mika-v0.1.51-arm64.apk` 已落盘，`mika_cli.py connect` 已成功连接 `10AF4G1GUX002N2`（`ready: true`）

## I. SDD 规范驱动开发治理体系与自动化门禁（`SPEC-SDD-GOVERNANCE`）
- [x] 完整读取并提炼 PMGao SDD 视频核心五支柱与三步闭环，同步更新 [DENGTA-SDD-SPEC.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/DENGTA-SDD-SPEC.md) 至 `v2.13.62-sdd.2`
- [x] 整合历史交接文档（`AI-HANDOVER-2026-11-25`、`ENGINEERING-AUDIT`、`OPTIMIZATION-LEDGER`）与 `v2.13.53`–`v2.13.62` 全量需求，沉淀结构化需求表单 [REQUIREMENTS-FORM.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/REQUIREMENTS-FORM.md)（含 `In/Out` 边界与可执行交互明细）
- [x] 建立可执行验收测例库 [TEST-CASES.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/TEST-CASES.md) 并补齐 [SYNC-LEDGER.md](file:///D:/GZdeepseek/dengta-home/docs/SYNC-LEDGER.md) 同步台账
- [x] 落地 SDD Harness 自动化合规检查门禁 [verify-sdd-compliance.mjs](file:///D:/GZdeepseek/dengta-home/tools/verify-sdd-compliance.mjs) 并全项通过（exit 0）

## J. AI 视界与 B站/抖音/小红书多平台接入向导（`SPEC-CREATOR-ONBOARDING`）
- [x] 修复 `App.jsx` 全部 4 处「MCP 插件中心」跳转改用 `openMcpDeviceCenter()` 准确进入 `settingsCategory="devices"` 与 `#mcp-device-center`，新增 `openXhsSettings()` 直达小红书登录与发布面板
- [x] `CreatorWorldStudio.jsx` 新增「接入向导 · 平台入口」标签页与「怎么接入？」快捷入口，支持本机/局域网 `18088` 网关一键测试连接、真实状态徽章、B站/小红书/抖音/剪映四平台一键直达与 `18px` 复选框锁
- [x] `McpDeviceCenter.jsx` 创作者应用模板自动切换 Bearer 并平滑滚至表单；`dengta-creator-bridge-mcp/server.js` 放行 `https://dengta-home.vercel.app` CORS 与 PNA 预检
- [x] 自动化单测 `test/creator-world-onboarding.test.js` + `test/mcp-device-center.test.js` 全部通过

## K. QQ 机器人连接状态、绑定码与人设同步铁证 & AI 工作台滚动（`SPEC-QQ-SYNC-AND-SCROLL`）
- [x] `qq-bridge.js` 新增 `buildChannelPersonaDetail()`，修复 `user_details` 缺失、`memory_limit=0` 静默零条陷阱、补齐最近 10 轮灯塔对话衔接与 8 位同步指纹，`channel-sync.js` 新增 `GET /preview` 与保存回执
- [x] `qq-cloud.js` 拦截 6 位数字绑定码（自动核销或回执在线状态不再透传给 LLM），新增 `/同步状态` 实时服务端自检指令，优化自然口语人设引导
- [x] `ChannelHub.jsx` + `QQCloudConnect.jsx` + `channel-hub.css` 首帧加载连接态与同步证据，展示高对比三态大横幅、同步指纹证据卡与一键全量开启按钮
- [x] `LocalAgentStudio.jsx` + `local-agent-studio.css` 添加 `feature-page`、`overflow-y: auto`、`min-height: 0`、`touch-action: pan-y` 根治 AI 工作台无法上下滑动
- [x] 从 GitHub 下载安装 `kukemc/bili-cli` (`bili-agent 1.4.0`) 与 Agent Skills，端到端全量单测通过

## L. X / Twitter 真实连接态检测与防误判（`SPEC-X-HUB-HONEST-STATE`）
- [x] `x-hub-utils.js` 新增 `resolveXConnectionState()`，彻底移除裸 `/\bx\b/i` 误匹配，严格校验 `enabled === true`、`last_status === "connected"` 与真实 X 工具存在
- [x] `XHub.jsx` + `x-hub.css` 移除硬编码「MCP 网关在线」，清晰呈现四态与诊断卡片，提供「实测连通性」「一键启用并实测连通」及工具调用失败自动翻红，新增用户资料/时间线查询卡
- [x] 自动化单测 `test/x-hub-status.test.js`（3/3）及 `build:web` / `verify:csp` / `test:initial-bundle-budget` 全通过

## M. 涂鸦画室专业提示词工程与多模型调用适配（`SPEC-CREATIVE-PROMPT-PRO` · `v2.13.67`）
- [x] `creative-prompt-engineer.js` + `companion-creative.js` 实现 8 套画风预设、5 种画幅、7 层美术指导编译、零 DB 迁移 `__DT_PROMPT_V2__:` 加密封套及多模型家族渐进降级调用
- [x] `companion-creative-tool.js` + `tenant-companion-creative.js` + `routes/companion-creative.js` + `server.js` 升级专业工具 Schema、否定句过滤、`PATCH /artworks/:id/prompt` 与 `POST /artworks/:id/refine-prompt`
- [x] `CompanionCreativeStudio.jsx` + `cozy-theme.css` + `native-feel.css` 落地创作导演台、提示词精修/AI 免费润色抽屉与 8 项主流生图接口预设；前后端单测、ESLint、CSP 与包体预算全绿

## N. 聊天收纳重构、持久权限/Siri 呼唤/智能截屏依据、弹字引用修复与灵动岛 CD 封面升级（`SPEC-PERCEPTION-UX-AND-DANZI` · `v2.13.68`）
- [x] 原生 `MediaPermissionsPlugin.java` + `MainActivity.java` + `live-perception.js` + `LivePerceptionBar.jsx` 持久化摄像头/麦克风授权并在切应用回前台后自动恢复
- [x] `App.jsx` + `LivePerceptionBar.jsx` + `CottonChatDock.jsx` + `CottonDesktopPet.jsx` + `sun-glass-chat.css` + `dynamic-island.css` 将 4 项感知控制、暂停屏幕共享、小棉花陪聊与悬浮桌宠收拢至左侧星星抽屉，修复语音按钮换行与诊断药丸压字
- [x] `voice-wake-word.js` + `screen-change-monitor.js` + `ChatMessage.jsx` + 后端 `environment-context.js` / `chat-attachments.js` / `server.js` 落地 Siri 语音呼唤、32×18 智能屏幕变化检测、摄像头主动聊天引导与带时间点/缩略图的「截屏依据」气泡引用卡片（零 DB 迁移）
- [x] `ChatTextImpact.jsx` + `text-impact-preferences.js` + `chat-text-impact.css` 修复手机端「弹字」无头像回退、解除移动端自动播放禁用与触控防误关容差；升级「引用」点击跳转高亮与单行「追问」条
- [x] `NowPlayingCard.jsx` + `built-in-now-playing.js` + `sun-glass-chat.css` + `DeviceActivityPlugin.java` + `netease-cookie-session.js` + `music-cookie.js` 重构灵动岛防裁切三栏布局、移除遮挡封面的不透明灰盘并在左边旋转 CD 圆盘中完整展示 HTTPS 专辑封面（支持 `/providers/netease/cover` 自动补齐）

## O. 小棉花 3D 全面重塑、聊天麦克风修复、彩虹胶囊去杂去闪与真人喜怒哀乐情绪系统（`SPEC-COTTON-V2-AND-EMOTION` · `v2.13.69`）
- [x] `App.jsx` + `index.css` 修复聊天左下角麦克风支持单击录音/长按松手发送、原生权限申请与离线本地 `SpeechRecognition` 回落
- [x] `CompanionStatus.jsx` + `StatusFlowField.jsx` + `live-location-weather.js` + `dynamic-island.css` + `sun-glass-chat.css` 将彩色 SVG 天气胶囊移至右侧（`上海 9°` 去时间）、展开重构「此刻陪伴 / 天气与工具」双标签、消除开合闪屏与 WebGL 光球透字、修复定位按钮圆圈裁字与繁体「黃浦區」
- [x] `companion-status.js` + `emotion-state.js` + 后端 `services/companion-status.js` / `companion-interaction.js` / `companion-status-refresh.js` 修复默认/重置/闲置元气掉至 0%（恢复 70–80% 健康人类基线）、移除游戏式 `回元气 +18%` 并落地真人感 `喜/怒/哀/乐` 与情境化哄人/陪伴逻辑
- [x] `b1857-character.js` + `mtoon-style.js` + `interaction-props.js` + `interaction-controller.js` + `gyro-controller.js` + `pet-runtime.js` + `CottonPet.jsx` + `CottonDesktopPet.jsx` 完成手绘奶油毛绒纹理、24 骨骼实景食盆水碗互动、手机陀螺仪满屏跑动与甩球物理、GPU 零闪烁身体部位拎拖、精致磨砂图标菜单栏及小屋上下滑动修复
- [x] 修复 Windows PowerShell 5.1 一键发布脚本中 `git push` 正常 stderr 输出误触 `NativeCommandError` 中断的缺陷（`complete-github-release-v2.13.69.ps1`）

## P. 全端音乐无缝自动连播（`SPEC-MUSIC-AUTO-NEXT` · `v2.13.70`）
- [x] `built-in-now-playing.js` + `useBuiltInNowPlaying.js` + `backend-prod/routes/v2/music-cookie.js` 实现灵动岛内置随心听 `ended` 立即自动续播下一首、`?exclude=` 防重复、移动端 `NotAllowedError` 复用旧 Audio 兜底、失败清理与 `MediaSession` 操控同步
- [x] `MusicStudio.jsx` + `music-studio.css` 落地歌单/日推/搜索队列自动连播、自动跳过 VIP 不可播曲目、连续失败熔断保护及迷你栏「自动连播 · i/N」与上一首/下一首控制按钮
- [x] `TogetherMusic.jsx` + `MusicChatCard.jsx` + `App.jsx` 补齐一起听本地预览自动连播（保持 `active === true` 队列契约 100% 不变）及聊天歌曲卡片播完后通过 `dengta:chat-music-ended` 无缝接力灵动岛连播
- [x] 前后端全套音乐/生命周期单测（后端 42 项、前端 73 项）、ESLint、`build:web`、`verify:csp`、`verify:public-auth-build`、`test:initial-bundle-budget` 全部通过并签发 `DengTa-2.13.70.apk`（`versionCode 328`）

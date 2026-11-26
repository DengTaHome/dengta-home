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
- [x] 舞台渐变背景改为蓝灰/暖粉高对比底色，白毛轮廓投影 + 脚底接触阴影 + 默认开启细描边 + 白天防过曝灯光
- [ ] 真机实测：在手机端打开「小棉花」，确认白色博美犬轮廓、眼睛、鼻子与阴影清晰可见

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

# DengTa（灯塔）SDD 规范驱动开发需求与规格主文档（Single Source of Truth）

> **文档版本**：`v2.13.54-sdd.1`  
> **最后更新**：`2026-11-27`  
> **方法论来源**：SDD（Specification-Driven Development · 规范驱动开发，参考 PMGao《AI 产品经理不懂 SDD，你的 VibeCoding 项目就是在胡扯蛋》五大核心支柱）  
> **配套文档**：
> - 变更与版本追溯台账：[CHANGELOG.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/CHANGELOG.md)
> - 逐条验收清单：[ACCEPTANCE-CHECKLIST.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/ACCEPTANCE-CHECKLIST.md)
> - 运维与账号交接基线：[AI-HANDOVER-2026-11-25.md](file:///D:/GZdeepseek/dengta-home/docs/AI-HANDOVER-2026-11-25.md)

---

## 1. SDD 五大落地原则（本项目执行铁律）

本项目彻底告别“想到哪聊到哪 → 跑不通 → 再瞎改 → 前后冲突”的盲目 Vibe Coding，所有后续迭代强制执行以下五条规范：

1. **明确做什么（迭代范围先行）**：每次开发前只定义本轮 MVP/增量范围，不一次空想全部功能；范围变更必须先改本规格文档再动代码。
2. **需求保存为文档（单一事实来源）**：关键产品决策、交互约束、接口契约不得只留在聊天记录里，统一沉淀在 `dengta-home/docs/sdd/` 随 Git & CNB 同步版本化。
3. **定义“怎么才算做得好”（可执行规范 = 前置条件 + 触发动作 + 限制边界 + 失败回退）**：禁止使用“更好看/更快/更流畅”这类模糊词，全部量化为可验证的行为与阈值。
4. **版本管理规范化迭代（变更可追溯）**：每次需求调整都在 `CHANGELOG.md` 留下版本号、改动原因、影响文件与验证记录，确保 3 个月后仍查得清“当时为什么这么设计”。
5. **照规范验收（Checklist 闭环）**：AI 声称“做完了”不等于交付，必须逐条核对 `ACCEPTANCE-CHECKLIST.md`（单测 + 构建 + 真机/浏览器实测截图）全项通过才算关闭。

---

## 2. 系统架构红线与全局不变量（Global Invariants）

| 编号 | 不可违背红线 | 验收方式 |
|---|---|---|
| `INV-01` | **零生产数据库破坏性迁移**：严禁擅自修改线上 Supabase 表结构或执行未核对的 062/063/064 迁移；新运行时状态（如 Chronos）存入 `companion_runtime_states.status.__chronos_v1` 并由 `preserveCapsuleKeys` 保护。 | 代码审查 + `time-capsule-state.test.js` |
| `INV-02` | **租户与伴侣数据严格隔离**：所有 `/api/v2/*` 路由强制经过 `requireRequestScope(req)`，数据库读写经 `scope.db` 自动注入 `user_id` + `companion_id`。 | 401 未登录拦截单测 |
| `INV-03` | **无硬编码审查/撤回逻辑**：保留原始模型流式输出（`sentenceBubblesEnabled = false`），不允许恢复内容拒答拦截器。 | `npm run check:prompt-architecture` |
| `INV-04` | **KV-Cache 前缀稳定性**：稳定层（Layer 1–2 `agents.md`）不得混入每轮变化的动态时间戳/天气/唤醒摘要；动态时间信息仅进入 Layer 3–4 Runtime Context。 | `prompt-pipeline-cache.test.js` |
| `INV-05` | **双主题玻璃态对比度 + 内联复选框规范**：所有自定义模块必须声明 `:root` 与 `:root[data-dengta-appearance="night"]` 双套语义色变量；内联 checkbox 显式锁死 `18px × 18px`，不被全局 `44px` 表单规则撑爆。 | CSS 静态检查 + 实机/浏览器截图 |
| `INV-06` | **零明文凭据入库**：任何密码、API Key、Cookie、PAT、Keystore 不得写入代码、文档、GitHub 或 CNB。 | 提交前 secret 扫描 |

---

## 3. 核心功能模块可执行规格表（Executable Specifications）

### 模块 A · 聊天记录极速加载与渲染（`SPEC-CHAT-SPEED`）
- **问题背景**：每次打开聊天页或切换会话时，前端先清空消息数组再串行等待服务端一次性查 500 条消息，同时后端先串行查 `conversations` 再查 `messages`，导致白屏转圈慢。
- **可执行规范**：
  1. **后端并行与分页**：`GET /api/v2/sessions/:id/messages` 支持可选 `limit`（1–500）与 `before`（ISO 时间戳），并且**并行执行**会话归属校验与消息查询（`Promise.all`），响应返回 `{ has_more, messages }`。
  2. **前端三级缓存（Stale-While-Revalidate）**：
     - **L1 内存缓存**（`peekCachedHistory`）：同一次运行内切回会话时 0ms 同步渲染上次已确认历史；
     - **L2 IndexedDB 持久化缓存**（`readCachedHistory`，按 `account+companion` 作用域隔离，单会话最多缓存最近 200 条，350ms 去抖写盘）：冷启动打开 App 时无需等待远端即先出首屏历史；
     - **L3 首屏快取 + 后台完整校准**：无缓存时并行发出 `?limit=40` 首屏快拉与完整历史校准；校准结果若当前会话未处于流式回复中则无缝更新，绝不打断正在生成的回复。
  3. **首屏 DOM 减负**：`ChatTranscript.jsx` 初始渲染窗口设为最近 **80 条**（原 200 条），更早消息按 150 条/批点击展开并保持滚动位置不跳动。

### 模块 B · 音乐工作室手机直连二维码与登录态捕获（`SPEC-MUSIC-STUDIO`）
- **问题背景**：
  1. Android 15 WebView 默认禁用第三方 Cookie，导致内嵌 `https://music.dengtahome.com/?token=...` iframe 在 302 后丢失会话 Cookie，呈现白屏 `open this player with its access link`；
  2. 手机浏览器或 WebView 打开二维码、用户保存图片切去网易云音乐 App 扫码确认后再切回时，因页面缺少前台恢复复查、且旧版 120s 自动偷换 `qrKey`、加上网易云 `803` 凭据只吐一次，导致切回后页面毫无反应、抓不到登录态。
- **可执行规范**：
  1. **默认直连模式（零白屏）**：进入「音乐工作室」默认打开「扫码/歌单直连工作台」（`mode = "direct"`），并行核对 `GET /api/v2/music/providers/netease/qr/status` 与 `GET /api/v2/music/providers/netease/cookie-session`；
  2. **未登录首屏直出二维码**：未登录时无需二次跳转，直接在页面中央绘制 `248×248` 带白边高清网易云登录二维码，提供四个明确动作：
     - **保存二维码到相册**：Android 端调用 `window.DengTaFileBridge.saveImageToGallery()` 通过 `MediaStore` 写入 `Pictures/DengTa`（Android 10–15 零权限弹窗）；Web 端触发 PNG 下载；
     - **打开网易云 App**：Android 端调用 `DengTaFileBridge.openNeteaseApp()`（拉起 `com.netease.cloudmusic` / `orpheus://`）；
     - **我已扫码，立即检测**：手动触发立即检测并核对真实登录状态；
     - **换一张**：显式重新向服务端申请新 `unikey`。
  3. **切回前台 100% 捕获登录态**：
     - 严禁在用户扫码期间 120s 自动偷换二维码；
     - 正在扫码的 `qrKey` 持久化至 `sessionStorage`（4.5 分钟内即使系统回收重载页面也可无缝续查）；
     - 同时监听 `visibilitychange`、`pageshow`、`window.focus` 及 Capacitor `App.appStateChange`，从网易云切回瞬间（0ms、1.5s、4s）连查 `qr/check` + 统一登录状态；
     - 后端 `netease-qr-login.js` 增加 `confirmedSessions` 3 分钟幂等缓存、`json.cookie` 兜底提取、800 过期时 90 秒内库记录复核、`status()` 与 `cookieSession` 双源统一，以及 `weapi type=1` 失败自动回退明文 `type=3`。
  4. **Android 原生双兜底**：
     - `MainActivity.java` 开启 `CookieManager.setAcceptThirdPartyCookies(webView, true)`，修复切到「外置播放器」iframe 时的 401 白屏；
     - `NeteaseCookieActivity.java` 增加 1.5s `CookieManager` 轮询，检测到 `MUSIC_U=` 自动保存并同步回灯塔，不再强迫用户找按钮。
  5. **已登录工作台能力**：直接展示账号昵称/UID，支持「我的歌单」（浏览曲目 + 一键导入一起听同步）、「每日推荐」、「搜歌」与底部内置 `<audio>` 播放器，顶部可随时切到「外置播放器」。

### 模块 C · Chronos 严格时间架构与统一自动唤醒（`SPEC-CHRONOS`）
- **可执行规范**：
  1. **单一权威时钟（`chronos-engine.js`）**：服务端 UTC 结合用户 IANA 时区输出统一时钟、日历锚点（昨天/今天/明天/后天）、时钟偏差告警（偏差 ≥ 90s 提示）、跨天与沉默时间差分析；修复 `special-dates.js` 凌晨 00:00–08:00 的 UTC 跨天错位 Bug。
  2. **对话时间流逝真实注入**：`annotateHistoryWithTimeGaps` 在读时非侵入式插入 ≥20 分钟或跨午夜分隔提示；前端不再硬编码 `Asia/Shanghai`，按用户时区发送 `timezone` 与 `client_time_iso`。
  3. **严格静默免打扰与统一自动唤醒（`chronos-wake-engine.js`）**：
     - 区分工作日/周末静默时段（支持跨午夜与同日窗口），主动消息在静默期内不调用 LLM 并精确顺延至静默结束；
     - 支持 `one_shot`（倒计时/精确时刻）、`daily`、`weekdays`、`weekends` 及早晚安仪式，每条触发具备幂等键（`last_occurrence_key`）、45 分钟离线补发宽限、冷却保护与最近 24 条审计记录；
     - 注册聊天 AI 核心工具 `manage_wake_schedule`（前置 Top-20 避免上游网关截断），用户口语要求“15 分钟后提醒我 / 明早 7:30 叫醒”即落库真实闹钟；
     - 三端协同：后端 `background-job-worker` 60s 巡检 + 前端 45s/切前台心跳 + Android `PushNotificationWorker` 后台拉取前先触发 `/api/v2/chronos/heartbeat` + Capacitor `LocalNotifications` 48h 离线闹钟预装。

### 模块 D · 博美犬小棉花 3D 桌宠与可见性保障（`SPEC-COTTON-PET`）
- **问题背景**：浅色/暖白色舞台背景 + 过曝白天灯光导致白色博美小棉花融进背景“白的啥也看不见”。
- **可执行规范**：
  1. **舞台对比度**：小棉花专属舞台采用莫兰迪蓝灰渐变（普通模式 `#dfe6e1 → #bccbc8 → #93a9b1`）与暖藕粉暮色渐变（MToon 卡通模式 `#f3dccb → #d9b3aa → #a88ea6`），白毛轮廓对比度清晰可辨；
  2. **立体光照与接地阴影**：白天降低过曝环境光（`toneMappingExposure = 0.9`，`hemiLight = 1.5`，冷色边缘光 `rimLight = 1.25`），加深 MToon 暗部阴影色阶（`142,120,116`），增加脚底柔和椭圆接触阴影（`createContactShadow`）；
  3. **默认细描边 + Canvas 柔和轮廓投影**：`CottonPet.jsx` 与 `CottonDesktopPet.jsx` 默认开启细描边（`outline: true`），CSS 叠加暖棕色柔和描边投影，确保无论全屏舞台还是聊天页悬浮桌宠都一眼清晰。

### 模块 E · 已上线成熟能力基线（汇总自历史迭代与交接文档）
- **提示词分层与设置面板**：`agents.md` 稳定层 + 运行时动态层分层注入 + Prompt Pipeline 实时检查器 + 图标/动效/SVG 精修。
- **记忆与人格自由导出/导入**：支持 45+ 文件后缀（世界书/PNG Chara V2/V3/ZIP/EPUB/ChatGPT/Claude/SillyTavern）、MCP 外部记忆库导入、本机记忆整理蒸馏与 10 种便携格式导出、Kiwi 记忆健康与召回诊断。
- **灯塔邮局（Surprise Map）**：移动端原生定位授权探索附近公共惊喜与私人信件。
- **AI 创作者与剪映桥接**：内置 `dbskill` 选题分析主动工具调用 + `adudir-open` / 剪映本地工作区一键授权桥接。

---

## 4. 数据与接口契约速查

| 接口路径 | 方法 | 作用域要求 | 用途 |
|---|---|---|---|
| `/api/v2/sessions/:id/messages?limit=&before=` | `GET` | `requireRequestScope` | 并行校验会话与拉取聊天记录，支持首屏分页 |
| `/api/v2/chronos/state` / `policy` / `schedules` / `heartbeat` | `GET/PUT/POST/PATCH/DELETE` | `requireRequestScope` | 严格时间时钟、免打扰策略、精确闹钟与唤醒心跳 |
| `/api/v2/music/providers/netease/qr/*` | `GET/POST/DELETE` | `requireRequestScope` | 网易云扫码登录（幂等确认 + 歌单/直链解析） |
| `/api/v2/music/providers/netease/cookie-session` & `cookie/*` | `GET/POST/DELETE` | `requireRequestScope` | App 原生 Cookie 登录态同步、日推、搜歌、歌单曲目 |
| `/api/v2/music/embed-url` | `GET` | `requireRequestScope` | 外置独立音乐播放器访问链接 |

---

## 7. 侧边栏比例重构与玩法列表全景展示（`SPEC-SIDEBAR-LAYOUT` · v2.13.55）

- **问题根源**：旧版侧边栏底部依次堆叠账号卡片、`下载 Android App`、独立`设置`按钮与连接状态行（占去 ~280–320px），外加 `.sidebar { gap: 17px/18px }` 与 `.feature-navigation { max-height: 52vh }`，导致「找个玩法」列表在手机屏上被压扁至约 180px，且半透明粘性搜索框遮挡首行图标。
- **核心设计规范**：
  1. **底部单行紧凑 Dock（`.sidebar-dock-footer`）**：账号触发器与右侧动作区（网页端紧凑 `⤓` 图标、Android 原生自动隐藏；以及集成在线状态绿点的紧凑 `⚙ 设置` 按钮）合并为单行约 46px 高度；账号弹窗向上完整展开不裁切。
  2. **玩法列表主视觉占比最大化**：`.feature-navigation` 改为 `flex: 1 1 auto; max-height: none;`，搜索栏改为纯不透明 `rgb(var(--theme-card-rgb))` 粘性顶栏杜绝透字重叠；功能卡片高度收紧至 44px、副标题单行省略，单屏可视玩法数提升 2.5 倍以上。
  3. **可折叠「最近对话」**：默认限高 `max-height: 124px` 防止挤占玩法列表，支持一键折叠释放几乎 100% 侧边栏纵向空间给玩法导航；原生 Android 设置页顶部同样隐藏冗余「下载安卓安装包」入口。
  4. **双外观兼容**：完整适配 Day / Night Glass 以及 `android-compat.css` 移动端不透明抽屉。

---

## 8. 实时多模态全程感知架构（`SPEC-MULTIMODAL-PERCEPTION` · v2.13.55）

- **产品目标**：只要用户明确授予对应系统/浏览器权限并打开开关，DengTa 即可全程随时随地结合**屏幕捕获**、**应用活动感知**、**摄像头实时视觉**与**麦克风持续聆听**自然陪伴用户；任意时刻在聊天页可一键暂停或关闭。
- **三端分层实现**：
  1. **Android 原生层**：
     - `AndroidManifest.xml` 补齐 `android.permission.CAMERA` 及相机可选硬件声明（配合已声明的 `RECORD_AUDIO`、`MODIFY_AUDIO_SETTINGS`、`FOREGROUND_SERVICE_MEDIA_PROJECTION`、`PACKAGE_USAGE_STATS` 与 Capacitor 8 `BridgeWebChromeClient.onPermissionRequest` 运行时授权桥接）。
     - `ScreenGlancePlugin.java` 新增后台线程方法 `captureSnapshotNow()`：在用户已授权 `MediaProjection` 屏幕共享会话后，单次调用即可 1.8s 内抓回最新屏幕帧，不阻塞主 UI 线程。
  2. **前端多模态引擎（`live-perception.js` + `LivePerceptionBar.jsx` + `live-perception.css`）**：
     - **看屏幕**：Android 端直连 `ScreenGlance` 会话，桌面/网页端保持持久化 `getDisplayMedia` 视频流；每轮发送消息自动静默附带此刻屏幕帧（无手动附件时自动标为 `ephemeral` 临时画面）。
     - **应用感知**：Android 端授权使用情况访问后每 25s 及切回前台实时同步 `currentApp` 与近 30 分钟 `deviceActivity`，聊天栏直接显示当前正在使用的 App 徽标。
     - **开镜头**：支持 `getUserMedia` 实时摄像头常驻（前置/后置一键切换、可收起悬浮小窗、手动抓拍），开启后每轮对话自动附带此刻镜头画面。
     - **常开麦**：基于 `SpeechRecognition` 持续语音聆听（AI 语音播报时自动暂停防回声，播完自动恢复），支持「自动填入」与「说完自动发送」双模式；无语音识别 API 的 WebView 自动降级为常驻麦克风就绪态。
     - **设置总控**：设置 → `devices` 顶部挂载 `LivePerceptionSettingsCard`，集中提供四项权限测试/申请与默认行为配置。
  3. **后端运行时上下文（`services/environment-context.js`）**：
     - `normalizeEnvironmentContext` 与 `sanitizeLivePerceptionSnapshot` 严格校验清洗 `live_perception` 字段；`buildEnvironmentRuntimeContext` 注入 `[实时多模态感知]` 引导词，让伴侣自然结合屏幕、镜头、声音与应用状态回应。

---

## 9. `agents.md` 提示词分层注入与双断点缓存（`SPEC-PROMPT-PIPELINE` · v2.13.55–v2.13.58）

- **链路核验结论**：`buildUserAgentsMdPlan` → `<file path="agents.md">` 置于最高系统层首位，静态人设与锁定核心记忆前置、动态记忆去重后置、易变上下文隔离在最新消息前的 4 层架构（L0–L3）完全正确且符合主流 LLM KV Prefix Cache 机制。
- **v2.13.55 强化**：`buildAnthropicSystem` 新增 **双断点 Ephemeral Cache**——当首位 `agents.md` 静态前缀自身达到可缓存阈值（≥1024 tokens）且后续仍有系统指令块时，在 `blocks[0]` 与尾部同时写入 `cache_control: { type: "ephemeral" }`，确保动态尾部变更不再击穿静态人设缓存。
- **v2.13.58–v2.13.59 升级**：
  1. **全协议真实 KV-Cache 遥测与前端可视化闭环（`ai-service.js` → `settings.js` → `PromptPipelineInspector.jsx`）**：统一采集 DeepSeek、OpenAI Chat/Responses（含官方 `stream_options.include_usage` 与 `prompt_cache_key`）、Anthropic（双事件流合并）与 Gemini 的 `cached_input_tokens` / `cache_creation_tokens` / `cache_hit_ratio`，持久化至 `lastPromptReceipt.upstreamUsage` 并在设置页实时呈现真实命中率。
  2. **冷启动单次 RTT 首屏预热（`routes/v2/content.js` + `chat-history-cache.js`）**：`/api/v2/bootstrap` 顺带预取最近会话 40 条消息，通过 `seedInitialHistory()` 无损预热 L1 缓存，新设备冷启动即刻出首屏。
  3. **自定义接口控制台升级（`ai-provider-center.js` + `provider-form.js` + `AiProviderCenter.jsx`）**：后端 `testDraft`/`testProfile` 返回真实 `latency_ms`；前端自动识别 Base URL 协议并弹出「一键切换协议」提示，卡片与表单展示协议 KV 缓存能力与实测延迟徽章。
  4. **`PromptPipelineInspector` + 设置面板精修**：新增「实时感知与严格时间」模板与 5 维自动体检清单；全局设置面板统一高精度 SVG 渲染（`geometricPrecision` / `round`）、滑入动效与 `reduced-motion` 兼容、Night Glass 高对比卡片及全量 `18px` 复选框锁定。

---

## 10. 开源手机控制引擎 Mika 接入准备（`SPEC-MIKA-PHONE-CONTROL`）

- 已拉取官方开源仓库 `wangzan101/Mika` 至 `D:\GZdeepseek\_refs\Mika`，下载最新 `arm64-v8a` 安装包 `Mika-v0.1.51-arm64.apk` 至 `D:\GZdeepseek\apk-build\Mika-v0.1.51-arm64.apk`，并验证本机 Python 3.12 + `mika_cli.py devices --json` 成功识别已连接设备 `10AF4G1GUX002N2 (vivo V2454A · Android 15)`。
- 严格遵循安全合规红线与 Mika 官方 `install-with-agent` Rule 5：不绕过或自动点击 Android 系统安全弹窗（含 vivo `PackageInterceptActivity` 安装确认与无线调试配对确认），由用户在手机端确认安装与模型配置后即可随时通过 `mika connect --device 10AF4G1GUX002N2` 联动。

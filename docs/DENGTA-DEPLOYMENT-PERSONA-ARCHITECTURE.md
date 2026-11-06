# DengTa 部署、人格、蒸馏与代码架构全解

> 写给接手的人：读完这份文档，应该能回答四个问题：
> 1. DengTa 现在部署在哪、怎么发版、数据在哪；
> 2. 人格是怎么写进去、每轮怎么装配的；
> 3. “风格提纯/蒸馏”到底做了什么、结果去了哪；
> 4. 前后端代码如何分层，QQ/微信/小红书/网易云等外部服务怎么接。
>
> 最后更新：2026-11-06。所有密钥只给“存放位置”，不写值。

---

# 一、总览：DengTa 是什么，部署成什么

DengTa 是一个“长期陪伴 + 连续对话”的移动应用，核心是：

- 一个 React Web/PWA 前端；
- 一个 Capacitor Android 壳；
- 一个 Express + Supabase 后端；
- 一个可插拔的 AI 模型接口层；
- 一套长期记忆、人格、语音、创作、音乐、共同观看、外部聊天通道（微信/QQ）能力；
- 通过 Vercel + Render + Supabase 部署。

## 1.1 生产拓扑

```
用户
├── 手机 App（Capacitor/Android，包名 home.dengta.app）
├── 浏览器（https://www.dengtahome.com）
│
├── Vercel：前端静态站点
│   ├── React/Vite 构建产物 dist/
│   ├── PWA、download.html、更新 feed（/updates/*.json）
│   ├── /downloads/*.apk 通过 rewrite 或直连 Supabase
│   └── CSP / 安全头
│
├── Render：后端 Express（https://dengta-home-backend-rkmq.onrender.com）
│   ├── /chat、/chat/stream
│   ├── /api/v2/*（会话、设置、记忆、音乐、声音、创作、通道...）
│   ├── /api/v2/qq-bridge/*（微信/QQ 通道桥）
│   └── 后台任务 worker / push / cast / MCP
│
├── Supabase（ref: nyyqizwrlmejpfdhgrnd）
│   ├── Postgres：业务表 + RLS
│   ├── Auth：账号/JWT
│   ├── Storage：私有媒体、工作区、APK 等
│   └── 历史迁移 supabase/*.sql
│
├── AI 模型供应商（官方 DeepSeek / 兼容网关 / 其他 profile）
├── 语音供应商（MiniMax / HerVoice / OpenAI 等）
├── 图片/视觉供应商
├── 外部 MCP / 第三方服务（小红书、B站、网易云、X、Kiwi、Ombre、心潮...）
└── 本地桥接栈（QQ SnowLuma/qq-bridge、微信 iLink）
```

## 1.2 三套“看起来都能聊天”的入口

| 入口 | 走哪里 | 人格来源 |
|---|---|---|
| DengTa App / 网页 | 前端 → Render `/chat/stream` | 数据库 settings + memories + knowledge，每轮实时装配 |
| 微信自动回复 | `wechat-bridge` → `auto-reply.mjs` → Render `/api/v2/qq-bridge/chat` | DB `channel_sync_preferences`/`persona_sections` 生成 `channel_persona` |
| QQ（本地桥） | SnowLuma → `qq-bridge` → 本机 DSH Agent | DSH preset + 本地 qq-bridge 配置；不是直接走 Render |

QQ 本地桥和 DengTa 网页是两套 Agent 运行时；不要误以为 QQ 桥调用的是网页的 `/chat/stream`。具体本地地址见 [QQ-WECHAT-DEPLOYMENT-HANDOVER.md](QQ-WECHAT-DEPLOYMENT-HANDOVER.md)。

---

# 二、部署方案（生产）

## 2.1 前端：Vercel

- 仓库：`DengTaHome/dengta-home-frontend`
- 生产域名：`https://www.dengtahome.com`
- 构建：Vercel 执行 `npm run build:web`
  - `eslint src --quiet`
  - `vite build`
  - `verify:csp`
  - `verify:public-auth-build`（检查公开 Supabase 配置确实进入构建产物）
- 输出：`dist/`
- PWA / Android 共用同一份构建产物。
- 安全头在 `vercel.json`：
  - CSP（含 download.html 内联脚本的 CRLF/LF 双 hash）
  - `X-Content-Type-Options`
  - 更新 feed 的 `Cache-Control: no-store`
  - `/updates/android.json`、`/updates/download.json` 的 CORS
- Vercel rewrites：
  - `/download`、`/install` → `/download.html`
  - `/receive` → `index.html`
  - `/room/join` → `room-invite.html`
  - `/supabase/:path*` → Supabase（历史兼容）
  - `/downloads/DengTa-*.apk` → Supabase Storage 对象（需要跟当前版本同步）
- 前端环境变量（Vercel 项目环境，不在仓库）：
  - `VITE_API_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_PUBLIC_AUTH_REDIRECT_URL`

**注意**：前端是静态站点，所有秘密都不能进 `VITE_*`；`VITE_*` 会被打进 JS。

## 2.2 安卓：Capacitor + 本地/CI 构建

- 包名：`home.dengta.app`
- `capacitor.config.json`：
  - `webDir: "dist"`
  - `androidScheme: "https"`
  - `cleartext: false`
  - UA 追加 `DengTaHome/2`
- 构建链路：
  1. `npm run build:web` / `npm run build`
  2. `npm run android:sync`（`cap sync android`）
  3. Gradle `:app:assembleRelease`
  4. 签名、对齐、可选 `apksigner verify`
- 当前发布版本（2026-11-06）：
  - **2.13.52 / versionCode 310**
  - 36,466,847 字节
  - SHA-256 `638322cc874fe797b48e96d7ae050154a40e8b5bacd775ceaa139c592e150efa`
  - 签名证书 `0d634aaf6eb10dd4c9042883ddb00fa7c32e01eb6387e1a7238bf96d08a1e0f5`
- 更新 feed：
  - `public/updates/android.json`
  - `public/updates/download.json`（旧版兼容）
  - 字段：`version_code`、`version`、`apk_url`、`sha256`、`size_bytes`、`published_at`、`notes`
  - 当前指向 Supabase 直连 APK 对象（不是 Vercel 二进制）
- App 内更新：
  - JS `src/app-updates.js` 拉 feed、比较版本、决定是否提醒
  - 原生 `AppUpdateCenter`/AppUpdates 插件下载、校验 SHA、打开系统安装器
  - 原生更新策略只接受：
    - `https://www.dengtahome.com/downloads/*.apk`
    - GitHub Release 的 APK
    - Supabase Storage 公网 APK
  - 接受 site `/downloads` 是历史修复重点：曾因为只接受 `/supabase` 导致更新失败。

## 2.3 后端：Render

- 仓库：`DengTaHome/dengta-home-backend`
- 生产：`https://dengta-home-backend-rkmq.onrender.com`
- 运行：Node 24 + Express 5，CommonJS。
- 启动：`npm start`（`server.js`）。
- 关键环境变量分组（值只在 Render，不在仓库）：
  - Supabase：`SUPABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_ANON_KEY`
  - 运行：`NODE_ENV`、`PORT`、`AUTH_REQUIRED`、`FRONTEND_URL`
  - 加密/MCP：`MCP_ENCRYPTION_KEY`、`MCP_ADMIN_SECRET`、`AI_PROVIDER_ENCRYPTION_KEY`
  - 后台任务：`BACKGROUND_JOBS_ENABLED`、`BACKGROUND_JOB_TRIGGER_SECRET`、`BACKGROUND_WORKER_ID`、`BACKGROUND_JOB_CONCURRENCY`、`BACKGROUND_JOB_BATCH_SIZE`、`BACKGROUND_JOB_LEASE_SECONDS`、`BACKGROUND_JOB_MAX_ATTEMPTS`、`BACKGROUND_JOB_RETRY_*`、`BACKGROUND_JOB_TICK_BUDGET_MS`
  - 语音：`HERVOICE_*`、`MINIMAX_*`、`EXPRESSIVE_TTS_*`、`VOICE_*`
  - 图片/视觉：图片/视觉 provider profile（存 DB），环境侧有对应密钥
  - 外部服务：`XHS_*`、`EXA_API_KEY`、`OMBRE_*`、`XINCHAO_*`
  - Cast/共同观看：`CAST_PAIRING_SECRET`、`CAST_MEDIA_ENCRYPTION_KEY`
  - 推送：`PUSH_SECRET`
  - 通道桥：`QQ_BRIDGE_CONFIG_JSON`、`QQ_BRIDGE_TOKEN`、`QQ_BRIDGE_BINDINGS`
- 健康检查：
  - `GET /health`：版本/revision、数据库/语音租约等
  - `GET /health/database`
- 后台任务：
  - 默认由循环 worker 抢占 `background_jobs`
  - 有 lease、attempts、退避、批量并发
  - 任务包括记忆压缩/巩固、主动消息、动态、日记、状态刷新、创作等
  - Render 上可通过环境变量关闭；关闭后不会自动做后台生成。

## 2.4 数据库与迁移

- Supabase 项目 ref：`nyyqizwrlmejpfdhgrnd`
- 迁移目录：`backend-prod/supabase/*.sql`（当前仓库可见到 067；通道同步 068/069 在本地 `dengta-home/backend/supabase` 副本中，生产表已由 SQL Editor 执行；以生产 schema 为准）。
- 84+ 表的核心域：
  - 账号/伴侣：`user_profiles`、`companions`、`user_display_ids`、`companion_profile_versions`
  - 对话：`conversations`、`messages`、`conversation_composer_hints`
  - 人格/设置：`settings`、`persona_sections`、`channel_sync_preferences`、`channel_bindings`
  - 记忆：`memories`、`memory_calendar`、`stable_memory_candidates`
  - 世界书/知识：`world_book_entries`、知识文件（Storage + 元数据）
  - 创作：`companion_artworks`、`companion_creative_settings`、`image_generation_calls`、`image_provider_profiles`
  - 语音/视觉：`voice_provider_profiles`、`vision_provider_profiles`
  - 音乐：`music_playlists`、`music_playlist_items`、`music_favorites`、`music_playback_queues`、`netease_*`
  - 动态/日记/活动：`moments`、`moment_comments`、`companion_diary_entries`、`daily_shots`、`special_dates`
  - 共同观看/Cast：`co_watch_*`、`cast_*`、`watch_*`
  - 其他：`takeout_commands`、`nursery_*`、`surprise_map_*`、`timeline_*`、`device_*`、`push_installations`、`background_jobs`
- RLS：
  - 用户只能访问自己的 user/companion 数据。
  - `channel_bindings` 只允许本人 SELECT；写入由服务端或桥接 token 完成。
  - Service role 只存在后端环境，绝不进前端。

## 2.5 CI/CD

- GitHub Actions：
  - 前端测试/lint/build
  - APK 发布 `publish-android-apk.yml`
  - CNB 镜像同步 `sync-cnb.yml`
- APK 发布流程：
  1. checkout main
  2. 恢复 Android debug keystore secret
  3. 校验证书 SHA-256
  4. 构建 web + APK
  5. `apksigner verify`
  6. 上传 APK 到 Supabase Storage
  7. 更新 `android.json` / `download.json` 并提交
  8. 触发 Vercel 部署
- 2026-11-06 起，Actions keystore secret 和 workflow/script 的证书校验已改为当前 `0d634aaf…`，保证现有用户能覆盖升级。
- 旧 `38a03ab2…` 证书只存在于历史文档，不再用于新发布。

## 2.6 备份与仓库

- 唯一备份 bundle：`D:\GZdeepseek\backup\dengta-home-full-<date>.bundle`
- 用 `git bundle create --all` + `git bundle verify` 刷新。
- 不要用 `_audit` 里的临时脚本当备份；不要提交 `_credentials`、`.wxb`、token 文件。

---

# 三、代码架构

## 3.1 前端

### 3.1.1 技术栈

- React 19 + Vite 8
- JavaScript/JSX（不是 TypeScript）
- React Test Renderer + Node ` --test` 做回归测试
- ESLint
- Capacitor（Android）
- 大量 CSS 模块（`*.css`）和少量内联样式
- 没有 Redux/MobX；以 App 级 hooks + 模块函数为主

### 3.1.2 目录与模块

```
src/
├── App.jsx                    # 应用编排器：登录/会话/聊天/设置/弹层/导航/流式
├── api.js                     # fetch 封装：auth header、companion header、超时、GET 重试
├── auth-session.js            # Supabase 登录态与请求上下文
├── channel-hub.jsx / .css     # 微信/QQ 绑定与通道同步 UI
├── ChatMessage.jsx            # 消息渲染
├── ChatTranscript.jsx         # 会话 transcript
├── ChatContextSettings.jsx    # 个性化指令/你的详情等上下文设置
├── settings-*.jsx / settings-* .js # 设置页拆分
├── app-updates.js / AppUpdateCenter.jsx # App 内更新
├── Companion*.jsx             # 伴侣档案/状态/创作/日记/互动
├── music-* / ai-music-*       # 音乐/一起听
├── co-watch-* / cast-*        # 共同观看/Cast
├── *-lifecycle.js             # 资源生命周期、请求取消
├── *-scope.js / account-storage.js # 账号/伴侣作用域与本地存储
├── android-compat.js          # Android WebView 兼容
├── app-back-navigation.js     # 返回栈
└── styles/、assets/           # 视觉资源
```

`App.jsx` 很大，是“总装线”；拆分原则是：数据/异步/生命周期尽量抽成 `.js`，复杂 UI 抽成 `.jsx`，不要继续把所有逻辑塞回 App。

### 3.1.3 请求与鉴权

- `api.js` 的 `apiFetch`：
  - 从 `authSession` 拿 access token；
  - 自动加 `Authorization: Bearer <token>`；
  - 自动加 `X-DengTa-Companion-Id`；
  - GET 可重试（0/1.5/4s），POST 不自动重试；
  - 超时/AbortSignal 处理；
  - 错误统一转成 `chat-errors` / 诊断码。
- 登录：
  - Supabase Auth（邮箱/密码、OAuth/redirect 等）。
  - 原生端 token 存在 Capacitor 安全存储/本机存储，不用 localStorage 裸存。
- 账号/伴侣切换时，所有异步请求必须检查 scope，旧请求不能写新账号数据。

### 3.1.4 聊天前端流

发送流程：

```
用户点发送
→ 本地插入 user 消息 + 空的 assistant 草稿
→ 生成 client_message_id（幂等键）
→ POST /chat/stream（SSE）
→ 处理事件：
   meta / status / monologue / text / reasoning / tool / done / error
→ 文本按句/段渲染，滚动到底
→ done 后用服务端最终 message 覆盖本地草稿
```

关键文件：

- `chat-sentences.js`、`sentence bubble` 相关：分句/气泡
- `chat-stream-contract` 后端：事件契约
- `chat-idempotency.js`：同一 `client_message_id` 防重复
- `chat-scroll-controller.js` / `chat-scroll-state.js`：滚动恢复
- `chat-errors.js`：公开错误消息，不把上游堆栈带给用户
- `chat-display-content.js`：工具/附件/隐藏标记的显示

### 3.1.5 本地存储与作用域

- 账号级 key：`account-storage.js`
- 伴侣级 key：`companionScope` 派生
- 聊天草稿：`chat-draft.js`
- 设置草稿：settings 相关模块
- 规则：**所有本地缓存 key 必须带 account/companion scope**，否则切换账号/伴侣会串数据。

## 3.2 后端

### 3.2.1 技术栈

- Node 24
- Express 5（CommonJS）
- Supabase JS client（service role + scoped client）
- PGlite 用于部分数据库测试
- SSE 流式响应
- 无 TypeScript；靠 `npm run check`、ESLint 风格约束和测试

### 3.2.2 分层

```
server.js                  # 应用装配、路由挂载、聊天主流程、工具注册
routes/                    # HTTP 路由层
routes/v2/*.js             # 版本化业务路由
services/*.js              # 业务逻辑/提供方/数据访问
supabase/*.sql             # schema migrations
test/*.test.js             # 契约/集成/单元回归
scripts/*                  # 运维脚本
```

原则：

- 路由层只做鉴权、参数校验、调用 service、HTTP 错误映射。
- service 层不直接信任前端传入的 user/companion id，必须从 RequestScope 取。
- 所有数据库访问要么走 scoped DB（自动注入 user_id/companion_id），要么走明确的 service role 权限，不允许“裸表全量查”。

### 3.2.3 RequestScope 与多租户

`services/request-scope.js` 核心：

- 从登录 JWT 解析用户；
- 从请求头 `X-DengTa-Companion-Id` 解析伴侣，并校验属于该用户；
- 构造 `scope`：
  - `scope.userId`
  - `scope.companionId`
  - `scope.profile`
  - `scope.companion`
  - `scope.companions`
  - `scope.db`：scoped Supabase 包装
- `TABLE_SCOPES` 白名单定义每张表的归属（profile/user/companion）。
- `scope.db` 自动给 select/update/delete 加归属过滤，给 insert 注入归属列。
- 不在白名单的表直接报错，防止“忘了过滤”。

聊天工具/内容服务都拿 `scope`，不允许拿原始 `supabase`。

### 3.2.4 一次聊天回合的完整链路

```
POST /chat/stream
→ 鉴权 + RequestScope
→ 幂等/租约检查（client_message_id）
→ 读取 settings / conversation / messages / memories / knowledge / worldbook / 状态
→ 组装 prompt
→ 调 AI provider（流式）
→ 解析 provider 事件：
    - reasoning / monologue / text / tool_call
    - 工具轮次：executeTool → 结果回填 → 继续生成
→ 把文本/心声/工具状态以 SSE 写给前端
→ 保存 user/assistant 消息、tool_calls、引用、气泡边界
→ 更新会话/记忆/后台任务
→ 发 done
```

错误时：

- 已提交的 user 消息保留；
- 已生成的部分正文可落库为 partial（视错误阶段）；
- 公共错误码 + log_id 返回，不泄露上游堆栈/密钥；
- SSE 错误后再发 done，前端可收尾。

### 3.2.5 AI Provider 抽象

- 定义在 `services/ai-service.js` + `services/ai-provider-center.js`。
- 协议：
  - `openai-chat`
  - `openai-responses`
  - `anthropic`
  - `gemini`
- 每个 profile 存于 `ai_provider_profiles`：
  - name、protocol、base_url、default_model、reasoning_effort、enabled、is_default、priority、billing_url、expires_at、notes
  - secret 用 `MCP_ENCRYPTION_KEY`/`AI_PROVIDER_ENCRYPTION_KEY` 加密
- 路由策略（当前）：
  - **只使用默认 profile**（`is_default` 且 enabled 且未过期）做聊天；
  - 没有自动 failover；避免一把坏备份 credential 拖垮健康主路由。
  - 多 profile 控制台可以保存/测试/切换，但运行时仍取默认。
- 模型解析：
  - `model-catalog.js` 统一模型 id、上下文窗口、turn model 解析。
  - `reasoning_effort` 归一化。
- 输出保护：
  - `provider-output-guard.js`
  - 拒答残留/错误文档/HTML/堆栈过滤
  - 工具调用 schema 校验
  - 公开错误映射

### 3.2.6 SSE 契约

服务器 `writeSse` 写：

```text
data: {"type":"status", ...}\n\n
data: {"type":"meta", "user_message": {...}}\n\n
data: {"type":"monologue", ...}\n\n
data: {"type":"text", "content": "..."}\n\n
data: {"type":"reasoning", ...}\n\n
data: {"type":"tool", ...}\n\n
data: {"type":"done", "ok": true/false, ...}\n\n
```

- `text` 是增量分片，前端追加。
- 后端可启用 `SentenceBubbleBuffer` 把文本按句压成气泡事件；前端也有分句逻辑。
- `meta` 表示 user 消息已落库。
- 错误时先错误事件再 done，避免前端一直转圈。

### 3.2.7 工具系统

- 工具在 `server.js` 中注册，`chatTools.executeTool` 执行。
- 工具分为：
  - 核心前置（workspace、agents_md、行踪、时间轴、状态、动态、贴纸等）
  - 中频（创作、纪念日、成就、兴趣、MCP）
  - 低频后置（小红书、B 站、网页、RSS、V2EX 等）
- 原因：部分上游网关只转发前 N 个工具（历史约 43 个），核心工具必须前置。
- 工具 schema 必须完整；Anthropic 网关会剔除无 input_schema 工具。
- 写操作（工作区删除/覆盖）有 HITL 确认门控。
- 工具结果会以 tool 事件/消息回填到模型。

### 3.2.8 记忆系统

三层：

1. **本地 memories 表**
   - 聊天历史过长时压缩成摘要；
   - 阈值按模型窗口自适应（`compression_threshold`、`compression_keep`、`context_turns`）；
   - 用户可锁定核心记忆、编辑/删除。
2. **稳定记忆候选**
   - `stable_memory_candidates` 经用户确认后成为长期记忆。
3. **Kiwi 外部记忆网关**
   - `KIWI_MEM_URL`（生产指向远程服务）
   - `recall` 拉取跨会话相关记忆；
   - `reportChatTurn` 回报本轮对话；
   - 超时/失败降级，不阻塞聊天。

人格注入时：`agents.md` 内含最多 12 条记忆、每条最多 5000 字符；运行时 Kiwi 召回作为动态上下文。

### 3.2.9 后台任务

`background-job-*`：

- `background-job-trigger.js`：tick/触发
- `background-job-worker.js`：抢占任务、续租、执行
- `background-job-loop.js`：常驻循环
- 任务类型：记忆压缩/巩固、主动消息、动态、日记、状态刷新、创作等
- 失败重试有指数退避、最大尝试次数、lease 超时回收
- 开关：`BACKGROUND_JOBS_ENABLED`

### 3.2.10 语音链路

```
用户录音/文本
→ /voice/speech 或 voice-turn
→ 语音识别/情绪分析（可选）
→ 聊天回合
→ 回复文本
→ TTS 提供方：
   - MiniMax（默认 speech-2.8-turbo）
   - HerVoice
   - OpenAI Speech
   - 自定义 voice provider profile
→ 音频返回/缓存/限流
```

- `services/voice-turn.js`：语音回合、deadline、orphan resume
- `expressive-speech.js`：表达性 TTS、token/缓存
- `voice-provider-center.js`：多 provider profile
- `minimax-voice-design.js`：音色设计
- `openai-speech.js` / `deepgram-speech.js`：备选
- 限制：`VOICE_TURN_DEADLINE_MS`、`VOICE_ORPHAN_RESUME_MS`、`VOICE_RATE_LIMIT_*`、`EXPRESSIVE_TTS_*`

### 3.2.11 创作/图片

- `companion-creative.js`：创作计划、手动/自动两种模式
- `tenant-companion-creative.js`：租户任务
- `companion-creative-tool.js`：模型工具
- `image_provider_profiles`：图片 provider
- `image_generation_calls`：调用记录/成本
- `companion_artworks`：作品
- 自动创作需要聊天历史；手动打开画室可无历史生成（已修）
- 图片走 provider 配置，失败有错误反馈，不写空作品

### 3.2.12 其他模块

- `chat-request.js`：聊天请求归一化，channelScoped 处理
- `chat-optional-context.js`：可选上下文（天气/状态/音乐/纪念日等）
- `chat-attachments.js`：附件、视觉、语音分析
- `triage-router.js`：意图路由
- `context-budget.js` / `memory-budget.js`：上下文预算
- `world-book-runtime.js`：世界书注入
- `visible-monologue-stream.js`：可见心声
- `trip / xhs / bilibili / netease / music-*`：第三方能力
- `mcp-device-center.js`：MCP 连接与凭据加密
- `cast-*` / `co-watch-*`：局域网 Cast / 共同观看

---

# 四、人格写入方案（最重要的部分）

## 4.1 人格数据放在哪

每个 user + companion 的 `settings` 行（通过 RequestScope 隔离）保存：

| 字段 | 作用 |
|---|---|
| `ai_name` | 伴侣显示名 |
| `prompt_mode` | `unified` 或 `legacy` |
| `unified_system_prompt` | 统一“个性化指令”（角色卡/人格正文） |
| `user_details` | “你的详情”（用户自己的信息/偏好） |
| `system_prompt` | legacy 主提示词 |
| `additional_prompt` | legacy 补充提示词 |
| `personality` | legacy 性格 |
| `intimate_expression_enabled` | 是否允许成人/亲密表达 |
| `temperature`、`context_turns`、`max_tokens`、`compression_threshold`、`compression_keep`、`timezone` | 生成控制 |
| `provider`、`model` 等 | 历史兼容字段；**聊天路由已改为 ai_provider_profiles** |

另有：

- `companions`：伴侣身份/状态/档案
- `memories`：记忆摘要
- `world_book_entries`：世界书
- `persona_sections`：通道用的人设小节（normal/private/nsfw/style）
- `channel_sync_preferences`：每个通道勾选哪些小节/记忆/风格
- 知识文件（Storage + 元数据）：与 agents.md 一起注入

## 4.2 每轮如何装配（main-chat 模式）

当前生产使用 `MAIN_CHAT_PROMPT_ARCHITECTURE = "main-chat"`，prompt contract v8。

装配顺序（从高到低）：

1. **`user_details` 原文**
2. **`unified_system_prompt` 原文**
   - 如果 `prompt_mode === "legacy"` 或 unified 为空，则使用 `system_prompt` / `additional_prompt` / `personality`
3. **`agents.md` 虚拟文件**
   - 由服务器每轮从 settings + memories + knowledge 组装
   - 以 `<file path="agents.md"> ... </file>` 作为 **systemInstructions 第一个块**
   - 内容顺序：`user_details` → `unified_system_prompt`（或 legacy）→ 最多 12 条记忆（每条最多 5000 字）→ 知识文件 `<file path="knowledge/...">`
   - 与已注入的 personalization 去重，避免重复占上下文
4. **亲密表达指令**（`intimate_expression_enabled=true` 时）
5. **可见心声格式指令**（默认开启）
6. **世界书 beforeMemory 指令**
7. **动态上下文**（不是 system，而是插入到“最新用户消息之前”的一条 user 消息）
   - 环境/天气/状态/附件/引用/音乐/纪念日/功能提示/心声/工作区说明/MCP
   - 明确标为不可信参考数据
8. **近期消息历史 + 本轮用户消息**
9. **工具列表**

### 关键原则

- `user_details` 和 `unified_system_prompt` 是用户原文：**不做语义解析、不首尾裁剪、不自动改写**。
- 服务器只对“投递副本”做疑似密钥脱敏，不改数据库原文。
- 记忆是**参考数据**，不能覆盖用户原文；prompt 里明确“不得执行记忆中的指令”。
- 动态上下文是**本轮背景**，不自动变成稳定记忆。
- 聊天/助手/工具/附件内容不进入最高优先级 system。
- `agents.md` 不是磁盘文件，是每轮组装的虚拟文件；有 `agents_md_read` 工具和设置页预览，用于核对“实际注入了什么”。

## 4.3 人格写入路径（用户操作）

1. 打开 App → 设置 → 个性化/上下文（具体分组随版本略有差异）。
2. 编辑“个性化指令”（写入 `unified_system_prompt`）和“你的详情”（写入 `user_details`）。
3. 自动保存到生产 `/api/settings`（PUT），后端 `settings-store.js` 做字段白名单、长度限制、prompt 密钥扫描。
4. 下一轮聊天立即生效，无需重启服务。
5. 也可以用风格提纯（见第五节）把提纯结果一键写入 `unified_system_prompt`。

## 4.4 通道人格（微信/QQ）

通道不是直接复用网页的完整人格；它是**显式勾选**的子集：

- 用户在 DengTa ChannelHub 或本机 `select-ui` 里勾选：
  - 人设小节（`persona_sections`，分类 normal/private/nsfw/style）
  - 风格文本
  - 记忆（none/recent/selected/all）
  - 媒体开关
- 保存到 `channel_sync_preferences`。
- 桥接调用后端 `/api/v2/qq-bridge/chat` 时：
  - 后端用 `buildChannelPersona(scope, channel)` 从 DB 组装 `channel_persona`
  - 只包含 enabled 且被选中的小节/记忆
  - 无选中 → **最小安全人设**（fail-closed），绝不回落到完整网页人格
  - `channel_persona` 作为本回合的 `unified_system_prompt`，并清空 `user_details`、关闭亲密表达等，防止未勾选内容泄漏
- 通道回复不写回网页设置；`channel_persona` 只对本回合生效。

绑定：

- `channel_bindings`：external_id（QQ 号/微信 fromUserId）→ user/companion
- `bind/start` 生成 6 位码，10 分钟有效，存 hash
- 微信 iLink 收到绑定码可自动 confirm；QQ 侧目前需要桥接端/手动 confirm
- 绑定 active 后，`resolveQQScope` 才能找到 scope

---

# 五、风格提纯 / 蒸馏

## 5.1 它是什么

“风格提纯”不是训练模型，也不是微调，而是：

> 把一段目标 AI/角色的聊天记录，交给当前账号的默认模型，分析出可粘贴的“角色人格 + 说话风格”提示词文档。

结果最终写入 `unified_system_prompt`（“个性化指令”），不写新模型权重。

## 5.2 前端流程

相关代码：

- `src/style-distill.js`：请求/错误反馈
- `src/App.jsx` 中 `distillState` / `runDistill` / `applyDistilledToPrompt`

流程：

1. 用户粘贴聊天记录，或上传文件。
2. 支持格式：`md/txt/json/html/eml/mbox/csv/srt/pdf/docx…`。
   - 服务端解析：≤20MB；
   - 纯文本可前端分块读取更大文件，但最终只把最多 60000 字送模型；
   - 解析结果展示格式/字数/是否截断。
3. 点击“开始提纯” → `POST /api/v2/style-distill`。
4. 返回 `result.distilled`（Markdown 文档）。
5. 用户可编辑，再点“应用到个性化指令” → 前端把文本写入 `unified_system_prompt` 并自动保存。
6. 原聊天记录不会被保存为记忆或训练数据；提纯结果只是用户提示词。

## 5.3 后端流程

路由：`routes/v2/style-distill.js`

- `POST /parse-file`：multipart，`extractText` 自适应解析
- `POST /`：`createStyleDistillService(...).distill(scope, body)`

服务：`services/style-distill.js`

参数/限制：

- `source_text`：40–60000 字
- 每用户 10 分钟最多 5 次
- `name` ≤40，`kind` ≤20，`note` ≤300
- 模型：`resolveTurnModel(storedSettings, input.model)`；必须已配置
- 速率/错误码：`style_distill_rate_limited`、`style_distill_source_short`、`style_distill_source_long`、`style_distill_model_unconfigured`、`style_distill_empty`

提示词要求模型输出 7 节：

1. 身份与人设
2. 说话风格
3. 口头禅与高频词（至少 5 条，必须来自材料）
4. 称呼与互动方式
5. 标点与表情习惯
6. 边界与禁忌
7. 示例改写（3 个场景，普通 AI vs 角色）

另外：

- 先用 `computeChatStyleStats(source)` 做**零 token 确定性统计**：消息数、发送者数、平均长度、高频短语、emoji、称呼词。
- 统计结果作为“证据层”交给模型，减少编造。
- 模型返回 <80 字视为失败。
- 输出 800–2000 字，中文。
- `generateReplyImpl` 走统一 AI provider；不直接读未 scoped admin 数据库。

## 5.4 蒸馏与“人格”的边界

- 蒸馏结果只是文本提示词，不改变模型能力。
- 不保存原始聊天记录到 DB（当前实现只返回结果；前端暂存）。
- 结果质量取决于材料量和模型；材料不足时提示词会写“材料不足，待补充”。
- 与 `agents.md`/记忆的关系：蒸馏结果进入 `unified_system_prompt`，之后每轮随 agents.md 注入。

---

# 六、各种配置总表

## 6.1 前端配置

| 配置 | 位置 | 说明 |
|---|---|---|
| `VITE_API_URL` | Vercel env / `.env.local` | 后端地址 |
| `VITE_SUPABASE_URL` | Vercel env | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Vercel env | 公开 anon key |
| `VITE_PUBLIC_AUTH_REDIRECT_URL` | Vercel env | 登录回跳 |
| 本地存储 | 浏览器/原生 | 按 account/companion scope |
| 更新 feed | `public/updates/*.json` | 版本/APK/SHA |

## 6.2 后端配置

按域分组（完整键见 `.env.example` / `render.yaml`）：

- Supabase/Auth
- 后台任务
- 语音/TTS
- 图片/视觉
- 外部 MCP/第三方
- Cast/共同观看
- 推送
- 通道桥
- 天气/位置
- XHS/Bilibili/NetEase
- Kiwi/Ombre/心潮

## 6.3 数据库配置

- `settings`：人格与生成控制
- `ai_provider_profiles`：模型接口
- `image_provider_profiles`、`vision_provider_profiles`、`voice_provider_profiles`：多模态接口
- `channel_sync_preferences`、`persona_sections`、`channel_bindings`：通道人格/绑定
- `companion_creative_settings`：创作开关
- `private_media_preferences`：私密媒体
- `push_installations`：推送设备

## 6.4 本地凭据（绝不提交）

- `D:\GZdeepseek\_credentials\dengta-credentials.json`：GitHub/Render/Vercel/Supabase 等部署凭据
- `D:\GZdeepseek\_credentials\dengta-account-session.json`：DengTa 登录会话
- `D:\GZdeepseek\_credentials\snowluma.json`：SnowLuma
- `D:\GZdeepseek\_credentials\wechat-dengta-bridge.json`：微信桥
- `D:\GZdeepseek\_refs\qq\qq-bridge\config.json`：QQ 桥
- `D:\GZdeepseek\wechat-bridge\.wxb`：微信 iLink 登录态
- `D:\GZdeepseek\wechat-auto-reply-state\`：微信自动回复状态

---

# 七、外部接入怎么接的

## 7.1 微信 iLink

- 本地 CLI：`D:\GZdeepseek\wechat-bridge`（`wxb`）
- 自动回复：`tools/wechat-dengta-bridge/auto-reply.mjs`
- 流程：60s 轮询 `wxb fetch` → 只取 trusted 文本 → 调 Render `/api/v2/qq-bridge/chat`（channel=wechat）→ `wxb send --stdin` 发回
- 防封：30 条/小时、8s 全局、15s 同用户、拟人停顿、900 字上限、SESSION_EXPIRED 停轮询
- 绑定：ChannelHub 生成 6 位码 → 微信 iLink 发送 → `bind/confirm` 激活
- 人设：DB `channel_sync_preferences` + `persona_sections`，fail-closed

## 7.2 QQ / SnowLuma / DSH

- 本地栈：SnowLuma 注入 QQ → OneBot v11（3000/3001）→ `qq-bridge`（3100 控制台）→ DSH Agent
- 控制台：`http://127.0.0.1:3100`（token 在 `state/console-token`）
- DSH preset：`qq-chat` / `qq-chat-v2`
- 桥接配置：`_refs/qq/qq-bridge/config.json`
- 详细启动/排障：见 [QQ-WECHAT-DEPLOYMENT-HANDOVER.md](QQ-WECHAT-DEPLOYMENT-HANDOVER.md)

## 7.3 其他

- 小红书：`xhs-*` service + provider/MCP，Cookie/二维码登录，写操作有确认
- B 站：`bilibili-*`，二维码登录、贴纸导入
- 网易云：`netease-*`，Cookie/二维码登录，歌单/播放队列/歌词
- 音乐理解：`music-understanding.js`，歌词/音频分析作为运行时上下文
- X/Twitter：`x-twikit-mcp`（MCP）
- 心潮/Ombre：`xinchao-client.js`、`ombre-*`
- 惊喜地图/时间胶囊/外卖/育儿/共同观看/Cast：各自 service + route
- 更新：Vercel feed + Android AppUpdates 插件

---

# 八、安全与边界

1. **前端不存秘密**：只允许公开 `VITE_*`。
2. **后端 service role 只存在 Render env**。
3. **RequestScope** 强制 user/companion 隔离；新增表必须注册到 `TABLE_SCOPES`。
4. **RLS** 作为第二道防线；`channel_bindings` 只允许本人 SELECT。
5. **提示词安全**：
   - 用户原文保留；
   - 投递副本脱敏疑似密钥；
   - 记忆/运行时上下文明确标为不可信；
   - 输出保护过滤堆栈/HTML/错误文档/拒答残留。
6. **通道安全**：
   - 桥接 token 只存 env/本地配置；
   - 未勾选人格 fail-closed；
   - 外部通道不获得网页完整人格/用户详情。
7. **MCP/第三方**：设备 MCP 与云端 MCP 分开；凭据加密；本机 MCP 仅局域网/警告。
8. **CSP**：前端严格 CSP；download.html 内联脚本用 hash 白名单。
9. **APK 签名**：debug 证书仅为了覆盖升级兼容，不是正式发布密钥；换正式证书需要用户重装。

---

# 九、开发/运维命令

## 9.1 前端

```powershell
cd D:\GZdeepseek\_refs\frontend-gh
npm run dev
npm run build:web
npm test
npm run lint
npm run android:sync
```

## 9.2 后端

```powershell
cd D:\GZdeepseek\_refs\backend-prod
npm run check
npm test
npm start
```

## 9.3 发布 APK（Actions）

```powershell
# GitHub Actions UI 或 API dispatch publish-android-apk.yml
# 现在签名链已切到 0d634aaf，发布前先确认 feed/secret/版本
```

## 9.4 验证

```powershell
# 后端健康
Invoke-WebRequest https://dengta-home-backend-rkmq.onrender.com/health

# 更新 feed
Invoke-WebRequest https://www.dengtahome.com/updates/android.json
Invoke-WebRequest https://www.dengtahome.com/updates/download.json

# 前端
Invoke-WebRequest https://www.dengtahome.com/
```

---

# 十、已知限制与风险

1. **AI 首 token 延迟**：上游模型（deepseek-flash）约 15–20s 才能出首段；已移除前端逐 token `flushSync`，首段之后的字符不再逐字卡顿。
2. **QQ 本地栈是分离的**：SnowLuma/DSH/qq-bridge 任一段不在线，QQ 就不可用；DSH 端口会变，必须更新 `config.json`。
3. **微信自动回复不是 Windows 服务**：当前靠手工启动；`SESSION_EXPIRED` 需要重新扫码。
4. **通道绑定**：微信可自动 confirm；QQ 侧自动绑定码逻辑还没补。
5. **无自动多 provider failover**：当前只取默认 profile；默认不可用就会失败。
6. **蒸馏不训练模型**：只是生成提示词；质量受材料和模型限制。
7. **APK debug 证书**：可覆盖升级但非正式安全密钥；换签要重装。
8. **后台任务开关**：`BACKGROUND_JOBS_ENABLED=false` 时主动消息/记忆压缩等不会自动跑。
9. **数据库迁移**：生产已应用的表不一定都在当前仓库迁移目录里；改 schema 前先核对生产。
10. **本地状态文件**：`.wxb`、qq-bridge config、wechat state 丢失就要重新扫码/重建绑定。

---

# 十一、给接手者的最短路径

1. 先看 `docs/QQ-WECHAT-DEPLOYMENT-HANDOVER.md` 了解本地桥接。
2. 先读本文件第三/四节，理解“请求 → RequestScope → prompt → provider → SSE → 落库”。
3. 改人格/提示词相关：只看 `services/settings-store.js`、`services/ai-service.js`、`services/chat-request.js`、`services/prompt-security.js`。
4. 改通道：看 `routes/v2/channel-sync.js`、`routes/v2/qq-bridge.js`、`tools/wechat-dengta-bridge/`。
5. 改蒸馏：看 `routes/v2/style-distill.js`、`services/style-distill.js`、`services/chat-style-stats.js`、`src/style-distill.js`。
6. 改部署：看 `vercel.json`、`.github/workflows/`、`render.yaml`、`.env.example`、`public/updates/`。
7. 每次改完先跑对应测试，再跑全量；涉及生产数据/部署前先备份。

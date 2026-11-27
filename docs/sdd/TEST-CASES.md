# DengTa（灯塔）SDD 可执行验收测例库（Test Cases）

> **方法论对应**：对齐 PMGao SDD 实践中的 `docs/测例.md` + `harness/specs/`。每条测例必须有明确的前置条件、操作步骤、可观察预期结果及对应自动化脚本，拒绝主观“感觉还行”。  
> **配套主规范**：[DENGTA-SDD-SPEC.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/DENGTA-SDD-SPEC.md) · [REQUIREMENTS-FORM.md](file:///D:/GZdeepseek/dengta-home/docs/sdd/REQUIREMENTS-FORM.md)

---

## 1. 聊天记录极速加载（`SPEC-CHAT-SPEED`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-SPEED-01` | L0 同步秒开冷启动 | 已登录加载过聊天后关闭重启应用 | 首帧 `0ms` 直接显示最近 20 个会话摘要与当前会话最新 25 条消息，无白屏转圈，随后静默对齐最新远端数据 | `frontend-gh/test/music-studio-qr-and-history.test.js` |
| `TC-SPEED-02` | `?after=` 零冗余增量同步 | 已完整加载某会话后切换至其他会话再切回 | 仅请求 `/api/v2/sessions/:id/messages?after=<lastIso>`；无新消息返回 `{ incremental: true, messages: [] }`，界面不闪烁不跳滚动条 | `backend-prod/test/v2-core-routes.test.js` + `music-studio-qr-and-history.test.js` |
| `TC-SPEED-03` | 侧边栏悬停/按压预热 & 80 行 DOM 复位 | 展开某长会话 300 条后，悬停并点击另一会话 | 悬停/按压即预热目标会话，切入后 `<ChatTranscript>` 复位至 80 条轻量窗口 | `frontend-gh/test/music-studio-qr-and-history.test.js` |
| `TC-SPEED-04` | 多账号/多伴侣缓存隔离 | 切换账号或清空当前伴侣 | L0 快照自动清除，绝不串显上一账号或伴侣的聊天记录 | `frontend-gh/test/startup-scope-lifecycle.test.js` |

## 2. 音乐工作室手机扫码（`SPEC-MUSIC-STUDIO`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-MUSIC-01` | 手机未登录首屏直出二维码 | Android 15 App 打开「音乐工作室」 | 默认进入直连工作台并立即展示清晰白边二维码，顶部不裁切，无 `open this player with its access link` 白屏 | `frontend-gh/test/music-studio-qr-and-history.test.js` |
| `TC-MUSIC-02` | 保存相册 & 跳转网易云 | 点击「保存二维码到相册」与「打开网易云 App」 | 零权限弹窗写入 `Pictures/DengTa` 并成功拉起网易云客户端 | `DengTaFileBridge` + 真机复核 |
| `TC-MUSIC-03` | 切回前台捕获登录态 | 在网易云确认登录后切回灯塔 | `0ms / 1.5s / 4s` 自动补查，3 分钟幂等缓存确保 `803` 不丢失，立即进入歌单工作台 | `backend-prod/test/netease-qr-login.test.js` |
| `TC-MUSIC-04` | 扫码过程禁止偷换码 | 停留二维码页超过 120 秒 | 不自动更换 `qrKey`，仅用户点击「换一张」才刷新二维码 | `frontend-gh/test/music-studio-qr-and-history.test.js` |

## 3. Chronos 严格时间与自动唤醒（`SPEC-CHRONOS`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-CHRONOS-01` | 隔夜首轮真实时间差 | 距上一条消息超过 8 小时后发送新消息 | 服务端排除刚入库的本轮用户消息，时间差正确注入「约 8 小时/跨夜」，绝不误判为「刚刚」 | `backend-prod/test/chronos-time-and-wake.test.js` |
| `TC-CHRONOS-02` | 凌晨跨天锚点准确性 | 在本地时间 `00:05–07:55` 计算昨天/今天/明天 | 与用户 IANA 时区完全一致，无 UTC 跨天错位 | `backend-prod/test/chronos-time-and-wake.test.js` |
| `TC-CHRONOS-03` | 自定义时区与时钟偏差告警 | 切换非预设 IANA 时区或模拟客户端时间快/慢 120s | 下拉正确展示自定义时区；偏差 `>=90s` 触发清晰提醒 | `frontend-gh/test/chronos-wake-center.test.js` |
| `TC-CHRONOS-04` | 沉默轻唤 `2×` 指数退避上限 | 用户连续不回复沉默轻唤消息 | 第 1 次按设定间隔，第 2 次加倍，连续 2 条未读后自动暂停（不影响显式闹钟） | `backend-prod/test/chronos-time-and-wake.test.js` |
| `TC-CHRONOS-05` | 对话调度与准秒级前台触发 | 聊天说「2 分钟后提醒我喝水」或面板点「`+10分`」 | AI 调 `manage_wake_schedule` 落库，`dengta:chronos-refresh` 即刻同步，`<45s` 内精准对齐目标秒触发 | `chronos-time-and-wake.test.js` + `chronos-wake-center.test.js` |
| `TC-CHRONOS-06` | 静默窗口与离线补发宽限 | 闹钟落入免打扰时段或离线延迟在宽限内恢复 | 静默期不调 LLM 自动顺延；宽限内补发且幂等去重不重复发 | `backend-prod/test/chronos-time-and-wake.test.js` |

## 4. 小棉花 3D 博美犬可见性（`SPEC-COTTON-PET`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-COTTON-01` | 默认标准 PBR 立体清晰度 | 打开小棉花小屋并点击「打开小屋」 | 深雾松绿背景上白毛博美轮廓分明，下颌/胸毛/爪底 AO 阴影、耳廓淡粉、脸颊腮红、五官与手绘细描边清晰可见，控制台 0 WebGL 报错 | `frontend-gh/test/cotton-course-upgrades.test.js` + WebGL 实拍 |
| `TC-COTTON-02` | MToon 卡通着色不泛白 | 点击「MToon 卡通」切换 | 自动切至暮光紫底色，4 阶卡通色带清晰分层，不出现浅白糊平 | `cotton-course-upgrades.test.js` + WebGL 实拍 |
| `TC-COTTON-03` | 舞台底色切换与大头/表情同步 | 点击「底色」切换暖咖绒/暮色蓝并开启「大头模式」/切换表情 | 舞台渐变流畅切换，蒙皮后法线描边紧贴轮廓无头部错位 | `cotton-course-upgrades.test.js` + `cotton-runtime.test.js` |
| `TC-COTTON-04` | 彩色壁纸与夜间玻璃控制卡可读性 | 在彩色壁纸或 Night Glass 主题打开小棉花页及聊天悬浮桌宠 | 顶部与右侧磨砂卡片高对比易读；悬浮桌宠在亮底聊天页同样边缘清晰 | `cotton-course-upgrades.test.js` + `cotton-dock.test.js` |

## 5. 侧边栏布局与全程实时多模态感知（`SPEC-SIDEBAR-LAYOUT` / `SPEC-MULTIMODAL-PERCEPTION`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-SIDEBAR-01` | 底部紧凑 Dock 与原生隐藏下载 | 手机与桌面端展开侧边栏 | 底部单行 `~46px`；原生 Android 隐藏「下载安装包」 | `frontend-gh/test/sidebar-and-perception.test.js` |
| `TC-SIDEBAR-02` | 玩法列表全景 & 粘性搜索不透字 | 滚动玩法列表并点击「最近对话」折叠 | 玩法列表无 `52vh` 截断，搜索框不透明不透字，折叠按钮单行不挤压 | `frontend-gh/test/sidebar-and-perception.test.js` |
| `TC-PERCEPT-01` | 全程跨页感知与聊天栏防碰撞 | 开启屏幕/镜头/应用感知/常开麦后跨页切回聊天 | 媒体流不中断；操作栏位于输入框上方单行胶囊，不与顶栏灵动岛重叠 | `frontend-gh/test/sidebar-and-perception.test.js` |
| `TC-PERCEPT-02` | 后端感知注入与一键全停 | 开启感知发消息后点击「一键全停」 | 后端注入 `[实时多模态感知]`；点击全停后立即释放全部采集流 | `backend-prod/test/live-perception-context.test.js` |

## 6. 提示词管线、自定义 API 与设置精修（`SPEC-PROMPT-PIPELINE`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-PROMPT-01` | `agents.md` 1:1 原文契约 | 配置自定义人设并触发生成 | `<file path="agents.md">` 置于系统层首位且正文与用户输入 1:1 一致 | `backend-prod/test/user-agents-md.test.js` |
| `TC-PROMPT-02` | 四协议真实 KV-Cache 遥测 | 分别用 DeepSeek/OpenAI/Anthropic/Gemini 回包测试 | 正确解析并聚合 `cached_input_tokens` 与 `cache_hit_ratio` 并回显前端回执 | `backend-prod/test/prompt-pipeline-cache.test.js` |
| `TC-PROMPT-03` | API 控制台智能识别与测速 | 粘贴不同厂商 Base URL 并点击检测 | 协议不匹配时给出「一键切换协议」提示，检测返回 `latency_ms` 徽章 | `frontend-gh/test/ai-provider-center.test.js` |
| `TC-SETTINGS-01` | 设置面板双主题、SVG 与 `18px` 复选框 | 切换 Day / Night Glass 与减少动画 | SVG 锐利、复选框锁定 `18px`、Night Glass 高对比、`settings-save-lifecycle` 25/25 绿灯 | `prompt-and-settings-polish.test.js` + `settings-save-lifecycle.test.js` |

## 7. SDD 规范治理与合规门禁（`SPEC-SDD-GOVERNANCE` / `SPEC-MIKA-PHONE-CONTROL`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-SDD-01` | SDD 文档双向可追溯性 | 运行 `node D:\GZdeepseek\dengta-home\tools\verify-sdd-compliance.mjs` | 主规范中全部 `SPEC-*` ID 在需求表单、测例库与验收清单中 100% 匹配无孤儿条目 | `tools/verify-sdd-compliance.mjs` |
| `TC-SDD-02` | 发布清单与实测 APK 一致性 | 运行 `verify-sdd-compliance.mjs` | `android.json` / `download.json` / `download.html` / `vercel.json` / `DENGTA-SDD-SPEC.md` / `CHANGELOG.md` 版本号及实盘 APK `size` 与 `sha256` 100% 一致 | `tools/verify-sdd-compliance.mjs` |
| `TC-SDD-03` | 红线防回归与零密钥扫描 | 运行 `verify-sdd-compliance.mjs` | 无高危密钥模式泄露、无 `#f3dccb` 小棉花白桃背景回归、存在 `18px` 复选框锁与 `user-agents-md` 契约 | `tools/verify-sdd-compliance.mjs` |

## 8. AI 视界与 B站/抖音/小红书多平台接入向导（`SPEC-CREATOR-ONBOARDING`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-CREATOR-01` | MCP 插件中心与小红书入口准确跳转 | 分别在 AI 视界 / X / 剪映 / 一起看点击「MCP 插件中心」，并在接入向导点击「打开小红书登录与发布」 | 前者准确打开「设置 → 设备与共看 (`devices`)」并滚动至 `#mcp-device-center`（绝不误开「模型与服务」）；后者准确打开「设置 → 成就与新玩法 (`fun`)」并聚焦 `#xhs-login-section` | `frontend-gh/test/creator-world-onboarding.test.js` |
| `TC-CREATOR-02` | 本机/局域网 18088 网关直连与真实状态 | 在「AI 视界·创作者 → 接入向导」填入 `http://127.0.0.1:18088` 或局域网 IP 点「测试并连接本机网关」 | 连通后持久化共用地址并切换「本机创作者网关在线」，立即刷新 B 站实时热点与 FFmpeg 视频；云端 404 且本机未启动时如实显示离线策划模式，不虚报在线 | `frontend-gh/test/creator-world-onboarding.test.js` |
| `TC-CREATOR-03` | MCP 模板 Bearer 默认与 HTTPS 陷阱提示 | 在 MCP 插件中心点击 B 站/抖音/视频工坊「使用此应用」并检查 AI 视界文案 | 授权方式自动设为 `bearer` 并平滑滚动到表单；AI 视界明确区分本机直连与云端公网 `https://.../mcp`（附 `cloudflared tunnel` 命令），不诱导直接填 `127.0.0.1` 进云端 MCP 表单 | `creator-world-onboarding.test.js` + `mcp-device-center.test.js` |

## 9. QQ 机器人状态/绑定码/人设同步铁证与 AI 工作台滚动（`SPEC-QQ-SYNC-AND-SCROLL`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-QQSYNC-01` | QQ 6 位绑定码拦截与 `/同步状态` 自检 | 向在线 QQ 云机器人发送 `324116` 与 `/同步状态` | 两条均由服务端直接处理不触发 LLM；自动尝试核销绑定码并回执伴侣名、8 位指纹、人设字数、记忆与最近对话条数 | `backend-prod/test/qq-cloud.test.js` |
| `TC-QQSYNC-02` | 完整人设 + `user_details` + `memory_limit=0` 兜底 + 最近对话衔接 | 配置 `qq_include_persona_prompt=true`、`memory_mode=recent`、`memory_limit=0` 并调用 `buildChannelPersonaDetail` | `is_fallback_generic=false`，同时包含核心人设、主人称呼、已确认记忆与最近对话，返回合法 8 位指纹 | `backend-prod/test/qq-bridge.test.js` |
| `TC-QQSYNC-03` | QQ 高对比状态横幅、同步证据卡与 AI 工作台垂直滚动 | 打开「QQ」通道与「AI 工作台·剪映」 | QQ 页首帧拉取 `/api/v2/qq-cloud` + `/api/v2/channel-sync/preview` 展示绿/琥珀/红呼吸灯横幅与证据卡；`LocalAgentStudio` 使用 `feature-page` + `overflow-y: auto` + `touch-action: pan-y` 顺滑上下滚动 | `channel-hub-usability.test.js` + `local-agent-studio.test.js` |

## 10. X / Twitter 真实连接态检测与防误判（`SPEC-X-HUB-HONEST-STATE`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-XHUB-01` | 杜绝名称含字母 x 误匹配与未启用/离线虚报已连接 | 传入含字母 `x` 的非 X 连接、未启用 X 连接、离线错误连接、0 工具连接与健康连接调用 `resolveXConnectionState` | 非 X 连接返回 `none`；未启用返回 `disabled`；错误/0 工具返回 `disconnected`；仅启用+已连通+含 X 工具才返回 `connected` | `frontend-gh/test/x-hub-status.test.js` |
| `TC-XHUB-02` | 实测连通性、一键启用与失败自动翻红 | 检查 `XHub.jsx` 状态徽章与交互逻辑 | 无硬编码「MCP 网关在线」与 `/\bx\b/`；提供「实测连通性」与「一键启用并实测连通」，遇到 409/502/504 立即切回离线/未启用态 | `frontend-gh/test/x-hub-status.test.js` |

## 11. 涂鸦画室专业提示词工程与多模型调用适配（`SPEC-CREATIVE-PROMPT-PRO`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-CREATIVE-01` | 废话与陈旧堆词清洗、短提示 7 层补全与 V2 加密封套兼容 | 调用 `sanitizeVisualPrompt`、`compileCreativePrompt`、`encodeArtworkPromptPayload` / `decodeArtworkPromptPayload` | 剥离「请帮我画一张」与 `masterpiece/best quality/8k`；短提示自动注入类型构图与画风媒介指导及负向避坑词；旧明文与新 V2 封套双向无损解码 | `backend-prod/test/creative-prompt-engineer.test.js` |
| `TC-CREATIVE-02` | 多模型家族协议适配与 400/422 渐进降级重试 | 针对 `gpt-image-1`、`dall-e-3`、`Kwai-Kolors/Kolors`、`FLUX.1-schnell`、`test-image` 验证 `buildImageGenerationRequests` 与 `fetchGeneratedImage` | `gpt-image-1` 跳过无效 `response_format` 并映射 `1024x1536` + `quality=high`；SiliconFlow 使用 `image_size` + `negative_prompt`；遇到 400/422 逐级剥离可选字段重试成功 | `backend-prod/test/creative-prompt-engineer.test.js` + `companion-creative.test.js` |
| `TC-CREATIVE-03` | 聊天 `create_artwork` 专业槽位与画室首屏零扣费兼容 | 调用 `createCompanionCreativeToolExecutor` 传精简/完整槽位；渲染 `CompanionArtStudio` 核对首屏请求 | 工具自动按 `kind` 匹配默认画幅并编译高质量提示词；打开涂鸦画室仍仅发 2 个 GET（`/status`、`/artworks`），无任何自动生图调用 | `companion-creative-tool.test.js` + `art-studio.component.test.js` |

## 12. 聊天按钮收纳、持久感知/Siri 呼唤/截屏依据、弹字引用修复与灵动岛 CD 封面（`SPEC-PERCEPTION-UX-AND-DANZI`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-PERCEPT-04` | Siri 风格语音呼唤、智能屏幕变化检测与本地缩略图隔离 | 调用 `parseWakeWordTranscript`、`computeLumaChangePercent`、`shouldTriggerAutoScreenCapture`、`registerScreenEvidence` 与 `serializeEvidenceForPayload` | 正确识别「嗨灯塔/Hey DengTa/伴侣名」单气命令与纯唤醒；切换应用或变化 `>=18%` 触发截屏、冷却期内抑制重复；序列化载荷不含本地缩略图 base64 | `frontend-gh/test/sidebar-and-perception.test.js` |
| `TC-PERCEPT-05` | 后端摄像头主动观察引导、截屏时间依据注入与 `perception_evidence` 透传 | 调用 `normalizeEnvironmentContext`、`buildEnvironmentRuntimeContext` 与 `publicMessage` 传入 `screen_evidence`、`wake_word_triggered` | 提示词自动注入【摄像头实时画面互动指引】【屏幕变化截屏依据】（含时间点/应用/变化%）与【语音呼唤】；`publicMessage` 安全透传 `tool_calls.perception_evidence` | `backend-prod/test/live-perception-context.test.js` |
| `TC-PERCEPT-06` | 手机端「弹字」无头像回退与三落点切换 | 在无可见 `.message-avatar`（`width=0`）环境下点击「弹字 → 文字弹弹」 | 自动无缝回退对 `.message-content` 播放弹性动效并触发 `onAvatarHit({ target: "bubble" })`，不再报错 `avatar_not_found`；提供第三落点「消息文字」 | `frontend-gh/test/chat-text-impact.component.test.js` |
| `TC-ISLAND-01` | 灵动岛三栏防裁切布局、CD 专辑封面渲染与网易云 HTTPS 封面归一化 | 渲染 `CompanionStatus` 播放中状态（传入 `http://p1.music.126.net/...` 封面）并校验 `normalizeNeteaseCoverUrl` | CD 圆盘内渲染 `<img class="sun-glass-now-playing-art">` 且自动升级 `https://`；自动过滤网易云空占位封面；三栏布局歌名、歌手与三枚按钮完整不裁切 | `dynamic-island.test.js` + `live-perception-context.test.js` |

## 13. 小棉花 3D 重塑、麦克风修复、彩虹胶囊去杂去闪与真人喜怒哀乐情绪系统（`SPEC-COTTON-V2-AND-EMOTION`）

| 测例 ID | 场景 | 操作步骤 | 可观察预期结果 | 自动化映射 |
|---|---|---|---|---|
| `TC-EMOTION-01` | 健康人类元气基线（70–80%、永不默认归零）与旧缓存自愈 | 调用 `createDefaultCompanionStatus`、`createResetCompanionStatus`、`readCompanionStatus`（含 0% 旧缓存）与 `settleAmbientCompanionEnergy` | 默认与重置元气均位于 `70–80` 之间、心跳正常；旧 0% 缓存读取自动恢复至 `76`；持续闲置不低于健康静息下限 `56` | `human-emotion-and-cotton-v2.test.js` + `backend-prod/test/companion-status.test.js` |
| `TC-EMOTION-02` | 真人感「喜怒哀乐」象限、情境化哄人动作、彩虹胶囊双标签与位置简繁归一 | 验证 `resolveHumanEmotionQuadrant`、`describeRecoveryIntent`、`localCompanionInteractionReaction`（赌气态拥抱）及 `normalizeSimplifiedPlaceName("上海市 · 黃浦區")` | 正确区分 `喜/怒/哀/乐` 象限、消除游戏式 `回元气 +18%`、赌气态拥抱输出「嘴硬心软」而非瞬间假笑；`黃浦區` 归一为 `黄浦区`；展开面板使用 `di-panel-tabs` 双标签且无闪屏/光球透按钮 | `human-emotion-and-cotton-v2.test.js` + `dynamic-island.test.js` |
| `TC-COTTON-05` | 小棉花 24 骨骼毛绒纹理、陀螺仪重力滚球与 GPU `translate3d` 拎拖 | 校验 `BallPhysics.setTiltGravity` 倾斜加速与 `CottonDesktopPet` / `CottonPet` 滚动与形态键契约 | 倾斜重力稳定驱动小球滚动回弹；49,853 顶点与 5 形态键完整保留；桌宠采用 `translate3d` 与 `createGyroController`；小屋支持 `overflow-y: auto` + `touch-action: pan-y` | `human-emotion-and-cotton-v2.test.js` + `cotton-course-upgrades.test.js` |
| `TC-COTTON-06` | 聊天左下角麦克风单击/长按录音与离线本地语音识别回落 | 检验 `App.jsx` `localSpeechListening`、`getSpeechRecognitionCtor`、`requestNativeMediaPermissions` 与 `voice.test.js` | 无论语音服务在线或离线点击均有明确录音响应与回落机制，长按松手与单击再点均可发送 | `human-emotion-and-cotton-v2.test.js` + `voice.test.js` |

### 15. 全端音乐无缝自动连播（`SPEC-MUSIC-AUTO-NEXT`）
| 用例号 | 场景 | 执行步骤 | 预期结果 | 自动化 / 实测依据 |
|---|---|---|---|---|
| `TC-MUSIC-05` | 灵动岛内置随心听自动连播、防重复、复用解锁 Audio 与失败清理 | 触发 `ended`（含连续双 `ended`）、模拟移动端新建 Audio `NotAllowedError`、模拟失败响应及 `localBlocked()` 场景 | 单次 `ended` 自动带 `?exclude=` 拉取并续播下一首且释放旧音轨；遇 `NotAllowedError` 自动复用旧 Audio 播放；失败时清空已结束卡片不留死卡；本地占线时不抢声道 | `built-in-now-playing.test.js` (16/16) |
| `TC-MUSIC-06` | 音乐工作室队列连播、一起听本地预览连播与聊天音乐卡片续播 | 校验 `MusicStudio.jsx` `handlePlayAdjacent`/`onEnded`、`TogetherMusic.jsx` `localAutoPlayRef`、`MusicChatCard.jsx` 与 `App.jsx` `dengta:chat-music-ended` | 音乐工作室播完自动切下一首可播歌曲并跳过 VIP 受限曲；一起听未开场本地预览自动切歌（不破坏 `active` 队列测试）；聊天卡片播完无缝触发灵动岛续播 | `music-studio-qr-and-history.test.js` + `music-player-lifecycle.test.js` |

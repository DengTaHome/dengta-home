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

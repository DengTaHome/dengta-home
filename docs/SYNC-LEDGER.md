# 全平台同步记录

> 每次更新完成后追加一行。GitHub 和 CNB 都完成才算完成（当前阶段 GitHub 待用户使用 `Jessica-tce` PAT 运行对应 `tools/complete-github-release-v*.ps1` 一键推送，CNB 全量工作区快照已逐版实时同步）。

| 日期 | 版本 / 更新内容 | 本地三仓 HEAD（待推送 GitHub） | CNB 全量快照 commit | 本地发布产物 / 备份 |
|---|---|---|---|---|
| 2026-11-22 | 账号迁移；7 个仓库转入 `tnineninet`；建立 CNB 新组织/仓库；首次完整快照 3001 文件 / 约 87MB | `tnineninet` 各仓库 HEAD；快照 `5343e5ea` | `https://cnb.cool/DengTaArchive2026/dengta-workspace` `main` | `D:\GZdeepseek\backup\workspace-snapshot-20261122\` |
| 2026-11-25 | `v2.13.53 (311)` 全量升级：agents.md 缓存管线、聊天首字提速、设置面板 SVG/动效、AI 预设中心、小棉花 3D 桌宠、adudir-open/剪映工作台、邮局定位探索、dbskill、Kiwi 记忆、情绪/成就升级 | frontend `5b5fe392`、backend `387e832` | `0924e9a5`（3653 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.53.apk` |
| 2026-11-27 | `v2.13.54–v2.13.57 (312–315)`：音乐工作室手机零白屏扫码闭环、侧边栏比例重构、全程多模态感知、Mika 真机联动与 vivo Android 15 真机实拍 4 项细节根治 | `main` 连续提交（见 `CHANGELOG.md`） | 已同步 | `D:\GZdeepseek\apk-build\DengTa-2.13.57.apk` |
| 2026-11-27 | `v2.13.58–v2.13.59 (316–317)`：四大协议真实 KV-Cache 遥测与前端可视化闭环、API 控制台测速与协议识别、设置面板动效/SVG/Night Glass/`18px` 复选框锁、`/bootstrap` 单次 RTT 40 条预热 | `main` 连续提交 | 已同步 | `D:\GZdeepseek\apk-build\DengTa-2.13.59.apk` |
| 2026-11-27 | `v2.13.60 (318)`：Chronos 严格时间实时轮次防遮蔽、沉默轻唤 2x 退避上限、AI 全功能调度、准秒级动态心跳与 `+10分` 推迟 UI | `main` 连续提交 | 已同步 | `D:\GZdeepseek\apk-build\DengTa-2.13.60.apk` |
| 2026-11-27 | `v2.13.61 (319)`：聊天记录 0ms 四级秒开架构（L0 同步启动快照 + `?after=` 零冗余增量同步 + 侧边栏悬停/按压预热 + 80 行 DOM 窗口重置） | backend `271e678`、frontend `1047d9f`、docs `7d65c05` | `4f06467e`（3719 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.61.apk` |
| 2026-11-27 | `v2.13.62 (320)` + **SDD 规范体系升级**：小棉花 3D 毛绒 AO/MToon 校准/蒙皮后法线外扩细描边/摄影棚底色/磨砂控制卡（WebGL 实拍 0 报错）+ PMGao SDD 全量需求表单、测例库与 `verify-sdd-compliance.mjs` 自动化门禁 | backend `271e678`、frontend `f26986e`、docs `e133025` | `f791f7c`（3723 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.62.apk`（SHA-256 `b1532c33…74b26c9`） |
| 2026-11-27 | `v2.13.63 (321)`：音乐工作室手机零裁切二维码 + `-462` 风控识别与 App 内一键登录直出 + 网易云 HTTPS 音频直链修复 + 侧边栏分组标题/单行 Dock 比例再精修 | backend `2f056cb`、frontend `6173272`、docs `cfd09f7` | `ffd07825`（3724 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.63.apk`（SHA-256 `6784268b…17d2376b`） |
| 2026-11-27 | `v2.13.64 (322)`：AI 视界「接入向导 · 平台入口」与本机 18088 网关一键直连、根治全站 4 处「MCP 插件中心」跳转错位 Bug、B站/小红书/抖音/剪映一键直达与本机网关 CORS 增强 | backend `2f056cb`、frontend `e664f25`、docs `d1fe85e` | `f3fdf38b`（3726 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.64.apk`（SHA-256 `b0547f8d…94fba19b`） |
| 2026-11-27 | `v2.13.65 (323)`：QQ 机器人高对比在线大横幅、6 位绑定码拦截与 `/同步状态` 实时自检、完整人设/称呼/记忆/对话延续同步铁证、AI 工作台无法上下滑动根治 + GitHub `kukemc/bili-cli` (`1.4.0`) 安装 | backend `3a35271`、frontend `588b4a2`、docs `f68660f` | `bf49930`（3727 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.65.apk`（SHA-256 `3c3f580e…46ec3933`） |
| 2026-11-27 | `v2.13.66 (324)`：根治 X / Twitter 页未连接却假显示「已连接 / MCP 网关在线」且功能全不可用；实现真实四态判定、网关诊断卡、一键启用并实测连通、工具门控与查用户主页/推文 + 傻瓜式双击 GitHub 同步脚本 | backend `3a35271`、frontend `b2f7621`、docs `5b75a95` | `f54ef6c9`（3731 文件） | `D:\GZdeepseek\apk-build\DengTa-2.13.66.apk`（SHA-256 `23e0e112…163ec5b`） |
| 2026-11-27 | `v2.13.67 (325)`：涂鸦画室专业提示词工程（8 画风/5 画幅/7 层美术指导/V2 加密封套/免费 AI 润色）+ 多生图模型家族渐进降级调用适配 + Windows 零乱码 GUI GitHub 同步工具 + 本机 X MCP 一键启动脚本 | backend `66dcee8`、frontend `a213539`、docs `5a3bbd8` | `9e5d849d` | `D:\GZdeepseek\apk-build\DengTa-2.13.67.apk`（SHA-256 `e83482ca…2ae985e29`） |
| 2026-11-27 | `v2.13.68 (326)`：聊天按钮全量收纳至左侧星星菜单 + 一次授权持久感知（原生 `MediaPermissionsPlugin`）+ Siri 语音呼唤 + 摄像头主动聊天 + 智能屏幕变化截屏依据气泡卡片 + 手机端「弹字/引用」修复 + 灵动岛三栏防裁切布局与 CD 专辑封面自动补齐 | backend `38b281c`、frontend `f00fe1d`、docs `c9f4236` | `e40de014` | `D:\GZdeepseek\apk-build\DengTa-2.13.68.apk`（SHA-256 `fddb4a6b…6ae8b24d`） |
| 2026-11-27 | `v2.13.69 (327)`：小棉花 3D 全量重塑（手绘奶油毛绒纹理/24骨骼/食盆水碗/陀螺仪/甩球物理/GPU 零闪拎拖/精致磨砂菜单/小屋滚动修复）+ 聊天左下角麦克风一键修复 + 灵动岛右侧 SVG 天气胶囊（`上海 9°` 去时间）+ 彩虹胶囊双标签去杂/去闪屏/位置防裁切简繁归一 + 真人感「喜怒哀乐」与健康 76% 元气基线 + PowerShell 5.1 推送脚本 stderr 报错根治 | backend `1432c61`、frontend `6d904dd`、docs 本轮提交 | 本轮同步刷新 | `D:\GZdeepseek\apk-build\DengTa-2.13.69.apk`（SHA-256 `44af0848…db5bf`） |

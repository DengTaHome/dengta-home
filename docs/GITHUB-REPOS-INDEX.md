# DengTa GitHub 仓库索引与接手调用说明

> 生成日期：2026-11-25  
> 用途：把你的 DengTa 相关 GitHub 仓库、上游参考项目和当前状态集中给另一个 AI，方便它按链接重新读取、评估和优化。  
> 注意：旧链接 `github.com/DengTaHome/...` 已迁移到 `github.com/tnineninet/...`；GitHub 通常会重定向，但请优先使用新链接。

---

## 1. DengTa 自己的主仓库（优先读）

| 仓库 | 链接 | 作用 | 当前状态 |
|---|---|---|---|
| DengTa 前端 | https://github.com/tnineninet/dengta-home-frontend | React 19 + Vite + Capacitor；网页、PWA、Android WebView、iOS 工程；聊天、记忆、语音、动态、一起看等前端 | **public**，Vercel 生产源，`main` |
| DengTa 后端 | https://github.com/tnineninet/dengta-home-backend | Node/Express 后端；聊天、记忆、人格、语音、MCP、QQ/微信桥接、Supabase 集成 | private，Render 生产源，`main` |
| DengTa 文档/工具 | https://github.com/tnineninet/dengta-home | 交接、架构、账本、同步策略、repo-watch、发布脚本、历史文档 | private，docs 主仓库 |
| DengTa 语音服务 | https://github.com/tnineninet/dengta-home-voice | HerVoice/TTS 语音服务；后端 `HERVOICE_URL` 指向 Render 的 `dengta-home-voice` | private |
| Kiwi 记忆 | https://github.com/tnineninet/kiwi-mem-dengta | Python 记忆提取/隔离服务；DengTa 长期记忆和 kiwi-mem 后端集成 | public |
| DengTa 音乐 MCP | https://github.com/tnineninet/dengta-music-mcp | 自托管网易云音乐 MCP 的稳定 Docker 宿主；MIT 上游封装 | public |
| DengTa 旧资料库 | https://github.com/tnineninet/dengta | 早期资料/实验仓库（描述为 `chatlovers`），不是当前主链路；只用于查历史 | public |

### 旧的 GitHub 链接

以前使用的 `DengTaHome` 个人账号链接：

```text
https://github.com/DengTaHome/dengta-home-frontend
https://github.com/DengTaHome/dengta-home-backend
https://github.com/DengTaHome/dengta-home
```

现在都会跳到 `tnineninet` 新地址；旧账号 `DengTaHome` 已不是主仓库所有者，不要从旧账号继续开发。

---

## 2. 上游/参考项目（按需读，不要整包复制进 DengTa）

| 项目 | 链接 | 用途 | 状态/注意 |
|---|---|---|---|
| SnowLuma | https://github.com/SnowLuma/SnowLuma | QQ 注入运行时，曾用于本地 QQ 栈 | **当前 404/不可用**；不要再计划基于它升级 |
| QQ Bridge | https://github.com/Derpyu520/qq-bridge | QQ（SnowLuma OneBot v11）与 DSH agent 的桥；社交模拟、MCP 工具、黑话学习 | **已归档**，最后 release `v0.2.2-final`；不要把新功能建立在其上，优先使用线上 DengTa↔QQ |
| X/Twitter MCP | https://github.com/yxiy171866-boop/x-twikit-mcp | 用 twikit 实现的 X MCP；发帖、回复、搜索、用户信息、转推等 | Python/stdio；DengTa 若要接，需要 HTTP 包装；新版已做 Asia/Shanghai 时间格式化 |
| 网易云 MCP（Anko3o） | https://github.com/Anko3o/Music-Mcp-Netease | 网易云音乐 MCP；带歌词句级注释/评论、播放器；HTTP MCP + MUSIC_U | 可作为网易云/音乐理解接入候选；注意许可证和网易云风控 |
| 网易云 MCP（Cheiineeey） | https://github.com/Cheiineeey/netease-music-mcp | 网易云音乐 MCP 备选实现 | **非商业许可证**；商用/分发前必须核对 LICENSE |
| 网易云 MCP（Vael-KY） | https://github.com/Vael-KY/netease-music-mcp | 网易云音乐 MCP 备选；支持一起听房间事件/队列事件 | 跟踪表里较活跃；接入前仍要核对许可证和 API 兼容性 |
| Meting-Agent | https://github.com/ELDment/Meting-Agent | 多音乐平台 API 代理/重构版；可作为网易云或其他平台备选 | 2026-11-22 有 release；只作为代理层候选，不直接替换 DengTa 音乐域 |
| WeChat iLink Bridge（hardened） | https://github.com/Geokkk/wechat-ilink-bridge-hardened | DONGH4O/wechat-ilink-bridge 的加固 fork；本地微信消息 fetch/send/state/media | 适合本地桥接；支持 mp4/mov 等媒体发送 |
| WeChat iLink Bridge（上游） | https://github.com/DONGH4O/wechat-ilink-bridge | 本地 WeChat iLink Bridge CLI；Agent 安全消息/媒体交接 | 上游参考；接 DengTa 前先看本地桥接适配和隐私边界 |
| dayflow | https://github.com/0xblewalker/dayflow | 高频日常 AI 聊天的 cache-aware 注意力/遗忘层；上下文压缩、记忆、prompt caching | **AGPL-3.0-only**；只借鉴设计，不要直接闭源嵌入 |
| MuSe toy broadcaster | https://github.com/Cami-Ose/muse-toy-broadcaster | Android BLE 广播器（MuSe/Love Spouse），Kotlin | MIT；可构建独立 APK；与 DengTa 主应用无直接代码依赖 |
| Navi Shell | https://github.com/Cami-Ose/navi-shell | 高德导航 Android App 壳；需要高德 key + 自建 `/access`、`/asr`、`/proxy_chat`、`/tts` 后端 | MIT；适合作为导航/车机方向参考，不是 DengTa 主应用模块 |

> 未列入 GitHub 仓库追踪表的 AstrBot/本地 QQ 云端项目不在本索引内；它们主要在本机 `E:\yz` 或后端部署中，不要误当成 GitHub 仓库。

---

## 3. 建议 AI 的读取顺序

1. **先读 DengTa 自己的前端/后端/文档**，确认当前架构和约束；
2. 再读 `dengta-home-voice`、`kiwi-mem-dengta`、`dengta-music-mcp`；
3. 只有需要某个具体能力时，再打开对应上游/参考项目；
4. 上游项目先看 LICENSE、归档状态、最近 commit，不要直接 `git clone && merge`；
5. 任何适配都先写测试，再在本地/预发验证，不要直接改生产数据。

优先级建议：

- P0：登录故障、GitHub Actions billing、Vercel/Render 生产链路；
- P1：网页安装（PWA manifest/sw）+ Android in-app 更新包；
- P2：记忆（kiwi）、语音（voice）、音乐 MCP；
- P3：QQ/微信桥、X MCP、导航/BLE 等外围能力。

---

## 4. 可直接发给接手 AI 的提示词

```text
你是 DengTa（灯塔）项目的接手 AI。请先读取：
1) https://github.com/tnineninet/dengta-home-frontend
2) https://github.com/tnineninet/dengta-home-backend
3) https://github.com/tnineninet/dengta-home

然后按 docs/AI-HANDOVER-2026-11-25.md 和 docs/GITHUB-REPOS-INDEX.md 做只读检查。

要求：
- 不要改生产数据库、不要清空聊天/记忆、不要动 Cloudflare DNS；
- 不要输出或索取明文密码/token/API Key；
- 先确认登录故障的具体报错、Vercel/Render 的 Git 连接、GitHub Actions billing；
- 对每个上游项目先核对其 LICENSE、是否归档、API 是否变化，再提出最小适配方案；
- 代码改动必须先补测试，再部署；
- 最后给我一份“问题→证据→建议改动→测试计划”的清单。

外围项目按需读取：
- SnowLuma（当前 404，不要依赖）
- Derpyu520/qq-bridge（已归档，勿作为新功能基础）
- yxiy171866-boop/x-twikit-mcp（需 HTTP 包装）
- Anko3o/Music-Mcp-Netease
- Cheiineeey/netease-music-mcp（非商业许可）
- Vael-KY/netease-music-mcp
- ELDment/Meting-Agent
- Geokkk/wechat-ilink-bridge-hardened
- DONGH4O/wechat-ilink-bridge
- 0xblewalker/dayflow（AGPL，只借鉴）
- Cami-Ose/muse-toy-broadcaster
- Cami-Ose/navi-shell
```

---

## 5. 不要做的事

- 不要把旧 `DengTaHome` 链接当成当前主仓库；
- 不要把上游项目整包复制进 DengTa；
- 不要在没有测试的情况下改登录、Supabase、Android 更新链路；
- 不要公开或提交任何 `.env`、API Key、Cookie、keystore；
- 不要使用 SnowLuma（已 404）或把新功能建立在已归档的 qq-bridge 上；
- 不要忘记 CNB 完整快照：https://cnb.cool/DengTaArchive2026/dengta-workspace

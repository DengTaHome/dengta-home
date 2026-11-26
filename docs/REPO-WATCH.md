# 项目追踪（GitHub + CNB，DengTa 生态）

- 最近检查：2026-11-25T01:20:05.216Z
- 项目数：17（GitHub 16 + CNB 1）；本次变化：0；错误：1

| 项目 | Stars | 最新 commit | 提交时间 | Release | 变化 |
|---|---:|---|---|---|---|
| [tnineninet/dengta-home](https://github.com/tnineninet/dengta-home) | 4 | `8e1139eb` Add GitHub repository index for AI handover | 2026-11-24 16:56:38 | v2.13.43 | 无变化 |
| [tnineninet/dengta-home-backend](https://github.com/tnineninet/dengta-home-backend) | 0 | `b1d60630` Merge QQ cloud onboarding and AstrBot persona export | 2026-11-06 10:02:55 | — | 无变化 |
| [tnineninet/dengta-home-frontend](https://github.com/tnineninet/dengta-home-frontend) | 0 | `af5c29fd` Fix Android APK workflow YAML quoting | 2026-11-23 12:33:51 | v2.13.47 | 无变化 |
| [tnineninet/kiwi-mem-dengta](https://github.com/tnineninet/kiwi-mem-dengta) | 0 | `483a0c5a` feat(extractor): 成人互动偏好提取保护 + 可配置记忆提示词模板 | 2026-08-18 16:35:31 | — | 无变化 |
| [Geokkk/wechat-ilink-bridge-hardened](https://github.com/Geokkk/wechat-ilink-bridge-hardened) | 0 | `6acda974` B0: mp4/mov file send support (video/mp4, video/quicktime) | 2026-10-28 08:49:56 | — | 无变化 |
| [DONGH4O/wechat-ilink-bridge](https://github.com/DONGH4O/wechat-ilink-bridge) | 41 | `7946df5d` Release M14 M15 P2 adapters | 2026-05-18 12:43:43 | — | 无变化 |
| [SnowLuma/SnowLuma](https://github.com/SnowLuma/SnowLuma) | — | — | — | — | ⚠️ not-found |
| [yxiy171866-boop/x-twikit-mcp](https://github.com/yxiy171866-boop/x-twikit-mcp) | 35 | `ec842b1d` feat(timezone): format tweet created_at to Asia/Shanghai (UTC+8) datetime string | 2026-11-13 12:36:52 | — | 无变化 |
| [Anko3o/Music-Mcp-Netease](https://github.com/Anko3o/Music-Mcp-Netease) | 95 | `06e5a258` 批注捆在歌词句上：每条带 line，卡片先放句子再放评论；MCP 的 line 单独递 | 2026-10-27 17:58:33 | — | 无变化 |
| [Cheiineeey/netease-music-mcp](https://github.com/Cheiineeey/netease-music-mcp) | 118 | `547afbe0` Adopt noncommercial licensing | 2026-10-01 18:07:13 | — | 无变化 |
| [Vael-KY/netease-music-mcp](https://github.com/Vael-KY/netease-music-mcp) | 239 | `af20456a` together: grade room events; a song that ran out and pauses go to the relay as quiet events | 2026-11-22 15:27:47 | — | 无变化 |
| [ELDment/Meting-Agent](https://github.com/ELDment/Meting-Agent) | 119 | `c22e26d7` refactor: 全面重构 Meting Agent 并重写构建发布流程 (#11) | 2026-11-21 18:26:55 | 2026.11.22 | 无变化 |
| [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) | 3682 | `12e66d2c` Merge pull request #186 from Derpyu520/dev | 2026-11-18 04:10:53 | v0.2.2-final | 无变化 |
| [0xblewalker/dayflow](https://github.com/0xblewalker/dayflow) | 54 | `30b338c7` Relicense current and future versions under AGPL-3.0-only | 2026-08-16 14:47:26 | v0.1.2 | 无变化 |
| [Cami-Ose/muse-toy-broadcaster](https://github.com/Cami-Ose/muse-toy-broadcaster) | 4 | `2c4a7af5` Initial commit: MuSe/Love Spouse BLE broadcaster | 2026-08-27 08:53:00 | v1.0 | 无变化 |
| [Cami-Ose/navi-shell](https://github.com/Cami-Ose/navi-shell) | 11 | `1d198962` 初始提交：navi-shell | 2026-10-08 15:32:19 | — | 无变化 |
| [DengTaArchive2026/dengta-workspace](https://cnb.cool/DengTaArchive2026/dengta-workspace) | — | `2e49b226` CNB main HEAD | — | — | 无变化 |

## 已记录的项目说明

- Vercel 生产前端仓库；已改为 public，Vercel Hobby 才能连接组织仓库
- stdio MCP，需要 HTTP 包装后接入 DengTa
- HTTP MCP，自建播放器 + MUSIC_U
- 网易云 MCP 备选项目
- 网易云 MCP 备选项目
- 多音乐平台 API 代理，可作网易云备选
- DSH↔QQ 桥接上游；升级前跑 verify:adaptation
- 时间胶囊/注意力层参考项目；只借鉴设计，不直接嵌入
- MIT；Android BLE 广播器（MuSe/Love Spouse），可构建独立 APK
- MIT；高德导航 Android App，需要高德 key + 自建 /access /asr /proxy_chat /tts 后端
- 腾讯 CNB 完整工作区快照；main 分支，由 tools/sync-all-platforms.ps1 推送

> 由 `tools/repo-watch/watch.mjs` 生成；状态文件 `docs/REPO-WATCH-STATE.json`。

# 项目追踪（GitHub + CNB，DengTa 生态）

- 最近检查：2026-10-28T17:45:54.045Z
- 项目数：17（GitHub 16 + CNB 1）；本次变化：1；错误：0

| 项目 | Stars | 最新 commit | 提交时间 | Release | 变化 |
|---|---:|---|---|---|---|
| [DengTaHome/dengta-home](https://github.com/DengTaHome/dengta-home) | 4 | `1a262f5d` Record MCP catalog deployment and NetEase MCP connection | 2026-10-28 17:36:46 | v2.13.43 | 无变化 |
| [DengTaHome/dengta-home-backend](https://github.com/DengTaHome/dengta-home-backend) | 0 | `3055ec06` Keep time-capsule persistence non-fatal when runtime state is unavailable | 2026-10-28 17:03:25 | — | 无变化 |
| [DengTaHome/dengta-home-frontend](https://github.com/DengTaHome/dengta-home-frontend) | 0 | `65eeb4ff` Add MCP app catalog cards with deployment tutorials | 2026-10-28 17:33:08 | — | 无变化 |
| [DengTaHome/kiwi-mem-dengta](https://github.com/DengTaHome/kiwi-mem-dengta) | 0 | `483a0c5a` feat(extractor): 成人互动偏好提取保护 + 可配置记忆提示词模板 | 2026-08-18 16:35:31 | — | 无变化 |
| [Geokkk/wechat-ilink-bridge-hardened](https://github.com/Geokkk/wechat-ilink-bridge-hardened) | 0 | `6acda974` B0: mp4/mov file send support (video/mp4, video/quicktime) | 2026-10-28 08:49:56 | — | 无变化 |
| [DONGH4O/wechat-ilink-bridge](https://github.com/DONGH4O/wechat-ilink-bridge) | 13 | `7946df5d` Release M14 M15 P2 adapters | 2026-05-18 12:43:43 | — | 无变化 |
| [SnowLuma/SnowLuma](https://github.com/SnowLuma/SnowLuma) | 3049 | `8ffd3142` chore(release): v2.2.1 | 2026-10-27 09:28:27 | v2.2.1 | 无变化 |
| [yxiy171866-boop/x-twikit-mcp](https://github.com/yxiy171866-boop/x-twikit-mcp) | 9 | `dc5c9352` feat: include bookmark_count and views in get_tweet_by_id stats | 2026-10-28 14:33:06 | — | 无变化 |
| [Anko3o/Music-Mcp-Netease](https://github.com/Anko3o/Music-Mcp-Netease) | 73 | `06e5a258` 批注捆在歌词句上：每条带 line，卡片先放句子再放评论；MCP 的 line 单独递 | 2026-10-27 17:58:33 | — | 无变化 |
| [Cheiineeey/netease-music-mcp](https://github.com/Cheiineeey/netease-music-mcp) | 115 | `547afbe0` Adopt noncommercial licensing | 2026-10-01 18:07:13 | — | 无变化 |
| [Vael-KY/netease-music-mcp](https://github.com/Vael-KY/netease-music-mcp) | 212 | `7a9344bd` fix: apply 3.2.1 NetEase request and history repairs | 2026-10-12 13:20:40 | — | 无变化 |
| [ELDment/Meting-Agent](https://github.com/ELDment/Meting-Agent) | 112 | `f91472c6` docs: Synchronize updates to improve user guidance | 2026-03-20 13:54:02 | v1.6.11 | 无变化 |
| [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) | 3190 | `a49877f4` chore: probe-tools 跑完自清理工作区与临时目录 | 2026-10-22 12:05:47 | v0.2.1-r1 | 无变化 |
| [0xblewalker/dayflow](https://github.com/0xblewalker/dayflow) | 45 | `30b338c7` Relicense current and future versions under AGPL-3.0-only | 2026-08-16 14:47:26 | v0.1.2 | 无变化 |
| [Cami-Ose/muse-toy-broadcaster](https://github.com/Cami-Ose/muse-toy-broadcaster) | 3 | `2c4a7af5` Initial commit: MuSe/Love Spouse BLE broadcaster | 2026-08-27 08:53:00 | v1.0 | 无变化 |
| [Cami-Ose/navi-shell](https://github.com/Cami-Ose/navi-shell) | 11 | `1d198962` 初始提交：navi-shell | 2026-10-08 15:32:19 | — | 无变化 |
| [dengtahome/dengtahome](https://cnb.cool/dengtahome/dengtahome) | — | `0d69edea` CNB frontend-main HEAD | — | — | 🆕 有更新 |

## 已记录的项目说明

- Vercel 生产前端仓库；已可访问，提交 author 必须用账号邮箱，否则 Vercel BLOCKED
- QQ 注入运行时；升级前先确认兼容版本
- stdio MCP，需要 HTTP 包装后接入 DengTa
- HTTP MCP，自建播放器 + MUSIC_U
- 网易云 MCP 备选项目
- 网易云 MCP 备选项目
- 多音乐平台 API 代理，可作网易云备选
- DSH↔QQ 桥接上游；升级前跑 verify:adaptation
- 时间胶囊/注意力层参考项目；只借鉴设计，不直接嵌入
- MIT；Android BLE 广播器（MuSe/Love Spouse），可构建独立 APK
- MIT；高德导航 Android App，需要高德 key + 自建 /access /asr /proxy_chat /tts 后端
- 腾讯 CNB 前端镜像仓库；GitHub Actions sync-cnb 在额度恢复后自动推送

> 由 `tools/repo-watch/watch.mjs` 生成；状态文件 `docs/REPO-WATCH-STATE.json`。

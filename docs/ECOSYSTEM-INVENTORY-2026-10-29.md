# 生态仓库全量审查（Elephant 记录）

生成：2026-10-29（Asia/Shanghai）
范围：`docs/REPO-WATCH.md`、`D:\GZdeepseek\_refs` 全部本地仓库、此前会话出现过的 GitHub/CNB 项目，以及它们的直接上游。
方法：逐仓库读 README / LICENSE / 入口 / 配置 / 关键源码 / 最近提交；四个独立只读审计员分组复核；Goldfish 口径为「只读、外部、永不自评」。
注意：`D:\GZdeepseek\dengta-home` 是公开镜像旧副本；线上/生产口径是 `_refs/frontend-gh` + `_refs/backend-prod`，不要拿旧副本构建或部署。

## 仓库总表

| # | 仓库 | 类型/用途 | 本地路径 | HEAD / 版本 | 许可 | DengTa 关系 | 结论 |
|---|---|---|---|---|---|---|---|
| 1 | DengTaHome/dengta-home | 公开自托管镜像 | `dengta-home` | 旧镜像 | ISC | 发布/文档镜像 | 落后线上；下载链接已修；tag 仍异常 |
| 2 | DengTaHome/dengta-home-backend | 生产后端 | `_refs/backend-prod` | f96b0b5 / 0.29.76 | ISC（无 LICENSE 文件） | 线上后端 | 与 /health 一致；render.yaml 已对齐；health DB 盲区待处理 |
| 3 | DengTaHome/dengta-home-frontend | 生产前端 | `_refs/frontend-gh` | 58ae256 / 2.13.43 | 无 LICENSE | Vercel/Capacitor | 已清理调试截图；CSP 手同步 |
| 4 | DengTaHome/dengta-music-mcp | 网易云 Docker 宿主 | `_refs/music-stable` | 4fde883 | CC BY-NC-SA 4.0（非 MIT） | 线上音乐 MCP | 安全加固已部署；public /health 200 |
| 5 | （旧副本）frontend-prod | 前端克隆 | 已删除 | 损坏 | — | 无 | 零提交/中断克隆，已删除 |
| 6 | yxiy171866-boop/x-twikit-mcp | X/Twitter stdio MCP | `_refs/x-twikit-mcp` | dc5c935（上游） | MIT | 本机经 supergateway 接入 | **本地补丁**已加只读闸门；上游未合并，dc5c935 仍可写 |
| 7 | Anko3o/Music-Mcp-Netease | 网易云 MCP + 播放器 | `_refs/music-mcp-netease` | 06e5a258 | CC BY-NC-SA 4.0 | 参考/备选 | 不搬代码；非商用+SA 传染 |
| 8 | Cheiineeey/netease-music-mcp | 网易云 MCP 备选 | 无本地 | 547afbe0 | PolyForm Noncommercial | 未集成 | 禁止并入；鉴权/CORS 风险 |
| 9 | Vael-KY/netease-music-mcp | 网易云 MCP 备选 | 无本地 | 7a9344b (v3.2.1) | MIT | Cookie 方案参考 | 已补 attribution；未挂 MCP；默认 0.0.0.0 无鉴权 |
| 10 | ELDment/Meting-Agent | 多平台搜歌/歌词 | 无本地 | f91472c6 | MIT | 未集成 | 可作只读补充；依赖未锁 |
| 11 | CRTNET8866/MMTR | 仿人脑记忆 REST | `_refs/MMTR` | 601ac33 | MIT | 未集成 | 最值得试点；token 不设=全放行 |
| 12 | Derpyu520/qq-bridge | QQ↔DSH 主桥 | `_refs/qq/qq-bridge` | a49877f4 (v0.2.1-r1) | MIT+条款 | 生产 QQ 桥 | 锁版本；EULA/旁观出机需注意 |
| 13 | wufa-cat/dsh-qq-bot | DSH 插件/NapCat | `_refs/qq/dsh-qq-bot` | 02160e82 | MIT（新增码） | 未集成 | 上游许可无书证，暂缓 |
| 14 | leonathan369-droid/qq-bridge | QQ 桥衍生 | `_refs/qq/qq-bridge-dsh` | 966ef411 | MIT | 未集成 | `{{cwd}}` preset 对 DSH 0.2.1 已失效 |
| 15 | Geokkk/wechat-ilink-bridge-hardened | 微信→DengTa | 本地 `D:\GZdeepseek\wechat-bridge` | 6acda974 (v0.3.1) | MIT | 生产微信桥 | 非官方协议/封号风险；本机白名单 |
| 16 | DONGH4O/wechat-ilink-bridge | 微信桥上游 | 无本地 | 7946df5d | MIT | 未集成 | 停更、无媒体限额 |
| 17 | LucieEveille/kiwi-mem | 记忆服务 | `_refs/kiwi-mem` | b01a0c5 | AGPL-3.0-or-later | `/memory/*` | /admin、/sync/export 鉴权缺口；禁止裸公网 |
| 18 | DengTaHome/kiwi-mem-dengta | 多租户记忆 fork | `_refs/kiwi-mem-dengta` | 8e435bc1 | AGPL-3.0-or-later | 生产记忆 + MMTR | 部署版源未发布（AGPL §13）；鉴权范围不足 |
| 19 | 0xblewalker/dayflow | 注意力层参考 | 无本地 | 30b338c7 | AGPL-3.0-only | 仅理念 | 不移植代码，避免 AGPL |
| 20 | SnowLuma/SnowLuma | NTQQ OneBot 网关 | `D:\GZdeepseek\snowluma\app` | 8ffd3142 / v2.2.1 | 源码可见非商业 + EULA | QQ 桥上游 | 本机 3000/3001 未监听，桥接离线；禁止自动注入产品化 |
| 21 | Cami-Ose/muse-toy-broadcaster | BLE 玩具广播 | `_refs/muse-toy` | 本地 a25aee2d / 1.1 | MIT | 独立 APK | v1.1 未回上游；公分发门槛未达 |
| 22 | Cami-Ose/navi-shell | 高德导航 App | `_refs/navi-shell` | 1d198962 | MIT | 未集成 | 缺 Amap Key + 后端适配层，不可用 |
| 23 | cnb.cool/dengtahome/dengtahome | CNB 多分支镜像（本地同步仅 frontend-main） | `_refs/cnb-dengtahome` | 0d69ede / 59ee05c9 | 无 | 公开镜像 | 已分叉；另有 backend-main/opensource-main 分支；无写 token，等 11/01 |
| 24 | 历史 fork `buyaocaowo555-collab/kiwi-mem-dengta` | 旧部署 fork | `_audit/kiwi-deploy-test` | — | AGPL | 仅历史 | 不用于生产；以 DengTaHome fork 为准 |

直接依赖（非用户项目，单独跟踪）：`d60/twikit`（X 客户端，补丁在 `tools/x-mcp/patches`）、`rany2/edge-tts` / `andresayac/edge-tts`（TTS 参考）、Cloudflare cloudflared。

## P1 / P2 结论（按仓库）

### DengTaHome/dengta-home（公开镜像）
- P1：README 与 `frontend/public/updates/android.json` 指向不存在的 `v2.10.74` Release。**已修**：README 改 `/releases/latest`；feed 改 `v2.13.43`（code 301，sha256/size 按 GitHub asset）。
- P1：`.packed-refs` 共 63 个 tag，其中 **54 个**同指 `766e47c9`，共 10 个不同目标（tag 仍不能准确表示版本）。**未修**：需一次 tag 清理+推送，风险高，留待确认。
- P2：镜像落后线上 3 个 minor；不应用它构建/部署。

### DengTaHome/dengta-home-backend
- P1：`/health` 的 `database:"not_checked"`，Render 用 `/health` 做探针；真正的 `/health/database` 存在但不在探针。**未改探针**（避免 DB 短暂故障导致反复重启），保留独立 15 分钟监控。
- P1：`render.yaml` `BACKGROUND_JOBS_ENABLED=false` 与线上 true 漂移。**已修**为 true。
- P2：`coverage/*` 入库。**已修**：`git rm --cached` + `.gitignore`。
- P2：无 LICENSE 文件、Dockerfile 与 Node engines 不一致。未改；私有仓库非公开分发。

### DengTaHome/dengta-home-frontend
- P1：根目录 41 个调试 png/xml（含 5.2MB/2MB 截图）。**已修**：从 index 移除这 41 个根目录调试图/XML（index 现为 0），加入 `.gitignore`；本地文件仍保留以便排查。
- P2：CSP 手工同步、`verify-csp-hashes` 只查缺失不查多余；当前 12 个 hash 中约 6 个为历史/CRLF 兼容保留。**未删**：防止旧 PWA 缓存页面被 CSP 拦。
- P2：`.env.local` 含公开 Supabase URL/publishable key（已 gitignore，未跟踪）；`.env.production` 被跟踪。未改。
- 新增：inline 字体启动脚本行为测试（mobile/desktop/stored/无 matchMedia）。

### DengTaHome/dengta-music-mcp
- P1：license 元数据与 README 有“MIT upstream”冲突；实际 CC BY-NC-SA 4.0，禁止商用。
- P1：proxy token 空时 fail-open、gateway header 默认值、body 无上限。**已修**：
  - `MUSIC_WEB_TOKEN` 缺失即拒绝 player；
  - `MUSIC_GATEWAY_TOKEN` 必填；
  - `hmac.compare_digest` 常量时间比较；
  - `Cache-Control: no-store`；
  - body 上限 64MB；
  - entrypoint 要求 4 个 token、失败退出、日志移到 0700 volume；
  - Dockerfile 去掉硬编码 gateway token；
  - 新增 2 个行为单测 + 1 个源码字符串断言（`test_proxy_security.py`，3 passed）。
- **已部署**：VPS `/home/ubuntu/music-mcp` 已 pull 到 4fde883、重建镜像并重启；public `/health` 200，无 token `/mcp` 401，`.netease_cred` 保留。

### MCP / 音乐上游
- x-twikit-mcp：MIT；DengTa 已接 12 工具。**上游 dc5c935 未读只读闸门**；本机 worktree 已打补丁并运行（写工具被拒），但未合并上游，任何从上游 dc5c935 起的部署仍可写。建议合并 read-only 闸门后再长期暴露。
- Music-Mcp-Netease：CC BY-NC-SA，不可商用并入；只参考评论/MV/卡片。
- Cheiineeey：PolyForm NC，禁止并入。
- Vael：MIT，Cookie 设计已参考；已补 THIRD_PARTY_NOTICES；其服务默认 0.0.0.0 无鉴权，不能直接公网部署。
- Meting-Agent：MIT、停更；可 vendor 锁版本做只读补充。
- MMTR：MIT，最值得记忆适配试点；`MMTR_TOKEN` 不设即放行，`?token=` 会进日志；需先设 token+127.0.0.1，再写 Ombre→REST adapter。

### QQ / 微信 / 记忆
- qq-bridge 是生产主链路：锁 `v0.2.1-r1` + DSH `0.2.1-rc.3`；EULA 条款和旁观消息出机需在产品层再确认。
- qq-bridge-dsh：`agent.cordis.yml` 仍含 DSH 0.2.1 已删除的 `{{cwd}}`，启用会每回合 error；未修/未用。
- dsh-qq-bot：上游 QQ-bot 无许可证，暂不采用。
- wechat hardened：MIT；非官方协议封号/ToS 风险；保持本机/白名单，不公网。
- kiwi-mem / kiwi-mem-dengta：AGPL；`/admin`、`/sync/export`、`/v1` 鉴权范围不足，`/sync/export` 可导出含 Key 配置；**禁止裸公网**，需反代+token；AGPL §13 要求部署版源码可获取，fork 需发布或加 Source 链接。

### 伴生 App / 镜像
- SnowLuma：app 内无 LICENSE 文件，package.json 写 “SEE LICENSE IN LICENSE”；非商业约束主要由 EULA v1.1 支撑，禁止第三方打包/自动注入；本机 3000/3001 未监听，QQ 桥当前离线；注入脚本只可作一次性运维，不进产品仓。
- Muse 1.1：本地已做强度/模式控制并签名私有 release；上游仍缺 res，需要回推分支/补丁。
- navi-shell：缺 Amap Key + DengTa 后端 `/access /asr /proxy_chat /tts /api/navi/*` 适配层，开箱不可用。
- CNB：多分支镜像（main/backend-main/opensource-main/feat 等），但 `sync-cnb.yml` 只同步 `frontend-main`；本地无写 token，11/01 Actions 额度恢复后再做 tree diff + force-push。
- `_refs/frontend-prod`、`_refs/artifacts`：已删除（损坏克隆/纯 Vite 缓存）。

## 已执行动作（本轮）

1. 删除 `_refs/frontend-prod` 与 `_refs/artifacts`（约 460MB 无效数据）。
2. 修复公开镜像 README + Android feed 到真实 latest release，并 push。
3. music-stable：fail-closed token、gateway 必填、常量时间比较、no-store、body 上限、日志/entrypoint 加固 + 3 个安全测试；已 push，待部署。
4. backend：`render.yaml` 后台任务对齐 true；`coverage/*` 停止跟踪；已 push。
5. frontend：移除根目录调试截图/XML 的 git 跟踪；新增 inline 字体行为测试；已 push。
6. 补 Vael-KY cookie 方案 attribution；已 push 公开镜像。
7. 本清单 + 四个 Goldfish 审计报告记录在 Elephant 账本。

## 本轮追加动作（第二批）

- x-twikit-mcp：**本机 worktree** 新增 `_write_tool` 闸门，默认 `X_MCP_READ_ONLY=1`；`post_tweet/reply_tweet/send_direct_message/favorite_tweet/retweet/delete_tweet` 会直接返回只读错误；本地已用 MCP client 验证 tools=12、写工具被拒。补丁保存在 `tools/x-mcp/patches/server.py.patch`；**上游仓库未合并/未 push**。
- GZdeepseek 本地 X 隧道已用只读 wrapper 重启；DengTa 只读工具仍可用。
- frontend：新增 inline 字体行为测试（真实执行启动脚本，覆盖 mobile/desktop/stored/无 matchMedia）。
- backend：`render.yaml` 后台任务开关与线上对齐；`coverage/*` 停止跟踪。
- 公开镜像：README/feed 指向 `v2.13.43`；Vael attribution 已加。
- music-stable：安全加固已 push **并已在 VPS 重建/重启**；public `/health` 200、无 token `/mcp` 401、`.netease_cred` 保留。

## 仍待决策/执行

- CNB 写 token / 11-01 同步；高德开发者认证 + Key；凭据轮换。
- 公开镜像 54 个重复 tag 清理（需确认；不是全部 63 个）。
- backend `/health` 是否改用 `/health/database` 作为 Render 探针（可能因 DB 抖动重启，需决策）。
- kiwi-mem 生产反代/鉴权与 AGPL 源发布。
- x-twikit-mcp 只读闸门合并到上游/部署镜像（本机 worktree 已生效，但上游未合并）。
- Vael/MMTR/Meting 是否需要适配层（建议 MMTR 先试点）。
- music-stable 新镜像部署（先确认 `MUSIC_GATEWAY_TOKEN` 已在 VPS env）。
- 公开镜像是否升级到最新源码（当前只是文档/feed 修复）。

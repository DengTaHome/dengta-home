# 人设分节 × 记忆勾选 × 多通道同步 设计（草案 + 落地状态）

目标：DengTa 里把一个人设拆成可独立勾选的小节（正常 / 私密 / NSFW / 说话风格），
再按“记忆词条”选择性同步到微信 ClawBot 和 QQ；同时支持图片/视频/音频等媒体。

## 1. 数据模型（见 `068_channel_persona_sync.sql`）

| 表 | 作用 |
|---|---|
| `persona_sections` | 人设小节：title/content/category(normal/private/nsfw/style)/enabled/sort_order |
| `channel_sync_preferences` | 每个用户+伴侣+通道一行：勾选哪些小节、风格开关、记忆模式/ID/关键词/条数、媒体开关 |
| `channel_bindings` | 通道外部身份（QQ 号、微信 fromUserId）→ DengTa user/companion；含一次性绑定 token 哈希 |

三张表都开 RLS，只能读写 `auth.uid()` 自己的行；NSFW 小节默认不勾选，
只在目标通道显式选中时注入 prompt。

## 2. 后端接口（待迁移执行后实现）

- `GET /api/v2/persona/sections` / `PUT`：读取/保存小节；`category` 仅作展示与筛选。
- `GET /api/v2/channel-sync/preferences?channel=wechat|qq` / `PUT`：勾选结果。
- `GET /api/v2/channel-sync/memories?channel=...&q=...`：返回可勾选记忆（summary、时间、关键词命中）。
- `POST /api/v2/channel-sync/bind/start` / `bind/confirm`：生成一次性绑定码，QQ/微信侧
  发送该码完成绑定；未绑定的 QQ 用户按授权自动创建 DengTa 账号（Supabase Admin）。
- 扩展 `/api/v2/qq-bridge/context`：按 channel 过滤小节与记忆；`/chat` 把过滤后的
  人设/风格/记忆注入该回合 system prompt。

## 3. 前端（DengTa 设置页）

1. 「人设小节」：把现有统一提示词按 Markdown 标题拆分，自动生成小节 + 手动新增；
   每条有正常/私密/NSFW/风格分类开关。
2. 「通道同步」：选微信/QQ → 勾选小节、风格、记忆（按关键词搜索 + 勾选）、媒体开关。
3. 「绑定」：显示绑定码/二维码；未绑定时提示先绑定。
4. 私密/NSFW 小节在通道侧默认关闭，需二次确认；日志留痕。

## 4. 媒体支持矩阵

| 方向 | 微信 iLink | QQ/SnowLuma | 备注 |
|---|---|---|---|
| 收图片 | `wxb fetch --download-media` → `attachments[].path` | 支持 | 交给视觉模型/后端附件链路 |
| 收语音 | 下载后交给 ASR | 支持 | 需转写后再进对话 |
| 收视频 | 下载后抽帧/摘要 | 支持 | 25MiB 上限（wxb 加固） |
| 发图片 | `wxb send --image` | qq-bridge 图片发送 | 尺寸/格式校验 |
| 发文件 | `wxb send --file`（mp4/mov 以文件发） | 支持 | 限大小、类型 |
| 发语音 | wxb 当前无语音发送 | qq-bridge 有语音链路 | 微信侧后续补 |
| 说话风格 | 存入 `style_text`，注入 prompt | 同上 | 仅文字，不上传媒体 |

## 5. 登录 / 封号风险（已做 + 建议）

**已做：**
- 自动回复只在收到**主人 trusted 消息**后回复；陌生消息默认静默（加固版白名单）。
- 限速：30 条/小时、全局 8s 间隔、同用户 15s 间隔、发送前 0.8–2.2s 拟人停顿、
  单条 ≤900 字。
- `SESSION_EXPIRED` 立即停止轮询并等重新扫码，不反复重试；`STATE_LOCK_TIMEOUT`
  自动清理死进程孤儿锁。
- QQ 侧只回白名单私聊，不主动加群/加好友、不做营销群发。

**重要建议（需要你决策）：**
- 当前 SnowLuma 注入的是你的**主 QQ 号**，这属于第三方注入，主号有封禁风险；
  更稳的是**专用小号**做机器人（主号只做授权/审批）。微信 iLink 是独立机器人身份，
  风险低得多。
- 微信：保持同一家庭宽带出口，`weixin.qq.com` 直连不走代理；不要频繁重扫码；
  `.wxb` 会话目录只留本机、定期备份，过期再扫一次即可。
- QQ：登录后保持会话，不反复卸载/注入；先养号再上量；降低主动发言频率；
  不要在云服务器/共享代理出口扫码（腾讯风控）。
- 后续可在 `channel_sync_preferences` 增加“每日上限 / 安静时段 / 只回复关键词”并
  在桥接层强制执行。

## 6. 当前阻塞

- 迁移需要 Supabase SQL Editor 执行；本机账号密码登录官网控制台失败（应用账号 ≠
  控制台账号），需要用户执行 SQL 或提供 Supabase Personal Access Token。
- 前端生产仓库 `DengTaHome/dengta-home-frontend` 对当前 GitHub PAT 返回 404，
  UI 无法上线；需要仓库访问权限或用户自行推送。


## 当前实现状态（2026-10-29）

- **已上线（微信/owner）**：`channel_persona` per-turn 覆盖 + 服务端过滤
  `user_details` / DB memories / knowledge / worldbook / special dates / interests，
  并强制 `intimate_expression_enabled=false`；仅内部 `isChannelBridge` 路由可传该字段。
- **已上线（本地工具）**：selection.json + `select-ui.mjs`（127.0.0.1:3111）；所有小节/记忆
  默认关闭，缺失/损坏/全空 fail-closed 到最小安全人设。
- **draft 未执行**：`068_channel_persona_sync.sql` 尚未在数据库执行；RLS/默认值已按
  “全部默认关闭 + companion 归属校验 + 绑定只读”修正，但仍需人工确认后再执行。
- **未完成**：QQ 多用户绑定/自动建号、DengTa 前端勾选 UI、媒体收发管线；
  微信桥的 rate-limit 队列/重试策略仍待改进。

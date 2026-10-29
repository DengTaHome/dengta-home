# 独立栏目：一起听 / X / 微信 / QQ（2026-10-29）

## 导航
`src/feature-navigation.js` 新增独立分组「一起听与连接」：

- `music` → 一起听（原来的听歌页，完整歌单/网易云/队列/导入/一起听）
- `x` → X / Twitter
- `wechat` → 微信
- `qq` → QQ

手机快捷栏改为：聊天、一起听、微信、X；QQ 在「更多」里。旧「一起体验」仍保留一起看/放映厅。

## X Hub
`src/XHub.jsx`：

- 从 `/api/mcp/connections/status` + `/manage` 读取真实 X/twikit MCP 连接（工具名识别）
- 显示连接状态、工具列表
- 搜索：调用 `search_tweets`
- 发帖：调用 `post_tweet`，必须勾选二次确认
- 新增后端通用工具调用：
  - `services/mcp-device-center.js` 暴露 `callTool(connectionId, toolName, args)`
  - `POST /api/mcp/connections/manage/:id/tools/:toolName/call`
  - 参数按 MCP `inputSchema` 校验，结果限制大小
- 上游 X/twikit 目前搜索返回 `Twitter search error: 404`，Hub 会显式显示失败，不伪造成功。

## 微信 / QQ 通道 Hub
`src/ChannelHub.jsx` + `channel-hub.css`：

### 人设与记忆同步
- 真实读取 `persona_sections`、`channel_sync_preferences`、`memories`
- 模式：日常小节 / 勾选 / 全部；勾选小节；说话风格；记忆模式（none/recent/selected/all）、条数、媒体开关
- 保存 `PUT /api/v2/channel-sync/preferences`
- 移除了旧的全局 `persona_sections.enabled` PATCH，避免微信保存把 QQ 勾选关掉；服务端 `buildChannelPersona` 改为按各通道 `persona_mode + persona_section_ids` 过滤

### 绑定
- `POST /api/v2/channel-sync/bind/start`：生成 6 位一次性码，10 分钟有效
- `GET /api/v2/channel-sync/bind/status?channel=...`
- `DELETE /api/v2/channel-sync/bind/:id`
- 新增桥接端 `POST /api/v2/qq-bridge/bind/confirm`（桥接 token 鉴权）：按 code hash 找到 pending，写入 external_id 并 active
- `resolveQQScope` 支持 DB `channel_bindings` fallback：桥接发送 external_id（WeChat fromUserId / QQ 号），不再只依赖本地 config
- 微信 `auto-reply.mjs`：
  - 收到 6 位码时调用 confirm 绑定
  - chat 时把 `qq` 传为发送者 external_id
- 已实测：生成码 → 桥接 token confirm → `active` → `/api/v2/qq-bridge/context` 用该 external_id 解析到正确 user/companion/persona。测试记录已清理。

### 已知限制
- 微信桥必须重启后才加载新逻辑；本轮已重启本机 bridge。
- SnowLuma QQ 桥脚本本身还没有发绑定码/写 external_id 的自动逻辑；QQ 通道 sync 真实可用，但 QQ 动态绑定需要再改 QQ 桥。
- 媒体/NSFW 只保存开关，未实现完整媒体管线。
- 微信/QQ 的绑定码 confirm 目前以绑定码作为持有证明；后续建议加 bridge 限流/锁定。

## 一起听
独立栏目复用现有 `TogetherMusic`（歌单、网易云二维码登录、队列、播放、回忆、一起听同步），已完成手机/平板/桌面适配。
**没有**直接移植 `_refs/music-mcp-netease/client/index.html`（4590 行、60+ 接口，依赖独立 music.k 服务和 token）；Elephant 建议用 iframe/独立子域，不要重写。这是后续单独决策项。

## 命令面板
- 最近使用 chip（保存 6 条、展示 4 条）
- 搜索清空按钮
- 结果计数
- 键盘高亮 scrollIntoView
- 手机 16px 输入防缩放、44px recent chip
- 夜/日主题显式深色文字（修正夜间浅字浅底）
- Hub 新入口自动出现在命令面板

## 审查
- Elephant（架构）：指出绑定断链、微信同步只写不读、X 半伪、一起听外部完整页未搬；本轮已修绑定/DB scope/同步冲突/最近使用布局，剩余 X 上游/QQ 桥/一起听完整页列为后续。
- Goldfish（只读）：确认 4 个入口切到正确 `.view-*`；微信/QQ 读到 41 小节 + 19 记忆；绑定码生成成功；X 读到 12 工具；320/390/844/1280 无溢出；发现夜间对比度、recent 布局、dock 遮挡、同步冲突，本轮逐项修复。


## 两轮审查后的修复（2026-10-29 21:00）
Elephant（架构）与 Goldfish（只读）都跑完：

- **绑定断链**：补 `POST /api/v2/qq-bridge/bind/confirm`（桥接 token），`resolveQQScope` 增加 DB `channel_bindings` fallback；微信 auto-reply 收到 6 位码时自动 confirm，并把发送者 external_id 传给 `/chat`。已实测「生成码 → confirm → context 解析到 user/companion」；测试记录已清理。
- **同步冲突**：删除 ChannelHub 对全局 `persona_sections.enabled` 的 PATCH；`buildChannelPersona` 去掉 `.eq("enabled", true)`，改由每个通道的 `persona_mode + persona_section_ids` 决定。微信保存不会关掉 QQ 勾选。
- **夜间对比度**：Hub 标题/卡片 h3/连接名/toast 全部显式深色；命令面板 input、行副标题、footer、计数显式深色；`goldfish-hubs/audit-palette` 最终 0 contrast failure。
- **最近使用布局**：recent 从第 5 个 grid 子项移入结果列表，修复行高 0/被“聊天”覆盖；390 recent 截图可见。
- **dock 遮挡**：默认位置下移到屏幕下半部，旧 localStorage 位置在 y<220 时回弹；减少遮住 hub 标题/标签。
- **UI**：微信/QQ 自定义复选框与开关、绑定码状态、X 工具列表；绑定状态失败不再强行显示“待绑定”（保留读取失败提示）。

## 仍未闭环（需要下一轮）
- 一起听的**外部完整页**（`_refs/music-mcp-netease/client/index.html`）没有移植/嵌 iframe；当前独立栏目仍是 DengTa 自己的 TogetherMusic。外部 music 服务当前 HTTP 超时，iframe 需要单独子域/反代/token。
- X 上游 twikit 的 `search_tweets` 返回 `Twitter search error: 404`；Hub 能正确显示失败，但搜索不可用。12 工具中只接了搜索/发帖两个操作，其余仍是只读工具清单。
- QQ 桥脚本（SnowLuma）尚未自动处理绑定码；QQ 通道 sync 真实可用，QQ 动态绑定需要再改 QQ 桥。
- 媒体/NSFW 只保存开关，没有完整媒体管线；绑定 confirm 目前以 6 位码作为持有证明，建议后续加限流/锁定。


## 最终验证（2026-10-29 21:10）
- 前端全量：**0 failure（3834 行）**
- 后端全量：0 failure（5 tests）
- Vercel `72cdb13` READY
- 手机 APK：`_audit/DengTa-2.13.44-302-hubs.apk`，SHA-256 `78d325ae0f77a510a0a60c1c60de292089ba34c47bfe62574bb49ac79326b444`，已 `adb install -r` 到 vivo V2454A，启动正常。
- Goldfish 最终 palette/hubs：320/390/844/1280 四入口正确、无横向溢出；命令面板对比度失败已清零；最近使用 chip 在结果列表内可点；绑定码生成成功。

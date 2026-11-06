# QQ / 微信本地接入部署交接文档

> 目的：让下一位 AI 或工程师在不猜测的情况下，接手本机 QQ、微信与 DengTa 的桥接栈。
> 最后实测：2026-11-06（Asia/Shanghai）。本机为 Windows 11，Node 在 `D:\GZdeepseek\_tools\node`。
> **本文不包含任何 token、密码、Cookie、二维码或聊天正文；这些只在下面列出的本机文件中。**

---

## 0. 先记住结论

本机不是“一个统一服务”，而是三套东西：

1. **QQ 本地桥接栈**
   - SnowLuma 注入 QQ → OneBot v11（HTTP 3000 / WS 3001）
   - `qq-bridge` Node 进程：连接 SnowLuma + 本机 DSH Agent，提供本地控制台
   - DSH 桌面 API（桥接配置当前写的是 `http://127.0.0.1:64020`）
   - 本地目录：`D:\GZdeepseek\_refs\qq\qq-bridge`
   - **本地控制台：`http://127.0.0.1:3100`**（需要 `state/console-token` 里的令牌；直接打开会 401）

2. **微信 iLink 本地桥**
   - `wechat-ilink-bridge-hardened` CLI（可执行 `wxb`）
   - 本地目录：`D:\GZdeepseek\wechat-bridge`
   - 自动回复：`D:\GZdeepseek\dengta-home\tools\wechat-dengta-bridge\auto-reply.mjs`
   - 勾选界面：`D:\GZdeepseek\dengta-home\tools\wechat-dengta-bridge\select-ui.mjs`
   - **本地勾选地址：`http://127.0.0.1:3111`**

3. **DengTa 生产后端**
   - `https://dengta-home-backend-rkmq.onrender.com`
   - 负责微信自动回复的 `/api/v2/qq-bridge/chat`、通道绑定、通道人设/记忆同步
   - 正式前端 ChannelHub：设置里的微信/QQ 绑定页

### 当前实测运行状态（2026-11-06）

| 服务 | 地址/路径 | 状态 |
|---|---|---|
| QQ 桥控制台 | `http://127.0.0.1:3100` | **端口在监听**，HTTP 401 是正常的鉴权保护；`state/bridge.lock` = 当前 PID |
| SnowLuma WebUI | `http://127.0.0.1:5099` | **未运行/端口未监听** |
| SnowLuma OneBot HTTP/WS | `127.0.0.1:3000` / `3001` | **未监听** |
| DSH API | 配置里写 `127.0.0.1:64020` | **未监听**（DSH 每次启动端口可能变，必须核对并更新配置） |
| 微信自动回复 | `auto-reply.mjs` | **未运行**，`wechat-auto-reply-state/bridge.lock` 是旧锁 |
| 微信勾选界面 | `http://127.0.0.1:3111` | **未运行** |
| DengTa 后端 | Render 正式地址 | 正常 |

也就是说：**QQ 桥进程只启动了一半，上游 SnowLuma/OneBot 和 DSH 都不在，端到端 QQ 目前不可用；微信自动回复也停了。** 需要按第 3、4 节恢复。

---

## 1. 本地地址总表

### QQ
- 本地控制台：`http://127.0.0.1:3100`
- 控制台令牌文件：`D:\GZdeepseek\_refs\qq\qq-bridge\state\console-token`
- SnowLuma WebUI：`http://127.0.0.1:5099`
- SnowLuma OneBot HTTP：`http://127.0.0.1:3000`
- SnowLuma OneBot WS：`ws://127.0.0.1:3001`
- DSH 桌面 API：以 DSH 实际启动日志为准；桥接配置当前为 `http://127.0.0.1:64020`

### 微信
- 勾选/同步界面：`http://127.0.0.1:3111`（仅 `127.0.0.1`，不对外）
- 微信 iLink 登录态：`D:\GZdeepseek\wechat-bridge\.wxb`
- 自动回复状态：`D:\GZdeepseek\wechat-auto-reply-state`
- 自动回复日志：`D:\GZdeepseek\wechat-auto-reply-state\bridge.log`

### DengTa
- 正式前端：`https://www.dengtahome.com`
- 正式后端：`https://dengta-home-backend-rkmq.onrender.com`
- 健康检查：`https://dengta-home-backend-rkmq.onrender.com/health`
- 更新 feed：`https://www.dengtahome.com/updates/android.json`

---

## 2. 目录与文件地图

### QQ
```
D:\GZdeepseek\_refs\qq\qq-bridge\
  src\bridge.js                 # 主桥接进程
  src\mcp-host-server.js       # 本机 MCP host
  src\mcp-snowluma-safe.js     # SnowLuma MCP（只读/白名单）
  config.json                  # 运行配置（含 QQ/SnowLuma token，永远不要提交）
  start.bat                    # 启动（单实例锁 + 自动重启）
  restart.bat                  # 安全重启（按 PID/命令行杀旧实例）
  state\bridge.lock            # 单实例 PID
  state\console-token          # 控制台令牌
  state\*.log                  # 桥接日志
  package.json                 # 依赖/脚本
```
- 主进程 PID 以 `state/bridge.lock` 为准。
- 当前 `config.json` 关键项（值需自己读，本文不复制）：
  - `dsh.baseUrl`：DSH 桌面 API
  - `snowluma.httpUrl` / `wsUrl` / `accessToken`
  - `snowluma.homeDir` / `launcherPath`
  - `ownerQQ`、`allow.private` / `allow.groups`
  - `consolePort`（3100）
  - `socialV2.enabled` / `agentPreset`

### SnowLuma
```
D:\GZdeepseek\snowluma\app\
  launcher.bat                  # 启动器
  ...                           # 便携版本体、日志、配置
```
- 安装/账号信息在 `D:\GZdeepseek\_credentials\snowluma.json`（含密码，**不要打印/提交**）。
- SnowLuma 负责把 QQ 客户端注入成 OneBot v11 服务端；桥接本身不直接登录 QQ。

### DSH
- 桌面版 API 地址会随 DSH 启动变化；不要死信 `64020`。
- QQ 桥要在 `config.json` 的 `dsh.baseUrl` 指向当前 DSH API。
- QQ preset / MCP 安装脚本：`node scripts/setup-dsh.mjs desktop`（安装后必须**完全重启 DSH**）。
- 当前配置加载模式看 `state/mode.json`；模式切换在控制台顶部或 DSH 设置。

### 微信
```
D:\GZdeepseek\wechat-bridge\
  src\cli\index.js              # wxb CLI 入口（wxb fetch/send 等）
  .wxb\                         # 微信登录态（敏感，仅本机）
  package.json                  # wechat-ilink-bridge-hardened v0.3.1

D:\GZdeepseek\dengta-home\tools\wechat-dengta-bridge\
  auto-reply.mjs                # 60s 轮询 → DengTa → wxb send
  select-ui.mjs                 # DB-backed 勾选界面，127.0.0.1:3111
  make-selection.mjs            # 旧的本地 selection 生成器（迁移/预览）
  README.md                     # 启动/行为说明

D:\GZdeepseek\wechat-auto-reply-state\
  bridge.lock                   # 单实例锁（当前可能是旧 PID）
  processed.json                # 去重
  conversations.json            # 微信用户 → DengTa conversation_id
  rate.json                     # 30 条/小时、8s 全局、15s 同用户限速
  bridge.log                    # 自动回复日志
```
- 微信配置：`D:\GZdeepseek\_credentials\wechat-dengta-bridge.json`（含 `token`、绑定 user/companion、路径，**不要打印/提交**）。
- 微信登录态是 `D:\GZdeepseek\wechat-bridge\.wxb`，不是 DengTa 的 SUPABASE cookie。

---

## 3. QQ 恢复顺序（下一位 AI 按顺序做）

### Step 1：确认 DSH 在运行并拿到 API 地址
1. 启动 DSH 桌面版。
2. 从 DSH 的实际启动信息/设置中确认本地 API 地址和端口（历史配置是 64020，但会变）。
3. 编辑（只改字段，不要 cat 整个文件到聊天）：
   `D:\GZdeepseek\_refs\qq\qq-bridge\config.json` → `dsh.baseUrl`
4. 确认 DSH profile 是桌面版 `desktop`。

### Step 2：启动 SnowLuma 并打开 OneBot
1. 运行：
   ```powershell
   D:\GZdeepseek\snowluma\app\launcher.bat
   ```
2. 打开 `http://127.0.0.1:5099`，确认 QQ 已注入/在线。
3. 在 SnowLuma 中启用：
   - OneBot v11 **HTTP API**：`127.0.0.1:3000`
   - OneBot v11 **WebSocket 服务端**：`127.0.0.1:3001`
4. 如果 access token 变了，只更新 `qq-bridge\config.json` 的 `snowluma.accessToken`，不要把 token 贴到任何文档。

验收：
```powershell
Test-NetConnection 127.0.0.1 -Port 3000
Test-NetConnection 127.0.0.1 -Port 3001
```
应为 True。

### Step 3：确保 QQ 桥依赖与 DSH preset 已安装
```powershell
cd D:\GZdeepseek\_refs\qq\qq-bridge
npm ci --no-audit --no-fund
node scripts\setup-dsh.mjs desktop
# 完全重启 DSH
```
验收：DSH 的 preset 列表应包含 `qq-chat` / `qq-chat-v2`；MCP 里能看到 `mcp__snowluma__*`、`mcp__snowluma-host__*`、`mcp__web-search-safe__*`。

### Step 4：启动 QQ 桥
```powershell
cd D:\GZdeepseek\_refs\qq\qq-bridge
.\start.bat
```
- `start.bat` 自带单实例锁和崩溃自动重启。
- 控制台：`http://127.0.0.1:3100`；401 正常，令牌读 `state\console-token`。
- 期望日志：
  - `SnowLuma 已连接 ws://127.0.0.1:3001`
  - `DSH 已就绪（模式: ...）`
  - 控制台启动

### Step 5：验收
1. `state\bridge.lock` PID 存活，`http://127.0.0.1:3100` 可访问（带 token）。
2. 用一个外部 QQ 号给机器人账号发消息（当前主号 `2458077782`）：
   - 桥接日志出现 `新会话 private:...`
   - QQ 能收到 DSH 回复。
3. 模式切换在控制台顶部：`chat / closed-agent / reserved / reserved2`。
4. 如果 DSH/端口变化，先 `.\restart.bat`，不要重复开两个 `start.bat`。

### 已跑过的历史验证
- SnowLuma v2.2.1，注入主号，OneBot 3000/3001 曾在线。
- `qq-bridge` 曾日志显示 `DSH 已就绪（reserved2）`、`SnowLuma 已连接`、控制台 3100。
- 离线 mock 全链路和交互回路曾通过。
- **真实双账号 QQ 回环没有完成的记录**：本机只有一个登录号，需要外部号验收。

---

## 4. 微信恢复顺序

### Step 1：确认微信 iLink 登录态
- 登录态目录：`D:\GZdeepseek\wechat-bridge\.wxb`
- 如果失效，需要在微信中重新扫码/登录 iLink 机器人账号（账号 `36b6e01aa0d2@im.bot` 是历史记录，不要在文档里写 owner 凭据）。
- 只允许本机使用；不要上传 `.wxb`。

### Step 2：启动自动回复
```powershell
$node = 'D:\GZdeepseek\_tools\node\node.exe'
Set-Location D:\GZdeepseek\dengta-home
& $node tools\wechat-dengta-bridge\auto-reply.mjs
```
行为：
- 每 60s 执行 `wxb fetch --maxAttempts 2`；
- 只处理 `trusted` 文本消息；
- 调生产 `POST /api/v2/qq-bridge/chat`（`channel=wechat`）；
- 用 `wxb send --stdin` 发回；
- 30 条/小时、全局 8s、同用户 15s、800–2200ms 拟人停顿。

### Step 3（可选）启动勾选界面
```powershell
& $node tools\wechat-dengta-bridge\select-ui.mjs
```
打开 **`http://127.0.0.1:3111`**，选人设小节/记忆/风格，保存到 DB（`persona_sections`、`channel_sync_preferences`），下一轮生效。
- 只监听 127.0.0.1。
- 需要 DengTa 登录 token；页面会读取/写入生产 `/api/v2/channel-sync`。

### Step 4：绑定与验收
1. 微信 ClawBot 给机器人发一条消息。
2. 看 `D:\GZdeepseek\wechat-auto-reply-state\bridge.log`：应有收到、调用后端、发送成功。
3. 微信侧应收到回复；若 `SESSION_EXPIRED`，停止轮询并重新扫码。
4. DengTa 前端 ChannelHub → 微信：生成 6 位绑定码 → 用已登录的微信 iLink 发送 → 状态变 active（详见 `docs/CONNECTION-HUBS-2026-10-29.md`）。
5. 外部验收：微信主人发消息 → 自动回复 → DengTa DB 绑定/人设生效。

---

## 5. 生产后端与 DB

### 相关接口
- `POST /api/v2/qq-bridge/chat`：桥接 token 鉴权；`channel=wechat|qq`；`client_message_id` 必须是 UUID。
- `POST /api/v2/qq-bridge/bind/confirm`：桥接 token 鉴权；6 位绑定码 + external_id。
- `/api/v2/channel-sync/*`：
  - `persona-sections`
  - `preferences`
  - `memories`
  - `bind/start`、`bind/status`、`bind/:id`
- `GET /health`：`revision`、`voice_lease_degraded` 等。

### DB 表
- `persona_sections`：41 个小节（normal/private/nsfw/style），默认 enabled=false。
- `channel_sync_preferences`：每个用户+伴侣+通道的勾选/记忆模式/媒体开关。
- `channel_bindings`：外部身份（QQ 号/微信 fromUserId）→ DengTa user/companion，含一次性绑定码哈希和过期时间。

### Render 环境变量（值不在文档）
- `QQ_BRIDGE_TOKEN`
- `QQ_BRIDGE_BINDINGS`（历史绑定）
- `SUPABASE_URL` / `SUPABASE_SECRET_KEY`（仅服务端）
- 前端更新：`updates/android.json`

---

## 6. 验证命令（不打印秘密）

```powershell
# 服务端口
Test-NetConnection 127.0.0.1 -Port 3100   # QQ 控制台
Test-NetConnection 127.0.0.1 -Port 5099   # SnowLuma WebUI
Test-NetConnection 127.0.0.1 -Port 3000   # OneBot HTTP
Test-NetConnection 127.0.0.1 -Port 3001   # OneBot WS
Test-NetConnection 127.0.0.1 -Port 3111   # 微信勾选 UI

# QQ 桥
Get-Content D:\GZdeepseek\_refs\qq\qq-bridge\state\bridge.lock
Get-Content D:\GZdeepseek\_refs\qq\qq-bridge\state\console-token   # 只在本机用，勿外传

# 微信
Get-Content D:\GZdeepseek\wechat-auto-reply-state\bridge.lock
Get-Content D:\GZdeepseek\wechat-auto-reply-state\bridge.log -Tail 30

# 后端
Invoke-WebRequest https://dengta-home-backend-rkmq.onrender.com/health
Invoke-WebRequest https://www.dengtahome.com/updates/android.json
```

---

## 7. 常见故障判定

| 现象 | 优先检查 |
|---|---|
| QQ 控制台 3100 401 | 正常；读 `state/console-token`，不是服务挂了 |
| QQ 发消息没回复 | SnowLuma 3000/3001 是否在；DSH API 端口是否改了；`config.json dsh.baseUrl` 是否还指向旧端口；`state/bridge.log` |
| 桥接启动即退出 | `state/bridge.lock` 是否旧 PID；用 `restart.bat`；不要同时开两个 `start.bat` |
| Wooden/仿真模式报错 | DSH 是否安装了 `qq-chat*` preset；DSH 是否重启过 |
| 微信 3111 打不开 | `select-ui.mjs` 是否启动；端口 3111 是否被占用 |
| 微信没自动回复 | `auto-reply.mjs` 是否运行；`.wxb` 是否过期；`bridge.log`；`bridge.lock` 是否旧锁 |
| 微信回复内容不对 | DB 通道勾选（`channel_sync_preferences`）；`selection`/人设是否为空；服务端 `channel_persona` fail-closed |
| 绑定码一直 pending | 桥接端没有调用 `/bind/confirm`；QQ 桥目前没有自动绑定码逻辑，需要桥接端实现或手动用 token confirm |

---

## 8. 升级/优化待办（按优先级）

1. **QQ 上游升级**
   - `qq-bridge` 当前本地版本 v0.2.1-r1；上游已到 v0.2.1-r2（PR #146）。
   - SnowLuma 已到 v2.4.0（本地历史 v2.2.1）。
   - 升级前必须：备份 `config.json`/`state`；跑 `verify:adaptation`/`self-test`；真实 QQ 回环验收。
2. **微信自动回复进程守护**
   - 当前靠手工启动；建议做计划任务/服务守护，并在 `SESSION_EXPIRED` 时通知用户。
3. **绑定自动化**
   - 微信 iLink 已支持收到 6 位码自动 confirm；QQ 桥上游还没有自动绑定码逻辑，需要补或改桥接端。
4. **UI**
   - 正式 ChannelHub 已支持复制绑定码/倒计时/自动检测；微信勾选仍可用本机 3111 过渡界面。
5. **安全**
   - QQ 主号注入有封号风险；建议专用小号。
   - 所有 token/Cookie 只在 `_credentials` 和 `.wxb`；不写文档、不进仓库。
   - `.wxb`/state/qq config 只留本机，不公网暴露。

---

## 9. 给下一位 AI 的接手提示

1. 先按第 0 节核对当前到底哪些端口在监听，不要假设 SnowLuma/DSH 还在。
2. QQ 先恢复 SnowLuma → OneBot → DSH → qq-bridge，顺序不能反。
3. 微信先确认 `.wxb` 登录态，再启动 `auto-reply.mjs`，最后开 `select-ui.mjs`。
4. 任何配置改动只改字段，不要把 `config.json`、`wechat-dengta-bridge.json`、`.wxb` 内容打印到聊天或写进 docs。
5. 每次改动后按第 6 节做端口/日志验证，并用真实外部 QQ/微信账号做一次收发回环。

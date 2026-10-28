# QQ 接入栈恢复结论与 Runbook（qqbridge + SnowLuma + DSH）

> 状态：**已完成可恢复性验证（DSH 内核链路 + 离线全链路），真实 QQ/SnowLuma 段待用户扫码后验证。**
> 产出：`tools/qq-bridge-recovery/`（启动/停止/自检脚本、mock OneBot、脱敏配置模板、原始日志）。
> 日期：2026-10-28；执行环境：Windows 11 + Node v24.22.1 + DSH 桌面版 0.2.1-rc.3（`http://127.0.0.1:64020`）。

---

## 1. 结论

### 1.1 用户之前部署的是哪一套

**最可能：Derpyu520 的 `qq-bridge`（SnowLuma OneBot v11 ↔ DSH 桥接）+ SnowLuma。**

判断依据：
1. 用户描述是“qqbridge + snowluma + dsh 链接 QQ 的插件”——`qqbridge`、`snowluma` 两个关键词直接命中
   `_refs/qq/qq-bridge`（包名 `qq-bridge`、依赖 `@snowluma/sdk`、README 自述“把 QQ 消息接入 DSH agent”）；
   “dsh 插件”对应它要求执行的 `setup-dsh.mjs`（向 DSH profile 装 `qq-chat`/`qq-chat-v2` preset
   + 3 个 MCP + `qq-mode-console` 插件 bundle）。
2. 本机残留信号吻合：DSH 0.2.1-rc.3 桌面版运行中（上游 v0.2.1-r1 正是为 0.2.1 线适配的版本）；
   `_refs/qq/` 里三套候选都已克隆，其中 qq-bridge 与用户措辞最贴近。
3. 反证：`dsh-qq-bot` 是 NapCat/Docker 路线的纯插件，不需要 SnowLuma；`qq-bridge-dsh` 是 macOS+LLBot
   衍生版、带 DSH 设置页控制中心，用户措辞里没有“设置页/LLBot/macOS”的线索。
4. 本机没有 qqbridge/snowluma 残留配置（侦察已确认），所以“恢复”= 重新 clone/安装（已完成依赖安装）
   + 重建 DSH 端 + 用户重新装 SnowLuma 并扫码。

### 1.2 恢复优先级（推荐主链路）

| 优先级 | 组合 | 定位 | 结论 |
| --- | --- | --- | --- |
| **P0（推荐）** | **qq-bridge v0.2.1-r1 + SnowLuma** | 用户原部署；DSH 0.2.1 适配版 | **主链路**。本次已完成依赖、DSH 鉴权/回合/离线 E2E 验证；只差用户装 SnowLuma + 跑 `setup-dsh.mjs desktop` + 扫码 |
| P1（备选） | dsh-qq-bot v1.4.0（纯 DSH 插件 + NapCat/Docker） | 最省心的“插件化”路线 | 可在 rc.3 上安装（peer 依赖齐全），但**本机没有 Docker**；且不是用户原链路（无 SnowLuma）。不替用户安装 |
| P2（暂不推荐） | qq-bridge-dsh v0.3.3（衍生版 + 设置页控制中心） | macOS/LLBot 向，适配 DSH 0.2.0-rc.2 | **在 0.2.1-rc.3 上有硬伤**：preset 仍含 `{{cwd}}`，rc.3 已删该变量且 fail-loud → 每个 QQ 回合直接 error（“发消息没反应”）。需先移植上游修复 |

三套候选差异（关键项）：

| 项 | qq-bridge（Derpyu520） | qq-bridge-dsh（leonathan369-droid） | dsh-qq-bot（wufa-cat） |
| --- | --- | --- | --- |
| 版本/日期 | v0.2.1-r1 / 2026-10-22 | v0.3.3 / 2026-10-24 | v1.4.0 / 2026-10-25 |
| 上游 QQ 网关 | **SnowLuma**（OneBot v11） | SnowLuma 或 LLBot（macOS 适配） | **NapCat（Docker）** |
| 形态 | 独立 Node 桥接进程 + 本地控制台 + DSH 端 preset/MCP | 同上 + **DSH 设置页「QQ 桥接」控制中心**（`qq-bridge-panel`） | **纯 DSH 插件**（`dsh` 字段：bundle patch + web client） |
| 官方适配 DSH | **0.2.1-rc.2（也兼容 0.2.0-rc.2）** | 0.2.0-rc.2 | `>=0.1.5-alpha.1`（范围宽） |
| 0.2.1 `{{cwd}}` 修复 | ✅ 已修（v0.2.1-r1 P0） | ❌ 未修（preset 仍写 `{{cwd}}`） | N/A（自己的提示词体系） |
| 在本机 rc.3 的可行性 | ✅ 内核链路实测可用（见 §3） | ⚠️ 需先移植修复 | ⚠️ 需 Docker + NapCat 且未实测 |
| 一键自检 | `self-test` / `test:audit` / `verify:adaptation` | 同上游 + panel 测试 | 无 CLI 自检（界面自检） |

---

## 2. 恢复步骤（主链路，按顺序）

> 详细命令/字段说明见 [`tools/qq-bridge-recovery/README.md`](../tools/qq-bridge-recovery/README.md)。
> 前置：qq-bridge 仓库在 `D:\GZdeepseek\_refs\qq\qq-bridge`（已克隆、依赖已装好）。

**Step 0 环境核对**
- Node ≥ 22.13（本机 `D:\GZdeepseek\_tools\node\node.exe`，v24.22.1）；
- DSH 运行中：桌面版 API 在 `http://127.0.0.1:64020`（Web 版默认 3080）；
- 确认 `%USERPROFILE%\.dsh\.credentials.yaml` 存在且含 `client-connection/browser-session`
  （桥接靠它离线铸造 Cookie，不需要 authToken）。

**Step 1 依赖（已完成，换机时重做）**
```powershell
cd D:\GZdeepseek\_refs\qq\qq-bridge
npm ci --no-audit --no-fund        # 代理：$env:HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:10809
```
postinstall 会修补 `@snowluma/*` 的 ESM 打包 bug（实测 13 文件）；**不要改源码绕过**。

**Step 2 DSH 端安装（必做，当前未做）**
```powershell
node scripts/setup-dsh.mjs desktop   # 桌面版 profile 是 desktop，脚本默认 web → 必须显式传
# 完全重启 DSH（preset/MCP 只在启动时加载）
```
验收：DSH 的 `agentPresets/list` 出现 `qq-chat` / `qq-chat-v2`（当前只有 `standard,ptc,minimal,cordis`）；
QQ 会话能挂上 preset；`mcp__snowluma__*` / `mcp__snowluma-host__*` / `mcp__web-search-safe__*` 工具可见。

**Step 3 SnowLuma（用户自己完成）**
- 下载 win-x64 完整包 → 解压 → `launcher.bat` → WebUI 引导（同意条款/设密码/**扫码登录机器人 QQ**）；
- 开 OneBot **WebSocket 服务端**（默认 3001）+ **HTTP API**（默认 3000），记下 accessToken（没设就留空）；
- 桥接 config 的 `snowluma.homeDir` 指向 SnowLuma 安装目录（token 自愈需要）。

**Step 4 配置**
```powershell
cd D:\GZdeepseek\dengta-home\tools\qq-bridge-recovery
Copy-Item .\config.recovery.example.json .\config.json
notepad .\config.json   # 填 dsh.baseUrl、snowluma.wsUrl/httpUrl/accessToken/homeDir、ownerQQ、allow.*
```

**Step 5 启动 / 观察**
```powershell
powershell -ExecutionPolicy Bypass -File .\start-qq-bridge.ps1
# 期望：SnowLuma 已连接 → DSH 已就绪（模式: …）→ 控制台 http://127.0.0.1:3100
```
首次 WS 若报 `code=1006` 属正常（HTTP/WS token 不同），自愈重连后即 `SnowLuma 已连接`。

**Step 6 验收**
1. `powershell -File .\run-selfcheck.ps1`（离线全链路，不登录 QQ）→ 期望 `✅ 通过 … 收到`；
2. 真实链路：QQ 给机器人发消息 → DSH 建会话（日志 `新会话 private:…`）→ 回复回到 QQ；
3. 模式切换：桥接控制台 `http://127.0.0.1:3100`（令牌 `state/console-token`）→ chat / closed-agent /
   reserved / reserved2；仿真模式必须已装 `qq-chat*` preset（否则 fail-closed 拒绝建会话）；
4. 异常排障查 `tools/qq-bridge-recovery/README.md` §9 或上游 `docs/guides/DSH_SETUP.md` 常见问题。

**Step 7 回退**：停桥接（`stop-qq-bridge.ps1` / `restart.bat`）→ DSH 端可保留（preset/MCP 不影响
非 QQ 会话）→ 如需彻底撤销，重跑 `setup-dsh.mjs` 前备份的 profile 配置
（`cordis.patch.yml.qq-bridge.bak`）并重启 DSH。

---

## 3. 已验证项（2026-10-28，本机）

| 类别 | 项目 | 结果 |
| --- | --- | --- |
| 安装 | `npm ci` + postinstall 修补 | ✅ 128 包；`@snowluma/sdk` 13 文件修补；纯 Node ESM 可 import |
| DSH 鉴权 | `test:dsh-auth`（64020） | ✅ 16/16（32 字节签名密钥 → 铸造 Cookie → HTTP 200） |
| DSH 协议 | `self-test` | ✅ 建会话 → prompt 接受 → 回合 completed → 回复“收到” → 归档 |
| DSH 工具面 | `test:mcp-servers` | ✅ snowluma 38 + host 1 + web-search-safe 2 工具握手 |
| 回归 | `test:audit` | ⚠️ 33/35（2 个失败：缺 `docs/guides/VOICE.md`；DSH 模块在 app.asar 内找不到） |
| 回归 | `test:hardening` | ✅ 36/36 断言 |
| 离线 E2E | `run-selfcheck.ps1`（mock OneBot + 真实 DSH） | ✅ 注入 QQ 私聊 → 桥接 → DSH 建会话(standard) → 选模型 `deepseek-account/deepseek-flash(max)` → agent 回复“收到” → 桥接发回 mock |
| 交互回路 | ask_user_question 转发 | ✅ agent 反问 → 桥接转发到 QQ → 回复选项 → 回合继续 → 547 字正式回复送达 |
| 运维脚本 | start/stop（前台+后台） | ✅ 启动、PID/日志、单实例锁、停止清理均验证 |
| 版本身份 | DSH CLI | ✅ `dsh --version` → `0.2.1-rc.3`（桌面版 FileVersion 一致） |

失败/受限项及原因：
- `test-voice-system`：公开 clone 缺 `docs/guides/VOICE.md`（上游 `.gitignore` 排除）；
- `test-preset-local-tools`：本机扫描不到 `dsh_snapshot` / `dsh_rollback` / `incident_resolved`
  （rc.3 安装包里没有这些工具名；上游在 rc.2 记录 75/75）。影响：restrict 对这 3 个名字静默失效，
  但工具本身不存在 ⇒ 无本地能力暴露；**升级后需上游重新对账守卫名单**；
- `test-encoding`：0 通过 0 失败（需要仓库上一级 `voice-tool/`，全部跳过）；
- `verify:adaptation`：**本机不可完整运行**——DSH 桌面模块在 `app.asar`（Electron-as-Node 可越过）、
  脚本硬编码 `profiles/web`（本机是 `desktop`）、且要求 DSH 端已安装 + 仓库 config.json。
  按上游说明它面向 **DSH 0.2.1-rc.2 + web profile**；本机记“不适用”，改由上面三项活体测试覆盖。

---

## 4. 未验证项与风险

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 真实 SnowLuma/QQ 未验证 | 本机无 SnowLuma 安装、无账号凭据；`[Hook]` 注入、扫码、真实收发都没跑过 | 用户按 Step 3 装 SnowLuma、扫码后做首条真实消息验收；留意 SnowLuma `logs/snowluma-*.log` 的 `[Hook]` 行 |
| DSH 端安装未执行 | `setup-dsh.mjs desktop` 会改 `~/.dsh/profiles/desktop`（preset/MCP/bundles），本次**刻意未执行**以免影响正在运行的 DSH | 用户确认后执行并重启 DSH；验收 `agentPresets/list` 含 `qq-chat*` |
| 0.2.1-rc.3 vs rc.2 | 上游适配目标是 rc.2；rc.3 上内核链路实测正常，但守卫名单有 3 个名字对不上 | 升级 DSH 前后各跑 `scan-dsh-tool-names --missing` 与 `probe-tools qq-chat-v2`（需先完成 DSH 端安装） |
| 桌面版路径/profile 差异 | API 64020、profile `desktop`、模块在 app.asar | 已写进 runbook；`verify/self-test` 需 `DSH_BASE_URL`/`DSH_INSTALL_MODULES` 等环境变量 |
| 富媒体/语音 | 依赖 SnowLuma 实际能力与 QQ 返回 | 不在本次验收内；控制台 `tools.sendVoice` 默认关 |
| 单实例/锁 | 桥接强单实例；异常退出可能留锁 | `stop-qq-bridge.ps1` 自动清死锁；不要并发起两个桥接 |

---

## 5. dsh-qq-bot 作为 DSH 插件的安装可行性（本次不安装）

- **可行性：高**。它是标准 DSH 插件：`package.json` 有 `main=lib/index.js`、`exports ./client`、
  `dsh.manifestVersion=1`、`dsh.bundle.patch=./cordis.patch.yml`、`dsh.client{platform:web, inject:[@deepseek-ai/dsh-client-locale]}`、
  `dshhub` 市场元数据；`cordis.patch.yml` 只插一行 `id: qq-bot, name: dsh-qq-bot`。
  `engines.dsh >= 0.1.5-alpha.1` 与本机 0.2.1-rc.3 兼容；peer 依赖（`dsh-agent/brand/llm/session/system-prompt`）
  在 rc.3 安装包内全部存在（实测 0.2.1-rc.3）。
- **安装步骤（记录，未执行）**：
  1. 前置：DSH 已装；**Docker Desktop 已装并启动**（本机未安装）；NapCat 由插件用 `docker compose` 拉起。
  2. `D:\deepseek\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add <本仓库目录|tgz|git+https|npm>`
     （`dsh` 不在 PATH，用桌面版自带 CLI；`plugin` 参数会转发给 profile 里的 pnpm）。
  3. **完全退出并重启 DSH**（Host 侧代码生效）。
  4. 设置 → QQ 机器人 → 初始化目录（默认 `%USERPROFILE%\dsh-qq-bot`）→ 环境自检 → 启动服务
     （`docker compose up -d`）→ 打开 NapCat WebUI **扫码登录机器人 QQ** → 添加机器人
     （WS `ws://127.0.0.1:3001`，token 没设留空）。
  5. 群里 `@机器人 /ping` 验收。
- **注意**：仓库 clone 里没有 `dist/dsh-qq-bot-1.4.0.tgz`（`DISTRIBUTE.md`/`SHA256SUMS.txt` 提到但未随
  公开仓库提供），安装用目录或自行 `npm pack`；目录安装不装依赖，v1.2.2 起回退 Node 内置 WebSocket。
- 与主链路互斥性：它**不经过 SnowLuma**，与 qq-bridge 同时跑会抢 OneBot 端口/消息；二选一。

---

## 6. 与 DengTa 接入的边界（交接 Lead）

- **QQ → DSH**：已由 qq-bridge 完整覆盖（QQ 消息→DSH 会话 prompt；回复/提问/审批→QQ）。
  这部分恢复后即可用，无需 DengTa 参与。
- **QQ → DengTa**：**不能复用 qq-bridge 直接接**——qq-bridge 说的是 DSH 的
  Cookie 鉴权 / 斜杠 RPC（`/api/<ns>/<method>`）/ `remote.mux` 事件流协议，而 DengTa Home 是
  自己的 Express backend + Supabase（`backend/`、`frontend/`），API 形状完全不同。
  需要单独写一个 OneBot v11 适配器：SnowLuma/OneBot 事件 → DengTa backend 的会话/消息 API，
  并把 DengTa 的回复通过 OneBot `send_private_msg/send_group_msg` 发回；鉴权、白名单、
  “群友不得触达本地工具”的安全基线应沿用 qq-bridge 的做法（fail-closed 白名单）。
- 可复用资产：`tools/qq-bridge-recovery/mock-onebot.mjs`（OneBot v11 WS+HTTP 仿真，可用于
  离线测试任何 OneBot 侧适配器）；`README.md` 的排障表与 SnowLuma/OneBot 字段说明。
- 建议由 Lead 决定 DengTa 适配器落在 `backend/` 还是新增 `tools/` 下；本次恢复未触碰
  `backend/frontend/` 的任何文件。

---

## 7. 证据与产出清单

产出目录 `tools/qq-bridge-recovery/`：
- `README.md`（一页式恢复手册 + 完整验证记录）
- `start-qq-bridge.ps1` / `stop-qq-bridge.ps1` / `run-selfcheck.ps1`
- `mock-onebot.mjs`（OneBot v11 WS+HTTP 仿真）/ `archive-test-session.mjs`
- `config.recovery.example.json`（脱敏模板）/ `config.selfcheck.example.json`（假号自检配置）
- `logs/`：`install-npm-ci.log`、`self-test.log`、`test-audit.log`、`test-dsh-auth.log`、
  `test-hardening.log`、`test-mcp-servers.log`、`test-encoding.log`、
  `test-preset-local-tools-electron.log`、`verify-adaptation.log`、
  `run-selfcheck.console.log`、`bridge-20261028-213607.out.log`、
  `mock-onebot-20261028-213607.jsonl`、`start-script-test.log`、`stop-script-test.log`
- `artifacts/`：自检运行态留存（`config.selfcheck-used.json`、`state-*.json`）

外部目录（允许的运行产物，未改源码）：`_refs/qq/qq-bridge/node_modules/`、`package-lock.json`；
本次为验证临时写入的仓库 `config.json` / `state/` 已在验证后删除。**未提交 git。**

---

## 8. 待 Lead/用户决策

1. 是否执行 `node scripts/setup-dsh.mjs desktop` 并重启 DSH（会改用户 profile；本次未做）；
2. 是否安装 SnowLuma 并提供扫码（真实 QQ 段只能由用户完成）；
3. 是否需要把 qq-bridge-dsh 的 DSH 设置页控制中心移植到主链路（需补 0.2.1 适配）；
4. DengTa 侧 QQ 适配器的归属与形态（见 §6）。

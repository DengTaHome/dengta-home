# QQ 接入栈恢复工具包（qqbridge + SnowLuma + DSH）

> 目标：把「QQ ↔ SnowLuma(OneBot v11) ↔ qq-bridge ↔ DeepSeek Harness」这条链路恢复成可复现、可自检、可排障的状态。
> **本目录只做恢复/验证，不改 qq-bridge 源码，不写真实凭据，不登录真实 QQ。**
>
> 本机侦察结论：用户此前部署的是 **Derpyu520/qq-bridge（v0.2.1-r1）+ SnowLuma**，DSH 端通过 `setup-dsh.mjs`
> 装 `qq-chat`/`qq-chat-v2` preset + 3 个 MCP server。当前机器上已无 qqbridge/SnowLuma 残留配置，
> 但 DSH 桌面版（0.2.1-rc.3）正在 `http://127.0.0.1:64020` 运行，桥接内核链路已实测可用。
> 完整论证与三套候选对比见仓库文档 **[`docs/QQ-BRIDGE-RECOVERY.md`](../../docs/QQ-BRIDGE-RECOVERY.md)**。

---

## 1. 目录内容

| 文件 | 作用 |
| --- | --- |
| `README.md` | 本文件：一页式恢复手册 + 验证记录 |
| `start-qq-bridge.ps1` | 启动桥接（读本目录 `config.json`，同步到仓库后启动；支持 `-Background`） |
| `stop-qq-bridge.ps1` | 停止桥接（只杀命令行含 `bridge.js` 的 node 进程，清理锁/PID） |
| `run-selfcheck.ps1` | **离线全链路自检**：mock OneBot + 桥接 + 真实 DSH，跑通「QQ→桥接→DSH→桥接→QQ」 |
| `mock-onebot.mjs` | 本地模拟 SnowLuma 的 OneBot v11 正向 WS + HTTP API（不登录 QQ 的验收工具） |
| `archive-test-session.mjs` | 归档自检产生的 DSH 会话（避免污染会话列表） |
| `config.recovery.example.json` | 恢复用**脱敏**配置模板（复制为 `config.json` 后填写） |
| `config.selfcheck.example.json` | 离线自检用假配置（ownerQQ=10001，仅 mock 场景） |
| `logs/` | 本次验证的原始日志（安装、测试、自检；已加入 `.gitignore`。注意：若协作方曾用 `git add -A` 提交过早期的 `logs/mock-onebot.jsonl`，需要 `git rm --cached` 才能停止跟踪） |
| `artifacts/` | 验证过程留存的运行态证据（`git` 忽略） |

依赖：`npm install`（仅 `mock-onebot.mjs` 需要 `ws`；桥接自身的依赖装在 `_refs/qq/qq-bridge`）。

---

## 2. 环境要求（本机实测值）

| 组件 | 要求 | 本机 |
| --- | --- | --- |
| OS | Windows 10/11 | Windows 11 22621 |
| Node.js | **≥ 22.13**（qq-bridge engines） | v24.22.1（`D:\GZdeepseek\_tools\node\node.exe`） |
| npm | 随 Node | 11.19.1 |
| DSH | 桌面版或 Web 版，**运行中** | 桌面版 **0.2.1-rc.3**（GUI/API `http://127.0.0.1:64020`） |
| DSH profile | `setup-dsh.mjs` 默认 `web`；**桌面版是 `desktop`** | `C:\Users\24580\.dsh\profiles\desktop` |
| SnowLuma | 独立安装（桥接**只探测、不部署**，见其 EULA §5.4） | 本机未安装 → 用 mock 验收 |
| QQ 账号 | 用户自己扫码登录 SnowLuma | 本次未使用（无凭据） |
| 网络 | GitHub 直连不通时用 HTTP 代理 `127.0.0.1:10809` | npm 直连与代理均可用 |

> ⚠️ DSH 0.1.7 起启动 token 只存在内存；桥接默认读 `%USERPROFILE%\.dsh\.credentials.yaml`
> 里的 `client-connection/browser-session` 签名密钥**离线铸造 Cookie**鉴权（本机 32 字节密钥，
> 已在 0.2.1-rc.3 上实测 16/16 通过）。`config.json` 的 `dsh.authToken` **保持空**。

---

## 3. 一次性安装（仓库依赖）

```powershell
$env:HTTP_PROXY="http://127.0.0.1:10809"; $env:HTTPS_PROXY=$env:HTTP_PROXY   # 直连可用可省略
cd D:\GZdeepseek\_refs\qq\qq-bridge
npm ci --no-audit --no-fund          # 本机实测：128 包 / 15s
# 或：npm install
```

- 仓库 `.npmrc` 已设 `legacy-peer-deps=true`；npm 源在本机是 `https://registry.npmjs.org/`，
  直连也能 `npm ping` 通；**代理写法**（需要时）：
  `npm ci --no-audit --no-fund --proxy http://127.0.0.1:10809 --https-proxy http://127.0.0.1:10809`
- `postinstall` 会跑 `scripts/patch-snowluma-sdk.mjs`，修补 `@snowluma/*` npm 包 dist 里
  **相对导入缺 `.js` 扩展名**的打包 bug（本机实测修补 13 个文件；纯 Node ESM 才能 import）。
  **不要改源码绕过**；若手工清过 node_modules，重跑 `node scripts/patch-snowluma-sdk.mjs` 即可。
- 依赖装好后用 `node -e "import('@snowluma/sdk').then(m=>console.log(typeof m.SnowLumaWebSocketClient))"`
  应输出 `function`。

---

## 4. 恢复用 config.json（脱敏模板）

```powershell
Copy-Item .\config.recovery.example.json .\config.json
notepad .\config.json
```

| 字段 | 说明 | 本机建议 |
| --- | --- | --- |
| `dsh.baseUrl` | DSH Web 地址 | **桌面版 `http://127.0.0.1:64020`**；Web 版默认 `http://127.0.0.1:3080` |
| `dsh.provider` / `model` / `reasoningEffort` | 每个 QQ 会话固定的模型 | `deepseek-account` / `deepseek-flash` / `max`（与 DSH 默认一致，实测可用） |
| `dsh.authToken` | 进程启动 token | **留空**（Cookie 铸造，通常不需要） |
| `snowluma.wsUrl` | OneBot **WebSocket** 地址 | `ws://127.0.0.1:3001`（或 SnowLuma 实际端口） |
| `snowluma.httpUrl` | OneBot **HTTP API** 地址 | `http://127.0.0.1:3000`（**别填 WS 端口**，否则 HTTP 426） |
| `snowluma.accessToken` | OneBot accessToken | SnowLuma WebUI 里配了才填；没配留空 |
| `snowluma.homeDir` | SnowLuma 安装目录 | 如 `C:\SnowLuma`；**token/端点自愈靠它**，建议必填 |
| `snowluma.launcherPath` | SnowLuma 启动器路径（可选） | `C:\SnowLuma\launcher.bat` |
| `snowluma.followDiscoveredEndpoint` | 是否跟随自发现的端点并写回 URL | 正式用 `true`；跑 mock/第二实例用 `false` |
| `ownerQQ` | 管理员 QQ（审批、closed-agent 用） | 填自己的 QQ |
| `allow.private` / `allow.groups` | 白名单（fail-closed） | 必须填；留空 + `allowAllWhenEmpty:false` = 不响应任何消息 |
| `agentPreset` / `socialV2.agentPreset` | QQ 会话 preset | `qq-chat` / `qq-chat-v2`（必须先跑 setup-dsh，见下） |
| `consolePort` | 本地控制台端口 | `3100` |
| `consoleToken` | 控制台令牌 | 留空自动生成（完整值在 `state/console-token`） |

> 真实 `config.json` 含 QQ 号/token，**不入库、不贴群**；本目录只放占位模板。

### DSH 端安装（必做，否则 QQ 上完全没反应）

```powershell
cd D:\GZdeepseek\_refs\qq\qq-bridge
# 桌面版 profile 是 desktop（脚本默认 web，必须显式传）
node scripts/setup-dsh.mjs desktop
# 然后【完全重启 DSH】，preset/MCP 只在启动时加载
```

它会：装 `qq-chat`/`qq-chat-v2` preset（bundle `qq-agent-presets`）→ 在 profile 的
`cordis.patch.yml` 挂 `mcp-snowluma` / `mcp-snowluma-host` / `mcp-web-search-safe` →
注册 `qq-mode-console` → 默认模式写 `reserved2`。装完 `agentPresets/list` 里应能看到
`qq-chat`、`qq-chat-v2`（当前未装，实测只有 `standard, ptc, minimal, cordis`）。

### SnowLuma 端（用户自己完成）

1. 从 SnowLuma releases 下载 `win-x64.zip` 解压，启动 `launcher.bat`；
2. WebUI 首次引导：同意条款 → 设密码 → 扫码登录机器人 QQ；
3. 打开 **OneBot WebSocket 服务端**（默认 3001）和 **HTTP API**（默认 3000），
   若设了 accessToken，填进 `snowluma.accessToken`；
4. 把 `homeDir` 指向 SnowLuma 安装目录，桥接才能自愈 per-account 的 HTTP/WS token。

> 已知行为：HTTP token 与 WS token 是**两个不同值**，启动首次 WS 连接报 `1006` 是正常的，
> 桥接随后自愈并重连成功。找不到 `token 自愈失败` 才需要处理（多半是 `homeDir` 不对）。

---

## 5. 启动 / 停止 / 状态

```powershell
cd D:\GZdeepseek\dengta-home\tools\qq-bridge-recovery

# 前台（看日志，Ctrl+C 退出）
powershell -ExecutionPolicy Bypass -File .\start-qq-bridge.ps1

# 后台（PID/日志在 logs\；用 stop 脚本停止）
powershell -ExecutionPolicy Bypass -File .\start-qq-bridge.ps1 -Background
powershell -ExecutionPolicy Bypass -File .\stop-qq-bridge.ps1

# 仓库原生方式（等价）
cd D:\GZdeepseek\_refs\qq\qq-bridge
npm start            # 前台
.\start.bat          # 守护模式（崩溃 5s 自动拉起）
.\restart.bat        # 杀旧实例 → 清锁 → 守护重启
```

- 成功标志日志：`SnowLuma 已连接` + `DSH 已就绪（模式: …）`；控制台
  `http://127.0.0.1:3100`（令牌：`state/console-token`，请求头 `x-console-token`）。
- **单实例**：`state/bridge.lock`；重复启动会被拒绝。异常后先跑 `stop-qq-bridge.ps1`。
- 桥接只能有一个实例；它不启动/停止 SnowLuma，也不登录 QQ。
- 改 `config.json` / `roles/` / 模式后重启桥接生效；改 preset/MCP 后重启 DSH 生效。

---

## 6. 离线自检（不登录 QQ 的验收方式）

```powershell
cd D:\GZdeepseek\dengta-home\tools\qq-bridge-recovery
npm install                                  # 仅 mock 需要 ws
powershell -ExecutionPolicy Bypass -File .\run-selfcheck.ps1
# DSH 不在 64020 时： -DshBaseUrl http://127.0.0.1:3080
```

脚本流程：检查 3000/3001/3100 空闲 → 备份并写自检配置（假 ownerQQ=10001、mode=closed-agent）
→ 起 mock OneBot → 起桥接 → 注入一条私聊消息 → 等 agent 回复被桥接发回 mock → 归档自检
会话 → 恢复原 config/mode。**通过时输出 `✅ 通过 … agent 回复：收到`**。

手动玩法（mock 常驻时）：

```powershell
node mock-onebot.mjs --ws-port 3001 --http-port 3000
# 另一个窗口注入一条 QQ 消息（UTF-8）：
$json='{"user_id":10001,"text":"你好，只回复两个字：收到"}'
$b=[Text.Encoding]::UTF8.GetBytes($json)
$r=[Net.HttpWebRequest]::Create('http://127.0.0.1:3000/mock/inject'); $r.Method='POST'
$r.ContentType='application/json; charset=utf-8'; $r.ContentLength=$b.Length
$s=$r.GetRequestStream(); $s.Write($b,0,$b.Length); $s.Close(); $r.GetResponse().Close()
# 查看 mock 收到的发送内容：GET http://127.0.0.1:3000/mock/state
```

> mock 只仿真 OneBot v11 协议（含 `get_login_info`/`get_status`/`send_private_msg`/`send_group_msg`/
> `send_msg`/`get_msg`/心跳），**不是 SnowLuma 替代品**；未实现动作会记 warn 并返回 retcode 1404
>（桥接对表情同步等失败是优雅降级的）。

---

## 7. 验证记录（2026-10-28，本机）

> 原始日志都在 `logs/`；结论：**桥接内核 + DSH 链路可恢复、已实测可用；真实 QQ/SnowLuma 段留待用户扫码后验证。**

### 7.1 安装

| 项 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund`（代理环境变量） | ✅ 128 包 / 15s（`logs/install-npm-ci.log`） |
| postinstall `patch-snowluma-sdk` | ✅ `@snowluma/sdk` 修补 13 文件，`@snowluma/mcp` 0 文件 |
| 纯 Node ESM import `@snowluma/sdk` | ✅ `SnowLumaWebSocketClient` 可 import |

### 7.2 DSH 活体链路（0.2.1-rc.3 / 64020）

| 测试 | 结果 | 说明 |
| --- | --- | --- |
| `npm run self-test`（`node src/self-test.js http://127.0.0.1:64020`） | ✅ **通过** | Cookie 铸造 → 建会话 → prompt 接受 → 回合 `completed` → 回复「收到」→ 归档（`logs/self-test.log`） |
| `npm run test:dsh-auth`（`DSH_BASE_URL=http://127.0.0.1:64020`） | ✅ **16 通过 / 0 失败** | 32 字节签名密钥、Cookie 名/载荷/有效期、鉴权 200、`agentPresets/list` 可达（`standard,ptc,minimal,cordis`）（`logs/test-dsh-auth.log`） |
| `npm run test:audit` | ⚠️ **33/35 脚本通过** | 2 个失败：① 缺 `docs/guides/VOICE.md`（公开 clone 无此文件）；② 默认定位不到 DSH 安装 node_modules（模块在 app.asar 内）。②解决后暴露出 rc.3 守卫名单 3 个名字对不上（见下）（`logs/test-audit.log`） |
| `npm run test:hardening` | ✅ 全部通过（36 条断言） | 表情/黑话提示词注入面、截断、节假日价目表（`logs/test-hardening.log`） |
| `npm run test:mcp-servers` | ✅ 三个 MCP server 握手正常 | snowluma **38** 工具、snowluma-host **1**、web-search-safe **2**（`logs/test-mcp-servers.log`） |
| `npm run test-encoding` | ⚠️ **0 通过 / 0 失败（全部跳过）** | 断言需要仓库上一级 `voice-tool/`（未克隆），属“跳过”不是通过（`logs/test-encoding.log`） |
| `npm run test:voice` | 未跑 | 依赖 `voice-tool/` 与 docs/guides/VOICE.md（公开仓库中被 .gitignore 排除） |
| `npm run verify:adaptation` | ⚠️ **本机不可完整运行** | ① DSH 桌面模块打包在 `app.asar` 内，`scripts/dsh-modules.mjs` 找不到 → 用 Electron-as-Node + `DSH_INSTALL_MODULES=…\app.asar\dsh\node_modules` 可越过；② 脚本硬编码 `~/.dsh/profiles/web/…`，本机 profile 是 `desktop`；③ 还要求 DSH 端 preset/MCP 已装 + 仓库有 config.json。**结论：需 DSH 0.2.1-rc.2 + web profile + 已完成 DSH 端安装；本机记为“不适用”，改由 self-test/test:dsh-auth/离线 E2E 覆盖**（`logs/verify-adaptation.log`） |

两个 audit 失败原因：
1. `test-voice-system.mjs`：缺 `docs/guides/VOICE.md`（该文件被上游 `.gitignore` 排除，公开 clone 没有），非版本问题。
2. `test-preset-local-tools.mjs`：默认找不到 DSH 安装 node_modules；用 Electron-as-Node 指定后 **6 通过 / 1 失败**——
   守卫名单里的 `dsh_snapshot` / `dsh_rollback` / `incident_resolved` 在本机 0.2.1-rc.3 安装包中扫描不到
   （上游记录里 rc.2 是 75/75）。这 3 个名字未注册时 restrict 会抛错并被守卫吞掉（静默 no-op），
   但对应工具本身也不存在，**未造成本地能力暴露**；升级 rc.3 后需上游重新对账名单（`logs/test-preset-local-tools-electron.log`）。

### 7.3 离线全链路 E2E（mock OneBot + 真实 DSH）

| 场景 | 结果 |
| --- | --- |
| `run-selfcheck.ps1` | ✅ **通过**：桥接连上 mock WS → `DSH 已就绪（closed-agent）` → 注入私聊 → 建 DSH 会话（preset `standard`）→ 设置模型 `deepseek-account/deepseek-flash (max)` → 回合完成 → 桥接把「收到」发回 mock（`logs/run-selfcheck.console.log`、`logs/bridge-20261028-213607.out.log`、`logs/mock-onebot-20261028-213607.jsonl`） |
| 提问/审批回路（人工一次性验证） | ✅ agent 先用 `ask_user_question` 反问 → 桥接转发成 QQ 消息 → mock 回复选项 → DSH 回合继续 → 547 字正式回复送达（`logs/bridge-selfcheck.log`） |
| 启动/停止脚本 | ✅ 前台 + `-Background` 均验证；stop 只杀桥接、清理 lock/PID，不影响 mock/DSH（`logs/start-script-test.log`、`logs/stop-script-test.log`） |

### 7.4 未验证项（需要用户账号/环境）

- ❄️ **真实 SnowLuma + 真实 QQ**：本机未安装 SnowLuma、无账号凭据，无法验证扫码登录、`[Hook]` 注入、真实收发；
- DSH 端 `setup-dsh.mjs` 安装 preset/MCP 后的 `agentPresets/list` 是否出现 `qq-chat*`、QQ 会话是否挂载成功；
- `verify:adaptation` 全套（需 DSH 0.2.1-rc.2 + web profile 或适配 rc.3 的机器）；
- 语音/图片/表情等富媒体出站（依赖 SnowLuma + QQ 实际返回）。

---

## 8. 与当前 DSH 版本（0.2.1-rc.3）兼容性说明

- qq-bridge **v0.2.1-r1 官方适配 DSH 0.2.1-rc.2**（也兼容 0.2.0-rc.2）。本机 rc.3 上实测：
  离线 Cookie 鉴权、`settings/describe`、`agentPresets/list`、建会话、prompt、回合完成、模型选择
  **全部正常**（见 7.2/7.3）；因此“内核可恢复”是确定的。
- rc.3 与 rc.2 的差异风险集中在 **preset 工具面/守卫名单**：rc.3 安装包扫描不到 3 个旧名字（见 7.2），
  升级前建议跑一遍 `node scripts/scan-dsh-tool-names.mjs --missing`，并在真机上新建 QQ 会话后
  用 `node scripts/probe-tools.mjs qq-chat-v2` 体检（需先完成 DSH 端安装）。
- 上游明确提示：`@deepseek-ai/dsh-host-apiproxy` 钉在 `0.1.1-rc.2`，靠 `verify:adaptation` 盯协议漂移；
  本机因 profile 差异跑不了全套，**后续 DSH 再升级时应补跑**。
- DSH 桌面版差异：API 在 **64020**（不是 3080）、profile 是 **desktop**（不是 web）、DSH 模块在
  **app.asar** 内（脚本默认找不到）。这三处都不影响桥接运行，只影响上游验证脚本。

---

## 9. 排障速查

| 症状 | 先看 | 处理 |
| --- | --- | --- |
| QQ 发消息完全没反应，日志有 `SnowLuma 已连接` | 桥接日志有无 `⛔ … 缺少 preset`；DSH `agentPresets/list` | 跑 `node scripts/setup-dsh.mjs desktop` 并重启 DSH |
| 同上，且 preset 已装 | SnowLuma 日志 `logs/snowluma-*.log` 里的 `[Hook] receive path stale` / `process enumeration timed out` | SnowLuma 注入退化，重登 QQ / 升级 SnowLuma（桥接只探测不部署） |
| 启动就报 `连接断开（code=1006）` | 正常现象（HTTP/WS token 不同） | 等自愈重连；若出现 `token 自愈失败` → 检查 `snowluma.homeDir` |
| `unauthorized` / 401（QQ 侧） | `snowluma.accessToken` 与 SnowLuma HTTP token | 在 SnowLuma WebUI 统一 token 后重启桥接 |
| HTTP 426 | `snowluma.httpUrl` 填成了 WS 端口 | 改成 HTTP API 端口（如 3000） |
| DSH 侧 401 | `%USERPROFILE%\.dsh\.credentials.yaml` 是否有 `client-connection/browser-session`；`DSH_HOME` 是否正确 | 保持 `dsh.authToken` 空；用 `npm run test:dsh-auth` 定位 |
| 控制台 3100 打不开/端口占用 | `Get-NetTCPConnection -LocalPort 3100` | 先 `stop-qq-bridge.ps1`；再查是否被别的程序占用 |
| “已有实例在运行” | `state/bridge.lock` | `stop-qq-bridge.ps1`（会自动清死锁） |
| 重启 DSH 后 QQ 消息积压 | 桥接 5s 探活，每会话最多排 50 条 | 等桥接重连后自动补投；桥接进程退出会丢内存队列 |
| 新建会话报“缺少 preset” | 桥接日志 `⛔` 行 | 这是 fail-closed 设计（绝不回落带本地工具默认 preset），补装 preset 后重启 DSH |
| 改了 config 不生效 | 是否改的是**仓库根** `config.json`（脚本会自动同步） | 重启桥接；模式类设置改后 5 秒轮询即时生效 |
| `verify:adaptation` 报找不到 DSH node_modules / profiles/web | 见 §7.2 | 该脚本面向 web profile + rc.2；本机记录“不适用”，勿据此判定桥接坏了 |

---

## 10. 安全 / 合规 / 边界

- **SnowLuma 是第三方独立软件**（EULA §5.4）：桥接**不部署、不启动、不停止** SnowLuma，
  也不做任何 QQ 进程注入；SnowLuma 的安装、启动、扫码全部由用户自己完成。
- **凭据**：不把真实 token/QQ 号写进本目录模板或任何文档；真实 `config.json`、`state/`、
  SnowLuma per-account token 都只在用户本机。桥接启动时会用 `icacls` 收紧 `state/` ACL。
- **准入 fail-closed**：白名单为空且 `allowAllWhenEmpty:false` 时不响应任何消息；不要为了省事开
  `allowAllWhenEmpty:true`（等于把账号交给模型）。仿真会话缺 preset 时桥接拒绝建会话（安全设计）。
- **QQ → DSH 已由 qq-bridge 负责；QQ → DengTa 需要单独适配**（qq-bridge 说的是 DSH 的 Cookie/斜杠
  RPC/mux 协议，不是 DengTa 的 Express/Supabase API）。该适配留给 Lead，`mock-onebot.mjs` 可复用来
  测试任何 OneBot 侧适配器。

---

## 11. 备选方案（未在本机安装）

### A. dsh-qq-bot（纯 DSH 插件，NapCat/Docker）— 备选
- 适配 `dsh >= 0.1.5-alpha.1`（本机 rc.3 满足）；peer 依赖 `dsh-agent/brand/llm/session/system-prompt`
  在 rc.3 安装包内均存在（0.2.1-rc.3）。
- 安装（**本次未执行**，仅记录步骤）：`D:\deepseek\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add <仓库目录|tgz|git+https|npm>` →
  **完全退出并重启 DSH** → 设置 → QQ 机器人 → 初始化目录 → 环境自检 → 启动服务（`docker compose up`）→
  NapCat WebUI 扫码 → 添加机器人（WS `ws://127.0.0.1:3001`）。
- 前置：Docker Desktop（**本机未安装**，`docker` 不在 PATH）+ NapCat 容器；数据在 `%USERPROFILE%\dsh-qq-bot`。
- 与本链路区别：**不走 SnowLuma**，用 NapCat；插件版有设置页 UI，但没有 qq-bridge 的仿真/控制台生态。

### B. qq-bridge-dsh（leonathan369-droid 衍生版 v0.3.3）— 暂不推荐
- 增加 DSH 设置页「QQ 桥接」控制中心（`plugins/qq-bridge-panel`，engines `dsh>=0.2.0-rc.1`），
  面向 **macOS + LLBot**，官方适配目标 **DSH 0.2.0-rc.2**。
- **在 rc.3 上的硬伤**：其 preset 仍含 `{{cwd}}`（`dsh/agent-presets/qq-chat*/agent.cordis.yml`），
  而 DSH 0.2.1 删除了该提示词变量、未知变量是 fail-loud → **每个 QQ 回合都会 error（发消息没反应）**。
  要用必须先移植上游 v0.2.1-r1 的修复（删 `suffix` / 用 runtime context）并重跑其 0.2.0 验证脚本。
- 结论：**主链路仍用上游 qq-bridge v0.2.1-r1**；等它把 0.2.1 适配补上再考虑其控制面板。

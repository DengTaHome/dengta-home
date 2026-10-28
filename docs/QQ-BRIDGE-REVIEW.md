# DSH ↔ QQ 教程复核与长期维护（2026-10-29）

上游项目：`Derpyu520/qq-bridge`，当前最新 `v0.2.1-r1`（2026-10-22），本地 `_refs/qq/qq-bridge`
版本一致。适配 DSH 0.2.1-rc.2/rc.3。复核结论：**教程主链路可用，但缺少自动启动/会话续期/
升级回滚/发版维护**，下面是要补的内容。

## 1. 现有教程哪里可以更好

| 项 | 现状 | 建议 |
|---|---|---|
| DSH 鉴权 | 教程写了 `dsh.authToken` 留空、离线铸造 Cookie | 保留；明确 **DSH 0.1.7+ 启动 token 不落盘**，不要去 guard 日志找 token |
| 适配验证 | 只跑 `setup-dsh.mjs desktop` | 加 `npm run verify:adaptation`、`npm run self-test`、`npm run test:dsh-auth`、`npm run test:setup-idempotent` |
| 自动启动 | 没有 | 只对 **qq-bridge 自己**做计划任务（SnowLuma 启动/注入见下方法律边界），桥接会自愈 WS/token |
| 自动登录 | 没有 | QQ 客户端开「自动登录」；SnowLuma 会话持久化；桥接保持运行。**SnowLuma 的扫码与会话过期必须用户本人处理**，不要做自动扫码 |
| SnowLuma 注入 | 手动在 WebUI 点「加载」 | **不要自动注入**：SnowLuma EULA §5.4 禁止第三方自动化部署/打包；保留用户手动点一次，之后进程不卸载即可 |
| 日志与健康 | 只看终端 | 每天轮转日志；`/api/mcp/connections` 与 `http://127.0.0.1:3100` 控制台都有状态；做一个 `health.ps1` |
| 升级 | 没写 | `git pull` → `npm install` → `setup-dsh.mjs desktop` → **重启 DSH** → `verify:adaptation`；保留旧版本目录可回滚 |
| 安全 | 白名单/群限制写到了 | 保留 fail-closed；owner 私聊最小权限；不启用 `allowAllWhenEmpty`；不把 `config.json`/`state/` 进仓库或发群 |
| DSH 升级 | 没写 | DSH 升级可能删除提示词变量（`{{cwd}}` 曾导致整回合失败）；每次升级 DSH 后先跑 verify，再重启桥接 |

## 2. 自动启动（安全范围）

`tools/qq-bridge-recovery/register-autostart.ps1` 只注册 **qq-bridge** 的登录自启动：
- 不启动/不注入 SnowLuma（遵守 EULA）
- 启动失败不影响 DSH/QQ
- 日志写 `tools/qq-bridge-recovery/logs/bridge-autostart.log`
- 停用：`Unregister-ScheduledTask -TaskName DengTaQQBridge`

前置：SnowLuma 已由用户启动并登录 QQ；桥接会自动重连并自愈端点。
**SnowLuma 更新/重装后需要用户重新点一次「加载」，不能自动化。**

## 3. 自动登录的现实边界

- QQ 客户端：设置里打开「自动登录」，同一设备/同一网络下重启可免扫码。
- SnowLuma：登录态会持久化，但**会话过期时要重新扫码**；没有任何合规的“自动扫码”方案。
- 桥接：`followDiscoveredEndpoint=true` 会在换号/换端口后自愈 WS/HTTP token；`state/sessions.json`
  持久化 QQ↔DSH 会话映射；重启桥接不会丢会话，但 DSH 重启后需要重建会话（桥接会自动退役重建）。
- 主号/小号隔离：机器人用**专用小号**，主号只授权；SnowLuma 注入属于第三方行为，主号有封号风险。

## 4. 长期维护清单（每天/每次升级）

- 每天：看 `tools/repo-watch` 的 `docs/REPO-WATCH.md`（已含 qq-bridge），有更新先看 release notes。
- 每周：`git -C _refs/qq/qq-bridge pull` + `npm install` + `verify:adaptation`；更新前备份 `config.json`/`state/`。
- DSH 升级后：重启 DSH → 跑 `test:dsh-auth`/`test:dsh-inbox`/`test:mux-reconnect`，再重启桥接。
- SnowLuma 升级后：用户手动重新加载注入；确认 OneBot 端口/token 变化，桥接会自愈。
- 每季度：清理历史会话、轮换控制台 token、检查白名单、确认 DSH 版本与桥接 release 匹配。

## 5. 上游差异 / 可借鉴代码

- 上游 README 已覆盖 `reserved2`、控制台、token 花费、黑话、媒体等，比我们此前的恢复文档详细；
  我们的教程应直接链接上游而不是复制全部。
- 上游明确 **不提供 start/stop SnowLuma MCP 工具**（EULA），所以任何“全自动登录/注入”脚本都
  不应进入公开发布物。
- 上游的 `followDiscoveredEndpoint`、自愈、`test-setup-idempotent` 都是可借鉴的稳定性机制，
  我们保留其能力即可，不需要重写桥接。
- 我们的补充：repo-watch 追踪、每日检查提醒、Windows 自启动仅限桥接、日志/回滚 SOP、主号风险提示。

## 6. 当前真实状态（2026-10-29）

- SnowLuma 2.2.1 已安装，QQ 登录/注入/OneBot 已实测通过；qq-bridge 已跑通 DSH 链路。
- 用户准备换专用小号；换号后需：登录小号 → SnowLuma 手动「加载」→ 更新桥接 `ownerQQ/allow`
  → 重启桥接 → 用另一账号发「在吗」验证。
- 相关文件：`tools/qq-bridge-recovery/`、`docs/QQ-BRIDGE-RECOVERY.md`、本文件。

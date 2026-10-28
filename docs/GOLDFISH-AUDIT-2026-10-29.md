# Goldfish 外部复核处置记录（2026-10-29）

外部子智能体只读复核了部署脚本、时间胶囊、音乐反代、MCP 目录、repo-watch、APK 与文档。
以下按处置状态记录，未改任何生产凭据。

## 已修复

### P0 · 11/1 部署脚本
- `$cred.proxy` 实际是对象 `{socks5,http,note}`；改为取 `proxy.http` 并补 `http://` scheme。
- curl 调用现在检查退出码和 HTTP 状态；dispatch 后按 `created_at + path + branch` 找新 run，最多等 60 秒。
- 发版后比较 feed `versionCode` 是否增长，旧版本不再标 `feed=ok`。
- 增加 `-DryRun`；实测：GitHub API 200、7 个 workflow、feed 301。

### P1 · 时间胶囊
- 读失败（`result.error`/异常）返回 `ok:false`，本轮跳过 save，不再覆盖 `companion_runtime_states.status`。
- 保存失败有日志；capsule context 放在 user context 之前，避免被 3900 字符截断。
- 标记任务名上限 40→80；残留/超长 marker 清理；新增 3 个纯函数测试。
- 验证：`node --test test/time-capsule.test.js test/qq-bridge.test.js` → 5/5。

### P1 · 音乐反代
- 日志对 `token/key/auth/code` 查询参数脱敏。
- `/health` 真实探测 9090 与 18012，不再无条件 200。
- 启动 fail-closed：缺 `MUSIC_WEB_TOKEN`/`MCP_TOKEN`/`ADMIN_SECRET` 容器直接退出。
- entrypoint 监督三个子进程，任一死亡容器退出由 Docker 重启。
- VPS 已重建，健康 200、网易云登录态保留。

### P1 · repo-watch
- 错误行带 URL；错误 repo 保留上次 state，避免下次误报“首次记录”。
- curl fallback 检查 HTTP 状态；CNB `ls-remote` 空 sha 报错。
- 重跑 17 项（16 GitHub + 1 CNB）0 错误、0 `undefined` 链接。

### P1 · 计划任务
- `DengTaDeployNov1`、`DengTaRepoWatch`：关闭电池限制、启用 `StartWhenAvailable`/`WakeToRun`。

### P1 · 文档/目录
- 音乐 README 更正为 CC BY-NC-SA 4.0（禁止商用）。
- muse “可独立分发”结论撤回；未签名 aligned APK 已删除。
- navi 接口清单补 `/get_history_api`、`/get_chat_api/`。
- MCP 目录：后端步骤去掉重复编号、网易工具名改为实际的 12 个；前端读 `dengta_transport/upstream_transport`，补 `song_*` 风险标签与写工具 click-only。

### 每用户「一起听」入口
- 发现 `NeteaseQrLogin.jsx` 已实现但从未挂载；已接进
  `MusicSettings` 的 `一起听歌 → 网易云账号 · 扫码登录`。
- 后端 live `/api/v2/music/providers/netease/qr/begin` 返回 201；各用户各自存 cookie。
- 前端 build/lint 通过；Vercel `7ca0bd2` READY。

## 仍未处理（低风险/需用户/上游）

- MCP 目录 fetch 失败仍静默使用硬编码 fallback，用户看不出是旧数据；可加提示。
- NetEase 预设的 `auth_type` 仍为 none，托管版需要 Bearer；用户可手动选择。
- publish workflow 的 manifest 提交 author 与 Vercel 账号 author 规则可能不一致，11/1 发版时观察。
- CNB 本地直推仍缺写 token；依赖 11/1 GitHub Actions `sync-cnb`。
- 音乐容器 root 运行、`MUSIC_GATEWAY_TOKEN` 默认值仍为公开 internal 值。
- muse 本地模式只有 stop，无强度/模式 UI；未达可公开分发状态。
- navi 缺高德 Key + 开发者认证 + 后端 `/access` 等接口；只有 debug 构建。
- X：twikit 2.3.3 对当前 X 前端报 `Couldn't get KEY_BYTE indices`；Cookie 已提取但 MCP 未接通。
- 本轮工具输出曾意外包含凭据（非仓库、非日志文件）；建议用户之后轮换 Vercel/GitHub/Render token 与 VPS 密码。

## 验证命令

```powershell
node --test D:\GZdeepseek\_refs\backend-prod\test\time-capsule.test.js D:\GZdeepseek\_refs\backend-prod\test\qq-bridge.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\deploy\nov1-deploy.ps1 -DryRun
node D:\GZdeepseek\dengta-home\tools\repo-watch\watch.mjs
curl.exe -sS https://dengtahome.com/health
curl.exe -sS https://music.dengtahome.com/health
```

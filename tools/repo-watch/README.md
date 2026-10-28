# DengTa GitHub 项目追踪

每天扫描 `repos.json` 里的项目，比较最新 commit / release，生成 `docs/REPO-WATCH.md`。
只读 GitHub 公开元数据，不读取/不保存任何 Cookie。

## 手动运行

```powershell
$env:GITHUB_PROXY='http://127.0.0.1:10809'   # 本机需要代理时
node tools\repo-watch\watch.mjs
```

Token 优先读 `GITHUB_TOKEN`，否则读 `_credentials/dengta-credentials.json` 的 PAT。
无 Token 也能跑，但 GitHub 限流更严。

## 定时

Windows 计划任务（当前用户）：

```powershell
schtasks /Create /SC DAILY /ST 09:10 /TN "DengTaRepoWatch" /TR "`"D:\GZdeepseek\dengta-home\tools\repo-watch\run-watch.cmd`"" /F
```

Linux/macOS：

```cron
10 9 * * * GITHUB_TOKEN=... node /path/tools/repo-watch/watch.mjs
```

有更新时 Agent 会根据 `docs/REPO-WATCH.md` 的 🆕 行判断是否需要升级依赖、适配新接口或更新
MCP 目录/教程。

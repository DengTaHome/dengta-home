# 发版与 CNB 备份计划（2026-11-01 起）

## 背景

- GitHub 私有仓库 Actions 免费额度本月已用尽（2814 Linux 分钟），
  所有 workflow run 目前 `steps=0` 直接失败；用户决定不充值，等 11 月额度重置。
- 腾讯 CNB 镜像 `https://cnb.cool/dengtahome/dengtahome` 目前只读；
  写入由前端仓库的 `Sync frontend to CNB` workflow 用仓库 secrets（`CNB_USERNAME` / `CNB_TOKEN`）完成。
  本轮本地没有 CNB 写 token，因此**先把同步排进 11 月 1 日任务**。

## 已注册的两个定时任务

### 1. Windows 任务计划
- 任务名：`DengTaDeployNov1`
- 时间：**2026-11-01 08:10（Asia/Shanghai）**
- 动作：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/deploy/nov1-deploy.ps1`
- 查看：`schtasks /Query /TN DengTaDeployNov1 /FO LIST`
- 已设置 `StartWhenAvailable=true`、`WakeToRun=true`、`DisallowStartIfOnBatteries=false`、`StopIfGoingOnBatteries=false`；错过 08:10 后会在可用时补跑。仍建议 11 月 1 日保持开机/登录。

### 2. DSH 会话提醒
- 标题：`执行 DengTa 发版与 CNB 同步`
- 时间：2026-11-01 08:10（Asia/Shanghai）
- 用途：到点唤醒会话，由我检查任务结果、补跑失败项并更新账本。

## `tools/deploy/nov1-deploy.ps1` 做什么

1. 读取 `_credentials/dengta-credentials.json` 的 GitHub token；
2. 触发 `sync-cnb.yml`：把 frontend 仓库 `main` 镜像到 CNB `frontend-main`；
3. 触发 `publish-android-apk.yml`（`dry_run=false`）：构建/签名下一个 versionCode、
   上传 Supabase、更新 `updates/android.json`、部署 Vercel；
4. 轮询两个 run 直到结束，打印结论；
5. 成功则请求线上 `https://www.dengtahome.com/updates/android.json` 验证版本；
6. 若环境变量有 `CNB_USERNAME` + `CNB_TOKEN`，再把本地 `_refs/frontend-gh` 直接 push 到 CNB 作兜底；
7. 日志与结果写 `_audit/nov1-deploy-*.log` / `.result.json`。

## CNB 立即备份还缺什么

本地没有 CNB 的写凭据，无法现在直接 push。两个选择：

- **等 11 月 1 日**：上面的 Windows/DSH 任务会先跑 GitHub Actions 的 sync-cnb，
  用仓库里已有的 secrets 完成镜像；
- **现在就要直推**：在 CNB 网页右上角头像 → 设置 → 访问令牌，创建一个有仓库写权限的 token，
  把 `CNB_USERNAME` 和 `CNB_TOKEN` 放进环境变量或 `_credentials/cnb.json`，
  我就可以用 `tools/deploy/nov1-deploy.ps1` 的本地直推分支立即同步，不必等 Actions。

## 每次改动的本地备份

- 代码提交后刷新 git bundle：`D:\GZdeepseek\backup\dengta-home-full-20261028.bundle`
- 前端源码镜像：`D:\GZdeepseek\_refs\frontend-gh`（GitHub 私有仓库克隆）
- CNB 源码镜像：`D:\GZdeepseek\_refs\cnb-dengtahome`（只读 clone，`frontend-main`）

**注意**：CNB 仓库只镜像前端；后端、文档、Muse/Navi 伴生 App 源码目前在本地备份/其它仓库，
若要全部同步到 CNB，需要单独的 CNB 仓库或写 token。

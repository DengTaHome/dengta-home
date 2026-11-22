# DengTa 全平台同步与备份规则

> 目的：本地工作区不是唯一副本。任何一次代码、文档、iOS/Android 工程、配置模板或交接更新，都必须同步到 GitHub 和腾讯 CNB，避免工作区丢失后无法恢复。

## 1. 权威源

| 内容 | GitHub 源 | CNB 镜像/快照 |
|---|---|---|
| 前端/Android/iOS 工程 | `DengTaHome/dengta-home-frontend` | `cnb.cool/dengtahome/dengtahome` 的 `frontend-main` / `main` |
| 后端 | `DengTaHome/dengta-home-backend` | `cnb.cool/dengtahome/dengtahome` 的 `backend-main` / `main` |
| 文档/交接/审计摘要 | `DengTaHome/dengta-home` | `cnb.cool/dengtahome/dengtahome` 的 `docs-main` / `main` |
| iOS 导入工作区 | 前端仓库的 `feat/ios-*` 分支 | `cnb.cool/dengtahome/dengtahome` 的 `ios-import-*` / `main` 快照 |

## 2. 每次更新的固定流程

1. 在本地/分支完成修改。
2. 运行相关测试、构建和最小回归；保留日志。
3. 提交到 GitHub 分支并开 PR；不得直接覆盖 `main`。
4. 合并后同步 CNB：
   - 前端：更新 `frontend-main`
   - 后端：更新 `backend-main`
   - iOS：更新 `ios-import-*` 或 `main` 快照
   - 文档：更新 `docs-main`/`main`
5. 更新 `SYNC-MANIFEST.json`（文件数、字节数、源 commit、时间）。
6. 刷新本地 bundle/zip 备份。
7. 在本次交接文档或 `OPTIMIZATION-LEDGER.md` 写明同步结果：GitHub commit、CNB 分支/commit、备份路径。

## 3. 必须同步

- `frontend/` 源码（含 `src/`、`android/`、`ios/`、`public/` 源资源、测试、脚本、配置模板）
- `backend/` 源码（含 `routes/`、`services/`、`supabase/`、测试、脚本）
- `docs/` 交接/架构/发布/迁移文档
- 构建与发布脚本（不含密钥）
- `.env.example`、`config.example.json` 等模板

## 4. 绝不同步

- 密码、token、Cookie、API Key、service role
- `_credentials/`、`.env`、`.env.local`、`.env.production` 的实际值
- 证书、keystore、Provisioning Profile、`.wxb`
- `node_modules/`、`Pods/`、`DerivedData/`、`dist/`、`build/`
- 用户聊天/记忆/照片/屏幕截图
- APK/IPA/xcarchive/构建产物（除非用户明确要求归档）
- `_audit/` 原始隐私证据

## 5. CNB 分支约定

- `main`：最新整合工作区快照（frontend + frontend-ios + backend + docs + tools）
- `frontend-main`：生产前端镜像
- `backend-main`：生产后端镜像
- `ios-import-*`：iOS 工作分支/快照
- `opensource-main`：开源发布镜像（保留，不覆盖产品主线）
- 旧分支/旧快照先打 tag 或下载 bundle 备份，再清理。

## 6. 恢复顺序

1. 从 CNB `main` 或对应分支 clone。
2. 从 GitHub 对应仓库拉最新 main。
3. 对比 `SYNC-MANIFEST.json` 的 commit/文件数。
4. 恢复 `.env`/凭据（由用户提供，绝不在 CNB）。
5. 运行构建/测试，再继续开发。

## 7. 账号迁移期间

- 旧 Google 账号 `tnineninet@gmail.com` 的 OAuth 授权到期前，必须把
  GitHub / Vercel / Render / Supabase / CNB 的所有权或管理员身份迁移到
  `naiyouhaochi520@gmail.com`，并轮换 token。
- Cloudflare 当前无法登录，作为唯一未完成项记录；DNS 迁移/恢复另行处理。
- 迁移完成后，本文件仍需保留，作为长期同步纪律。

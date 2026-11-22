# DengTa 全平台同步与备份规则

> 生效日期：2026-11-22  
> 目的：本地工作区不是唯一副本。任何一次代码、文档、iOS/Android 工程、配置模板或交接更新，都必须同步到 GitHub 和腾讯 CNB；否则视为未完成。

## 1. 当前权威账号与平台

| 平台 | 权威位置 | 负责人/账号 |
|---|---|---|
| GitHub | `tnineninet` 组织 | `Jessica-tce`（Owner，`2458077782sans@gmail.com`） |
| GitHub 前端 | `tnineninet/dengta-home-frontend` | 公开仓库，Vercel Hobby 已连接 |
| GitHub 后端 | `tnineninet/dengta-home-backend` | 私有 |
| GitHub 文档 | `tnineninet/dengta-home` | 私有 |
| GitHub 源码快照 | `tnineninet/dengta-workspace-snapshot` | 私有 Release |
| GitHub 加密凭据库 | `tnineninet/dengta-private-vault` | 私有，仅密文 |
| Vercel | 项目 `dengta-home`，Git 连接 `tnineninet/dengta-home-frontend` | 邮箱 `2458077782sans@gmail.com` |
| Render | 服务 `dengta-home-backend`，repo `tnineninet/dengta-home-backend` | 邮箱 `2458077782sans@gmail.com` |
| Supabase | `buyaocaowo555-collab's Org` | `2458077782sans@gmail.com` Owner |
| CNB | `cnb.cool/DengTaArchive2026/dengta-workspace` | 微信账号 `cnb.ds3fm5MOAPA` |
| DNS/CDN | Cloudflare | 暂不可登录，未完成 |

旧账号 `DengTaHome`、旧 Gmail `buyaocaowo555@gmail.com`、旧 CNB 账号 `cnb.covlGfKahIA` 不再作为主账号；不要向它们上传新内容。

## 2. 每次更新的强制流程

任何更新，必须依次完成：

1. 在对应本地仓库完成修改，并通过测试/构建。
2. 提交到 GitHub 对应仓库，并 push 到 `tnineninet` 组织。
3. 运行一键同步脚本：

```powershell
powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1
```

4. 脚本会：
   - 检查 frontend/backend/docs/iOS worktree 是否有未推送提交；
   - 刷新完整 CNB 工作区快照；
   - 更新 `SYNC-MANIFEST.json`；
   - 推送 CNB `main`；
   - 输出 GitHub/CNB 的 commit 和文件数。
5. 验证结果：

```powershell
git -C D:\GZdeepseek\_incoming\cnb-workspace-20261122 ls-remote origin refs/heads/main
git -C D:\GZdeepseek\_refs\frontend-gh ls-remote origin refs/heads/main
```

6. 在 `docs/SYNC-LEDGER.md` 追加一行记录：
   - 日期
   - 更新内容
   - GitHub commit
   - CNB commit
   - 本地备份路径

**没有同时更新 GitHub 和 CNB 的更新，不算完成。**

## 3. 必须同步

- `frontend/` 源码（含 `src/`、`android/`、`ios/`、`public/` 源资源、测试、脚本、配置模板）
- `backend/` 源码（含 `routes/`、`services/`、`supabase/`、测试、脚本）
- `docs/` 交接、架构、发布、迁移文档
- `tools/` 构建与发布脚本（不含密钥）
- `.env.example`、`config.example.json` 等模板
- iOS 工作区源码和 Xcode 工程文件（不含 `Pods/`、`DerivedData/`）

## 4. 绝不同步

- 密码、token、Cookie、API Key、service role
- `_credentials/`、`.env`、`.env.local`、`.env.production` 的实际值
- 证书、keystore、Provisioning Profile、`.wxb`
- `node_modules/`、`Pods/`、`DerivedData/`、`dist/`、`build/`
- 用户聊天/记忆/照片/屏幕截图
- APK/IPA/xcarchive/构建产物（除非用户明确要求归档）
- `_audit/` 原始隐私证据

密钥只允许放在：

- 本机 `D:\GZdeepseek\_credentials\`
- GitHub 私有加密库 `tnineninet/dengta-private-vault`
- 对应平台的 Secrets/环境变量

## 5. CNB 仓库约定

- CNB 只作为**完整源码快照和灾备**，不承载线上运行。
- 路径：`https://cnb.cool/DengTaArchive2026/dengta-workspace`
- 默认分支：`main`
- 快照内容：`frontend/`、`frontend-ios/`、`backend/`、`docs/`、`tools/`
- 不再向旧仓库 `cnb.cool/dengtahome/dengtahome` 写入。
- 旧仓库保留只读，不再作为备份目标。

## 6. Vercel / Render 部署规则

- Vercel 只从 `tnineninet/dengta-home-frontend` 的 `main` 自动部署。
- Render 只从 `tnineninet/dengta-home-backend` 的 `main` 自动部署。
- 变更仓库归属、可见性或 Git 集成后，必须重新检查：
  - Vercel：Project → Settings → Git
  - Render：Service → Settings → Build & Deploy → Repository
- Vercel 前端仓库目前为 public；如改回 private，Hobby 套餐会再次拒绝组织私有仓库。

## 7. 本地备份规则

每次重要更新后刷新：

```text
D:\GZdeepseek\backup\workspace-snapshot-<日期>\
```

至少包含：

- frontend/backend/docs/iOS 的 Git bundle
- 未提交 patch
- 源码 ZIP
- `manifest.json`（SHA-256）

本地备份不能替代 GitHub/CNB；三者必须同时存在。

## 8. 恢复顺序

1. 从 GitHub `tnineninet` 对应仓库 clone。
2. 从 CNB `DengTaArchive2026/dengta-workspace` clone 完整快照。
3. 对比 `SYNC-MANIFEST.json` 的 commit、文件数、字节数。
4. 从本机/加密库恢复 `.env` 和凭据。
5. 运行构建和最小回归后继续开发。

## 9. 账号迁移遗留项

- Cloudflare 仍无法登录；DNS 迁移/恢复另行处理，未完成前不要改 DNS。
- 旧 CNB 空仓库可在确认新仓库稳定后删除。
- CNB all-scope 令牌仅限过渡期使用，稳定后换成只限 `DengTaArchive2026/dengta-workspace` 的 `repo-code:rw` 令牌。

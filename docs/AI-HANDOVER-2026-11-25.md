# DengTa（灯塔）AI 交接说明

> 交接日期：2026-11-25  
> 接收对象：接手 DengTa 项目的另一个 AI/工程师  
> 目的：让接手方在不破坏生产、不泄露凭据的前提下，理解当前状态、目标、账号归属、代码位置、部署链路、数据位置和未完成事项。

---

## 0. 先读这一节

1. **不要从旧账号继续操作。** 旧 Google 账号 `tnineninet@gmail.com` 以及旧 Gmail `buyaocaowo555@gmail.com` 已经不可用/被封；旧 GitHub 个人账号 `DengTaHome` 不再拥有主要仓库。
2. **主账号/主组织已经是：**
   - GitHub 组织：`tnineninet`
   - GitHub Owner：`Jessica-tce`
   - 新 Gmail：`2458077782sans@gmail.com`
   - CNB 微信账号：`cnb.ds3fm5MOAPA`
3. **不要把密码、token、API Key、Cookie 写进本文档、聊天、GitHub 或 CNB。**
4. 本文档只写“凭据在哪里”和“怎么取得”，不写凭据本身。真正交接密码时，请用密码管理器或一次性加密渠道单独发送。
5. 当前生产仍在运行，但有两项阻塞：
   - GitHub Actions 因账单/额度问题 `startup_failure`，自动发布 Android 更新包暂不可用；
   - DengTa 软件登录失败原因尚未最终确认（服务端 Auth 正常，偏向账号/密码/邮箱/网络问题）。
6. 未经用户确认，不要改生产数据库、不要清空聊天/记忆数据、不要重建 Supabase 项目、不要改 Cloudflare DNS。

---

## 1. 项目目标

DengTa（灯塔）是一个长期运行的 AI 伴侣/个人空间项目，核心目标：

- 多端可用：网页、PWA、Android App、iOS 工程；
- 聊天、记忆、动态、语音、一起看、音乐、MCP 工具等能力；
- 用户自己的账号、伴侣、记忆数据隔离；
- 中国大陆网络下可用；
- 代码、文档、发布物必须有 GitHub + CNB + 本地备份；
- 不允许内容过滤/拒答逻辑被恢复；
- AI 回复必须逐字即时可见、不可撤回；
- 不把生产数据当测试数据。

---

## 2. 当前生产地址

| 用途 | 地址 |
|---|---|
| 官网 / PWA | `https://www.dengtahome.com` |
| 后端 | `https://dengta-home-backend-rkmq.onrender.com` |
| 后端健康检查 | `https://dengta-home-backend-rkmq.onrender.com/health` |
| Android 更新 feed | `https://www.dengtahome.com/updates/android.json` |
| Android 下载页 | `https://www.dengtahome.com/download` |
| Supabase Auth（同源代理） | `https://www.dengtahome.com/supabase/auth/v1` |
| APK 存储 | Supabase Storage bucket `dengta-updates` |

当前线上基线（交接时）：

- 前端生产部署：`af5c29fd`（Vercel READY）；
- 后端 revision：`b1d60630`；
- Android feed：`version_code=310`，`version=2.13.52`；
- APK：约 36.4 MB，托管在 Supabase Storage；
- PWA manifest 和 `sw.js` 均为 200；
- 后端 `/health` 为 200；
- CNB 快照：`cfa74b5`；
- 本地主目录：`D:\GZdeepseek`。

---

## 3. 账号与平台归属

### 3.1 新主账号

| 平台 | 登录方式 | 账号/身份 | 说明 |
|---|---|---|---|
| Google/Gmail | Google | `2458077782sans@gmail.com` | 新主邮箱；用于 GitHub/Vercel/Render/Supabase 邀请和收信 |
| GitHub | 邮箱 + 密码/2FA | `Jessica-tce` | `tnineninet` 组织 Owner |
| GitHub 组织 | 组织 | `tnineninet` | 7 个 DengTa 仓库 + 私有快照/凭据库 |
| Vercel | 邮箱/passkey + GitHub | 账号邮箱 `2458077782sans@gmail.com`；GitHub 已切到 `Jessica-tce` | Hobby；项目 `dengta-home` |
| Render | GitHub 登录 | workspace `dengta`，邮箱 `2458077782sans@gmail.com` | Hobby；服务 `dengta-home-backend`、`dengta-home-voice` |
| Supabase | 邮箱/GitHub | 组织 `buyaocaowo555-collab's Org`，Owner 邮箱 `2458077782sans@gmail.com` | 项目 ref `nyyqyizwrlmejpfdhgrnd` |
| CNB | **只能微信扫码** | `cnb.ds3fm5MOAPA`（昵称：灯塔） | 组织 `DengTaArchive2026`，私有仓库 `dengta-workspace` |
| Cloudflare | 未知/不可登录 | 暂不可用 | DNS 未迁移；**不要动 DNS** |

### 3.2 旧账号（不要继续使用）

| 平台 | 旧身份 | 状态 |
|---|---|---|
| Google | `tnineninet@gmail.com` | 被封/不可用 |
| Gmail | `buyaocaowo555@gmail.com` | 被封，GitHub 验证邮件会被拒收 |
| GitHub | `DengTaHome` | 已不再是主要仓库所有者；仍可能是 org 成员 |
| CNB | `cnb.covlGfKahIA` | 旧微信账号；不再作为主备份账号 |
| Vercel | 旧 GitHub `DengTaHome` 身份 | 已断开并改用 `Jessica-tce` |

> 旧 GitHub `DengTaHome` 账号的邮箱仍未验证，但已不影响仓库归属。等所有集成稳定后，可由新 Owner 决定是否移除旧账号。

---

## 4. GitHub 仓库

组织：`https://github.com/tnineninet`

| 仓库 | 可见性 | 用途 |
|---|---|---|
| `tnineninet/dengta-home-frontend` | **public** | React/Vite/Capacitor 前端、Android、iOS 工程；Vercel 部署源 |
| `tnineninet/dengta-home-backend` | private | Express 后端；Render 部署源 |
| `tnineninet/dengta-home` | private | 文档、交接、工具、账本 |
| `tnineninet/dengta-home-voice` | private | 语音 TTS 服务 |
| `tnineninet/dengta` | public | 项目/资料仓库 |
| `tnineninet/dengta-music-mcp` | public | 音乐 MCP |
| `tnineninet/kiwi-mem-dengta` | public | Kiwi 记忆/后端集成 |
| `tnineninet/dengta-workspace-snapshot` | private | 完整源码 ZIP Release |
| `tnineninet/dengta-private-vault` | private | AES-256-GCM 加密凭据库 |

### 4.1 为什么前端是 public

Vercel Hobby 不支持“组织拥有的私有仓库”。为了不升级 Pro，frontend 被改为 public。仓库内没有生产 API Key/密码；不要往该仓库提交任何 `.env` 实际值。

### 4.2 源码快照

- 仓库：`https://github.com/tnineninet/dengta-workspace-snapshot`
- Release tag：`snapshot-20261122`
- 资产：`DengTa-workspace-snapshot-20261122.zip`（约 60MB）
- 内容：frontend、frontend-ios、backend、docs、tools
- 不包含：node_modules、build、`.env` 实际值、证书、APK/IPA

### 4.3 加密凭据库

- 仓库：`https://github.com/tnineninet/dengta-private-vault`
- 文件：`DengTa-secrets-20261122.enc`
- 算法：AES-256-GCM，PBKDF2-SHA256 300,000 次
- 解密口令：**不在仓库、不在本文档**；只在本机文件中（见第 8 节）

---

## 5. 本地代码与目录

主工作区：

```text
D:\GZdeepseek
```

关键目录：

```text
D:\GZdeepseek\_refs\frontend-gh          # 生产前端/Android/iOS 源码
D:\GZdeepseek\_refs\backend-prod         # 生产后端源码
D:\GZdeepseek\_worktrees\ios-import-75ad3da  # iOS 工作区（有未提交改动）
D:\GZdeepseek\dengta-home                # 文档、工具、账本
D:\GZdeepseek\_incoming\cnb-workspace-20261122  # CNB 快照工作区
D:\GZdeepseek\backup\workspace-snapshot-20261122  # 完整本地备份
D:\GZdeepseek\_credentials               # 凭据（绝不入库）
D:\GZdeepseek\_audit                     # 审计/诊断证据（隐私，不要公开）
```

当前目录大小参考：

- `D:\GZdeepseek`：约 36.7 GB
- `_refs`：约 2.13 GB
- `_worktrees`：约 2.56 GB
- `backup`：约 3.20 GB
- `dengta-home`：约 2.25 GB

E 盘只有小型集成目录：

```text
E:\yz\dengta-integrations   # 约 0.03 GB
E:\yz\dengta-qq-cloud       # 约 0.03 GB
```

**主源码/备份在 D 盘，不在 E 盘。**

---

## 6. 部署与发布链路

### 6.1 网页 / PWA

```text
frontend main push
→ GitHub tnineninet/dengta-home-frontend
→ Vercel Git 集成自动部署
→ 线上 manifest.webmanifest + sw.js + 图标
→ deployment-health.mjs 检查 PWA/feed/APK/后端
```

Vercel 项目：

- 项目名：`dengta-home`
- 项目 ID：`prj_P6wMEPflv6ZGrwz9Aef92RWSCAqP`
- GitHub 连接：`tnineninet/dengta-home-frontend`
- 生产分支：`main`
- 账号邮箱：`2458077782sans@gmail.com`
- GitHub 身份：`Jessica-tce`

### 6.2 Android 更新包

相关文件：

```text
frontend/.github/workflows/android-apk.yml
frontend/.github/workflows/publish-android-apk.yml
frontend/scripts/publish-site-apk.mjs
frontend/scripts/deployment-health.mjs
frontend/public/updates/android.json
frontend/public/updates/download.json
```

设计流程：

```text
frontend main 更新
→ Build Android APK（测试/构建）
→ 成功后自动触发 Publish Android APK
→ 构建 release APK
→ 上传 Supabase Storage dengta-updates
→ 更新 android.json / download.json
→ 提交 main
→ Vercel 部署
→ 校验线上 version_code + APK sha256/size
```

当前阻塞：

- GitHub Actions 最近运行是 `startup_failure`，之前报过 Actions 账单/额度问题；
- 因此 Android 更新包暂不会自动产出；
- 修复 GitHub Billing/Spending Limit 后，下次 frontend 更新会自动发布；
- 网页部署仍由 Vercel 独立完成，不受 Actions 影响。

### 6.3 CNB 完整快照

```text
https://cnb.cool/DengTaArchive2026/dengta-workspace
```

- 私有仓库
- 分支 `main`
- 最新 commit `cfa74b5`
- 约 3517 文件 / 181 MB
- 由本地脚本刷新并推送：
  - `D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1`
  - `D:\GZdeepseek\dengta-home\tools\sync-cnb-snapshot.py`
- CNB 只放源码/文档/工具，不放明文密钥。

---

## 7. 账号登录/凭据说明（不写秘密）

### 7.1 必须由用户保管的密码/2FA

以下内容本文档不记录，必须由用户通过密码管理器/一次性加密消息交给接手方：

- Google 新账号密码/恢复方式；
- GitHub `Jessica-tce` 密码、2FA/recovery codes；
- Vercel 登录/2FA/passkey；
- Render 登录；
- Supabase 登录；
- CNB 微信扫码登录能力；
- 服务器/VPS 登录；
- Cloudflare 恢复方式（当前不可用）；
- 任何第三方服务密码。

### 7.2 本机凭据文件

仅可在本机读取，不要发到聊天/仓库：

```text
D:\GZdeepseek\_credentials\dengta-credentials.json
D:\GZdeepseek\_credentials\cnb-newaccount-all-token-20261122.txt
D:\GZdeepseek\_credentials\dengta-secrets-passphrase-20261122.txt
D:\GZdeepseek\backup\secrets-vault-20261122\DengTa-secrets-20261122.enc
```

`dengta-credentials.json` 包含：

- Supabase URL/anon key/service role（service role 目前是占位值，不是完整密钥）；
- Vercel token；
- Render API key；
- GitHub PAT（旧账号，邮箱未验证，可能无法 git push）；
- 代理、VPS、第三方 API 凭据等。

**不要打印该文件内容，不要提交 Git，不要上传 CNB。**

### 7.3 加密保险库

- 路径见 7.2；
- 解密口令只在 `_credentials\dengta-secrets-passphrase-20261122.txt`；
- 远程交接时：把 `.enc` 文件和口令分开、通过不同安全渠道发送；
- 不要把 `.enc` 文件和口令放在同一个聊天/邮件里。

---

## 8. 数据位置

### 8.1 生产数据

- Supabase 项目：`https://nyyqizwrlmejpfdhgrnd.supabase.co`
- 项目 ref：`nyyqyizwrlmejpfdhgrnd`
- 组织：`buyaocaowo555-collab's Org`（org id `arsqmmmpmyotrzdkhviq`）
- Auth：邮箱密码登录已启用；Google/GitHub 等外部登录目前全部关闭
- Storage：`dengta-updates`（APK）
- 数据表/RLS/迁移：以 Supabase 项目和 `docs/QUALITY-AUDIT-2026-10.md` 为准
- **不要擅自执行仓库 migration 062/063/064**；生产 schema 与仓库 migration 不完全同源

### 8.2 源码/文档数据

- GitHub：`tnineninet/*`
- CNB：`DengTaArchive2026/dengta-workspace`
- 本地：`D:\GZdeepseek`
- 源码 ZIP：GitHub release `dengta-workspace-snapshot`
- 凭据密文：GitHub `dengta-private-vault`

### 8.3 本地备份

```text
D:\GZdeepseek\backup\workspace-snapshot-20261122\
```

包含 Git bundle、未提交 patch、源码 ZIP、manifest。不要删除。

### 8.4 不进入仓库的数据

- 用户聊天、记忆、照片、屏幕截图、私人媒体；
- API Key、Cookie、token、service role；
- Android keystore/证书/.wxb；
- APK/IPA（通过 Supabase/Release 分发，不入源码仓库）；
- `_audit` 原始隐私证据。

---

## 9. 当前未完成/风险

### 9.1 GitHub Actions

- 状态：`startup_failure`；
- 已确认的点：工作流文件 YAML 已修正，Actions 权限 enabled；
- 仍阻塞的原因：账单/额度（此前明确报 payments failed/spending limit）；
- 影响：Android release APK 不会自动发布；
- 需要用户：GitHub `tnineninet` → Billing & plans → 修复 Actions payment/spending limit；
- 修复后：重新运行 `Build Android APK`，或触发 `Publish Android APK`。

### 9.2 登录问题

- 官网、Supabase Auth、REST、后端 `/health` 均正常；
- 登录接口对无效账号返回 `invalid_credentials`，不是 500；
- 当前问题更可能是：
  - 旧邮箱 `tnineninet@gmail.com` 已封；
  - 忘记密码/账号不存在；
  - 使用了未启用的 Google 登录；
  - 手机网络连不上 Supabase；
  - App 版本过旧。
- 接手方应先让用户提供登录界面具体红字，再做账号/网络排查；不要直接改数据库用户。

### 9.3 Cloudflare

- 旧登录方式不可用；
- DNS 仍由 Cloudflare 托管；
- **未确认前不要改 DNS**，否则网站/邮箱可能同时故障。

### 9.4 CNB

- 只支持微信登录；
- 新账号 `cnb.ds3fm5MOAPA` 已实名认证；
- 组织 `DengTaArchive2026`、私有仓库 `dengta-workspace` 正常；
- all-scope token 只用于过渡，稳定后应换成只限该仓库的 `repo-code:rw` token；
- 旧 CNB 空仓库可以清理，但不要删除新仓库。

### 9.5 旧账号

- 旧 GitHub `DengTaHome` 仍可能是 org 成员；
- 旧 Vercel 身份/旧邮箱可能仍在 secondary；
- 旧 Supabase Owner 邮箱可能仍有两个；
- 待所有新链路稳定后再清理，避免误删导致无法恢复。

---

## 10. 接手后的第一批检查命令

```powershell
# 官网 / PWA / 后端
curl.exe -I https://www.dengtahome.com/
curl.exe -I https://www.dengtahome.com/manifest.webmanifest
curl.exe -I https://www.dengtahome.com/sw.js
curl.exe -sS https://dengta-home-backend-rkmq.onrender.com/health

# Android feed
curl.exe -sS https://www.dengtahome.com/updates/android.json

# PWA + feed + APK + 后端体检
D:\GZdeepseek\_tools\node\node.exe D:\GZdeepseek\_refs\frontend-gh\scripts\deployment-health.mjs

# GitHub 组织/仓库
gh repo list tnineninet --limit 100

# 远端仓库状态
git -C D:\GZdeepseek\_refs\frontend-gh remote -v
git -C D:\GZdeepseek\_refs\backend-prod remote -v
git -C D:\GZdeepseek\dengta-home remote -v

# CNB 快照
git -C D:\GZdeepseek\_incoming\cnb-workspace-20261122 log -1 --oneline
git -C D:\GZdeepseek\_incoming\cnb-workspace-20261122 ls-remote origin refs/heads/main
```

---

## 11. 每次更新的强制规则

1. 先改代码/文档，跑测试；
2. 提交到 GitHub `tnineninet` 对应仓库；
3. 推送后确认 Vercel 网页部署 / Render 后端部署；
4. Android 发布必须确认：
   - APK 已上传；
   - `public/updates/android.json` 的 version_code 已递增；
   - APK sha256/size 与 feed 一致；
   - 线上 feed 已更新；
5. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1
```

6. 确认 CNB 新快照 commit；
7. 在 `docs/SYNC-LEDGER.md` 记录 GitHub/CNB commit；
8. 没有“GitHub + CNB + 本地备份”三方同步，不算完成。

---

## 12. 绝对不要做

- 不要把密码、token、service role、Cookie 写进本文件、GitHub、CNB、聊天；
- 不要删除 `D:\GZdeepseek\backup\`；
- 不要改生产 Supabase schema/用户数据；
- 不要执行未经确认的 migration 062/063/064；
- 不要改 Cloudflare DNS；
- 不要从旧 `DengTaHome`/旧 Gmail 继续迁移；
- 不要强制推送覆盖 `tnineninet` 仓库历史；
- 不要为了让测试通过而删测试断言；
- 不要恢复任何 AI 拒答/内容过滤逻辑；
- 不要把 `.env`、keystore、APK/AAB 提交到源码仓库。

---

## 13. 给接手 AI 的最终提示

先做只读检查，确认：

1. `tnineninet` 是否仍由 `Jessica-tce` Owner 控制；
2. Vercel 项目是否仍连接 `tnineninet/dengta-home-frontend`；
3. Render 服务是否仍指向 `tnineninet/dengta-home-backend`；
4. 线上 `/health`、`/updates/android.json`、PWA manifest 是否正常；
5. CNB `DengTaArchive2026/dengta-workspace` 是否可读；
6. 用户是否能提供新的 Gmail/密码/2FA 或加密凭据包。

确认后再改代码或发布，不要直接动生产数据。

# Android 发版与「应用内更新」现状（2026-10-29）

## 线上现状

- 线上更新 feed：`https://www.dengtahome.com/updates/android.json`
  - 最新：`2.13.43`，versionCode `301`，APK 在 Supabase Storage
  - GitHub 最新 release（本次补发）：`v2.13.43`，资产 `DengTa-2.13.43.apk`，SHA-256
    `a4e1e9e6…b9a1`，与 feed 一致
- 已安装旧版 App 的更新逻辑：
  - `>= 2.12.18`：release notes 已写明「应用内显示下载进度，下载完成后打开系统安装界面」
  - `< 2.12.18`（如 2.10.x）：`AppUpdatesPlugin.openDownload` 会 `ACTION_VIEW` 打开浏览器下载；
    **这一跳无法由服务端改掉**（旧 APK 内的 Java 代码固定），必须用户手动装一次到 2.12.18+，
    之后才是应用内更新
- 本次无法构建一个「覆盖旧版」的新 APK：线上 2.13.43 的签名证书是
  `CN=Android Debug, SHA-256 38a03ab2…b4c6`，而本机 `~/.android/debug.keystore` 是
  `0D:63:4A:AF…F5`，**不同密钥**；且本地仓库源码版本仍是 2.10.74，落后线上 2.13.43。
  用不同密钥签的 APK 不能覆盖安装，用旧源码构建会回退功能。

## 要补发「可覆盖安装」的新版本，需要二选一

1. **当前生产前端源码**（`dengta-home-frontend` / 构建 2.13.43 的那份源码）**+ 原始签名 keystore**
   （含 alias/密码），在本地/CI 构建 versionCode > 301 的 release APK；
2. 或者把构建工作交回持有源码与密钥的 CI（GitHub Actions secrets），我们只提交代码与版本号。

拿到后流程：
1. 源码更新 → 前端 `npm test`/`npm run lint`/`npm run build`
2. `npx cap sync android` → `./gradlew assembleRelease`（或 CI）
3. `apksigner verify --print-certs` 确认与线上证书一致
4. 计算 SHA-256/大小，上传 GitHub Release（tag `vX.Y.Z`，资产 `DengTa-X.Y.Z.apk`）
5. 更新网站 `public/updates/android.json` / Supabase 对象（保持 feed 与 APK 同一 SHA）
6. 老用户打开 App → feed versionCode > 本地 → 应用内下载/安装（2.12.18+）

## 安全约束

- 不发布 debug 签名包给已有用户（签名不一致无法覆盖，且 debug key 公开）。
- feed 的 `apk_url`、`sha256`、`size_bytes` 必须与实际上传文件一致；错一个就会触发
  `app_update_manifest_invalid`。
- 本次 GitHub Release 只上传了官方已签名的 2.13.43，未改动线上 feed/网站。

## 相关文件

- 更新校验：`frontend/src/app-updates.js`
- 更新 UI：`frontend/src/AppUpdateCenter.jsx`
- 原生插件：`frontend/android/app/src/main/java/home/dengta/app/AppUpdatesPlugin.java`
- 构建 workflow：`.github/workflows/android-apk.yml`（当前只构建 debug artifact，不发版）
- 备份 APK：`D:\GZdeepseek\backup\releases\`

## 2026-10-29 更新：源码与 CI 已定位

- 生产前端源码在腾讯 CNB 公开仓库：`https://cnb.cool/dengtahome/dengtahome`
  - 分支 `frontend-main` 指向 `0d69ede`（与 Vercel 线上一致）
  - `package.json` version = **2.13.43**，Android versionCode 默认 301
  - 已克隆到 `D:\GZdeepseek\_refs\cnb-dengtahome`
- GitHub 前端私有仓库 `DengTaHome/dengta-home-frontend` 已用新 token 访问；发版 workflow
  `.github/workflows/publish-android-apk.yml` 存在，使用 secrets：
  `ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2`（证书 SHA-256 38a03ab2…）、
  `VITE_SUPABASE_*`、`SUPABASE_*`、`VERCEL_DEPLOY_HOOK`。
- 触发 `workflow_dispatch` 被接受，但 run 立即 failure、**steps=0、runner 未分配**；
  最近所有 health/publish run 同样失败。GitHub 用量接口显示 10 月 Linux Actions 已 **2814 分钟**
  （私有仓库免费额度通常 2000 分钟），极可能是 **Actions 分钟耗尽/支出上限** 导致 job 无法启动。
- 解决：GitHub → Settings → Billing → Spending limits 提高/启用 Actions 预算（或等下月额度重置），
  然后重新触发 workflow；它会自动构建下一个 versionCode、用现有 secret 签名、发布 Supabase、
  更新 `public/updates/android.json`、提交并触发 Vercel，完成后线上/应用内更新自动生效。
- 旧版（<2.12.18）第一次仍会打开浏览器；2.12.18+ 走应用内下载/安装（源码里的 AppUpdatesPlugin 已实现）。

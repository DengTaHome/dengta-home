# Android 2.13.44 更新受阻记录（2026-10-29）

## 已完成
- Web build 通过；`npx cap sync android` 完成。
- 本地构建 `assembleRelease` 成功：
  - `DengTa-2.13.44-302.apk`（34.63MB，versionCode 302）
  - SHA-256 `9cd5b84e8ad7f89ae5f65e99b092ccf1084d85ae105c8840b6bcc318db0ce5a5`
  - 内置 `assets/public/index.html` 已含手机 system 字体启动脚本，无字体 preload。
- 本地 APK 签名有效（v2），证书 SHA-256：
  `9cd5b84e8ad7f89ae5f65e99b092ccf1084d85ae105c8840b6bcc318db0ce5a5`

## 阻塞（P1）
1. **签名证书不匹配**：已安装/线上渠道的 APK 证书是
   `9cd5b84e8ad7f89ae5f65e99b092ccf1084d85ae105c8840b6bcc318db0ce5a5`（稳定 debug 证书）。
   当前机器 `C:\Users\24580\.android\debug.keystore` 是另一把
   `0d634aaf...`，用它签的 2.13.44 **无法覆盖安装**到现有用户；
   `scripts/prepare-app-update.mjs` 也会拒绝发布。
2. 官方 `publish-android-apk.yml` 依赖仓库 secret
   `ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2`；本机没有该 keystore，
   无法本地签名出可升级包。
3. 已尝试 GitHub Actions `workflow_dispatch`（run 40802990852/40803149576）：
   4 秒内失败、无 job/log，当前 Actions 额度/计费限制仍在。
4. `adb devices` 无设备，无法直接安装到手机。

## 不发布的候选
`D:\GZdeepseek\_audit\DengTa-2.13.44-302.apk` 仅可用于**全新安装/模拟器验证**；
不要上传到更新 feed，也不要覆盖安装到现有手机（签名冲突会失败）。

## 解除条件（任一）
- 提供稳定 debug keystore（或 `ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2` 对应的 base64），本地用 Gradle 304 再签名；
- GitHub Actions 额度恢复后，重跑 `Publish Android APK` workflow；
- 手机开启无线调试/连 USB，并提供安装授权（仍需签名兼容）。

## 2026-10-29 追加：新签名可行

- 旧 keystore 未找回；按用户确认生成新 keystore。
- 全新安装 APK：docs/ANDROID-APK-NEW-KEY-2026-10-29.md，证书 b4c7a2f…。
- 旧版不能覆盖升级；不要上传到现有更新 feed。

## 2026-11-02：Actions 额度恢复与签名检查

- 本机代理端口变为 `7877`（原 10809 不可用）；`nov1-deploy.ps1 -DryRun` 通过：GitHub API OK、7 workflows、feed 2.13.50/308。
- CNB 同步：`sync-cnb.yml` run **41370603706 success**，frontend main 已镜像。
- APK 构建校验：`publish-android-apk.yml` **dry_run=true** run **41370983295 success**；说明 Actions 可正常构建并恢复 secret 中的稳定 keystore（cert `38a03ab2…`）。
- **未执行 live publish**：当前线上/用户安装链证书是 `0d634aaf…`，Actions 稳定 keystore 是 `38a03ab2…`；直接发布会生成签名不兼容的 309，违反“不要发布签名不兼容的 APK”。
- 当前线上仍是本地构建的 **2.13.50/308**（cert 0d634aaf，36,467,003B，SHA 7fbf1469…），可覆盖升级。
- 若要走 Actions 正式发布：需把 workflow 的 `ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2` 及证书校验改为当前 `0d634aaf…`，再 dispatch live；或接受换签后用户卸载重装。需用户决策。


## 2026-11-06：Actions 正式发布链切换完成

- secret `ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2` 已换成当前 debug keystore（cert `0d634aaf…`）；3 处 workflow/script 证书常量已同步。
- dry run `42148010527`、live `42148415530`（309）、`42149326312`（310）均 success。
- 当前 feed 310/2.13.52，APK 直连 Supabase，SHA `638322cc…`，36,466,847B，cert 0d634aaf；下载约 2.3MB/s。

# Android 2.13.44 更新受阻记录（2026-10-29）

## 已完成
- Web build 通过；`npx cap sync android` 完成。
- 本地构建 `assembleRelease` 成功：
  - `DengTa-2.13.44-302.apk`（34.63MB，versionCode 302）
  - SHA-256 `7547fef6331ba9ea2d1b764f8ad3e3805366572ebdfb1d0fc918e6a295f4f546`
  - 内置 `assets/public/index.html` 已含手机 system 字体启动脚本，无字体 preload。
- 本地 APK 签名有效（v2），证书 SHA-256：
  `7547fef6331ba9ea2d1b764f8ad3e3805366572ebdfb1d0fc918e6a295f4f546`

## 阻塞（P1）
1. **签名证书不匹配**：已安装/线上渠道的 APK 证书是
   `7547fef6331ba9ea2d1b764f8ad3e3805366572ebdfb1d0fc918e6a295f4f546`（稳定 debug 证书）。
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

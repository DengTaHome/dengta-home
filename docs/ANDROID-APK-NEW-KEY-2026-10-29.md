# Android 新签名 APK（全新安装版）

日期：2026-10-29

## 结论
旧签名私钥（证书 `38a03ab2…`）本机已找不到，无法原地升级。按用户确认，生成了一枚新的发布签名，构建**只能全新安装**的 APK。

## 产物
- 文件：`D:\GZdeepseek\_audit\DengTa-2.13.44-302-fresh-install-newkey.apk`
- 包名：`home.dengta.app`
- versionCode：302 / versionName：2.13.44
- 大小：36,510,356 字节
- SHA-256：`ff9d1a5c2d3f8240e0b94d350c83667eb2c72d3654642d51122792e760fb62c9`
- 新证书 SHA-256：`ab4c7a2f7e3224550daa3a89e7fbb87ca83625ecd6cd3f05a2c543ea46309236`
- `apksigner verify` 通过：v3 有效，minSdk 31 / targetSdk 36

## 安装方式
1. 先备份/导出旧 App 内需要保留的本地内容（聊天云端数据在账号内，但本地草稿、部分设置可能随卸载清除）。
2. 卸载旧版 `DengTa home`。
3. 将新 APK 传到手机并安装。
4. 重新登录账号。

## 限制（重要）
- **不能覆盖安装旧版**：新证书与旧证书不同，Android 会拒绝升级。
- **不能更新到现有 `updates/android.json` feed**：旧用户会升级失败。
- 这份 APK 只用于全新安装/换机；未上传 GitHub Release，也未改线上更新 feed。
- 私钥保存在 `D:\GZdeepseek\_credentials\android\dengta-release-new-20261029.jks`，配套密码在 `dengta-release-new-20261029.json`；不进入仓库。
- 若以后要恢复“原地升级”能力，仍只能找回旧 keystore 或用新包名并存。

## 验证
```powershell
aapt dump badging <apk>        # home.dengta.app 2.13.44(302)
apksigner verify --print-certs <apk>  # ab4c7a2f…
```

## 当前网页版
网页/PWA 不受签名影响；Vercel `eb0d4cb` 已包含光子流动恢复等最新前端修复。


## 2026-10-29 17:00 真机安装回执

- 设备：vivo V2454A（Android 15，序列号已在本地 adb 会话确认）。
- 旧 2.13.43(301) 已卸载；新 2.13.44(302) 安装 Success。
- 启动后进入 DengTa 登录页“欢迎回来”，进程正常。
- 新证书 ab4c7a2f…；旧本地数据随卸载清除，需要重新登录。

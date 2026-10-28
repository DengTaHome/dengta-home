# Android 工具链与 APK 运行（工作区自包含）

本目录的脚本用于在 **本机工作区** 构建、安装、截屏 DengTa home 的 Android APK，
不依赖 Android Studio。工具链放在 `D:\GZdeepseek\_tools`（不在 git 里，体积大）。

## 一次性环境（已完成，记录备查）

| 组件 | 路径 | 说明 |
|---|---|---|
| JDK 21 | `D:\GZdeepseek\_tools\jdk21` | Gradle/AGP 需要 17+ |
| Android SDK | `D:\GZdeepseek\_tools\android-sdk` | cmdline-tools / platform-tools / platforms;android-36 / build-tools;36.0.0 |
| Emulator | `...\android-sdk\emulator` | 37.2.12，经 `sdkmanager` 直连安装（**不要走 10809 代理下载，直连 dl.google.com 快 20 倍**） |
| System image | `...\android-sdk\system-images\android-36\google_apis\x86_64` | 手动解压（zip 内层 `x86_64/` 需拍平），无 package.xml 也能用 |
| AVD | `C:\Users\<user>\.android\avd\dengta.avd` | 手工 config：1080×2400、API36、x86_64 |
| AEHD 驱动 | `...\android-sdk\extras\google\Android_Emulator_Hypervisor_Driver` | 需**管理员**运行 `silent_install.bat`；安装后 `sc query aehd` = RUNNING，可无重启使用 |

## 构建 / 运行

```powershell
# 1) 构建（自动: 前端 build → cap sync → gradlew assembleDebug → 复制到 D:\GZdeepseek\apk-build）
powershell -ExecutionPolicy Bypass -File tools\android\build-apk.ps1

# 2) 启动模拟器（必须 angle_indirect；swiftshader_indirect 会让 qemu 在 App 启动后崩溃）
powershell -ExecutionPolicy Bypass -File tools\android\start-emulator.ps1

# 3) 安装并启动
powershell -ExecutionPolicy Bypass -File tools\android\install-apk.ps1

# 4) 截屏 → D:\GZdeepseek\_audit\apk
powershell -ExecutionPolicy Bypass -File tools\android\screenshot.ps1
```

## 已验证的事实（2026-10-28）

- 构建产物：`D:\GZdeepseek\apk-build\DengTa-2.10.74-debug-bb283f6.apk`（38.7MB，debug 签名）。
- 静态校验：`package=home.dengta.app`、`versionCode=122`、`minSdk=31`、`targetSdk=36`，
  `apksigner verify` 通过，APK 内 `assets/public/index.html` 与最新 `dist` chunk 一致。
- 运行：Android 16（API 36）x86_64 模拟器，1080×2400@420dpi，
  登录页（含密码「显示」按钮、状态栏/手势条安全区正常）与已登录主界面均正常渲染，
  持续运行 >60s 无 crash buffer。
- 证据截图：`docs/screenshots/apk/android-login.png`、`android-main.png`；
  更多过程截图在 `D:\GZdeepseek\_audit\apk`。

## 坑（重要）

1. **渲染器**：`-gpu swiftshader_indirect` 下 qemu 会在 App 启动后约 30–40 秒崩溃
   （Windows 事件 0xc0000005），必须用 `-gpu angle_indirect`。
2. **网络**：`dl.google.com` 直连可用且很快；走 HTTP/SOCKS 代理反而只有 ~0.5MB/s。
3. **截屏**：`adb exec-out screencap -p > file` 在某些 shell 下会写出损坏 PNG；
   用 `adb shell screencap -p /sdcard/x.png` + `adb pull`。
4. **登录态**：APK 原生端把会话存在 **@capacitor/preferences**（不是 localStorage）。
   自动化登录可经 WebView DevTools（`/proc/net/unix` 里的 `webview_devtools_remote_*`
   → `adb forward` → CDP）调用 `Capacitor.Plugins.Preferences.set` 注入；
   注入用的 token/凭据文件用完必须删除，不要留在仓库或备份里。
5. 模拟器首次冷启动约 30–60 秒；`sys.boot_completed=1` 后再装 APK。
# 安装并启动最新 debug APK
# 用法：powershell -ExecutionPolicy Bypass -File tools\android\install-apk.ps1 [-NoLaunch]
param([string]$Apk = "", [switch]$NoLaunch)
$ErrorActionPreference = "Stop"
$tools = "D:\GZdeepseek\_tools"
$adb = Join-Path $tools "android-sdk\platform-tools\adb.exe"
if (-not $Apk) {
  $Apk = Get-ChildItem "D:\GZdeepseek\apk-build\*.apk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Apk -or -not (Test-Path $Apk)) { throw "找不到 APK：先运行 build-apk.ps1" }
if (-not (& $adb devices | Select-String "device$")) { throw "没有设备：插 USB 或先启动模拟器" }
& $adb install -r $Apk
if ($LASTEXITCODE -ne 0) { throw "adb install 失败" }
if (-not $NoLaunch) { & $adb shell monkey -p home.dengta.app -c android.intent.category.LAUNCHER 1 | Out-Null }
Write-Host "已安装并启动 DengTa home"
# 截屏（用 shell screencap + pull，避免 PowerShell 重定向破坏二进制 PNG）
$ErrorActionPreference = "Stop"
$tools = "D:\GZdeepseek\_tools"
$adb = Join-Path $tools "android-sdk\platform-tools\adb.exe"
$out = "D:\GZdeepseek\_audit\apk"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$name = "apk-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png"
& $adb shell screencap -p /sdcard/_dengta-shot.png
& $adb pull /sdcard/_dengta-shot.png (Join-Path $out $name) | Out-Null
Write-Host "已保存：$(Join-Path $out $name)"
# 启动 Android 模拟器（工作区自包含工具链）
# 前提：AEHD 驱动已安装（需要管理员权限安装一次）或 Windows Hypervisor Platform 已启用。
# 注意：必须用 -gpu angle_indirect；swiftshader_indirect 会让 qemu 在 App 启动后崩溃。
# 用法：powershell -ExecutionPolicy Bypass -File tools\android\start-emulator.ps1 [-Window]
param([string]$Avd = "dengta", [switch]$Window)
$ErrorActionPreference = "Stop"
$tools = "D:\GZdeepseek\_tools"
$sdk = Join-Path $tools "android-sdk"
$env:JAVA_HOME = Join-Path $tools "jdk21"
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_AVD_HOME = Join-Path $env:USERPROFILE ".android\avd"
$emulator = Join-Path $sdk "emulator\emulator.exe"
$adb = Join-Path $sdk "platform-tools\adb.exe"
if (-not (Test-Path $emulator)) { throw "缺少 emulator：参考 docs/OPTIMIZATION-LEDGER.md 轮次 13 安装" }
$args = @("-avd", $Avd, "-no-audio", "-no-boot-anim", "-gpu", "angle_indirect", "-no-snapshot")
if (-not $Window) { $args += "-no-window" }
Write-Host "启动模拟器 $Avd ..."
$proc = Start-Process -FilePath $emulator -ArgumentList $args -PassThru
Write-Host "PID=$($proc.Id)，等待 adb 设备（最多 5 分钟）..."
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 5
  $devices = & $adb devices 2>$null | Select-String "emulator-.*device"
  if ($devices) {
    for ($j = 0; $j -lt 120; $j++) {
      Start-Sleep -Seconds 5
      $booted = (& $adb shell getprop sys.boot_completed 2>$null) -join ""
      if ($booted.Trim() -eq "1") { Write-Host "Android 已启动完成"; exit 0 }
    }
    throw "系统 10 分钟内未完成启动"
  }
}
throw "adb 5 分钟内没有发现 emulator 设备"
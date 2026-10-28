# 构建 debug APK（工作区自包含 Android 工具链）
# 用法：powershell -ExecutionPolicy Bypass -File tools\android\build-apk.ps1
$ErrorActionPreference = "Stop"
$tools = "D:\GZdeepseek\_tools"
$sdk = Join-Path $tools "android-sdk"
$frontend = "D:\GZdeepseek\dengta-home\frontend"
$env:JAVA_HOME = Join-Path $tools "jdk21"
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:GRADLE_USER_HOME = Join-Path $tools "gradle-home"
$env:PATH = (Join-Path $tools "node") + ";" + $env:PATH

Push-Location $frontend
try {
  & (Join-Path $tools "node\npm.cmd") run build
  if ($LASTEXITCODE -ne 0) { throw "前端构建失败" }
  & (Join-Path $tools "node\node.exe") (Join-Path $tools "node\node_modules\npm\bin\npx-cli.js") cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync 失败" }
} finally { Pop-Location }

$android = Join-Path $frontend "android"
$localProperties = Join-Path $android "local.properties"
[IO.File]::WriteAllText($localProperties, "sdk.dir=" + $sdk.Replace('\','\\'), (New-Object System.Text.UTF8Encoding($false)))

Push-Location $android
try {
  & ".\gradlew.bat" ":app:assembleDebug" "--no-daemon" "--console=plain"
  if ($LASTEXITCODE -ne 0) { throw "gradle 构建失败" }
} finally { Pop-Location }

$apk = Join-Path $android "app\build\outputs\apk\debug\app-debug.apk"
$outDir = "D:\GZdeepseek\apk-build"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$version = (Select-String -Path (Join-Path $android "app\build.gradle") -Pattern 'versionName "([^"]+)"').Matches.Groups[1].Value
$target = Join-Path $outDir ("DengTa-" + $version + "-debug.apk")
Copy-Item $apk $target -Force
Write-Host "APK: $target"
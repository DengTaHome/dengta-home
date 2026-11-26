#requires -Version 5.1
<#
DengTa v2.13.65 (323) GitHub Push + Release APK Upload + Live Production Health Gate

Prerequisites:
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.65.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.65.apk"
$ExpectedSha256 = "3c3f580e1461c06ad2acf3988ac17d4972a90265b02b59e11d7bbc5846ec3933"
$ExpectedSize = 38917951

if ([string]::IsNullOrWhiteSpace($GithubToken)) {
  throw "Missing GH_TOKEN. Please set `$env:GH_TOKEN to a verified Jessica-tce GitHub PAT with repo write access and re-run."
}
$GithubToken = $GithubToken.Trim()
if (-not (Test-Path $ApkPath)) { throw "APK missing: $ApkPath" }
$actualSha = (Get-FileHash -Algorithm SHA256 $ApkPath).Hash.ToLower()
$actualSize = (Get-Item $ApkPath).Length
if ($actualSha -ne $ExpectedSha256 -or $actualSize -ne $ExpectedSize) {
  throw "APK verification failed: size=$actualSize sha256=$actualSha"
}

$headers = @{
  Authorization = "Bearer $GithubToken"
  Accept = "application/vnd.github+json"
  "User-Agent" = "dengta-release-v2.13.65"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -TimeoutSec 20
Write-Host "Authenticated GitHub user: $($me.login)" -ForegroundColor Cyan
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($me.login):$GithubToken"))

function Push-Repo([string]$Dir, [string]$Slug) {
  Write-Host "== Pushing $Slug main ==" -ForegroundColor Cyan
  $out = & $Git -C $Dir -c credential.helper= -c http.proxy= -c https.proxy= -c "http.extraheader=Authorization: Basic $basic" push "https://github.com/$Slug.git" HEAD:main 2>&1 | Out-String
  Write-Host ($out.Replace($GithubToken, "***").Replace($basic, "***").Trim())
  if ($LASTEXITCODE -ne 0) { throw "Failed to push $Slug" }
  return (& $Git -C $Dir rev-parse HEAD).Trim()
}

$beSha = Push-Repo "D:\GZdeepseek\_refs\backend-prod" "tnineninet/dengta-home-backend"
$feSha = Push-Repo "D:\GZdeepseek\_refs\frontend-gh" "tnineninet/dengta-home-frontend"
$docsSha = Push-Repo "D:\GZdeepseek\dengta-home" "tnineninet/dengta-home"
Write-Host "GitHub backend main = $beSha" -ForegroundColor Green
Write-Host "GitHub frontend main = $feSha" -ForegroundColor Green
Write-Host "GitHub docs main = $docsSha" -ForegroundColor Green

Write-Host "== Publishing GitHub Release v2.13.65 & uploading APK ==" -ForegroundColor Cyan
$tag = "v2.13.65"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v2.13.65 (versionCode 323)

- **QQ 机器人状态醒目化、6 位绑定码拦截与真实人设记忆同步铁证**：
  - 首帧即时加载 ``/api/v2/qq-cloud`` 与 ``/api/v2/channel-sync/preview``，顶部提供绿/琥珀/红呼吸灯大状态横幅与「同步生效证据」卡（8 位指纹、人设/称呼/记忆/最近对话计数、真实摘录预览与一键全量开启按钮）
  - ``qq-bridge.js`` 补齐主人称呼背景（``user_details``）、修复 ``memory_limit=0`` 静默零条陷阱、接入最近 10 轮灯塔对话延续，并改用自然有温度的伴侣身份引导
  - ``qq-cloud.js`` 自动拦截 6 位绑定码并回执在线状态与同步指纹，新增 QQ 私聊指令 ``/同步状态`` 即时自检
- **根治「AI 工作台·剪映」无法上下滑动**：补齐 ``feature-page`` 类与 ``overflow-y: auto; min-height: 0; touch-action: pan-y``
- 完整包含 ``v2.13.64`` AI 视界多平台接入向导与 MCP 跳转修复、``v2.13.63`` 音乐工作室零裁切二维码与 ``-462`` 风控根治、``v2.13.62`` 小棉花 3D 重塑

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v2.13.65 (323)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-2.13.65.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-2.13.65.apk"
Write-Host "Uploading DengTa-2.13.65.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "Uploaded APK asset: $($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== Waiting for Vercel deploy & verifying live health ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "323"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq 323) {
      Write-Host "Live feed updated to v$($feed.latest.version) ($($feed.latest.version_code))!" -ForegroundColor Green
      break
    }
    Write-Host "Attempt $i/12: live feed still version_code=$($feed.latest.version_code), waiting 10s..."
  } catch {
    Write-Host "Attempt $i/12: waiting for Vercel..."
  }
  Start-Sleep -Seconds 10
}

& $Node "D:\GZdeepseek\_refs\frontend-gh\scripts\deployment-health.mjs"
if ($LASTEXITCODE -ne 0) { throw "deployment-health.mjs failed" }
Write-Host "ALL GITHUB + VERCEL + RENDER + APK RELEASE GATES PASSED!" -ForegroundColor Green

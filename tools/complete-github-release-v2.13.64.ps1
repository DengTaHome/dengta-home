#requires -Version 5.1
<#
DengTa v2.13.64 (322) GitHub Push + Release APK Upload + Live Production Health Gate

Prerequisites:
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.64.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.64.apk"
$ExpectedSha256 = "b0547f8d3d76a92db868bc655aaeca8dd83f95d8fef0fa77d1dd052394fba19b"
$ExpectedSize = 38914727

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
  "User-Agent" = "dengta-release-v2.13.64"
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

Write-Host "== Publishing GitHub Release v2.13.64 & uploading APK ==" -ForegroundColor Cyan
$tag = "v2.13.64"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v2.13.64 (versionCode 322)

- **AI 视界 · B站/抖音/小红书多平台接入向导与直达路由**：
  - 根治全站 4 处「MCP 插件中心」跳转错位 Bug：改由 ``openMcpDeviceCenter()`` 准确打开「设置 → 设备与共看 → 自定义 MCP 连接」（不再误跳「模型与服务」），创作者模板默认 Bearer 并滚至表单
  - 新增「怎么接入？」快捷入口与「接入向导 · 平台入口」标签页：一屏梳理 B 站、小红书、抖音、剪映的免配置能力与进阶接口位置，内置一键直达「一起看登录 B 站」「设置→小红书登录/发布」「MCP 插件中心」「AI 工作台·剪映」
  - 支持在 AI 视界内直接配置并一键测试本机/局域网 ``18088`` 创作者网关（与剪映工作台共用地址，手机同 Wi-Fi 免公网 HTTPS 直连），修正云端接口 404 时虚报在线的问题并补充 ``cloudflared tunnel`` 公网 HTTPS 隧道命令
- 完整包含 ``v2.13.63`` 音乐工作室零裁切二维码与 ``-462`` 风控根治、``v2.13.62`` 小棉花 3D 立体重塑、``v2.13.61`` 聊天记录 0ms 秒开、``v2.13.60`` Chronos 严格时间

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v2.13.64 (322)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-2.13.64.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-2.13.64.apk"
Write-Host "Uploading DengTa-2.13.64.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "Uploaded APK asset: $($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== Waiting for Vercel deploy & verifying live health ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "322"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq 322) {
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

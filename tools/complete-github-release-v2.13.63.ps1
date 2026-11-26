#requires -Version 5.1
<#
DengTa v2.13.63 (321) GitHub Push + Release APK Upload + Live Production Health Gate

Prerequisites:
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.63.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.63.apk"
$ExpectedSha256 = "6784268b61684458c7bd8421313fffa2e95635ab1288762cfe03275a17d2376b"
$ExpectedSize = 38909492

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
  "User-Agent" = "dengta-release-v2.13.63"
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

Write-Host "== Publishing GitHub Release v2.13.63 & uploading APK ==" -ForegroundColor Cyan
$tag = "v2.13.63"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v2.13.63 (versionCode 321)

- **音乐工作室与一起听全链路实机修复**：
  - 移动端重构 180px 紧凑零裁切二维码卡片（2×2 按钮矩阵 + 全宽一键登录），根治「只显示一半二维码」
  - 前后端统一识别网易云云端风控 ``code -462``（不再卡死等待扫码），主区置顶「App 内一键登录（本机网络免风控）」；补齐 Cookie 会话歌单、搜歌（``data.items``）与直链 HTTPS 升级
  - 自动升级网易云官方 CDN ``http://*.music.126.net`` 为 ``https://`` 并刷新过期签名，根治一起听/随机放歌「歌曲暂时无法播放」报错
- **侧边栏比例再精修**：修复分组标题被撑成 17px 大按钮的问题、折叠搜索标签、收紧最近对话并统一底部单行等高 Dock，让玩法列表一屏显示更全面
- 完整包含 ``v2.13.62`` 小棉花 3D 立体毛绒与高对比舞台、``v2.13.61`` 聊天记录 0ms 秒开、``v2.13.60`` Chronos 严格时间与自动唤醒

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v2.13.63 (321)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-2.13.63.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-2.13.63.apk"
Write-Host "Uploading DengTa-2.13.63.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "Uploaded APK asset: $($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== Waiting for Vercel deploy & verifying live health ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "321"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq 321) {
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

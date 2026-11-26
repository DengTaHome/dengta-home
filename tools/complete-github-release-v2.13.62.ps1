#requires -Version 5.1
<#
DengTa v2.13.62 (320) GitHub Push + Release APK Upload + Live Production Health Gate

Prerequisites:
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.62.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.62.apk"
$ExpectedSha256 = "b1532c33cd288444a361a42b7dad3b4d2b64cf0cac131e58d88a0250474b26c9"
$ExpectedSize = 38908168

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
  "User-Agent" = "dengta-release-v2.13.62"
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

Write-Host "== Publishing GitHub Release v2.13.62 & uploading APK ==" -ForegroundColor Cyan
$tag = "v2.13.62"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v2.13.62 (versionCode 320)

- **小棉花 3D 博美犬可见性与质感全面重塑（根治「白的啥也看不见」）**：
  - 49,853 顶点注入自然毛绒 AO 阴影（下颌/领毛折痕/爪底过渡）+ 耳尖淡杏色/耳廓淡粉/面颊微红腮红与笑弧，立体层次分明
  - 校准 PBR & MToon 卡通布光（降低 MToon 半球泛光至 0.34，彻底消除白毛被泛光冲刷成纯白一团的问题），重构蒙皮后法线外扩细描边着色器（零偏移手绘动画轮廓）
  - 升级高对比度摄影棚舞台底色（新增「雾松绿 / 暖咖绒 / 暮色蓝」一键切换 + MToon 暮光紫 + 夜间星幕）与壁纸免疫磨砂控制卡片，同步提升悬浮桌宠在亮色聊天页的边缘清晰度
- 完整包含 ``v2.13.61`` 聊天记录 0ms 秒开与 ``?after=`` 增量同步、``v2.13.60`` Chronos 严格时间与准秒级自动唤醒、真实 KV-Cache 命中率可视化、全程实时多模态感知与音乐工作室直连二维码

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v2.13.62 (320)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-2.13.62.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-2.13.62.apk"
Write-Host "Uploading DengTa-2.13.62.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "Uploaded APK asset: $($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== Waiting for Vercel deploy & verifying live health ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "320"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq 320) {
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

#requires -Version 5.1
<#
DengTa v2.13.66 (324) GitHub Push + Release APK Upload + Live Production Health Gate

Usage (Beginner-friendly):
  Double-click D:\GZdeepseek\dengta-home\tools\点我一键同步GitHub-v2.13.66.cmd
  (Automatically opens GitHub token page if GH_TOKEN is not set; no command-line knowledge needed.)

Usage (Non-interactive):
  $env:GH_TOKEN = "<Jessica-tce PAT>"
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.66.ps1
#>
param(
  [string]$GithubToken = $env:GH_TOKEN,
  [string]$GithubUser = "Jessica-tce"
)

$ErrorActionPreference = "Stop"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Node = "D:\GZdeepseek\_tools\node\node.exe"
$ApkPath = "D:\GZdeepseek\apk-build\DengTa-2.13.66.apk"
$ExpectedSha256 = "23e0e112b0d0fed9fd607dcf91511214b0386ceebfab353819511b97a163ec5b"
$ExpectedSize = 38920842

$interactive = [string]::IsNullOrWhiteSpace($GithubToken)

if ($interactive) {
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host "  DengTa v2.13.66 (324) 一键推送到 GitHub / Vercel / Render" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "正在自动为你打开 GitHub 授权码生成页（已自动勾选 repo 权限）..." -ForegroundColor Yellow
  Write-Host "请按下面 3 步操作：" -ForegroundColor White
  Write-Host "  1. 确认浏览器右上角登录的是账号：Jessica-tce（不要用旧的 DengTaHome）" -ForegroundColor Green
  Write-Host "  2. 网页直接拉到最底部，点击绿色按钮 [Generate token]" -ForegroundColor Green
  Write-Host "  3. 点生成的 ghp_... 旁边的复制图标，再回到这里按 Ctrl+V 或右键粘贴并回车" -ForegroundColor Green
  Write-Host ""
  try {
    Start-Process "https://github.com/settings/tokens/new?description=dengta-push&scopes=repo"
  } catch {
    Write-Host "（如果浏览器没自动弹出，请手动打开：https://github.com/settings/tokens/new?description=dengta-push&scopes=repo ）" -ForegroundColor Yellow
  }
  $sec = Read-Host -Prompt "请粘贴刚才复制的 GitHub 授权码（输入时会显示星号）并按回车" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $GithubToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

if ([string]::IsNullOrWhiteSpace($GithubToken)) {
  throw "未输入 GitHub 授权码，已取消操作。"
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
  "User-Agent" = "dengta-release-v2.13.66"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -TimeoutSec 20
Write-Host "GitHub 登录验证成功，当前账号：$($me.login)" -ForegroundColor Green
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($me.login):$GithubToken"))

function Push-Repo([string]$Dir, [string]$Slug) {
  Write-Host "== 正在推送 $Slug main ==" -ForegroundColor Cyan
  $out = & $Git -C $Dir -c credential.helper= -c http.proxy= -c https.proxy= -c "http.extraheader=Authorization: Basic $basic" push "https://github.com/$Slug.git" HEAD:main 2>&1 | Out-String
  Write-Host ($out.Replace($GithubToken, "***").Replace($basic, "***").Trim())
  if ($LASTEXITCODE -ne 0) { throw "推送 $Slug 失败，请确认登录的是 Jessica-tce 且勾选了 repo 权限。" }
  return (& $Git -C $Dir rev-parse HEAD).Trim()
}

$beSha = Push-Repo "D:\GZdeepseek\_refs\backend-prod" "tnineninet/dengta-home-backend"
$feSha = Push-Repo "D:\GZdeepseek\_refs\frontend-gh" "tnineninet/dengta-home-frontend"
$docsSha = Push-Repo "D:\GZdeepseek\dengta-home" "tnineninet/dengta-home"
Write-Host "GitHub backend main = $beSha" -ForegroundColor Green
Write-Host "GitHub frontend main = $feSha" -ForegroundColor Green
Write-Host "GitHub docs main = $docsSha" -ForegroundColor Green

if ($interactive) {
  Write-Host ""
  $saveAns = Read-Host "是否把账号 $($me.login) 保存到本机 Windows 凭据管理器（替换旧账号 DengTaHome，以后不用再手动输）？直接按回车=是，输入 N=否"
  if ([string]::IsNullOrWhiteSpace($saveAns) -or $saveAns.Trim().ToUpper() -eq "Y") {
    try {
      "protocol=https`nhost=github.com`n`n" | & $Git credential reject 2>$null | Out-Null
      "protocol=https`nhost=github.com`nusername=$($me.login)`npassword=$GithubToken`n`n" | & $Git credential approve 2>$null | Out-Null
      Write-Host "已把 $($me.login) 写入 Windows 凭据管理器，以后 AI 可以直接推送代码啦！" -ForegroundColor Green
    } catch {
      Write-Host "（凭据保存跳过，不影响本次发布）" -ForegroundColor Yellow
    }
  }
}

Write-Host "== 正在发布 GitHub Release v2.13.66 并上传新版 APK ==" -ForegroundColor Cyan
$tag = "v2.13.66"
$rel = $null
try {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/tags/$tag" -Headers $headers -TimeoutSec 20
} catch {
  $rel = $null
}

$releaseNotes = @"
## DengTa v2.13.66 (versionCode 324)

- **根治 X / Twitter 假连接与全功能不可用问题**：
  - 移除硬编码「MCP 网关在线」与过于宽泛的 ``\bx\b`` 误匹配，改为真实四态判定（``● 已连接 · 可用`` / ``◌ 已保存 · 未启用`` / ``✕ 连接离线 / 不可用`` / ``○ 未连接``）
  - 新增 X 网关状态与诊断卡（展示真实端点、上次实测时间与报错原因），提供【一键启用并实测连通】和【实测连通性】按钮
  - 仅在实测在线且检测到对应工具时开放推文搜索、发推、查用户主页/近期推文功能；遇到 409/502/504 时立即把假在线翻转为真实离线
- **完整包含 v2.13.65**：QQ 机器人高对比在线大横幅、6 位绑定码拦截与 ``/同步状态`` 实时自检、完整人设/称呼/记忆/对话延续同步铁证、AI 工作台无法上下滑动根治
- **完整包含 v2.13.64 / v2.13.63 / v2.13.62**：AI 视界多平台接入向导与 MCP 跳转修复、音乐工作室零裁切二维码与 ``-462`` 风控根治、小棉花 3D 重塑

- **SHA-256**: ``$ExpectedSha256``
- **Size**: ``$ExpectedSize`` bytes
"@

if ($null -eq $rel) {
  $bodyJson = @{
    tag_name = $tag
    target_commitish = $feSha
    name = "DengTa v2.13.66 (324)"
    body = $releaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Depth 4
  $rel = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases" -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson)) -TimeoutSec 30
}

foreach ($a in @($rel.assets)) {
  if ($a.name -eq "DengTa-2.13.66.apk") {
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/tnineninet/dengta-home-frontend/releases/assets/$($a.id)" -Headers $headers -TimeoutSec 20 | Out-Null
  }
}

$uploadBase = ($rel.upload_url -split "\{", 2)[0]
$uploadUrl = "${uploadBase}?name=DengTa-2.13.66.apk"
Write-Host "正在上传 DengTa-2.13.66.apk ($ExpectedSize bytes)..."
$uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType "application/vnd.android.package-archive" -InFile $ApkPath -TimeoutSec 300
Write-Host "APK 上传成功：$($uploaded.browser_download_url)" -ForegroundColor Green

Write-Host "== 正在等待 Vercel 官网更新并验证全链路健康 ==" -ForegroundColor Cyan
$env:EXPECTED_FEED_VERSION_CODE = "324"
for ($i = 1; $i -le 12; $i++) {
  try {
    $feed = Invoke-RestMethod -Uri "https://www.dengtahome.com/updates/android.json?ts=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 15
    if ($feed.latest.version_code -eq 324) {
      Write-Host "官网更新清单已刷新至 v$($feed.latest.version) ($($feed.latest.version_code))！" -ForegroundColor Green
      break
    }
    Write-Host "第 $i/12 次检查：官网还是 version_code=$($feed.latest.version_code)，等待 10 秒..."
  } catch {
    Write-Host "第 $i/12 次检查：等待 Vercel 构建中..."
  }
  Start-Sleep -Seconds 10
}

& $Node "D:\GZdeepseek\_refs\frontend-gh\scripts\deployment-health.mjs"
if ($LASTEXITCODE -ne 0) { throw "deployment-health.mjs failed" }
Write-Host ""
Write-Host "全部完成！GitHub + Vercel 官网 + Render 后端 + v2.13.66 APK 均已线上生效！" -ForegroundColor Green

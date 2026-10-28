#requires -Version 5.1
<#
  2026-11-01 自动部署：GitHub Actions 额度重置后
  1) 触发 frontend 仓库的 Sync frontend to CNB（把 65eeb4f 镜像到 CNB）
  2) 触发 Publish Android APK（dry_run=false）构建/签名/发布 2.13.44+
  3) 轮询结果并验证线上 update feed
  4) 如果本地有 CNB_TOKEN，则把本地前端提交直推 CNB作为兜底

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy/nov1-deploy.ps1
  凭据从 D:\GZdeepseek\_credentials\dengta-credentials.json 读取，日志写 _audit。
#>
[CmdletBinding()]
param(
  [switch]$SkipPublish,
  [switch]$SkipCnbSync
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$CredPath = if ($env:DENGTA_CREDENTIALS) { $env:DENGTA_CREDENTIALS } else { "D:\GZdeepseek\_credentials\dengta-credentials.json" }
$LogDir = Join-Path $RepoRoot "_audit"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "nov1-deploy-$Stamp.log"

function Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

$cred = Get-Content -Raw -Encoding UTF8 -LiteralPath $CredPath | ConvertFrom-Json
$token = [string]$cred.github.pat
if (-not $token) { throw "缺少 github.pat" }
$repo = "DengTaHome/dengta-home-frontend"
$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }
$api = "https://api.github.com/repos/$repo/actions/workflows"
$proxy = if ($cred.proxy) { [string]$cred.proxy } else { "http://127.0.0.1:10809" }

function Invoke-GitHub {
  param([string]$Method, [string]$Uri, [object]$Body)
  $curlArgs = @("-sS", "--max-time", "60", "--proxy", $proxy, "--ssl-no-revoke", "-X", $Method, "-H", "Authorization: Bearer $token", "-H", "Accept: application/vnd.github+json")
  $tmp = Join-Path $env:TEMP ("dengta-" + [guid]::NewGuid().ToString("N") + ".json")
  try {
    if ($null -ne $Body) {
      [IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
      $curlArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$tmp")
    }
    $curlArgs += $Uri
    $raw = & curl.exe @curlArgs 2>&1 | Out-String
    if ($raw.Trim()) { return ($raw.Trim() | ConvertFrom-Json) }
    return $null
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function Dispatch-Workflow([string]$File, [string]$Ref = "main", [hashtable]$Inputs = @{}) {
  Log "dispatch $File ref=$Ref"
  $body = @{ ref = $Ref; inputs = $Inputs }
  Invoke-GitHub -Method POST -Uri "$api/$File/dispatches" -Body $body | Out-Null
  Start-Sleep -Seconds 5
  $runs = (Invoke-GitHub -Method GET -Uri "https://api.github.com/repos/$repo/actions/runs?event=workflow_dispatch&per_page=5").workflow_runs
  $run = @($runs | Where-Object { $_.path -like "*$File*" } | Select-Object -First 1)
  if (-not $run) { throw "没有找到刚触发的 $File run" }
  Log "run=$($run.id) $($run.html_url)"
  return $run[0]
}

function Wait-Run($Run, [int]$TimeoutMinutes = 50) {
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  while ((Get-Date) -lt $deadline) {
    $r = Invoke-GitHub -Method GET -Uri "https://api.github.com/repos/$repo/actions/runs/$($Run.id)"
    Log "run=$($r.id) status=$($r.status) conclusion=$($r.conclusion)"
    if ($r.status -eq "completed") { return $r }
    Start-Sleep -Seconds 25
  }
  throw "run $($Run.id) 超时"
}

$results = [ordered]@{}

if (-not $SkipCnbSync) {
  Log "开始 CNB 镜像同步（依赖 GitHub Actions 额度已重置）"
  $run = Dispatch-Workflow -File "sync-cnb.yml"
  $finished = Wait-Run -Run $run -TimeoutMinutes 15
  $results.cnb = $finished.conclusion
  if ($finished.conclusion -ne "success") { Log "CNB 同步失败，继续发版流程" }
}

if (-not $SkipPublish) {
  Log "开始 Android 发版"
  $run = Dispatch-Workflow -File "publish-android-apk.yml" -Inputs @{ dry_run = $false }
  $finished = Wait-Run -Run $run -TimeoutMinutes 50
  $results.publish = $finished.conclusion
}

if ($results.publish -eq "success") {
  try {
    $feed = & curl.exe -sS --max-time 60 --noproxy "*" "https://www.dengtahome.com/updates/android.json" | Out-String | ConvertFrom-Json
    Log ("线上 feed: version={0} code={1} url={2}" -f $feed.latest.version, $feed.latest.version_code, $feed.latest.apk_url)
    $results.feed = "ok"
  } catch { Log "feed 验证失败: $($_.Exception.Message)"; $results.feed = "error" }
}

# 可选：本地 CNB 兜底推送（需要 CNB_USERNAME / CNB_TOKEN）
$frontend = Join-Path (Split-Path $RepoRoot) "_refs\frontend-gh"
if ($env:CNB_USERNAME -and $env:CNB_TOKEN -and (Test-Path (Join-Path $frontend ".git"))) {
  Log "使用 CNB_TOKEN 直推 frontend-main"
  try {
    $git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
    $env:GIT_TERMINAL_PROMPT = "0"
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($env:CNB_USERNAME):$($env:CNB_TOKEN)"))
    & $git -C $frontend -c "http.extraheader=Authorization: Basic $basic" -c "http.proxy=$proxy" -c "https.proxy=$proxy" push "https://cnb.cool/dengtahome/dengtahome.git" "HEAD:refs/heads/frontend-main" 2>&1 | ForEach-Object { Log "  $_" }
    $results.cnbDirect = "pushed"
  } catch { Log "CNB 直推失败: $($_.Exception.Message)"; $results.cnbDirect = "error" }
} else {
  Log "没有 CNB_USERNAME/CNB_TOKEN，跳过本地直推；依赖上面的 GitHub Actions sync-cnb"
  $results.cnbDirect = "skipped"
}

$results | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path (Join-Path $LogDir "nov1-deploy-$Stamp.result.json") -Encoding UTF8
Log ("DONE " + ($results | ConvertTo-Json -Depth 4 -Compress))

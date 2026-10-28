#requires -Version 5.1
<#
  2026-11-01 自动部署：GitHub Actions 额度重置后
  1) 触发 frontend 仓库的 Sync frontend to CNB（把当前 main 镜像到 CNB）
  2) 触发 Publish Android APK（dry_run=false）构建/签名/发布 2.13.44+
  3) 轮询结果并验证线上 update feed 的 versionCode 确实增长
  4) 如果本地有 CNB_TOKEN，则把本地前端提交直推 CNB 作为兜底

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy/nov1-deploy.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy/nov1-deploy.ps1 -DryRun
  凭据从 D:\GZdeepseek\_credentials\dengta-credentials.json 读取，日志写 _audit。
#>
[CmdletBinding()]
param(
  [switch]$SkipPublish,
  [switch]$SkipCnbSync,
  [switch]$DryRun
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

# 凭据文件里的 proxy 是对象 {socks5, http}，不是字符串；必须取 .http。
if ($cred.proxy -is [string]) {
  $proxy = [string]$cred.proxy
} elseif ($cred.proxy.http) {
  $proxy = [string]$cred.proxy.http
} else {
  $proxy = "127.0.0.1:10809"
}
if ($proxy -notmatch '^https?://') { $proxy = "http://$proxy" }
$proxyDisplay = $proxy -replace "(?<=//)[^/@]+@", "***@"
if ($proxy -notmatch '^https?://[^/]+:[0-9]+$') { throw "proxy 地址无效（应为 http://host:port）" }

$repo = "DengTaHome/dengta-home-frontend"
$api = "https://api.github.com/repos/$repo/actions/workflows"

function Invoke-GitHub {
  param([string]$Method, [string]$Uri, [object]$Body)
  $curlArgs = @(
    "-sS", "--max-time", "60", "--proxy", $proxy, "--ssl-no-revoke",
    "-X", $Method,
    "-H", "Authorization: Bearer $token",
    "-H", "Accept: application/vnd.github+json",
    "-w", "`n__HTTP_STATUS__%{http_code}"
  )
  $tmp = Join-Path $env:TEMP ("dengta-" + [guid]::NewGuid().ToString("N") + ".json")
  try {
    if ($null -ne $Body) {
      [IO.File]::WriteAllText($tmp, ($Body | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
      $curlArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$tmp")
    }
    $curlArgs += $Uri
    $raw = & curl.exe @curlArgs 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw "curl 失败 exit=${exitCode}: $($raw.Trim())"
    }
    $marker = "__HTTP_STATUS__"
    $idx = $raw.LastIndexOf($marker)
    if ($idx -lt 0) { throw "curl 响应缺少 HTTP 状态标记" }
    $status = [int]($raw.Substring($idx + $marker.Length).Trim())
    $payload = $raw.Substring(0, $idx).Trim()
    if ($status -lt 200 -or $status -ge 300) {
      throw "GitHub API $Method $Uri 返回 HTTP ${status}: $($payload.Substring(0, [Math]::Min(500, $payload.Length)))"
    }
    if ($payload) { return ($payload | ConvertFrom-Json) }
    return $null
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

function Dispatch-Workflow([string]$File, [string]$Ref = "main", [hashtable]$Inputs = @{}) {
  Log "dispatch $File ref=$Ref"
  $dispatchStarted = (Get-Date).ToUniversalTime().AddSeconds(-15)
  $body = @{ ref = $Ref; inputs = $Inputs }
  Invoke-GitHub -Method POST -Uri "$api/$File/dispatches" -Body $body | Out-Null

  $run = $null
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    Start-Sleep -Seconds 5
    $runs = (Invoke-GitHub -Method GET -Uri "https://api.github.com/repos/$repo/actions/runs?event=workflow_dispatch&per_page=20").workflow_runs
    if ($runs) {
      $run = @($runs |
        Where-Object {
          $_.path -like "*$File*" -and
          $_.head_branch -eq $Ref -and
          ([datetime]$_.created_at).ToUniversalTime() -ge $dispatchStarted
        } |
        Sort-Object { [datetime]$_.created_at } -Descending |
        Select-Object -First 1)
    }
    if ($run -and $run.Count -gt 0) { break }
    Log "等待 $File 的新 run 出现（attempt=$attempt）"
  }
  if (-not $run -or $run.Count -eq 0) { throw "没有找到 15 秒内新触发的 $File run" }
  $run = $run[0]
  Log "run=$($run.id) $($run.html_url)"
  return $run
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

function Get-Feed {
  $raw = & curl.exe -sS --max-time 60 --noproxy "*" "https://www.dengtahome.com/updates/android.json" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "feed curl exit=$LASTEXITCODE" }
  return ($raw.Trim() | ConvertFrom-Json)
}

if ($DryRun) {
  Log "DRY RUN：校验凭据/代理/GitHub API，不触发任何 workflow"
Log "proxy=$proxyDisplay"
  $workflows = Invoke-GitHub -Method GET -Uri "https://api.github.com/repos/$repo/actions/workflows"
  Log ("GitHub API OK；workflow 数=" + @($workflows.workflows).Count)
  $feed = Get-Feed
  Log ("feed OK version=" + $feed.latest.version + " code=" + $feed.latest.version_code)
  Log "DRY RUN 完成"
  exit 0
}

$results = [ordered]@{}

if (-not $SkipCnbSync) {
  Log "开始 CNB 镜像同步（依赖 GitHub Actions 额度已重置）"
  $run = Dispatch-Workflow -File "sync-cnb.yml"
  $finished = Wait-Run -Run $run -TimeoutMinutes 15
  $results.cnb = $finished.conclusion
  if ($finished.conclusion -ne "success") { Log "CNB 同步失败，继续发版流程" }
}

$beforeFeed = $null
if (-not $SkipPublish) {
  try {
      $beforeFeed = Get-Feed
      Log ("发版前 feed code=" + $beforeFeed.latest.version_code)
  } catch {
      throw "发版前 feed 读取失败，拒绝在无法对比版本时发版: $($_.Exception.Message)"
  }

  Log "开始 Android 发版"
  $run = Dispatch-Workflow -File "publish-android-apk.yml" -Inputs @{ dry_run = $false }
  $finished = Wait-Run -Run $run -TimeoutMinutes 50
  $results.publish = $finished.conclusion
}

if ($results.publish -eq "success") {
  try {
    $feed = Get-Feed
    $oldCode = if ($beforeFeed) { [int]$beforeFeed.latest.version_code } else { -1 }
    $newCode = [int]$feed.latest.version_code
    Log ("线上 feed: version={0} code={1} -> {2}" -f $feed.latest.version, $oldCode, $newCode)
    if ($newCode -le $oldCode) {
      throw "feed versionCode 未增长（$oldCode -> $newCode），发布可能尚未生效"
    }
    $results.feed = "ok"
  } catch {
    Log "feed 验证失败: $($_.Exception.Message)"
    $results.feed = "error"
  }
}

# 可选：本地 CNB 兜底推送（需要 CNB_USERNAME / CNB_TOKEN）
$frontend = Join-Path (Split-Path $RepoRoot) "_refs\frontend-gh"
if ($env:CNB_USERNAME -and $env:CNB_TOKEN -and (Test-Path (Join-Path $frontend ".git"))) {
  Log "使用 CNB_TOKEN 直推 frontend-main"
  try {
    $git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
    $env:GIT_TERMINAL_PROMPT = "0"
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$($env:CNB_USERNAME):$($env:CNB_TOKEN)"))
    $cnbOutput = & $git -C $frontend -c "http.extraheader=Authorization: Basic $basic" -c "http.proxy=$proxy" -c "https.proxy=$proxy" push "https://cnb.cool/dengtahome/dengtahome.git" "HEAD:refs/heads/frontend-main" 2>&1
    $cnbExit = $LASTEXITCODE
    $cnbOutput | ForEach-Object { Log "  $_" }
    if ($cnbExit -ne 0) { throw "CNB push exit=$cnbExit" }
    $results.cnbDirect = "pushed"
  } catch {
    Log "CNB 直推失败: $($_.Exception.Message)"
    $results.cnbDirect = "error"
  }
} else {
  Log "没有 CNB_USERNAME/CNB_TOKEN，跳过本地直推；依赖上面的 GitHub Actions sync-cnb"
  $results.cnbDirect = "skipped"
}

$results | ConvertTo-Json -Depth 4 -Compress | Set-Content -Path (Join-Path $LogDir "nov1-deploy-$Stamp.result.json") -Encoding UTF8
Log ("DONE " + ($results | ConvertTo-Json -Depth 4 -Compress))
$publishFailed = $results.publish -and $results.publish -ne "success"
$feedFailed = $results.feed -and $results.feed -ne "ok"
$cnbFailed = $results.cnb -and $results.cnb -ne "success"
$cnbDirectFailed = $results.cnbDirect -eq "error"
if ($publishFailed -or $feedFailed -or $cnbFailed -or $cnbDirectFailed) { exit 1 }

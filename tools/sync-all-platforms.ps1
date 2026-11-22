#requires -Version 5.1
<#
DengTa 全平台同步：GitHub + CNB + 本地快照清单

在每次更新完成后运行：
  powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1

它会：
1. 提交并推送 frontend / backend / docs / iOS worktree 的当前分支到 GitHub；
2. 刷新完整工作区快照；
3. 推送 CNB 的 DengTaArchive2026/dengta-workspace；
4. 打印两边的 commit，便于写入 SYNC-LEDGER.md。

前置条件：
- 本机 git 已登录拥有 tnineninet 写权限的 GitHub 账号（推荐 Jessica-tce）；
- CNB 令牌在 _credentials/cnb-newaccount-all-token-20261122.txt，或设置 CNB_TOKEN。

不会提交 _credentials、.env、keystore、APK/IPA、node_modules。
#>
param(
  [string]$Message = ("sync: " + (Get-Date -Format "yyyy-MM-dd HH:mm"))
)

$ErrorActionPreference = "Stop"
$Root = "D:\GZdeepseek"
$Git = "D:\GZdeepseek\_tools\git\cmd\git.exe"
$Python = "D:\GZdeepseek\_tools\python312\python.exe"
$SnapshotScript = Join-Path $Root "dengta-home\tools\sync-cnb-snapshot.py"

$repos = @(
  @{ Name = "frontend"; Path = (Join-Path $Root "_refs\frontend-gh") },
  @{ Name = "backend";  Path = (Join-Path $Root "_refs\backend-prod") },
  @{ Name = "docs";     Path = (Join-Path $Root "dengta-home") },
  @{ Name = "ios";      Path = (Join-Path $Root "_worktrees\ios-import-75ad3da") }
)

function Invoke-Git([string]$Path, [string[]]$Args) {
  $out = & $Git -C $Path @Args 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ("git -C $Path " + ($Args -join " ") + " failed:`n" + ($out -join "`n"))
  }
  return ($out -join "`n")
}

Write-Host "== 1/2 GitHub ==" -ForegroundColor Cyan
foreach ($repo in $repos) {
  if (-not (Test-Path $repo.Path)) { throw "missing repo: $($repo.Path)" }
  Write-Host "-- $($repo.Name) --"
  $status = Invoke-Git $repo.Path @("status", "--porcelain")
  if ($status.Trim()) {
    Invoke-Git $repo.Path @("add", "-A") | Out-Null
    Invoke-Git $repo.Path @("commit", "-m", "$Message [$($repo.Name)]") | Out-Null
  } else {
    Write-Host "   no local changes"
  }
  $branch = (Invoke-Git $repo.Path @("branch", "--show-current")).Trim()
  if (-not $branch) { throw "$($repo.Name): detached HEAD, refuse to push" }
  $remote = (Invoke-Git $repo.Path @("remote", "get-url", "origin")).Trim()
  Write-Host "   push $branch -> $remote"
  Invoke-Git $repo.Path @("push", "origin", "HEAD") | Out-Null
  $sha = (Invoke-Git $repo.Path @("rev-parse", "HEAD")).Trim()
  Write-Host "   github=$sha"
}

Write-Host "== 2/2 CNB ==" -ForegroundColor Cyan
& $Python $SnapshotScript
if ($LASTEXITCODE -ne 0) { throw "CNB snapshot sync failed" }

Write-Host ""
Write-Host "All platforms synced. Add GitHub + CNB commits to docs/SYNC-LEDGER.md." -ForegroundColor Green

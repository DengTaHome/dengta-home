#Requires -Version 5.1
<#
.SYNOPSIS
  停止由 start-qq-bridge.ps1（或 start.bat）启动的 qq-bridge 进程。

.DESCRIPTION
  只停止「命令行里确实包含 bridge.js 的 node 进程」/ PID 文件 / 锁文件指向的进程，
  不会碰 SnowLuma、DSH 或其它 node 程序。
  停止后清理残留的 state/bridge.lock（仅当锁里的 PID 已不存在）。

.PARAMETER BridgeRoot
  qq-bridge 仓库目录。默认取 $env:QQ_BRIDGE_ROOT，再默认
  D:\GZdeepseek\_refs\qq\qq-bridge。

.PARAMETER Force
  跳过命令行二次校验（仅当进程信息读不到时使用）。
#>
[CmdletBinding()]
param(
  [string]$BridgeRoot = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1：node 输出是 UTF-8；统一控制台/读取编码，避免中文乱码。
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $script:Utf8 } catch { }
$OutputEncoding = $script:Utf8
$script:ScriptDir = $PSScriptRoot
$script:LogsDir = Join-Path $script:ScriptDir 'logs'

function Write-Step([string]$Message) { Write-Host "[qq-bridge] $Message" }

if (-not $BridgeRoot) {
  $BridgeRoot = if ($env:QQ_BRIDGE_ROOT) { $env:QQ_BRIDGE_ROOT } else { 'D:\GZdeepseek\_refs\qq\qq-bridge' }
}
if (-not (Test-Path -LiteralPath $BridgeRoot -PathType Container)) {
  Write-Host "[qq-bridge] 错误：找不到 qq-bridge 仓库目录：$BridgeRoot" -ForegroundColor Red
  exit 2
}
$BridgeRoot = (Resolve-Path -LiteralPath $BridgeRoot).Path
$lockFile = Join-Path $BridgeRoot 'state\bridge.lock'
$pidFile = Join-Path $script:LogsDir 'bridge.pid'

function Get-BridgeProcesses {
  $found = @{}
  # 1) PID 文件（-Background 启动时写）
  if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
    $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue)
    if ($raw -and $raw.Trim() -match '^\d+$') { $found[[int]$raw.Trim()] = 'pid-file' }
  }
  # 2) 单实例锁文件（桥接自己写）
  if (Test-Path -LiteralPath $lockFile -PathType Leaf) {
    $raw = (Get-Content -LiteralPath $lockFile -Raw -ErrorAction SilentlyContinue)
    if ($raw -and $raw.Trim() -match '^\d+$') { $found[[int]$raw.Trim()] = 'lock-file' }
  }
  # 3) 命令行扫描：node ... bridge.js，且路径/仓库匹配
  $all = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $all) {
    $cmd = [string]$proc.CommandLine
    if (-not $cmd) { continue }
    if ($cmd -notmatch 'bridge\.js') { continue }
    if ($cmd -notlike "*$BridgeRoot*") { continue }
    $found[[int]$proc.ProcessId] = 'command-line'
  }
  return $found
}

$targets = Get-BridgeProcesses
if ($targets.Count -eq 0) {
  Write-Step '没有发现正在运行的 qq-bridge 进程。'
  if (Test-Path -LiteralPath $lockFile -PathType Leaf) {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    Write-Step '已清理残留锁文件 state/bridge.lock'
  }
  exit 0
}

$stopped = 0
foreach ($pidValue in $targets.Keys) {
  $reason = $targets[$pidValue]
  $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $proc) { Write-Step "PID $pidValue（来源 $reason）已不存在，跳过"; continue }
  if ($proc.ProcessName -ne 'node') {
    Write-Step "PID $pidValue 不是 node（$($proc.ProcessName)），跳过（来源 $reason）"
    continue
  }
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
  $cmd = if ($cim) { [string]$cim.CommandLine } else { '' }
  if (-not $Force) {
    if (-not $cmd) {
      Write-Host "[qq-bridge] 无法读取 PID $pidValue 的命令行；确认是桥接后再用 -Force 停止。" -ForegroundColor Yellow
      continue
    }
    if ($cmd -notmatch 'bridge\.js') {
      Write-Step "PID $pidValue 命令行不含 bridge.js，跳过（防止误杀其它 node 进程）"
      continue
    }
  }
  try {
    Stop-Process -Id $pidValue -Force -ErrorAction Stop
    $stopped += 1
    Write-Step "已停止 qq-bridge PID=$pidValue（来源 $reason）"
  } catch {
    Write-Host "[qq-bridge] 停止 PID $pidValue 失败：$($_.Exception.Message)" -ForegroundColor Red
  }
}

# 等待进程退出
Start-Sleep -Milliseconds 800
$alive = @()
foreach ($pidValue in $targets.Keys) {
  if (Get-Process -Id $pidValue -ErrorAction SilentlyContinue) { $alive += $pidValue }
}
if ($alive.Count -gt 0) {
  Write-Host "[qq-bridge] 以下 PID 仍在运行，可重试或手动处理：$($alive -join ', ')" -ForegroundColor Yellow
} else {
  Write-Step "停止完成（共 $stopped 个进程）"
}

# 清理 PID 文件与残留锁
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $lockFile -PathType Leaf) {
  $lockPid = (Get-Content -LiteralPath $lockFile -Raw -ErrorAction SilentlyContinue)
  $lockPid = if ($lockPid) { $lockPid.Trim() } else { '' }
  $lockAlive = $false
  if ($lockPid -match '^\d+$') { $lockAlive = [bool](Get-Process -Id ([int]$lockPid) -ErrorAction SilentlyContinue) }
  if (-not $lockAlive) {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
    Write-Step '已清理残留锁文件 state/bridge.lock'
  }
}

exit 0

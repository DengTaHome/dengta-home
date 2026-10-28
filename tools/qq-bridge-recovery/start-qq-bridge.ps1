#Requires -Version 5.1
<#
.SYNOPSIS
  启动已部署的 qq-bridge（QQ ↔ DSH 主链路）。

.DESCRIPTION
  · 默认读取本脚本同目录的 config.json（或 -ConfigPath 指定），并把它同步到
    <qq-bridge 仓库>/config.json —— 桥接进程固定从仓库根目录读 config.json。
  · 同步前会把仓库里已有的 config.json 备份为 config.json.bak-<时间戳>。
  · 检查 Node / 依赖 / DSH 可达性，然后在**前台**运行桥接（Ctrl+C 退出）。
  · 加 -Background 时改为后台运行并写 logs/bridge.pid（用 stop-qq-bridge.ps1 停止）。
  · 本脚本不会启动 SnowLuma，也不会登录 QQ；这些是用户自己完成的步骤。

.PARAMETER BridgeRoot
  qq-bridge 仓库目录。默认取 $env:QQ_BRIDGE_ROOT，再默认
  D:\GZdeepseek\_refs\qq\qq-bridge。

.PARAMETER ConfigPath
  恢复用配置文件。默认 <本脚本目录>/config.json，其次 <BridgeRoot>/config.json。

.PARAMETER Background
  后台启动（Start-Process），日志写到 <本脚本目录>/logs/。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\start-qq-bridge.ps1

.EXAMPLE
  .\start-qq-bridge.ps1 -Background
  .\stop-qq-bridge.ps1
#>
[CmdletBinding()]
param(
  [string]$BridgeRoot = '',
  [string]$ConfigPath = '',
  [string]$NodeExe = '',
  [switch]$Background,
  [switch]$NoConfigSync,
  [switch]$SkipDshCheck
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1：node 输出是 UTF-8；统一控制台/读取编码，避免中文乱码。
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $script:Utf8 } catch { }
$OutputEncoding = $script:Utf8
$script:ScriptDir = $PSScriptRoot
$script:LogsDir = Join-Path $script:ScriptDir 'logs'

function Write-Step([string]$Message) { Write-Host "[qq-bridge] $Message" }
function Fail([string]$Message, [int]$Code = 1) {
  Write-Host "[qq-bridge] 错误：$Message" -ForegroundColor Red
  exit $Code
}

# ── 1. 定位 qq-bridge 仓库 ──────────────────────────────────────────────────
if (-not $BridgeRoot) {
  $BridgeRoot = if ($env:QQ_BRIDGE_ROOT) { $env:QQ_BRIDGE_ROOT } else { 'D:\GZdeepseek\_refs\qq\qq-bridge' }
}
if (-not (Test-Path -LiteralPath $BridgeRoot -PathType Container)) {
  Fail "找不到 qq-bridge 仓库目录：$BridgeRoot（用 -BridgeRoot 指定）" 2
}
$BridgeRoot = (Resolve-Path -LiteralPath $BridgeRoot).Path
$BridgeEntry = Join-Path $BridgeRoot 'src\bridge.js'
if (-not (Test-Path -LiteralPath $BridgeEntry -PathType Leaf)) {
  Fail "目录 $BridgeRoot 下没有 src\bridge.js，不像 qq-bridge 仓库" 2
}
Write-Step "桥接仓库：$BridgeRoot"

# ── 2. 定位 Node ─────────────────────────────────────────────────────────────
function Resolve-Node {
  param([string]$Prefer)
  $candidates = @()
  if ($Prefer) { $candidates += $Prefer }
  if ($env:QQ_BRIDGE_NODE) { $candidates += $env:QQ_BRIDGE_NODE }
  $candidates += 'D:\GZdeepseek\_tools\node\node.exe'
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return (Resolve-Path -LiteralPath $c).Path }
  }
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return $null
}
$node = Resolve-Node -Prefer $NodeExe
if (-not $node) {
  Fail '找不到 node.exe：请安装 Node.js >= 22.13，或用 -NodeExe 指定，或设置 $env:QQ_BRIDGE_NODE。' 3
}
$nodeVersion = (& $node -v) 2>$null
Write-Step "Node：$node（$nodeVersion）"
try {
  $major = [int](($nodeVersion -replace '^v', '').Split('.')[0])
  if ($major -lt 22) { Write-Host "[qq-bridge] 警告：qq-bridge 要求 Node >= 22.13，当前 $nodeVersion" -ForegroundColor Yellow }
} catch { }

# ── 3. 检查依赖（node_modules + postinstall 补丁效果） ───────────────────────
$sdkDir = Join-Path $BridgeRoot 'node_modules\@snowluma\sdk\dist'
if (-not (Test-Path -LiteralPath $sdkDir -PathType Container)) {
  Write-Host ''
  Write-Host '依赖尚未安装。请先执行（GitHub/npm 直连不通时加代理）：' -ForegroundColor Yellow
  Write-Host '  $env:HTTP_PROXY="http://127.0.0.1:10809"; $env:HTTPS_PROXY=$env:HTTP_PROXY'
  Write-Host "  cd `"$BridgeRoot`""
  Write-Host '  npm ci --no-audit --no-fund'
  Write-Host ''
  Fail '缺少 node_modules/@snowluma/sdk/dist（依赖未安装）' 4
}
Write-Step '依赖：node_modules 已存在（@snowluma/sdk 已修补）'

# ── 4. 定位 / 同步 config.json ──────────────────────────────────────────────
$bridgeConfig = Join-Path $BridgeRoot 'config.json'
$sourceConfig = $null
if ($ConfigPath) {
  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { Fail "指定的 -ConfigPath 不存在：$ConfigPath" 5 }
  $sourceConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
} elseif (Test-Path -LiteralPath (Join-Path $script:ScriptDir 'config.json') -PathType Leaf) {
  $sourceConfig = Join-Path $script:ScriptDir 'config.json'
} elseif (Test-Path -LiteralPath $bridgeConfig -PathType Leaf) {
  $sourceConfig = $bridgeConfig
} else {
  Write-Host ''
  Write-Host '没有找到 config.json。第一次恢复请：' -ForegroundColor Yellow
  Write-Host "  Copy-Item `"$script:ScriptDir\config.recovery.example.json`" `"$script:ScriptDir\config.json`""
  Write-Host '然后编辑 config.json：snowluma.wsUrl / httpUrl / accessToken、ownerQQ、allow.private / allow.groups。'
  Write-Host '不想用真实 QQ 时，可先跑 .\run-selfcheck.ps1 做离线自检。'
  Write-Host ''
  Fail '缺少 config.json' 5
}

if ($NoConfigSync) {
  if (-not (Test-Path -LiteralPath $bridgeConfig -PathType Leaf)) {
    Fail '-NoConfigSync 已指定，但 <仓库>\config.json 不存在；桥接固定读取该文件。' 5
  }
  Write-Step '按 -NoConfigSync 使用仓库内现有 config.json'
} elseif ($sourceConfig -ne $bridgeConfig) {
  if (Test-Path -LiteralPath $bridgeConfig -PathType Leaf) {
    $old = [System.IO.File]::ReadAllText($bridgeConfig, [System.Text.Encoding]::UTF8)
    $new = [System.IO.File]::ReadAllText($sourceConfig, [System.Text.Encoding]::UTF8)
    if ($old -ne $new) {
      $backup = "$bridgeConfig.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Copy-Item -LiteralPath $bridgeConfig -Destination $backup -Force
      Copy-Item -LiteralPath $sourceConfig -Destination $bridgeConfig -Force
      Write-Step "已同步配置：$sourceConfig -> $bridgeConfig（旧文件备份：$(Split-Path -Leaf $backup)）"
    } else {
      Write-Step '仓库内 config.json 与恢复配置一致，无需同步'
    }
  } else {
    Copy-Item -LiteralPath $sourceConfig -Destination $bridgeConfig -Force
    Write-Step "已同步配置：$sourceConfig -> $bridgeConfig"
  }
}
try {
  $cfgText = [System.IO.File]::ReadAllText($bridgeConfig, [System.Text.Encoding]::UTF8)
  $cfg = $cfgText | ConvertFrom-Json
} catch {
  Fail "config.json 不是合法 JSON：$($_.Exception.Message)" 6
}
$dshBase = [string]$cfg.dsh.baseUrl
$consolePort = if ($cfg.consolePort) { [int]$cfg.consolePort } else { 3100 }
Write-Step "DSH：$dshBase；本地控制台端口：$consolePort"

# ── 5. 预检：DSH 可达性 / 端口占用 ──────────────────────────────────────────
if (-not $SkipDshCheck -and $dshBase) {
  try {
    $resp = Invoke-WebRequest -Uri $dshBase -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Step "DSH 可达：HTTP $($resp.StatusCode)"
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -in 401, 403) {
      Write-Step "DSH 可达：HTTP $code（需要鉴权；桥接会用 ~/.dsh 签名密钥离线铸造 Cookie）"
    } else {
      Write-Host "[qq-bridge] 警告：连不上 DSH（$dshBase）：$($_.Exception.Message)" -ForegroundColor Yellow
      Write-Host '  桥接仍会启动，消息会先排队；DSH 起来后自动补投。' -ForegroundColor Yellow
    }
  }
}

$portInUse = Get-NetTCPConnection -State Listen -LocalPort $consolePort -ErrorAction SilentlyContinue
if ($portInUse) {
  Fail "控制台端口 $consolePort 已被占用（PID $($portInUse[0].OwningProcess)）：可能已有桥接实例在运行，先执行 .\stop-qq-bridge.ps1" 7
}

# ── 6. 启动 ─────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $script:LogsDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $script:LogsDir "bridge-$stamp.log"
$errFile = Join-Path $script:LogsDir "bridge-$stamp.err.log"

Write-Step "启动桥接（工作目录：$BridgeRoot）"
Write-Step "控制台：http://127.0.0.1:$consolePort（令牌在 $BridgeRoot\state\console-token）"

if ($Background) {
  $p = Start-Process -FilePath $node -ArgumentList @('src/bridge.js') -WorkingDirectory $BridgeRoot `
    -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru -WindowStyle Hidden
  Set-Content -LiteralPath (Join-Path $script:LogsDir 'bridge.pid') -Value $p.Id -Encoding ASCII
  Start-Sleep -Seconds 3
  if ($p.HasExited) {
    Write-Host '启动失败，输出如下：' -ForegroundColor Red
    foreach ($f in @($logFile, $errFile)) {
      if (Test-Path -LiteralPath $f) {
        $t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
        ($t -split "`r?`n") | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
      }
    }
    Fail "桥接进程已退出（exit $($p.ExitCode)）" 8
  }
  Write-Step "已在后台启动，PID=$($p.Id)"
  Write-Step "日志：$logFile"
  Write-Step '停止：.\stop-qq-bridge.ps1'
} else {
  Write-Step ("前台运行中，Ctrl+C 退出。日志同时写入：" + $logFile)
  # 桥接固定从仓库根目录读 config.json / state/，前台运行也必须切到仓库目录
  Push-Location -LiteralPath $BridgeRoot
  try {
    & $node 'src/bridge.js' 2>&1 | ForEach-Object {
      $line = [string]$_
      Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
      Write-Host $line
    }
  } finally {
    Pop-Location
  }
  exit $LASTEXITCODE
}

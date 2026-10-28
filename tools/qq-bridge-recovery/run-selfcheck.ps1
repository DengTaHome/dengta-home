#Requires -Version 5.1
<#
.SYNOPSIS
  qq-bridge 离线自检：mock OneBot + 桥接 + 真实 DSH，跑通「QQ → 桥接 → DSH → 桥接 → QQ」整条链路。

.DESCRIPTION
  不登录真实 QQ、不安装 SnowLuma、不使用任何真实凭据：
    1. 用 mock-onebot.mjs 在 127.0.0.1:3000/3001 模拟 SnowLuma 的 OneBot v11 HTTP + WS
    2. 用 config.selfcheck.example.json（ownerQQ=10001，假号）临时覆盖 <仓库>/config.json
    3. 把桥接模式设为 closed-agent（本地 state/mode.json），这样无需先装 qq-chat preset 也能建会话
    4. 向 mock 注入一条「私聊消息」，等桥接把它投给 DSH、再等待 agent 回复被桥接发回 mock
    5. 结束（或异常）时恢复原 config.json / state/mode.json，并归档自检创建的 DSH 会话

  退出码：0=通过；1=失败；2=环境不满足（端口占用/缺依赖/DSH 不可达等）。

.PARAMETER DshBaseUrl
  运行中的 DSH Web 地址。桌面版通常是 http://127.0.0.1:64020，Web 版通常是 http://127.0.0.1:3080。

.PARAMETER TimeoutSec
  从注入消息到收到回复的最长等待时间，默认 180 秒（模型可能先反问，脚本会自动应答一次）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\run-selfcheck.ps1
#>
[CmdletBinding()]
param(
  [string]$BridgeRoot = '',
  [string]$DshBaseUrl = 'http://127.0.0.1:64020',
  [int]$TimeoutSec = 180
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1：node 子进程输出是 UTF-8，日志文件也是 UTF-8；控制台/读取统一按 UTF-8 处理，
# 否则中文会变乱码，连「已就绪」关键字都匹配不到。
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $script:Utf8 } catch { }
$OutputEncoding = $script:Utf8
$script:ScriptDir = $PSScriptRoot
$script:LogsDir = Join-Path $script:ScriptDir 'logs'
$script:Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$script:BridgeProc = $null
$script:MockProc = $null
$script:BackupDir = $null
$script:RepoConfig = $null
$script:ModeFile = $null
$script:HadRepoConfig = $false
$script:HadModeFile = $false
$script:StateExisted = $false
$script:TestSessionId = $null

function Write-Step([string]$Message) { Write-Host "[selfcheck] $Message" }
function Fail([string]$Message, [int]$Code = 1) {
  Write-Host "[selfcheck] 失败：$Message" -ForegroundColor Red
  exit $Code
}
# 子进程被 Start-Process 重定向时仍持有日志句柄，必须用 FileShare.ReadWrite 才能读到实时内容。
function Read-Utf8Shared([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() } finally { $reader.Close(); $fs.Close() }
  } catch { return $null }
}
function Show-LogTail([string]$Path, [int]$Lines = 30) {
  $text = Read-Utf8Shared $Path
  if (-not $text) { return }
  $all = $text -split "`r?`n"
  $all | Select-Object -Last $Lines | ForEach-Object { Write-Host $_ }
}
function Write-Utf8File([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}
function Invoke-Utf8Http {
  param([string]$Url, [string]$Method = 'GET', [string]$BodyJson = $null, [int]$TimeoutMs = 10000)
  $req = [System.Net.WebRequest]::Create($Url)
  $req.Method = $Method
  $req.Timeout = $TimeoutMs
  $req.Proxy = $null
  if ($BodyJson) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($BodyJson)
    $req.ContentType = 'application/json; charset=utf-8'
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  }
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if (-not $r) { throw }
    $reader = New-Object System.IO.StreamReader($r.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd(); $reader.Close()
    throw "HTTP $([int]$r.StatusCode) $Url : $text"
  }
  $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd(); $reader.Close(); $resp.Close()
  return $text
}
function Test-TcpListen([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}
function Stop-Child([System.Diagnostics.Process]$Proc, [string]$Name) {
  if (-not $Proc) { return }
  try {
    if (-not $Proc.HasExited) {
      Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
      Write-Step "已停止 $Name（PID=$($Proc.Id)）"
    }
  } catch { }
}

# ── 0. 环境检查 ─────────────────────────────────────────────────────────────
Write-Step "自检时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')；DSH：$DshBaseUrl"
New-Item -ItemType Directory -Force -Path $script:LogsDir | Out-Null

if (-not $BridgeRoot) {
  $BridgeRoot = if ($env:QQ_BRIDGE_ROOT) { $env:QQ_BRIDGE_ROOT } else { 'D:\GZdeepseek\_refs\qq\qq-bridge' }
}
if (-not (Test-Path -LiteralPath (Join-Path $BridgeRoot 'src\bridge.js') -PathType Leaf)) {
  Fail "找不到 qq-bridge 仓库：$BridgeRoot（用 -BridgeRoot 指定）" 2
}
$BridgeRoot = (Resolve-Path -LiteralPath $BridgeRoot).Path

$nodeCandidates = @()
if ($env:QQ_BRIDGE_NODE) { $nodeCandidates += $env:QQ_BRIDGE_NODE }
$nodeCandidates += 'D:\GZdeepseek\_tools\node\node.exe'
$node = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $node) {
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { $node = $onPath.Source }
}
if (-not $node) { Fail '找不到 node.exe' 2 }
Write-Step "Node：$node（$(& $node -v)）"

if (-not (Test-Path -LiteralPath (Join-Path $BridgeRoot 'node_modules\@snowluma\sdk\dist') -PathType Container)) {
  Fail "qq-bridge 依赖未安装：请先在 $BridgeRoot 执行 npm ci（必要时加 HTTP 代理）" 2
}
if (-not (Test-Path -LiteralPath (Join-Path $script:ScriptDir 'node_modules\ws\package.json') -PathType Leaf)) {
  Fail "缺少 mock 依赖 ws：请先在 $script:ScriptDir 执行 npm install" 2
}

foreach ($port in @(3000, 3001, 3100)) {
  if (Test-TcpListen $port) {
    Fail "端口 $port 已被占用：自检需要 3000/3001/3100 空闲（真实 SnowLuma/桥接在跑时请先停止）。" 2
  }
}
try {
  $null = Invoke-Utf8Http -Url $DshBaseUrl -TimeoutMs 5000
  Write-Step "DSH 可达（HTTP 200）"
} catch {
  $msg = $_.Exception.Message
  if ($msg -match 'HTTP (401|403)') {
    Write-Step 'DSH 可达（HTTP 401/403：正常，桥接会离线铸造 Cookie 鉴权）'
  } else {
    Fail "DSH 不可达（$DshBaseUrl）：$msg。请先启动 DSH；地址不对时用 -DshBaseUrl 指定。" 2
  }
}

# ── 1. 备份现有 config/mode，写自检配置 ─────────────────────────────────────
$script:RepoConfig = Join-Path $BridgeRoot 'config.json'
$script:ModeFile = Join-Path $BridgeRoot 'state\mode.json'
$stateDir = Join-Path $BridgeRoot 'state'
$script:StateExisted = Test-Path -LiteralPath $stateDir -PathType Container
$script:BackupDir = Join-Path $script:LogsDir "selfcheck-backup-$($script:Stamp)"
New-Item -ItemType Directory -Force -Path $script:BackupDir | Out-Null
if (Test-Path -LiteralPath $script:RepoConfig -PathType Leaf) {
  Copy-Item -LiteralPath $script:RepoConfig -Destination (Join-Path $script:BackupDir 'repo-config.json') -Force
  $script:HadRepoConfig = $true
}
if (Test-Path -LiteralPath $script:ModeFile -PathType Leaf) {
  Copy-Item -LiteralPath $script:ModeFile -Destination (Join-Path $script:BackupDir 'mode.json') -Force
  $script:HadModeFile = $true
}
$sessionsFile = Join-Path $BridgeRoot 'state\sessions.json'
if (Test-Path -LiteralPath $sessionsFile -PathType Leaf) {
  try {
    $existing = Get-Content -LiteralPath $sessionsFile -Raw | ConvertFrom-Json
    $keys = @($existing.sessions.PSObject.Properties.Name)
    $foreign = @($keys | Where-Object { $_ -ne 'private:10001' })
    if ($foreign.Count -gt 0) {
      Fail "仓库 state/sessions.json 里已有非自检会话（$($foreign -join ', ')）。这是已有部署的数据，自检会追加测试会话；请换一个干净 clone，或先备份 state/ 后重试。" 2
    }
  } catch { }
}

$mockLog = Join-Path $script:LogsDir "mock-onebot-$($script:Stamp).jsonl"
try {
  $selfCfgText = [System.IO.File]::ReadAllText((Join-Path $script:ScriptDir 'config.selfcheck.example.json'), [System.Text.Encoding]::UTF8)
  $selfCfg = $selfCfgText | ConvertFrom-Json
  $selfCfg.dsh.baseUrl = $DshBaseUrl
  Write-Utf8File -Path $script:RepoConfig -Text ($selfCfg | ConvertTo-Json -Depth 10)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:ModeFile) | Out-Null
  Write-Utf8File -Path $script:ModeFile -Text '{"mode":"closed-agent","closedAgentPreset":""}'
  Write-Step '已写入自检配置（ownerQQ=10001，假号）与 mode=closed-agent'

  # ── 2. 启动 mock OneBot ───────────────────────────────────────────────────
  $mockOut = Join-Path $script:LogsDir "mock-$($script:Stamp).out.log"
  $mockErr = Join-Path $script:LogsDir "mock-$($script:Stamp).err.log"
  $script:MockProc = Start-Process -FilePath $node -WorkingDirectory $script:ScriptDir `
    -ArgumentList @('mock-onebot.mjs', '--ws-port', '3001', '--http-port', '3000', '--log-file', $mockLog) `
    -RedirectStandardOutput $mockOut -RedirectStandardError $mockErr -PassThru -WindowStyle Hidden
  $mockReady = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if ($script:MockProc.HasExited) { break }
    try { $null = Invoke-Utf8Http -Url 'http://127.0.0.1:3000/mock/state' -TimeoutMs 1000; $mockReady = $true; break } catch { }
  }
  if (-not $mockReady) { Fail "mock OneBot 未能启动，看日志：$mockOut" 1 }
  Write-Step 'mock OneBot 已就绪：ws://127.0.0.1:3001 / http://127.0.0.1:3000'

  # ── 3. 启动桥接 ───────────────────────────────────────────────────────────
  $bridgeOut = Join-Path $script:LogsDir "bridge-$($script:Stamp).out.log"
  $bridgeErr = Join-Path $script:LogsDir "bridge-$($script:Stamp).err.log"
  $script:BridgeProc = Start-Process -FilePath $node -WorkingDirectory $BridgeRoot -ArgumentList @('src/bridge.js') `
    -RedirectStandardOutput $bridgeOut -RedirectStandardError $bridgeErr -PassThru -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    if ($script:BridgeProc.HasExited) { break }
    if (Test-Path -LiteralPath $bridgeOut) {
      $text = Read-Utf8Shared $bridgeOut
      if ($text -and $text -match 'SnowLuma 已连接' -and $text -match 'DSH 已就绪') { $ready = $true; break }
    }
  }
  if (-not $ready) {
    Write-Host '--- 桥接输出（末尾） ---' -ForegroundColor Yellow
    if (Test-Path -LiteralPath $bridgeOut) { Get-Content -LiteralPath $bridgeOut -Tail 30 }
    if (Test-Path -LiteralPath $bridgeErr) { Get-Content -LiteralPath $bridgeErr -Tail 20 }
    Fail "桥接未在 60 秒内就绪（SnowLuma/DSH 未连接），日志：$bridgeOut" 1
  }
  Write-Step '桥接已就绪（SnowLuma 已连接 + DSH 已就绪）'

  # ── 4. 注入 QQ 消息，等待回复 ─────────────────────────────────────────────
  $injectBody = '{"user_id":10001,"text":"你好，请只回复两个字：收到"}'
  $null = Invoke-Utf8Http -Url 'http://127.0.0.1:3000/mock/inject' -Method 'POST' -BodyJson $injectBody
  Write-Step '已注入私聊消息（ownerQQ=10001），等待 agent 回复…'

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $answeredRounds = 0
  $finalText = $null
  $stateObj = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if ($script:BridgeProc.HasExited) { break }
    try { $stateObj = Invoke-Utf8Http -Url 'http://127.0.0.1:3000/mock/state' -TimeoutMs 3000 | ConvertFrom-Json } catch { continue }
    $sent = @($stateObj.sentMessages)
    if ($sent.Count -eq 0) { continue }
    # 找到「非提问」的最后一条 = agent 的正式回复
    $nonQuestions = @($sent | Where-Object {
        $t = (($_.message | ForEach-Object { $_.data.text }) -join '')
        $t -notmatch '需要你回答'
      })
    if ($nonQuestions.Count -gt 0) {
      $finalText = (($nonQuestions[-1].message | ForEach-Object { $_.data.text }) -join '')
      break
    }
    # 只有提问：自动回答一次（最多 2 轮）
    if ($answeredRounds -lt 2) {
      Start-Sleep -Seconds 1
      $answer = '{"user_id":10001,"text":"请直接回复两个字：收到"}'
      $null = Invoke-Utf8Http -Url 'http://127.0.0.1:3000/mock/inject' -Method 'POST' -BodyJson $answer
      $answeredRounds += 1
      Write-Step "agent 先反问了，已自动应答（第 $answeredRounds 轮），继续等回复…"
    }
  }

  # 记录自检会话 id，供 finally 归档（桥接把映射写在 state/sessions.json）
  try {
    $sfNow = Join-Path $BridgeRoot 'state\sessions.json'
    if (Test-Path -LiteralPath $sfNow -PathType Leaf) {
      $mapNow = Get-Content -LiteralPath $sfNow -Raw | ConvertFrom-Json
      $propNow = $mapNow.sessions.PSObject.Properties | Where-Object { $_.Name -eq 'private:10001' } | Select-Object -First 1
      if ($propNow) { $script:TestSessionId = [string]$propNow.Value }
    }
  } catch { }

  Write-Host ''
  if ($null -ne $finalText) {
    Write-Host '[selfcheck] ✅ 通过：QQ → 桥接 → DSH → 桥接 → QQ 全链路已跑通' -ForegroundColor Green
    Write-Host '[selfcheck] agent 回复（由 mock 收件箱捕获）：'
    Write-Host $finalText
    $ok = $true
  } else {
    Write-Host '[selfcheck] ❌ 失败：在超时时间内没等到 agent 的正式回复' -ForegroundColor Red
    if ($stateObj) {
      Write-Host '[selfcheck] mock 已收到的消息：'
      @($stateObj.sentMessages) | ForEach-Object {
        $t = (($_.message | ForEach-Object { $_.data.text }) -join '')
        Write-Host "  - [$($_.messageId)] $t"
      }
    }
    if (Test-Path -LiteralPath $bridgeOut) {
      Write-Host '--- 桥接输出（末尾） ---' -ForegroundColor Yellow
      Show-LogTail $bridgeOut 40
    }
    $ok = $false
  }
  Write-Host "[selfcheck] 日志：$bridgeOut"
  Write-Host "[selfcheck] mock 日志：$mockOut / $mockLog"

} finally {
  # ── 5. 清理：停进程、归档测试会话、恢复配置 ───────────────────────────────
  Stop-Child $script:BridgeProc 'bridge'
  Stop-Child $script:MockProc 'mock OneBot'
  Start-Sleep -Milliseconds 800

  # 归档自检会话（桥接写进 state/sessions.json 的 private:10001 映射）
  $archiveScript = Join-Path $script:ScriptDir 'archive-test-session.mjs'
  if ($script:TestSessionId) {
    try {
      $archOut = & $node $archiveScript $script:TestSessionId $DshBaseUrl $BridgeRoot 2>&1
      Write-Step "归档自检会话 $($script:TestSessionId)：$archOut"
    } catch {
      Write-Step "归档自检会话失败（可在 DSH 界面手动删除）：$($_.Exception.Message)"
    }
  } else {
    Write-Step '未捕获到自检会话 id（桥接可能未建会话），跳过归档'
  }

  # 清理自检写入的 state/ 运行产物；若 state/ 原本不存在则整个删除
  $stateDir = Join-Path $BridgeRoot 'state'
  try {
    foreach ($name in @('sessions.json', 'bridge.lock')) {
      $target = Join-Path $stateDir $name
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
    }
    if (-not $script:StateExisted -and (Test-Path -LiteralPath $stateDir)) {
      Remove-Item -LiteralPath $stateDir -Recurse -Force -ErrorAction SilentlyContinue
      Write-Step '已清理自检产生的 state/ 目录（原本不存在）'
    }
  } catch {
    Write-Step "清理 state/ 时出错：$($_.Exception.Message)"
  }

  # 恢复 config.json / state/mode.json
  try {
    if ($script:BackupDir) {
      if ($script:HadRepoConfig) {
        Copy-Item -LiteralPath (Join-Path $script:BackupDir 'repo-config.json') -Destination $script:RepoConfig -Force
        Write-Step '已恢复原 config.json'
      } elseif (Test-Path -LiteralPath $script:RepoConfig) {
        Remove-Item -LiteralPath $script:RepoConfig -Force -ErrorAction SilentlyContinue
        Write-Step '已移除自检临时 config.json（原本不存在）'
      }
      if ($script:HadModeFile) {
        Copy-Item -LiteralPath (Join-Path $script:BackupDir 'mode.json') -Destination $script:ModeFile -Force
        Write-Step '已恢复原 state/mode.json'
      } elseif (Test-Path -LiteralPath $script:ModeFile) {
        Remove-Item -LiteralPath $script:ModeFile -Force -ErrorAction SilentlyContinue
        Write-Step '已移除自检临时 state/mode.json（原本不存在）'
      }
    }
  } catch {
    Write-Step "恢复 config/mode 时出错：$($_.Exception.Message)"
  }
}

if ($ok) { exit 0 } else { exit 1 }

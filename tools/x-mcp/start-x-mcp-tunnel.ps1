#requires -Version 5.1
<#
DengTa X / Twitter Local MCP + Cloudflare Quick Tunnel Starter
- Automatically detects active local proxy (MyClash 7877 / Clash 7897 / 7890 / 10809 / 10808)
- Reads existing API key silently from D:\GZdeepseek\_credentials\x-mcp.json (never prints secrets)
- Launches supergateway (Streamable HTTP on 127.0.0.1:8765/mcp) + cloudflared quick tunnel
- Verifies live HTTPS /mcp initialize + tools/list with MCP-Protocol-Version: 2024-11-05
#>
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$NodeDir = "D:\GZdeepseek\_tools\node"
$env:PATH = "$NodeDir;$env:PATH"
$CredFile = "D:\GZdeepseek\_credentials\x-mcp.json"
$UrlFile = "D:\GZdeepseek\_credentials\.x-tunnel-url.txt"
$RunCmd = "D:\GZdeepseek\_refs\x-twikit-mcp\run-x-mcp.cmd"
$SupergatewayJs = "D:\GZdeepseek\_tools\supergateway\node_modules\supergateway\dist\index.js"
$NodeExe = Join-Path $NodeDir "node.exe"
$CloudflaredExe = "D:\GZdeepseek\_tools\cloudflared.exe"
$AuditDir = "D:\GZdeepseek\_audit"
$SgLogOut = Join-Path $AuditDir "x-supergateway-live.out.log"
$SgLogErr = Join-Path $AuditDir "x-supergateway-live.err.log"
$CfLogOut = Join-Path $AuditDir "x-cloudflared-live.out.log"
$CfLogErr = Join-Path $AuditDir "x-cloudflared-live.err.log"

if (-not (Test-Path $AuditDir)) { New-Item -ItemType Directory -Path $AuditDir | Out-Null }
if (-not (Test-Path $CredFile)) { throw "Missing $CredFile" }
$cred = Get-Content $CredFile -Raw -Encoding UTF8 | ConvertFrom-Json
$apiKey = [string]$cred.apiKey
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "apiKey missing in $CredFile" }

# 1. Auto-detect live local proxy port
$detectedProxy = ""
foreach ($p in @(7877, 7897, 7890, 10809, 10808)) {
  $hit = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) {
    $detectedProxy = "http://127.0.0.1:$p"
    break
  }
}
if (-not $detectedProxy) {
  $detectedProxy = "http://127.0.0.1:7877"
  Write-Host "[警告] 未检测到常见本地代理端口，将回退使用 $detectedProxy" -ForegroundColor Yellow
} else {
  Write-Host "[代理] 已自动检测到运行中的本机代理：$detectedProxy" -ForegroundColor Green
}

# Keep run-x-mcp.cmd synced to the active proxy port
$cmdLines = @(
  "@echo off",
  'set "X_MCP_READ_ONLY=0"',
  'set "TWITTER_COOKIES_PATH=D:\GZdeepseek\_credentials\x-cookies-full.json"',
  "set `"TWITTER_PROXY=$detectedProxy`"",
  'set "TWITTER_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"',
  'set "TWIKIT_ONDEMAND_URL=https://abs.twimg.com/responsive-web/client-web/ondemand.s.f6d6d2044cee5d0da.js"',
  '"D:\GZdeepseek\_tools\python312\python.exe" "D:\GZdeepseek\_refs\x-twikit-mcp\server.py"'
)
[System.IO.File]::WriteAllText($RunCmd, ($cmdLines -join "`r`n") + "`r`n", (New-Object System.Text.ASCIIEncoding))

# 2. Stop stale supergateway on 8765 and stale cloudflared pointing to 8765
Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -match '8765'
} | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 600

# 3. Launch supergateway on 127.0.0.1:8765
Remove-Item $SgLogOut, $SgLogErr, $CfLogOut, $CfLogErr -Force -ErrorAction SilentlyContinue
$sgProc = Start-Process -FilePath $NodeExe `
  -ArgumentList @($SupergatewayJs, "--stdio", $RunCmd, "--outputTransport", "streamableHttp", "--stateful", "--apiKey", $apiKey, "--port", "8765", "--host", "127.0.0.1") `
  -WorkingDirectory "D:\GZdeepseek\_refs\x-twikit-mcp" `
  -WindowStyle Hidden `
  -RedirectStandardOutput $SgLogOut `
  -RedirectStandardError $SgLogErr `
  -PassThru

$sgReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 400
  $listen = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listen) { $sgReady = $true; break }
}
if (-not $sgReady) {
  throw "supergateway 未能在 127.0.0.1:8765 启动，请检查 $SgLogErr"
}
Write-Host "[网关] supergateway 已就绪：http://127.0.0.1:8765/mcp (PID=$($sgProc.Id))" -ForegroundColor Green

# 4. Launch cloudflared quick tunnel over HTTP/2 (TCP 443; avoids QUIC UDP 7844 blocks)
$cfProc = Start-Process -FilePath $CloudflaredExe `
  -ArgumentList @("tunnel", "--protocol", "http2", "--url", "http://127.0.0.1:8765", "--no-autoupdate") `
  -WorkingDirectory "D:\GZdeepseek\_tools" `
  -WindowStyle Hidden `
  -RedirectStandardOutput $CfLogOut `
  -RedirectStandardError $CfLogErr `
  -PassThru

$tunnelOrigin = ""
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Milliseconds 500
  foreach ($logFile in @($CfLogErr, $CfLogOut)) {
    if (Test-Path $logFile) {
      $txt = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
      if ($txt -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
        $tunnelOrigin = $Matches[1]
        break
      }
    }
  }
  if ($tunnelOrigin) { break }
}
if (-not $tunnelOrigin) {
  throw "cloudflared 隧道未能获取公网 URL，请检查网络或代理后查看 $CfLogErr"
}
$mcpUrl = "$tunnelOrigin/mcp"
[System.IO.File]::WriteAllText($UrlFile, $mcpUrl, (New-Object System.Text.UTF8Encoding($false)))
$credObj = [ordered]@{
  url = $tunnelOrigin
  apiKey = $apiKey
  createdAt = (Get-Date).ToString("o")
}
[System.IO.File]::WriteAllText($CredFile, ($credObj | ConvertTo-Json -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[隧道] Cloudflare 公网网关已就绪：$mcpUrl (PID=$($cfProc.Id))" -ForegroundColor Cyan

# 5. Live MCP end-to-end handshake verification (wait briefly for DNS propagation)
$verified = $false
$toolCount = 0
for ($attempt = 1; $attempt -le 8; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $initBody = @{
      jsonrpc = "2.0"
      id = 1
      method = "initialize"
      params = @{
        protocolVersion = "2024-11-05"
        capabilities = @{}
        clientInfo = @{ name = "dengta-x-verifier"; version = "1.0.0" }
      }
    } | ConvertTo-Json -Depth 5 -Compress
    $headers = @{
      Authorization = "Bearer $apiKey"
      Accept = "application/json, text/event-stream"
      "Content-Type" = "application/json"
      "MCP-Protocol-Version" = "2024-11-05"
    }
    $initResp = Invoke-WebRequest -Method Post -Uri $mcpUrl -Headers $headers -Body $initBody -UseBasicParsing -TimeoutSec 15
    $sessionId = $initResp.Headers["mcp-session-id"]
    if (-not $sessionId) { $sessionId = $initResp.Headers["Mcp-Session-Id"] }
    if ($initResp.StatusCode -eq 200 -and $sessionId) {
      $headers["Mcp-Session-Id"] = [string]$sessionId
      $listBody = '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
      $listResp = Invoke-WebRequest -Method Post -Uri $mcpUrl -Headers $headers -Body $listBody -UseBasicParsing -TimeoutSec 15
      $matches = [regex]::Matches($listResp.Content, '"name"\s*:\s*"(post_tweet|reply_tweet|get_tweet_replies|search_tweets|get_tweet_by_id|get_user_info|get_user_tweets|read_direct_messages|send_direct_message|favorite_tweet|retweet|delete_tweet)"')
      $toolCount = $matches.Count
      $verified = $true
      break
    }
  } catch {
    Write-Host "等待公网隧道 DNS 生效 ($attempt/8)..." -ForegroundColor DarkGray
  }
}

Write-Host ""
Write-Host "X_MCP_LIVE_URL=$mcpUrl" -ForegroundColor Green
Write-Host "X_MCP_VERIFIED=$verified TOOLS=$toolCount PROTOCOL=2024-11-05" -ForegroundColor Green
Write-Host "提示：在灯塔「设置 -> 设备与共看 -> 自定义 MCP 连接」中填入上述地址，protocol_version 选 2024-11-05，API Key 留空（沿用已存密钥）保存后点「实测连通性」即可变绿！" -ForegroundColor Yellow

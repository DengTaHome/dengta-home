# 把 pgvector Windows 构建安装到本机 PostgreSQL 16（幂等）
# 用法：先下载 https://github.com/andreiramani/pgvector_pgsql_windows/releases
#       的 vector.v0.8.7-pg16.zip 并解压，然后：
#       powershell -ExecutionPolicy Bypass -File tools\pgsql\install-pgvector.ps1 -Source <解压目录>
param([Parameter(Mandatory = $true)][string]$Source)
$ErrorActionPreference = "Stop"
$targets = @(
  "D:\GZdeepseek\_tools\pgsql",
  "C:\Users\$env:USERNAME\AppData\Local\dengta-pgsql"
)
foreach ($target in $targets) {
  if (-not (Test-Path (Join-Path $target "bin\postgres.exe"))) { Write-Host "跳过（不存在）：$target"; continue }
  Copy-Item (Join-Path $Source "lib\vector.dll") (Join-Path $target "lib\vector.dll") -Force
  Copy-Item (Join-Path $Source "share\extension\*") (Join-Path $target "share\extension\") -Force
  $inc = Join-Path $target "include\server\extension\vector"
  New-Item -ItemType Directory -Force -Path $inc | Out-Null
  Copy-Item (Join-Path $Source "include\server\extension\vector\*") $inc -Force
  Write-Host "已安装 pgvector -> $target"
}
$pg = "C:\Users\$env:USERNAME\AppData\Local\dengta-pgsql\bin\psql.exe"
& $pg -h 127.0.0.1 -p 55432 -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
& $pg -h 127.0.0.1 -p 55432 -U postgres -d postgres -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
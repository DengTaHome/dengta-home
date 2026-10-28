$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "start-qq-bridge.ps1"
if (-not (Test-Path $runner)) { throw "start-qq-bridge.ps1 not found: $runner" }

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "DengTaQQBridge.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Background"
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "DengTa QQ bridge autostart (SnowLuma starts manually; EULA §5.4)."
$shortcut.Save()
Write-Host "Created startup shortcut: $shortcutPath"
Write-Host "Disable: delete that shortcut."
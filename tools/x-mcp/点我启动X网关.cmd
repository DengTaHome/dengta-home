@echo off
chcp 65001 >nul
title DengTa X MCP Gateway
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\GZdeepseek\dengta-home\tools\x-mcp\start-x-mcp-tunnel.ps1"
echo.
pause

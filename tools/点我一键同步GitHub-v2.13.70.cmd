@echo off
chcp 65001 >nul
title DengTa v2.13.70 GitHub Sync
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.70.ps1"
echo.
pause

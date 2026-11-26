@echo off
chcp 65001 >nul
title DengTa v2.13.66 一键同步 GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\GZdeepseek\dengta-home\tools\complete-github-release-v2.13.66.ps1"
echo.
if errorlevel 1 (
  echo [提示] 同步过程中出现错误，请把上面的提示截屏发给 AI 处理。
) else (
  echo [完成] 全部同步成功！可以关闭这个窗口了。
)
echo.
pause

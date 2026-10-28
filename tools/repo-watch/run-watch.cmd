@echo off
set GITHUB_PROXY=http://127.0.0.1:10809
"D:\GZdeepseek\_tools\node\node.exe" "D:\GZdeepseek\dengta-home\tools\repo-watch\watch.mjs" >> "D:\GZdeepseek\_audit\repo-watch.log" 2>&1

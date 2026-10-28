# X / Twitter MCP（可复现版）

这里的脚本用于把开源 `x-twikit-mcp`（stdio）接进 DengTa，并记录本轮对 twikit 的最小补丁。
**Cookie、代理、API key 都不进仓库。**

## 为什么需要补丁

当前 X 首页不再直接提供旧格式的 `ondemand.s` 文件名，twikit 2.3.3 解析会报：

```
Couldn't get KEY_BYTE indices
```

补丁做两件事：

1. `transaction.py`：支持 `TWIKIT_ONDEMAND_URL`，允许传入当前浏览器抓到的 ondemand JS URL；
2. `user.py`：X 返回缺少 profile 字段时容错，不再 KeyError。

`server.py.patch` 把服务改成 FastMCP、支持完整 cookie jar / 代理 / UA。

## 1. 准备 twikit 源码并应用补丁

```powershell
# 下载 twikit 源码（例如 tarball 解压到 D:\GZdeepseek\_refs\twikit-src\twikit-main）
cd D:\GZdeepseek\_refs\twikit-src\twikit-main
git apply --check --ignore-whitespace D:\GZdeepseek\dengta-home\tools\x-mcp\patches\transaction.py.patch
git apply --check --ignore-whitespace D:\GZdeepseek\dengta-home\tools\x-mcp\patches\user.py.patch
git apply --ignore-whitespace D:\GZdeepseek\dengta-home\tools\x-mcp\patches\transaction.py.patch
git apply --ignore-whitespace D:\GZdeepseek\dengta-home\tools\x-mcp\patches\user.py.patch
pip install -e .
```

 > 补丁路径按 `a/twikit/...` 生成，默认 `-p1`；因源文件 CRLF/空白差异，需加 `--ignore-whitespace`。

## 2. 准备 x-twikit-mcp

```powershell
git clone https://github.com/yxiy171866-boop/x-twikit-mcp D:\GZdeepseek\_refs\x-twikit-mcp
cd D:\GZdeepseek\_refs\x-twikit-mcp
git apply D:\GZdeepseek\dengta-home\tools\x-mcp\patches\server.py.patch
pip install -r requirements.txt
```

## 3. 抓当前 ondemand URL

X 前端更新后 hash 会变；用本机已登录的 Edge 抓：

```powershell
# Edge 需要以 --remote-debugging-port=9222 启动，并登录 x.com
node D:\GZdeepseek\dengta-home\tools\x-mcp\capture-ondemand.mjs
```

把输出 URL 填进 `TWIKIT_ONDEMAND_URL`。

## 4. 启动

```powershell
copy tools\x-mcp\run-x-mcp.cmd.example run-x-mcp.cmd
# 编辑 run-x-mcp.cmd 里的 cookie 文件路径/代理/ondemand URL
# 注意：不要把真实 cookie 写进仓库
$env:PATH='D:\GZdeepseek\_tools\node;' + $env:PATH
D:\GZdeepseek\_tools\supergateway\node_modules\.bin\supergateway.cmd `
  --stdio run-x-mcp.cmd --outputTransport streamableHttp --apiKey <随机key> `
  --port 8765 --host 127.0.0.1
cloudflared.exe tunnel --url http://127.0.0.1:8765 --no-autoupdate
```

DengTa 连接参数：
- endpoint：`https://.../mcp`
- auth：Bearer
- **protocol_version：`2024-11-05`（不要填 auto）**

## 5. 验证

```powershell
$env:X_COOKIES_PATH='D:\GZdeepseek\_credentials\x-cookies-full.json'
$env:TWITTER_PROXY='http://127.0.0.1:10809'
$env:TWIKIT_ONDEMAND_URL='<capture 输出>'
python D:\GZdeepseek\dengta-home\tools\x-mcp\smoke-test.py
```

期望：`tools/list=12`、`get_user_info("jack")` 返回资料。

## 限制

- quick tunnel URL 重启会变，DengTa 连接需重新发现；
- X 前端更新后必须重新抓 ondemand URL；
- 单账号单点，不是多用户隔离；服务端 tools/list 会返回全部 12 个工具，DengTa 侧只把只读工具设为 auto，写工具默认 disabled（需要在连接 tool_policies 里显式开启）。
- 不要把 cookie/API key 提交到任何仓库。

# X / Twitter MCP（本机桥接）

## 已完成

- 从 Edge 登录态提取 `auth_token` / `ct0`（完整 Cookie 含 cf_clearance，存 `_credentials/x-cookies-full.json`，不进仓库）。
- 上游 `yxiy171866-boop/x-twikit-mcp` 的 twikit 2.3.3 对当前 X 前端会报
  `Couldn't get KEY_BYTE indices`：原因是 X 首页不再直接给出旧格式的 ondemand 文件名。
- 修复：
  - `twikit/x_client_transaction/transaction.py` 支持 `TWIKIT_ONDEMAND_URL`；
  - `twikit/user.py` 对缺失 profile 字段容错；
  - X MCP `server.py` 改用 `FastMCP`（兼容 mcp 1.30），支持完整 cookies、代理、UA；
  - 用 supergateway 把 stdio 包成 Streamable HTTP（`:8765/mcp`），带 API key；
  - cloudflared quick tunnel 暴露；DengTa 连接已创建并启用 5 个只读工具。
- 本机验证：12 个工具；`search_tweets` 实际返回结果。

## 当前限制

- tunnel 是 quick URL，重启会变；DengTa 连接会失效，需要重新 `Discover tools`。
- `x-client-transaction-id` 依赖当前 X 的 ondemand hash（`TWIKIT_ONDEMAND_URL`），X 前端更新后会失效；
  需要重新用 Playwright 抓取：
  `page.on('request', r => r.url().includes('ondemand.s'))`。
- DengTa 的 `/connections/:id/test` 在当前 supergateway 会话下返回 400；discover/initialize 正常。
  连接已启用，聊天模型是否能直接调用待后续验证。
- 所有工具默认 disabled；只读 5 个（search/get info/get tweets/get tweet/replies）为 auto，写工具需手动开。

## 启动（本机）

```powershell
# 1. 设置 X cookies / 代理 / 当前 ondemand URL（从 _credentials 读，不写仓库）
$env:TWITTER_COOKIES_JSON=(Get-Content 'D:\GZdeepseek\_credentials\x-cookies-full.json' -Raw -Encoding UTF8)
$env:TWITTER_PROXY='http://127.0.0.1:10809'
$env:TWIKIT_ONDEMAND_URL='https://abs.twimg.com/responsive-web/client-web/ondemand.s.<hash>a.js'

# 2. supergateway（API key 从 _credentials/x-mcp.json 读）
node_modules\.bin\supergateway.cmd --stdio run-x-mcp.cmd \
  --outputTransport streamableHttp --stateful --apiKey <key> --port 8765 --host 127.0.0.1

# 3. cloudflared
cloudflared.exe tunnel --url http://127.0.0.1:8765 --no-autoupdate
```

## 后续

- 要稳定给所有用户：需要把 twikit 事务补丁做成可自动更新（抓 ondemand hash），
  或改为不依赖 transaction-id 的读取通道；写工具必须做二次确认/审计。
- 短期只读工具可用；发推/私信等写工具默认禁用。

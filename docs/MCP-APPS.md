# DengTa × 自托管 MCP 应用（X / 网易云）

DengTa 的 MCP 连接层支持 **HTTP/HTTPS MCP**（JSON-RPC，兼容 SSE 响应）与自定义鉴权头。
所以接入第三方项目不需要改 DengTa 前端：把项目跑成公网 HTTPS MCP 端点，在 DengTa 的
「MCP 连接」里填地址 + 鉴权即可。下面是两条经过仓库实读的接入路线。

> 普通用户只需要：部署一个 Docker/命令 → 得到 HTTPS 地址 → 在 DengTa 里添加连接 → 发现工具。
> Cookie、token 都要自己保存，不要填给 DengTa 或发到群里。

---

## 一、网易云音乐（Anko3o/Music-Mcp-Netease）

- 仓库：https://github.com/Anko3o/Music-Mcp-Netease （CC BY-NC-SA 4.0，禁止商用）
- 形态：自带播放器 + HTTP MCP（12 个工具：搜歌、歌词、歌曲卡、插队、批注、评论、歌单等）
- 最小部署：

```bash
git clone https://github.com/Anko3o/Music-Mcp-Netease.git
cd Music-Mcp-Netease
echo "MUSIC_U=你的网易云MUSIC_U Cookie" > server/.netease_cred
python3 server/music.py            # 播放器 :9090
python3 mcp/music_mcp.py           # MCP :18012，端点 /mcp
```

- 公网化（任选其一）：
  - Caddy 反代：`handle /mcp-music-<随机串>/* { uri strip_prefix /mcp-music-<随机串>; reverse_proxy 127.0.0.1:18012 }`
  - Nginx：`location /mcp-music-<随机串>/ { proxy_pass http://127.0.0.1:18012/; }`
  - 家庭电脑：`cloudflared tunnel --url http://127.0.0.1:18012`，把生成的 https 地址作为 MCP。
- DengTa 里填：
  - URL：`https://你的域名/mcp-music-<随机串>/mcp`
  - 鉴权：如果反代用随机路径就不需要额外 header；如果加 Bearer，就在 DengTa 填对应 header。
  - 点「发现工具」，应看到 12 个 `song_*` 工具。
- 注意：播放器页面必须开着（前台/允许后台）才能接走点歌队列；首次打开播放器带 `?token=server/.secret`。

---

## 二、X / Twitter（yxiy171866-boop/x-twikit-mcp）

- 仓库：https://github.com/yxiy171866-boop/x-twikit-mcp
- 形态：stdio MCP，12 个工具（发推、回复、搜索、私信、点赞、转推、删推等），Cookie=`auth_token`+`ct0`
- 问题：DengTa 只接 HTTP；上游 stdio 不能直接填。需要一层 **stdio→HTTP 包装**。

### 1. 跑上游

```bash
git clone https://github.com/yxiy171866-boop/x-twikit-mcp.git
cd x-twikit-mcp
pip install -r requirements.txt
export TWITTER_AUTH_TOKEN="..."   # 浏览器 Cookies
export TWITTER_CT0="..."
python server.py                  # 先确认 stdio 模式能启动
```

### 2. 包装成 HTTP（任选一个，需自行验证版本）

```bash
# 方案 A：supergateway（Node）
npx -y supergateway --stdio "python /绝对路径/server.py" --port 8765

# 方案 B：mcp-proxy（Python）
pip install mcp-proxy
mcp-proxy --port 8765 -- python /绝对路径/server.py
```

包装后本地端点通常是 `http://127.0.0.1:8765/mcp` 或 `http://127.0.0.1:8765/sse`；
用 `curl -i http://127.0.0.1:8765/mcp` 确认 MCP 有响应。

### 3. 公网 + 上锁

- 推荐 Caddy/Nginx 反代到 `https://你的域名/x-mcp/...`，加 Basic/Bearer 或长随机路径；
- 或 `cloudflared tunnel --url http://127.0.0.1:8765`；
- **不要**把 8765 裸暴露公网：X Cookie 泄漏 = 账号被接管。

### 4. DengTa 里填

- URL：`https://你的域名/x-mcp/mcp`（或 `/sse`）
- 鉴权：Bearer 或自定义 header（与反代一致）
- 发现工具后先启用只读工具（`search_tweets`/`get_user_info`/`get_tweet_by_id`），
  发推、私信、删推等写操作确认稳定后再开。

---

## 三、DengTa 侧已经做了什么

- 生产 API 新增 **MCP 应用目录**：`GET /api/v2/mcp/catalog`（登录后），返回 X / 网易云
  的端点要求、工具列表、部署步骤、安全注意事项，前端可直接渲染成「一键教程」。
- 现有连接管理仍复用 `/api/mcp/connections/manage`（发现/测试/启用/工具策略），
  不把任何 Cookie/token 存进目录。
- 目录里的步骤就是上面两节的精简版；前端 UI 上线后可直接把 `steps` 渲染成向导。

## 四、安全提醒（必读）

- X `auth_token`/`ct0`、网易云 `MUSIC_U` 都是账号级凭据；只放自建服务器。
- 公网 MCP 必须有 HTTPS + 鉴权；DengTa 会拒绝私网地址。
- 发推/私信/删推是不可逆操作；把写工具设为「每次确认」或先不启用。
- 网易云项目 CC BY-NC-SA 4.0，禁止商用；X 自动化注意平台风控与频率。

## 五、定时追踪更新

`tools/repo-watch/watch.mjs` 会每天检查你给过和已发现的 GitHub 项目（最新 commit/release），
写入 `docs/REPO-WATCH.md`，有更新时在表里标 🆕。计划任务/ cron 示例见
`tools/repo-watch/README.md`。

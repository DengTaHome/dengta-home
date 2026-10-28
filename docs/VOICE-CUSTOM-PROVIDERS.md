# 用户自带语音接口（BYO TTS）

DengTa 不再只能等服务器配置 MiniMax：每个账号都可以把自己的语音服务接进来。
设置页路径：**设置 → 发声接口**（按登录账号 + 伴侣隔离，密钥加密保存、不回读）。

## 支持的发声来源

| provider | 说明 | 需要 Key | 需要地址 |
|---|---|---|---|
| `server_default` | 服务器默认语音（当前 MiniMax，需部署者配 `MINIMAX_API_KEY`/`MINIMAX_TTS_VOICE_ID`） | 否（服务器配） | 否 |
| `deepgram` | Deepgram Aura-2（原有能力） | 是 | 否（内置区域） |
| `edge` | **微软 Edge Read Aloud 免费神经语音**，中文自然、无需 Key（v2 协议 + `ws` 依赖） | 否 | 否（内置音色） |
| `openai_compatible` | 任何兼容 `POST /v1/audio/speech` 的服务（OpenAI 官方、硅基流动、自建网关、Fish Audio 网关等） | 可选 | 是 |
| `custom_http` | 任意 HTTP TTS API：自定义方法/请求头/请求体模板，返回二进制、JSON base64 或 JSON 音频 URL | 可选 | 是 |

代码位置：`backend/services/custom-speech.js`（合成）、`backend/services/voice-provider-center.js`
（租户配置/加密/校验/试听）、`frontend/src/VoiceProviderSettings.jsx`（设置 UI）、
`backend/supabase/065_custom_voice_providers.sql`（迁移新增 12 个字段并放宽 speed 约束；部署前需执行）。

## 自定义 HTTP 模板

请求体/请求头支持占位符：

- `{{text}}`：要朗读的文本（原文）
- `{{text_json}}`：已做 JSON 转义的文本（放进 JSON 字符串时用它）
- `{{voice}}`、`{{model}}`、`{{format}}`
- `{{api_key}}`：如果填了 Key，也可直接写进模板；不写时自动加 `Authorization: Bearer`

返回方式：

- `binary`：响应体直接是音频（用 `Content-Type` 或所选格式）
- `json_base64`：JSON 里取 base64 音频，字段路径如 `data.audio`
- `json_url`：JSON 里取音频 URL（如 `data.url`），后端再下载

## 安全边界

- 用户填写的地址由**服务端**请求，默认只允许 **https 公网**，禁止 localhost/私网/云元数据（SSRF）。
- 自托管要接本地 TTS（GPT-SoVITS/IndexTTS 等）时在服务端设置：
  `VOICE_CUSTOM_ALLOW_HTTP=1`（放行 http）、`VOICE_CUSTOM_ALLOW_PRIVATE=1`（放行私网）。
- API Key 走与 MCP 设备中心相同的 AES-256-GCM 加密（`MCP_ENCRYPTION_KEY`），接口只返回
  `credential_configured`，不回读明文。
- 音频响应有 15MB 上限（流式读取，不会先整包进内存再判断）；JSON 响应另限 2MB；
  合成有超时；Edge/自定义请求不会把文字发给未配置的服务。
- SSRF：除字面地址校验外，运行时还会做 DNS 解析并拒绝解析到内网/回环的域名
  （`localtest.me`/`nip.io` 类）；重定向逐跳校验且**禁止跨源重定向**，避免 API Key 与
  文本被带到别的域。仍有极小的 DNS TOCTOU 窗口，生产建议使用可信的语音服务地址。
- 免费 Edge 走 `wss://api.msedgeservices.com` + Sec-MS-GEC v2（5 分钟桶），需要服务器能
  直连微软端点（`ws` 包会带上 Edge 的 Origin/UA 头）。**本机已用最终实现真实合成成功**
  （zh-CN-XiaoxiaoNeural，27,504 字节 MP3，约 1.9s）；单测另有协议夹具与已知向量。
  若部署环境网络受限，改用 `openai_compatible`/`custom_http` 即可。
- 语速范围：Deepgram 仍限制 0.70–1.50；Edge/OpenAI 兼容/自定义 HTTP 允许 0.25–4.00，
  数据库约束已在 065 中放宽。

## 运行时链路

1. 前端聊天消息带 `speech_token`；点击播放 → `POST /voice/speech`。
2. 后端按当前账号 `voice_provider_profiles.provider` 分流：
   - `server_default`/`deepgram` → 原有 `synthesizeExpressiveSpeech`；
   - `edge`/`openai_compatible`/`custom_http` → `synthesizeCustomSpeech`。
3. 合成结果进现有 LRU 缓存（缓存键已包含 provider/voice/base URL/格式，切换配置不会串音）。

## 验证

```powershell
cd backend
node --test test/custom-speech.test.js
node --test test/voice-provider-custom.test.js
node --test test/voice-provider-center.test.js test/voice-output-route.test.js `
  test/voice-provider-isolation.test.js test/expressive-speech.test.js
```

覆盖：Edge v2 Token 已知向量、WebSocket 帧解析/空音频/超时、OpenAI 兼容请求体与鉴权、
自定义 HTTP 三种返回、模板占位符、SSRF（字面地址 + DNS 解析 + 跨源重定向）、响应体积上限、
中心保存/切换 provider 清空旧密钥/试听。真实网络不可用时用 `custom_http` 接本地 mock 服务
即可端到端验证（已实测本地 HTTP TTS 返回音频并写入 `last_status=connected`）。

## 与 QQ 接入的关系

QQ 侧语音由 `qq-bridge` 的 voice 工具负责“把音频发到 QQ”；DengTa 这边负责“生成好听的声音”。
两者可通过同一条自托管 TTS 服务（`custom_http`）复用：QQ bridge 调 TTS 生成音频，
DengTa 聊天也调同一服务，用户只需要维护一套语音配置。

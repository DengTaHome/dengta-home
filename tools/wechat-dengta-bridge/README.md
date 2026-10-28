# WeChat iLink <-> DengTa auto-reply

把微信 ClawBot 的来信转给生产 DengTa 通道接口（`POST /api/v2/qq-bridge/chat`），
拿回小小灯的人设/记忆回复，再用 `wxb send` 发回微信。

## 运行

```powershell
$node = 'D:\GZdeepseek\_tools\node\node.exe'
& $node tools\wechat-dengta-bridge\auto-reply.mjs
```

配置放在仓库外：`_credentials/wechat-dengta-bridge.json`（token、绑定用户、状态目录）。
可用环境变量 `WECHAT_DENGTA_CONFIG` 指定其它路径。

## 行为

- 每 60s 执行一次 `wxb fetch --maxAttempts 2`，只处理 `trusted` 消息；
- 同一 WeChat 用户复用 `conversation_id`，不会每条重新开话题；
- 已处理消息 id 落盘到状态目录的 `processed.json`，重启不重复回复；
- 发送失败/接口失败写入 `bridge.log`，不会把异常当正常回复；
- 只聊天：不执行文件、邮件、付款等操作；媒体消息只做类型说明。

## 验证

已用 mock wxb CLI 跑通「fetch → DengTa `/chat` → send」全链路；真实微信回复
需要主人给 ClawBot 发一条消息触发。
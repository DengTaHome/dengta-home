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

## 人设小节勾选

```powershell
& $node tools\wechat-dengta-bridge\make-selection.mjs
```

生成 `wechat-auto-reply-state\selection.json`：
- 按空行把 DengTa 统一人设拆成小节；
- 关键词只做风险提示；**所有小节默认关闭**，必须显式勾选；
- 风格小节也默认关闭；
- 记忆条目全部默认关闭；只有 `enabled: true` 的词条才拼进本回合 prompt。
- selection 缺失/损坏/全空时 **fail-closed**：只发送最小安全人设（普通聊天、无角色扮演/无成人内容），绝不回落到完整原生人设。

手动编辑 `selection.json` 的 `enabled` 字段即可选择；每次聊天都会重新读取。
发送时作为 `channel_persona` 传给后端，只覆盖本回合，不写回 DengTa 网页端设置。

## 临时勾选界面（本机）

```powershell
& $node tools\wechat-dengta-bridge\select-ui.mjs
```

打开 http://127.0.0.1:3111 ，勾选人设小节/记忆/风格后点「保存勾选」；
保存到同一份 selection.json，下一轮微信回复立即生效。仅监听 127.0.0.1，不对外暴露。

## 行为

- 每 60s 执行一次 `wxb fetch --maxAttempts 2`，只处理 `trusted` 消息；
- 同一 WeChat 用户复用 `conversation_id`，不会每条重新开话题；
- 已处理消息 id 落盘到状态目录的 `processed.json`，重启不重复回复；
- 限速 30 条/小时、全局 8s、同用户 15s、发送前 0.8–2.2s 拟人停顿；
- `SESSION_EXPIRED` 停止轮询等重扫码；孤儿锁自动清理；
- 发送/接口失败写入 `bridge.log`；当前失败会发一句简短占位，不会重试（后续改进）。

## 验证

已用 mock wxb CLI 跑通「fetch → 仅勾选人设 `/chat` → send」全链路：
临时选择一个小节「只回复四个字：勾选生效」，mock 收到的发送文本正是 `勾选生效`，
证明 channel_persona 覆盖真实生效。真实微信回环需要主人给 ClawBot 发一条消息触发。
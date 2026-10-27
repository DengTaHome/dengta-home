# 心潮 xinchao 接口契约

本文档描述 `GET /api/v2/xinchao/state`。该接口是**从生产前端产物中还原出来的契约**，
不是推测：前端 `App` chunk 里对它的调用与渲染逻辑都可逐行验证。

---

## 1. 前端实际怎么用

```js
// 页面可见时，每 60 秒拉一次
const payload = await api("/api/v2/xinchao/state");
setState(payload?.configured === true && payload?.state ? payload.state : null);
```

前端对返回值的每一个用途：

| 字段 | 前端用途 |
| --- | --- |
| `configured` | 不为 `true` 就整体关闭心潮显示 |
| `state.drives` | 按 `value` 降序取前 5 项画花瓣；`value` 直接当 CSS 变量 `--xinchao-level`，所以必须是 **0..1** |
| `state.drives[].label` | 胶囊标题与详情里的文字 |
| `state.emotion.label` | 胶囊副标题（如「平静」） |
| `state.consciousness` | 等于 `'awake'` 时显示「此刻醒着」；**其他非空值会被原样打印出来**，所以只能是 `'awake'` 或 `null` |
| `state.revision` | 详情里的版本标记 |
| `state.lastConversationAt` | 详情里「上次聊天 …」，前端用 `zh-CN` 本地化 |

> ⚠️ 最容易踩的坑：`consciousness` 若返回 `"drowsy"` 这类英文枚举，界面会直接显示 `drowsy`。
> 前端只有一个分支：`=== 'awake' ? '此刻醒着' : (值 || '心潮流动')`。

---

## 2. 请求与响应

### 请求

```
GET /api/v2/xinchao/state
Authorization: Bearer <supabase access token>
```

需要登录。未登录返回 **401**（`code: "authentication_required"`），已实测。

### 响应 200

```json
{
  "configured": true,
  "state": {
    "emotion": { "label": "雀跃" },
    "drives": [
      { "key": "curiosity",    "label": "好奇", "value": 0.551 },
      { "key": "attachment",   "label": "依恋", "value": 0.548 },
      { "key": "tenderness",   "label": "温柔", "value": 0.512 },
      { "key": "closeness",    "label": "亲近", "value": 0.489 },
      { "key": "longing",      "label": "思念", "value": 0.414 },
      { "key": "restlessness", "label": "躁动", "value": 0.352 }
    ],
    "consciousness": "awake",
    "revision": 3,
    "lastConversationAt": "2026-10-27T09:42:00.000Z"
  }
}
```

响应头带 `Cache-Control: private, no-store` —— 状态在漂移且属于私人数据。

### 降级行为

数据库读失败时**不抛 500**，而是返回基于基线的可渲染状态并打 warning 日志。
心潮是装饰性信息，不能因为它把整个页面打挂。

---

## 3. 状态模型

两个分量相加，结果夹到 `0..1`：

```
value(drive) = clamp01( decayTowardBaseline(stored, baseline, halfLife, 距上次写入的小时数)
                        + conversationBoost(距上次对话的小时数) )
```

**长期分量**：向 `baseline` 做指数回归，`halfLifeHours` 小时后与基线的距离减半。

**短期分量**：越接近上次对话抬升越多，线性衰减，`3` 小时后归零，最大 `+0.25`。

### 参数

| key | 标签 | baseline | 半衰期 |
| --- | --- | --- | --- |
| `attachment` | 依恋 | 0.30 | 72h |
| `curiosity` | 好奇 | 0.30 | 16h |
| `longing` | 思念 | 0.16 | 90h |
| `tenderness` | 温柔 | 0.26 | 48h |
| `closeness` | 亲近 | 0.24 | 32h |
| `restlessness` | 躁动 | 0.10 | 8h |

所有 baseline 都**刻意低于** `CALM_THRESHOLD`（0.34）：不聊天时主导项不过阈值，情绪就是「平静」；
刚聊过天才越过阈值显出具体情绪。这是让「平静」这个状态真实可达的前提。

### 情绪标签

取主导项映射：依恋 / 雀跃 / 思念 / 温柔 / 亲近 / 躁动；低于阈值一律「平静」。

### 清醒窗口

距上次对话 ≤ 6 小时 → `'awake'`，否则 `null`。

### revision 只在真变化时递增

`MATERIAL_DELTA = 0.02`：任一驱动项变化 ≥ 0.02，或情绪标签 / 清醒状态改变，才落库并 `revision + 1`。
否则 60 秒一次的轮询会把 revision 每秒顶上去，失去意义。

---

## 4. 实现位置

| 文件 | 作用 |
| --- | --- |
| `supabase/062_xinchao_state.sql` | 建表、RLS 只读策略、幂等约束 |
| `services/xinchao.js` | 纯推导函数 + `createXinchaoService` |
| `routes/xinchao.js` | `GET /state`，走 `requireRequestScope` |
| `services/request-scope.js` | 新表加入 `TABLE_SCOPES`，并允许 upsert |
| `test/xinchao.test.js` | 衰减、抬升、标签、清醒窗口、revision 去重、降级读取 |
| `server.js` | 挂载 `/api/v2/xinchao`，`/health` 增加 `xinchao_configured` |

数据库：`companion_xinchao_state`，主键 `(user_id, companion_id)`，`drives` 为 `jsonb`。

---

## 5. 下一步（接真实数据时改哪里）

现在 `xinchao` 只用了「上次对话时间」这一个真实信号。要接更多真实输入，改
`services/xinchao.js` 里的两处即可，接口形状不用动：

1. **`readLastConversationAt`** —— 已从 `conversations` 取，可再叠加 `messages` 频率、`companion_diary_entries` 等。
2. **`deriveDrives`** —— 目前是时间函数；要给某个驱动项单独的输入（例如「思念」来自 `whereabouts` 距离、「躁动」来自未读消息堆积），在函数签名里加参数即可，纯函数特性保证仍可测。

**不要改**的是返回结构的字段名与 `value` 的取值范围 —— 前端按 0..1 直接算 CSS 变量。

### 仍未确认的部分

- 生产返回的 `drives` 到底有几项、`key` 叫什么：前端只渲染，不内置任何 key，所以无法从产物反推。当前用了 6 项，前端取前 5。
- 生产是否还有写接口（如手动调整情绪）：线上产物里只出现 `GET /api/v2/xinchao/state` 一个路径，据此判断目前是只读。

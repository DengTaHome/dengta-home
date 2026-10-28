# DengTa × kiwi-mem 结合方案（读源码后的结论）

> 目的：搞清楚 `kiwi-mem` 到底在做什么、DengTa 已经接入了什么、哪些机制值得"择优"搬过来、
> 哪些**不该**重复造。所有结论都对应到两侧源码位置，不是读 README 的转述。
>
> 参考对象：
> - 公开版 `LucieEveille/kiwi-mem`（AGPL-3.0，独立记忆网关）
> - DengTa 实际对接的**多租户分支**（备份 bundle `kiwi-mem-dengta-full-history`，
>   main `483a0c5`），它比公开版多了 `/memory/*` 外部接口、批量导入与提取保护。

---

## 1. 两个项目各是什么

| | kiwi-mem | DengTa home |
| --- | --- | --- |
| 定位 | **独立记忆网关**：站在聊天客户端与 AI 供应商之间，注入记忆、提取记忆 | **完整陪伴应用**：前端 + 后端 + Supabase + 供应商路由 + 语音/音乐/日记等 |
| 记忆存储 | 自带 PostgreSQL（`memories`、`memory_edges`、`mem_scenes`、`calendar_pages`、`reminders`…） | Supabase `memories`（`summary/locked/confirmation_status/superseded`）+ `memory_calendar` |
| 入口 | 客户端改连网关，或调用 `/memory/*` 外部接口 | 自己的 `/api/v2/*` 聊天/语音接口 |
| 记忆加工 | 按会话间隔自动提取、Dream 睡眠整合、日历层级摘要、约定/提醒 | 本地 `tryCompressMemory` 摘要 + `memory-budget` 预算化注入 |

DengTa 选的是**第二种接入方式**：聊天仍直连租户自己的供应商，只把「召回/上报」走
`backend/services/kiwi-memory-client.js` 调 `/memory/recall`、`/memory/chat-turn`
（另含 `store`、`import`、`import-file`、`health`）。这是合理的：不推翻现有流式管线与供应商路由。

## 2. 已集成现状（源码证据）

- 客户端：`kiwi-memory-client.js`
  - 租户 ID = `userId:companionId`，放在 `X-Tenant-Id`；响应回显不一致直接判失败（防串号）
  - 所有调用 3 秒超时 + 失败静默降级，`KIWI_MEM_URL` 未配置时零开销
  - 召回结果映射成 DengTa memories 形状，并带出 `heat / importance / emotional_weight / is_permanent / category_name`
- 注入：`context-reset.js` 把 kiwi 召回与本地 memories 合并 → `filterMemoriesForContext` → `selectMemoriesForContext`（预算 8000 字、最多 20 条）
- 上报：每轮对话后 `reportChatTurn` → 网关按会话间隔提取
- 状态：`/api/v2/memory/health` 使用 `checkKiwiMemoryHealth`

## 3. kiwi 里值得"择优"的机制（读源码后的判断）

| 机制 | kiwi 实现 | DengTa 现状 | 结论 |
| --- | --- | --- | --- |
| 热度 = 初始温度 × 半衰期衰减 + 召回加成 | `database.py:calculate_heat`：重要性/情绪取 max、普通 3 天/重要 7 天半衰期、每次召回延长 0.5 倍、永久=1、锚点取 `max(created_at,last_accessed)`、冷启动保护 | 自己另有一套 90/45 天半衰期的 `memoryHeat()`，**忽略网关 heat** | **本方案采纳：网关热度权威化**（见 §4） |
| 热度分层注入 0.7/0.3、清理阈值 0.15 | 网关内完成 | `memory-budget.js` 已有 full/summary/cold 三档与截断 | 已有，不重复；分层阈值与 kiwi 对齐 |
| 检索 `0.5 语义 + 0.15 重要 + 0.1 新近 + 0.25 热度` | `database.py` | 本地是词法相关 + 热度 + 重要度 | 两侧各保留：网关负责语义排序，DengTa 负责注入预算 |
| 记忆边（实体/时间/日历/主题扩散） | `memory_edges` + 图扩散 | 无 | **不搬**：需要独立图存储与 embedding，网关侧已具备 |
| Dream 睡眠整合 | `dream.py`（清理→融合场景→推断） | 无 | **不搬**：成本高且与网关重复，交给网关 |
| 日历层级摘要 日→周→月→季→年 | `calendar_periods.py`、`calendar_pages` | `memory_calendar` 已有类似表 | 已有，不重复 |
| 矛盾失效（`valid_until` / superseded） | 有 | `superseded` 字段 + `confirmation_status` | 已有 |
| 锁定记忆永不衰减 | `is_permanent` | `locked` + coreMemories | 已有；客户端已映射 |
| 会话间隔 = 一场对话边界 | `process_memories_background` | `reportChatTurn` 每轮上报，间隔由网关判断 | 已一致 |
| 约定/提醒（前瞻记忆，越近越清晰、broken 扣关系） | `reminders` + Dream 判定 | `special_dates` + 主动消息 | **下一阶段对齐**：见 §5 |
| 注入顺序为缓存命中优化（静态在前、动态在后） | prompt 组装 | `ai-service.js` runtimeContext 已有分块 | 已有；不重复 |

## 4. 本轮实际改动（P0，已带测试）

1. **网关热度权威化**（`backend/services/memory-budget.js`）
   网关返回的 `heat` 包含真实召回时间、访问次数、情绪权重与永久语义；
   本地再用 90/45 天公式重算，会出现「网关刚升温、这边仍按旧 `updated_at` 衰减」的分裂。
   现在：有 `heat` 就用网关值（clamp 0–1），只有本地 memories（无该字段）才走本地公式。
   测试：`memory-budget.test.js` 新增「旧记忆但 heat=0.95 应排最前」「heat=0.05 且无关不应注入」。

2. **召回与 nursery 加载并行**（`backend/services/context-reset.js`）
   原来 `await recallMemories(...)` 排在 nursery 之后；网关 3 秒超时直接叠在首字延迟上。
   现在先发 promise，nursery 处理完再 `await`，两段等待重叠。
   测试：`context-reset.test.js` 增加源码结构守卫（promise 必须先于 nursery 出现、await 在其后）。

> 这两项都是**小而确定**的收益，不改 prompt 语义、不新增依赖、不改变租户隔离。

## 5. 下一阶段（按性价比排序，尚未实现）

1. **emotion_level 随 `chat-turn` 上报**：分支接口已支持 `emotion_level: high/medium/normal`，
   DengTa 客户端目前没传。可从语音情绪分析/伴侣状态推导后随轮上报，提升网关提取权重。
2. **把 DengTa「锁定记忆」同步为网关 `is_permanent`**：分支有 `/memory/lock`、`/memory/unlock`，
   客户端尚未使用；避免本地锁定、网关侧仍会淡忘的不一致。
3. **`/memory/status` 暴露到设置页**：让用户看到记忆服务健康与 embedding 可用性
   （客户端已有 `checkKiwiMemoryHealth`，缺 UI）。
4. **约定对齐**：`special_dates` 创建/完成时通知网关（或读取网关 `reminders`），
   把「答应过的事越近越清晰、broken 扣关系」纳入陪伴关系。
5. **旧记忆导入入口**：分支有 `/memory/import` 与 `/memory/import-file`，客户端已封装，缺 UI/CLI 入口。
6. **观测**：召回命中数、超时次数、降级次数打点，避免"静默降级"变成长期静默故障。

## 6. 明确不采纳

- **不把 DengTa 聊天整体改走 kiwi-mem 代理**：会推翻现有流式管线、供应商路由与租户 BYOK 设计，
  收益只是省一次 HTTP 调用。
- **不在 DengTa 内重建 Dream / 记忆边 / 向量库**：与网关职责重复，双份成本且两套结果会打架。
- **不做双提取器**：DengTa 的压缩摘要继续服务本地上下文与兜底；记忆提取以网关为准。
- **不让网关直连 Supabase 的生产数据**：网关只经 `/memory/*` 拿到这一轮文本，租户隔离由
  `X-Tenant-Id` + 回显校验保证。

## 7. 验证方式

- 单测：`memory-budget.test.js`、`context-reset.test.js`、`kiwi-memory-client.test.js`
- 真实网关验证（需要可达的 `KIWI_MEM_URL` + token）：
  `POST /memory/recall` 看 `heat` 字段 → 注入文本里应保留该热度；
  `POST /memory/chat-turn` 后 `/memory/status` 看提取是否发生。
- 注意：本仓库后端改动**不会自动上线**（线上 0.29.76 不是本仓库构建），
  需要按 `QUALITY-AUDIT-2026-10.md` 的部署边界处理。

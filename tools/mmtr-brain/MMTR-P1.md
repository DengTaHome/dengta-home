# MMTR × kiwi P1（脑层落库 / 回填 / 每日巩固）

本目录是 kiwi-mem 的多租户 fork；P1 把 MMTR 的记忆物理量接进来，**不改变** kiwi 的
提取/embedding/Dream/多租户网关，只加列、加表、加一个每日巩固任务。

## 结构

| 文件 | 作用 |
|---|---|
| `mmtr_brain/brain.py` | P0：MMTR 纯公式移植（三通道、压缩、承诺、关系、检索重排），29 条不变量断言 |
| `mmtr_brain/p1.py` | P1：`migrate` / `backfill` / `consolidate` 三个幂等操作 |
| `mmtr_brain/test_p1_pg.py` | P1 真实 PostgreSQL 集成测试（migrate/backfill/consolidate/接线） |
| `database.py` | 启动时 `init_tables()` 给 public 模板补 P1；ensure 时按开关调 `apply_p1_schema`（每进程每 schema 一次） |
| `daily_digest.py` | 每日整理后按租户执行 `consolidate_schema` |

## 数据模型（每个 schema 一份，public 是模板）

`memories` 增列：`s_fact/s_gist/s_affect`、`t_fact/t_gist/t_affect`、`level`、
`floor_level`、`promise_state`、`due_at`、`theme_key`、`recall_count`、
`last_compress_at`、`promise_surfaced_at`、`last_consolidated_at`。

新表：
- `relation_state`：单行（id=1）六维关系向量 JSONB + revision；
- `mmtr_activations`：回血记录（供 P2 的复习衰减使用，90 天清理）；
- `mmtr_consolidate_runs`：每日巩固摘要（可审计）。

## P1 明确 descope：边衰减

MMTR 的 `decayEdges` 需要 `memory_edges` 具备 `w0/t0/hits` 三列、并按租户隔离。
kiwi 现状：`memory_edges` 只有 `reason/created_at`，且不在 `TENANT_DATA_TABLES`
（边是全局表）。在没有完成"边按租户迁移 + 加列"之前做衰减会写错数据，
因此 P1 **不做边衰减**，留到 P2 前置；这里显式记录，而不是留一个看似实现的空壳。

## 生命周期

- **启动**：`init_tables()` 给 public 补列/表（`MMTR_P1_ENABLED=0` 可关闭，失败只告警）；
- **新租户**：`ensure_tenant_schema()` 复制基础表后，按开关调 `apply_p1_schema` 补 P1；
  脑层表**不放进** `TENANT_DATA_TABLES`（否则禁用时 LIKE 会引用不存在的表而 503）；
- **老租户**：同一函数按列差集补齐基础列，再由 `apply_p1_schema` 补 P1 列/表；
- **回填**：`python -m mmtr_brain.p1 backfill --dsn ...`（只处理 `s_fact IS NULL`，可反复跑）；
- **每日**：`daily_digest_scheduler` 整理完执行 consolidate（关系回归 / 承诺 broken+surfaced /
  压缩阶梯 / 90 天前激活清理）；`MMTR_P1_CONSOLIDATE_ENABLED=0` 可关闭；
- **手动**：`python -m mmtr_brain.p1 migrate|backfill|consolidate [--dry-run]`。

## 回填公式（惰性、不重写历史）

```
heat  = kiwi 旧 calculate_heat（冷启动保护 / 半衰期 / 召回加成）
s_fact = heat
s_gist = max(heat, 0.30)
s_affect = max(heat, 0.55 * importance/10)
level = 0
floor_level = importance>=0.9?0 : >=0.62?1 : >=0.38?2 : 3
t_* = last_accessed or created_at
recall_count = access_count
```

## 并发与运维约束

- 迁移/巩固都有**每 schema 会话级 advisory lock**（`schema_lock`，`pg_try_advisory_lock`
  轮询实现：避免等锁事务与 `CREATE INDEX CONCURRENTLY` 互等死锁）；
  guards 用**两个真实 OS 进程同时 migrate** 验证（[4] 段）；
- 启动钩子只补列/表，**不建索引**（避免大表锁写）；索引由离线
  `python -m mmtr_brain.p1 migrate` 用 `CREATE INDEX CONCURRENTLY` 建；
- 每日巩固在 `run_memory_job` 的租户锁内执行（与 Dream 互斥），单 schema 一个事务，
  失败回滚，多副本不会重复施加承诺惩罚；
- 新记忆写入时还没有 `s_fact`，由每日 consolidate 的**增量回填**补上（最多延迟一天）；
- `main.py` 的 batch-update 只改 `importance` 时不会立刻重算 `floor_level`，
  要到下一次 consolidate（最多一天）才修正；auto-retire 与 consolidate 同日执行且
  consolidate 在后，通常当天修正。当前没有消费者依赖实时 floor_level。
- `MMTR_P1_ENABLED=0` 完全关闭脑层（不再主动建表/补列/不巩固），老租户请求不受影响；
  注意：如果 public 模板此前已迁移过，`ensure_tenant_schema` 的 LIKE/列差集仍可能把
  P1 列带进新租户（不会带 P1 表），这不影响请求，只是关闭期间不再主动升级；
  `update_memory` 也会先检查 `floor_level` 列是否存在，禁用或迁移失败时不会 500。
- 每进程对每个 schema 只做一次 P1 补列/建表（就绪缓存），避免每请求 20+ 次
  information_schema 查询；失败不缓存，下次再试。
- 离线 `migrate` 的索引创建与列迁移在同一把 schema 锁内；`public.mmtr_p1_meta`
  的并发建表竞态已捕获 `UniqueViolation/DuplicateTable` 后重试；发现
  `indisvalid=false` 的残留索引会先删后建。
- 压缩每轮默认上限 2000 条（`MMTR_COMPRESS_MAX_PER_RUN` 可调），避免大租户首跑把
 单个每日事务拖到几十秒；积压会分多天消化。

## 验证

```bash
python mmtr_brain/test_brain.py              # P0 公式（30 条 check）
python -m mmtr_brain.test_p1_pg              # P1 主链路（migrate/backfill/consolidate）
python -m mmtr_brain.test_p1_guards_pg       # P1 守卫（开关/老租户/并发/饥饿/dry-run/边界）
```

旧 heat 与新权重的抽样对比产物：`mmtr_brain/p1_backfill_sample.json`
（测试生成，可直接用于部署前 review）。

P1 测试分两个文件：
- `test_p1_pg.py`：migrate 幂等、public+租户两套 schema、冷启动/衰减公式、回填幂等、
  关系回归、承诺 broken/surfaced、压缩阶梯、重复执行幂等、dry-run 只读；
- `test_p1_guards_pg.py`：`MMTR_P1_ENABLED=0` 冷启动与 `update_memory`、老租户升级、
  **索引集合精确匹配且 indisvalid**、配置覆盖/importance=0/未来时间戳/valid_until/锁定记忆、
  pending 承诺不压缩、lock_source、floor 重算、**400 条 fact-alive 候选饥饿**、
  **真并发 consolidate（asyncio.gather + 独立连接）**、
  **真并发 migrate（两个 OS 进程 + meta 竞态）**、dry-run 零写入、增量回填。

## 未做（P2/P3）

- `/memory/recall` 响应里的 `weights/promise/relation_feeling`（P2）；
- `chat-turn` 写入时拆三通道 + 承诺识别（P3）；
- DengTa 侧 `memory-budget.js` 用网关 weights 取代本地 heat（P4）。
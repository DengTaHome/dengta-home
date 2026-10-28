# MMTR × kiwi-mem 融合方案（读源码后的结论 + 已跑通的移植原型）

> 对象：
> - **MMTR** — `CRTNET8866/MMTR`，TypeScript、零依赖、`node:sqlite`，仿人脑记忆层：「会忘，但忘得对」
> - **kiwi-mem** — `LucieEveille/kiwi-mem`，Python/PostgreSQL 独立记忆网关；DengTa 通过
>   `backend/services/kiwi-memory-client.js` 调它的 `/memory/*` 多租户接口
>
> 结论先行：**两者不能代码级合并，能算法级融合。** 把 MMTR 的「脑层」（三通道衰减、
> 压缩阶梯、关系向量、前瞻记忆、检索重排）移植进 kiwi-mem 的 Python 服务，kiwi 继续做
> 它的网关与语义库；DengTa 侧零改动即可受益（`/memory/recall` 多返回几个字段即可）。

---

## 1. 两个项目到底在做什么（源码证据）

| | MMTR | kiwi-mem |
| --- | --- | --- |
| 语言/存储 | TypeScript + `node:sqlite`（单文件） | Python + PostgreSQL |
| 形态 | **可嵌入库** + 可选 HTTP server | **独立部署的网关**（客户端改连它，或调 `/memory/*`） |
| 记忆模型 | 三通道 `fact/gist/affect`（τ=4/12/180 天，地板 0.02/0.12/0.55）+ L0–L3 压缩阶梯 | 单一 `heat` 热度（半衰期普通 3 天/重要 7 天，召回延长 0.5 倍）+ 重要度 |
| 联想 | 4 类边（实体/时间/日历锚点/主题）+ `hopDecay 0.85` 扩散 | `memory_edges` 表（图能力已在） |
| 关系 | **六维向量**（亲近/信任/俏皮/温度/张力/熟悉）+ 单场上限/速率衰减/回归半衰期 | 无（关系语义分散在提示词与状态里） |
| 前瞻 | 承诺/约定单独一类：锁 L0、**越近越清晰**、到期浮出、broken 扣关系 | `reminders` 表（机制更简单，偏提醒） |
| 常驻 | `core_memory` 身份块（不衰减）+ 事件拒绝入库 | 人设/画像在 settings 与 prompt，无硬门禁 |
| 检索 | 六步：向量→扩散→日历→重排(w×…×抑制)→MMR 裁剪→组装（quiet/full） | 语义+关键词混合检索，热度参与打分 |
| 巩固 | `sleep` / `consolidate`（关系回归、边衰减、压缩、约定判定、日历体检） | `Dream`（清理→融合场景→推断）+ 日历层级摘要 |

**核心差异**：MMTR 把「记忆强度」建模成三条速度不同的曲线 + 压缩阶梯；
kiwi 用单一 heat + 分层注入。kiwi 有存储/多租户/LLM 提取/Dream，MMTR 有更细的记忆物理量。

## 2. 为什么不能直接合并

1. 语言/存储不同（TS+sqlite ↔ Python+Postgres），不可能 `git merge`；
2. 两者都是完整记忆系统（提取、存储、检索、注入各有一套），双写会互相打架；
3. MMTR 的 LLM 抽取与 embedding 相对朴素，kiwi 已经成熟——那部分**不该搬**。

## 3. 融合架构（推荐）

```
DengTa backend ──/memory/recall──▶ kiwi-mem（Python/Postgres）
                     ▲                    │
                     │              ┌─────▼──────────────┐
                     └──────────────│ MMTR 脑层（移植模块）│
                       增强后的记忆  │ channels/levels/    │
                       （含通道权重）│ relation/promise    │
                                    └────────────────────┘
```

- **kiwi-mem 保留**：多租户网关、LLM 记忆提取、Dream、日历摘要、embedding/向量检索。
- **移植 MMTR 脑层**：三通道衰减、复习回血、压缩阶梯、关系向量、前瞻记忆、检索重排权重。
- **DengTa 不用改客户端**：`/memory/recall` 响应增加 `weights{fact,gist,affect}`、
  `promise{clarity,urgency}`、`relation_feeling` 等字段；DengTa 现有合并逻辑照单全收，
  `memory-budget.js` 可按 `weights` 替代本地 heat（两边已打通记忆形状）。

## 4. 数据层映射（kiwi Postgres 增量，不破坏现有表）

```sql
-- memories 增列（全部可空，旧数据可回填）
ALTER TABLE memories ADD COLUMN s_fact    REAL;   -- 三通道存储强度
ALTER TABLE memories ADD COLUMN s_gist    REAL;
ALTER TABLE memories ADD COLUMN s_affect  REAL;
ALTER TABLE memories ADD COLUMN t_fact    TIMESTAMPTZ;  -- 各自最后一次重算时间
ALTER TABLE memories ADD COLUMN t_gist    TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN t_affect  TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN level        SMALLINT DEFAULT 0;
ALTER TABLE memories ADD COLUMN floor_level  SMALLINT DEFAULT 3;
ALTER TABLE memories ADD COLUMN promise_state TEXT DEFAULT 'none';  -- none/pending/kept/broken
ALTER TABLE memories ADD COLUMN due_at     TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN theme_key  TEXT;       -- 已有主题概念可复用

CREATE TABLE relation_state (            -- 单行，多租户按 tenant 分区/或加 tenant 列
  tenant_id TEXT PRIMARY KEY,
  dims JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE mmtr_activations (          -- 只统计回血与横向抑制
  memory_id UUID REFERENCES memories(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  turn BIGINT
);
```

回填策略（避免历史数据失真）：
- `s_fact = heat（旧）`，`s_gist = max(heat, 0.3)`，`s_affect = max(heat, 0.55×importance/10)`；
- `level=0`、`floor_level = importance>=0.9?0 : >=0.62?1 : >=0.38?2 : 3`；
- `t_* = last_accessed or created_at`。
回填后旧记忆按新曲线跑，不会一次性大批量重写（惰性求值）。

## 5. 分阶段落地（P0 已完成）

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| **P0 ✅** | 把 MMTR 纯公式移植成 Python 模块（`mmtr_brain/brain.py`），覆盖三通道、回血、压缩、诺言、关系、检索重排；29 条不变量断言全过 | `python test_brain.py`（见 §8） |
| **P1 ✅ 已实现** | kiwi 加列 + 回填脚本 + 每日 `consolidate`（关系回归/压缩/约定判定）；边衰减 descope 到 P2 | 迁移/回填/巩固在真实 PG 跑通：`test_p1_pg` + `test_p1_guards_pg`；旧 heat 抽样见 `mmtr_brain/p1_backfill_sample.json` |
| P2 | `/memory/recall` 响应带 `weights/promise/relation`；注入文案用 `quiet` 组装（无数字） | DengTa 真机：同一查询注入内容更短且更贴情绪 |
| P3 | `/memory/chat-turn` 写入时拆三通道 + 承诺识别（复用 fork 的提取器，加 `due_at` 解析） | 契约测试：承诺在 7 天内浮出、宽限期后 broken |
| P4 | DengTa `memory-budget.js` 用 `weights` 取代本地 heat（已有网关 heat 权威化作为过渡） | 与 P2 同一测试；回退开关保留 |

## 6. P1 显式 descope：边衰减

MMTR 的 `decayEdges` 依赖 `memory_edges(w0,t0,hits)` 且边必须按租户隔离；
kiwi 目前边是全局表、无这些列。P1 不搬边衰减，待"边按租户迁移 + 加列"后再做。
写清楚而不是留空壳，避免后续误判 P1 完成度。

## 7. 明确不搬

- **MMTR 的 embedding/LLM 抽取**：kiwi 已成熟，重复搬只会增加 token 成本。
- **MMTR 的 sqlite 存储与 HTTP server**：kiwi 的 Postgres 与 `/memory/*` 已承担。
- **整套 MMTR 作为 sidecar 双跑**：两套记忆库必然分叉，用户会看到"同一件事两套说法"。
- **kiwi 现有 Dream/日历摘要**不动：它们与 MMTR 的 consolidate 有重叠但各有价值，
  先在 consolidate 里做关系/约定，Dream 保持现状。

## 8. 默认参数（移植进 kiwi 时保持一致，可配置覆盖）

```
channels: fact(τ4, p0.9, floor0.02, gain0.55) gist(τ12, p0.75, floor0.12, gain0.4)
          affect(τ180, p0.28, floor0.55, gain0.22)
levels:   floorThresholds l0=0.9 l1=0.62 l2=0.38
          compressThresholds 0→0.42 1→0.18 2→0.07 ; minIntervalDays 1/7/30
promise:  horizon45 clarityFloor0.42 curve1.25 surface7 grace3 default30 max400
relation: base(closeness.28 trust.30 playfulness.35 warmth.32 tension.10 familiarity.25)
          ceiling0.95 maxDeltaPerSession0.06 rateLimit0.55 regressHalfLife21 tensionHalfLife4
retrieval: sim.42 gist.18 fact.08 affect.14 importance.10 calendar.12 theme.08
           lateralInhibition.18 readOnly.04 redundant.25 mmrLambda.72
```

## 9. 已跑通的 P0 原型

位置：`D:\GZdeepseek\_refs\kiwi-mem-dengta\mmtr_brain\`（从备份 bundle 还原的 fork 工作副本）

- `brain.py`：纯算法移植，不依赖数据库
- `test_brain.py`：31 条不变量断言，实测全过：

```
✓ 事实最先淡掉 / 情绪几乎不走 / 三通道明显速度差
✓ 情绪地板 0.55、事实地板 0.02
✓ 回血随被想起次数递减
✓ importance 决定 floorLevel；锁定/到地板/fact 仍亮 都不压缩
✓ 约定：远期 0.42 → 到期 1.0；到期前 7 天浮出；过期 3 天判落空
✓ 关系：单场 0.06 上限、越近上限越推不动、张力回落比亲近快
✓ 检索：横向抑制/只读降权生效
```

## 10. 需要你拍板的两件事

1. **改哪个仓库**：我目前把原型放在 kiwi 的 fork 工作副本里；要真正上线需要能推该 fork 的权限
   （或把 P0 模块 + P1 迁移脚本交付给你手动合入）。
2. **部署形态**：kiwi-mem 目前部署在哪台服务器 / 是否跑 Docker？P1 的迁移与 consolidate
   定时任务需要在那里执行；如果暂时不部署，P2/P3 可以先在本地用 pglite/Postgres 验证。

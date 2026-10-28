"""MMTR × kiwi-mem — P1 落地模块（schema / 回填 / 每日 consolidate）。

设计要点（对应 docs/MMTR-KIWI-FUSION.md §4–§5）：

- kiwi 是「每租户一个 Postgres schema」的多租户结构，P1 的列与表必须落在
  **public 模板 + 每个租户 schema**，而不是加 tenant_id 列。
- 迁移幂等（ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS），并用
  **会话级 advisory lock** 串行化同一 schema 的迁移，避免多副本启动时
  check-then-alter 竞争。索引默认不在启动钩子里建（大表会锁写），
  由离线 `migrate` 用 CREATE INDEX CONCURRENTLY 建。
- 回填惰性：只处理 s_fact IS NULL 的行，分批 UPDATE；每天 consolidate 前
  也会先补一轮，保证新记忆能尽快进入新曲线。
- consolidate 单 schema 一个事务 + advisory lock：关系回归、承诺判定、
  压缩阶梯、激活清理要么全成、要么回滚；重复执行幂等。
- 承诺 pending 锁 L0：pending 的承诺不参与压缩（保留到期浮出）。
- **边衰减不在 P1**：MMTR 的 edge decay 需要 memory_edges 有 w0/t0/hits 且
  按租户隔离；kiwi 目前 edges 无这些字段且是全局表。这属于 P2 前置，
  已在融合文档与 MMTR-P1.md 里显式 descope，避免"假实现"。

命令行：
    python -m mmtr_brain.p1 migrate   --dsn postgresql://...
    python -m mmtr_brain.p1 backfill  --dsn ...
    python -m mmtr_brain.p1 consolidate --dsn ... [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

try:  # 包内导入（python -m mmtr_brain.p1）
    from . import brain
except ImportError:  # 直接在本目录执行时
    import brain  # type: ignore

import asyncpg

MS_DAY = brain.MS_DAY
RELATION_DIMS = brain.RELATION_DIMS
CONFIG = brain.DEFAULT_CONFIG

MEMORY_P1_COLUMNS = (
    ("s_fact", "REAL"),
    ("s_gist", "REAL"),
    ("s_affect", "REAL"),
    ("t_fact", "TIMESTAMPTZ"),
    ("t_gist", "TIMESTAMPTZ"),
    ("t_affect", "TIMESTAMPTZ"),
    ("level", "SMALLINT DEFAULT 0"),
    ("floor_level", "SMALLINT DEFAULT 3"),
    ("promise_state", "TEXT DEFAULT 'none'"),
    ("due_at", "TIMESTAMPTZ"),
    ("theme_key", "TEXT"),
    ("recall_count", "INTEGER DEFAULT 0"),
    ("last_compress_at", "TIMESTAMPTZ"),
    ("promise_surfaced_at", "TIMESTAMPTZ"),
    ("last_consolidated_at", "TIMESTAMPTZ"),
)

MEMORY_INDEXES = (
    ("idx_memories_p1_promise", "memories", "(promise_state, due_at)"),
    ("idx_memories_p1_level", "memories", "(level, floor_level)"),
    ("idx_mmtr_activations_memory", "mmtr_activations", "(memory_id, activated_at DESC)"),
)

KIWI_HEAT_DEFAULTS = {
    "half_life_normal": 3.0,
    "half_life_important": 7.0,
    "recall_extend": 0.5,
    "threshold_high": 0.7,
    "threshold_medium": 0.3,
    "importance_line": 8,
    "emotion_line": 6,
}

_SCHEMA_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TENANT_SCHEMA_RE = re.compile(r"^t_[0-9a-f]{20}$")

# 会话级 advisory lock 的命名空间（任意固定常量，只要全库一致）
_LOCK_NAMESPACE = "mmtr_p1"


def quote_ident(name: str) -> str:
    if not _SCHEMA_RE.match(name or ""):
        raise ValueError(f"非法 schema 名: {name!r}")
    return f'"{name}"'


@asynccontextmanager
async def schema_lock(conn, schema: str, purpose: str = "schema"):
    """会话级 advisory lock：串行化同一 schema 的迁移/巩固。

    用两个 int4 key（namespace + schema），避免和业务的其他 advisory lock 冲突。
    不放进事务里，是为了让 CREATE INDEX CONCURRENTLY 这类不能在事务中执行的
    语句也能受同一把锁保护。异常路径也会释放。
    """
    key1, key2 = f"{_LOCK_NAMESPACE}:{purpose}", schema
    deadline = asyncio.get_running_loop().time() + float(os.getenv("MMTR_LOCK_TIMEOUT_SECONDS", "180"))
    acquired = False
    while True:
        acquired = bool(
            await conn.fetchval(
                "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2))", key1, key2
            )
        )
        if acquired:
            break
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError(f"等待 schema 锁超时：{schema}/{purpose}")
        # 关键：让每次 try 的隐式事务立即结束，不做长时间阻塞等待；
        # 否则 CREATE INDEX CONCURRENTLY 会等待"等锁进程"的 virtual transaction，
        # 形成互等死锁（复审 D 用两个真实 OS 进程复现）。
        await asyncio.sleep(0.05)
    try:
        yield
    finally:
        await conn.execute(
            "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", key1, key2
        )


async def table_exists(conn, schema: str, table: str) -> bool:
    return bool(
        await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = $1 AND table_name = $2
            )
            """,
            schema,
            table,
        )
    )


async def column_exists(conn, schema: str, table: str, column: str) -> bool:
    return bool(
        await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
            )
            """,
            schema,
            table,
            column,
        )
    )


async def list_tenant_schemas(conn) -> List[str]:
    rows = await conn.fetch(
        "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name"
    )
    return [row["schema_name"] for row in rows if _TENANT_SCHEMA_RE.match(row["schema_name"])]


async def list_memory_schemas(conn) -> List[str]:
    rows = await conn.fetch(
        """
        SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'memories' ORDER BY table_schema
        """
    )
    return [row["table_schema"] for row in rows if _SCHEMA_RE.match(row["table_schema"])]


async def _create_indexes(conn, schema: str, concurrently: bool) -> int:
    q = quote_ident(schema)
    created = 0
    for name, table, columns in MEMORY_INDEXES:
        if not await table_exists(conn, schema, table):
            continue
        # CONCURRENTLY 失败可能留下 indisvalid=false 的索引；先清掉再建
        invalid = await conn.fetchval(
            """
            SELECT i.indisvalid
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = $1 AND n.nspname = $2
            """,
            name,
            schema,
        )
        if invalid is False:
            await conn.execute(f"DROP INDEX IF EXISTS {q}.{name}")
        keyword = "CONCURRENTLY " if concurrently else ""
        await conn.execute(
            f"CREATE INDEX {keyword}IF NOT EXISTS {name} ON {q}.{table} {columns}"
        )
        created += 1
    return created


async def apply_p1_schema(conn, schema: str = "public", create_indexes: bool = False) -> Dict:
    """把 P1 的列/表/索引幂等地加到指定 schema。

    create_indexes=False 供启动钩子使用（不在大表上拿写锁）；
    离线 migrate 会传 True 并用 CONCURRENTLY 建索引。
    """
    applied = {"schema": schema, "columns": 0, "tables": 0, "indexes": 0}
    if not await table_exists(conn, schema, "memories"):
        return {**applied, "skipped": "memories missing"}

    async with schema_lock(conn, schema, "schema"):
        q = quote_ident(schema)
        for column, ddl in MEMORY_P1_COLUMNS:
            if not await column_exists(conn, schema, "memories", column):
                await conn.execute(f"ALTER TABLE {q}.memories ADD COLUMN {column} {ddl}")
                applied["columns"] += 1

        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {q}.relation_state (
                id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                dims        JSONB NOT NULL,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                revision    BIGINT NOT NULL DEFAULT 1
            );
            """
        )
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {q}.mmtr_activations (
                id           BIGSERIAL PRIMARY KEY,
                memory_id    INTEGER NOT NULL,
                channel      TEXT NOT NULL DEFAULT 'gist',
                recall_count INTEGER NOT NULL DEFAULT 1,
                turn         BIGINT,
                activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {q}.mmtr_consolidate_runs (
                id         BIGSERIAL PRIMARY KEY,
                run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                summary    JSONB NOT NULL DEFAULT '{{}}'::jsonb
            );
            """
        )
        applied["tables"] = 3
        if create_indexes:
            applied["indexes"] = await _create_indexes(conn, schema, concurrently=False)

    await _ensure_meta_table(conn)
    await conn.execute(
        "INSERT INTO public.mmtr_p1_meta (schema_name) VALUES ($1) ON CONFLICT (schema_name) DO NOTHING",
        schema,
    )
    return applied


async def _ensure_meta_table(conn) -> None:
    """并发启动时 CREATE TABLE IF NOT EXISTS 仍可能撞 UniqueViolation（pg_type 竞态）。"""
    try:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS public.mmtr_p1_meta (
                schema_name TEXT PRIMARY KEY,
                applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
    except (asyncpg.DuplicateTableError, asyncpg.UniqueViolationError):
        # 另一个进程刚建好：表已存在，继续
        pass


async def migrate(dsn: str, concurrently: bool = True) -> Dict:
    """离线迁移：所有含 memories 的 schema 补列/表，并建 P1 索引。"""
    conn = await asyncpg.connect(dsn)
    try:
        await _ensure_meta_table(conn)
        results = []
        for schema in await list_memory_schemas(conn):
            async with schema_lock(conn, schema, "schema"):
                result = await apply_p1_schema(conn, schema, create_indexes=False)
                # 索引必须在同一把锁内建：两个并行 migrate 在 CONCURRENTLY 上
                # 会互相死锁（见复审 D）；串行化后失败也会被下一个 migrate 修复。
                result["indexes"] = await _create_indexes(conn, schema, concurrently=concurrently)
            results.append(result)
        return {"database": dsn.rsplit("/", 1)[-1], "schemas": results}
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# 回填：旧 heat → 三通道初始强度
# ---------------------------------------------------------------------------

def _to_utc(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def kiwi_heat(row: Dict, params: Optional[Dict] = None, now: Optional[datetime] = None) -> float:
    """database.py calculate_heat 的等价移植（回填专用）。

    与 database.py 对齐的分支：valid_until 失效归零、is_permanent=1、
    冷启动保护（access_count=0 且 emotional_weight<=2）、半衰期随召回延长、
    锚点取 created_at/last_accessed 中较近者、负年龄（未来时间戳）不裁剪。
    """
    p = {**KIWI_HEAT_DEFAULTS, **(params or {})}
    now = now or datetime.now(timezone.utc)

    valid_until = _to_utc(row.get("valid_until"))
    if valid_until is not None and valid_until <= now:
        return 0.0
    if row.get("is_permanent"):
        return 1.0

    importance = int(row["importance"]) if row.get("importance") is not None else 5
    emotional_weight = int(row["emotional_weight"]) if row.get("emotional_weight") is not None else 0
    access_count = int(row["access_count"]) if row.get("access_count") is not None else 0
    if access_count == 0 and emotional_weight <= 2:
        return min(1.0, 0.3 + importance / 10.0 * 0.5)

    imp_factor = importance / 10.0
    emo_factor = emotional_weight / 10.0
    initial_temp = min(1.0, 0.3 + 0.7 * max(imp_factor, emo_factor))

    if importance >= p["importance_line"] or emotional_weight >= p["emotion_line"]:
        base_half_life = p["half_life_important"]
    else:
        base_half_life = p["half_life_normal"]
    half_life = base_half_life * (1.0 + access_count * p["recall_extend"])

    created_at = _to_utc(row.get("created_at"))
    last_accessed = _to_utc(row.get("last_accessed"))
    anchor = created_at
    if last_accessed is not None and access_count > 0 and created_at is not None:
        anchor = max(created_at, last_accessed)

    decay = 0.5
    if anchor is not None:
        # 与 calculate_heat 一致：未来时间戳会产生 age<0 → decay>1，最后再 clamp 到 1
        age_days = (now - anchor).total_seconds() / 86400.0
        decay = math.pow(2, -age_days / max(0.0001, half_life))

    hashes = row.get("access_query_hashes") or []
    if isinstance(hashes, str):
        try:
            hashes = json.loads(hashes)
        except Exception:
            hashes = []
    diversity = len(set(hashes)) if isinstance(hashes, (list, tuple)) else 0
    recall_bonus = min(0.2, access_count * 0.02 + diversity * 0.03)
    return max(0.0, min(1.0, initial_temp * decay + recall_bonus))


def backfill_values(row: Dict, now: Optional[datetime] = None, params: Optional[Dict] = None) -> Dict:
    """一行旧记忆 → P1 初始值（公式见融合文档 §4）。"""
    heat = kiwi_heat(row, params=params, now=now)
    importance = (int(row["importance"]) if row.get("importance") is not None else 5) / 10.0
    t = _to_utc(row.get("last_accessed")) or _to_utc(row.get("created_at")) or (now or datetime.now(timezone.utc))
    return {
        "s_fact": round(heat, 6),
        "s_gist": round(max(heat, 0.3), 6),
        "s_affect": round(max(heat, 0.55 * importance), 6),
        "t_fact": t,
        "t_gist": t,
        "t_affect": t,
        "level": 0,
        "floor_level": brain.floor_level_for_importance(importance, CONFIG),
        "recall_count": int(row["access_count"]) if row.get("access_count") is not None else 0,
    }


async def _load_heat_params(conn) -> Dict:
    params = {**KIWI_HEAT_DEFAULTS}
    # 用 to_regclass 探测，避免在事务里因 gateway_config 缺失触发 UndefinedTable
    # 把整个事务打挂（捕获异常后事务已 aborted，后续语句会 InFailedSQLTransaction）。
    try:
        exists = await conn.fetchval("SELECT to_regclass('public.gateway_config')")
    except Exception:
        exists = None
    if exists is None:
        return params
    rows = await conn.fetch(
        "SELECT key, value FROM public.gateway_config WHERE key LIKE 'heat\\_%'"
    )
    for row in rows:
        key = str(row["key"])[len("heat_"):]
        if key not in params:
            continue
        try:
            value = float(row["value"])
        except (TypeError, ValueError):
            continue
        params[key] = int(value) if key in ("importance_line", "emotion_line") else value
    return params


async def backfill_schema(
    conn,
    schema: str,
    params: Dict,
    batch_size: int = 500,
    now: Optional[datetime] = None,
) -> int:
    """单 schema 惰性回填；返回本次回填行数。"""
    if not await table_exists(conn, schema, "memories"):
        return 0
    q = quote_ident(schema)
    total = 0
    while True:
        rows = await conn.fetch(
            f"""
            SELECT id, importance, emotional_weight, access_count, created_at,
                   last_accessed, is_permanent, valid_until, access_query_hashes
            FROM {q}.memories
            WHERE s_fact IS NULL
            ORDER BY id
            LIMIT $1
            """,
            batch_size,
        )
        if not rows:
            break
        updates = []
        for row in rows:
            values = backfill_values(dict(row), now=now, params=params)
            updates.append(
                (
                    values["s_fact"], values["s_gist"], values["s_affect"],
                    values["t_fact"], values["t_gist"], values["t_affect"],
                    int(values["level"]), int(values["floor_level"]),
                    int(values["recall_count"]), int(row["id"]),
                )
            )
        await conn.executemany(
            f"""
            UPDATE {q}.memories
            SET s_fact=$1, s_gist=$2, s_affect=$3,
                t_fact=$4, t_gist=$5, t_affect=$6,
                level=$7, floor_level=$8, recall_count=$9
            WHERE id=$10
            """,
            updates,
        )
        total += len(updates)
        if len(rows) < batch_size:
            break
    return total


async def backfill(dsn: str, batch_size: int = 500, now: Optional[datetime] = None) -> Dict:
    conn = await asyncpg.connect(dsn)
    try:
        params = await _load_heat_params(conn)
        results = []
        for schema in await list_memory_schemas(conn):
            if not await column_exists(conn, schema, "memories", "s_fact"):
                results.append({"schema": schema, "backfilled": 0, "skipped": "p1 schema missing"})
                continue
            count = await backfill_schema(conn, schema, params, batch_size=batch_size, now=now)
            results.append({"schema": schema, "backfilled": count})
        return {"params": params, "schemas": results}
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# consolidate：关系回归 / 承诺判定 / 压缩阶梯（每 schema 一个事务 + 锁）
# ---------------------------------------------------------------------------

def _ms(dt: Optional[datetime]) -> Optional[float]:
    return None if dt is None else dt.timestamp() * 1000.0


def _dt(ms: Optional[float]) -> Optional[datetime]:
    return None if ms is None else datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def _floor_level_sql(column: str = "importance") -> str:
    # 与 brain.floor_level_for_importance(importance/10) 等价（importance 是整数 1-10）
    return (
        f"CASE WHEN {column} >= 9 THEN 0 "
        f"WHEN {column} >= 7 THEN 1 "
        f"WHEN {column} >= 4 THEN 2 ELSE 3 END"
    )


async def _ensure_floor_levels(conn, schema: str, dry_run: bool) -> int:
    q = quote_ident(schema)
    fixed = await conn.fetchval(
        f"""
        SELECT COUNT(*) FROM {q}.memories
        WHERE floor_level IS NULL
           OR floor_level <> ({_floor_level_sql('importance')})
        """
    )
    if fixed and not dry_run:
        await conn.execute(
            f"""UPDATE {q}.memories
                SET floor_level = ({_floor_level_sql('importance')})
                WHERE floor_level IS NULL
                   OR floor_level <> ({_floor_level_sql('importance')})"""
        )
    return int(fixed or 0)


async def _load_relation_state(conn, schema: str, now_ms: float) -> brain.RelationState:
    q = quote_ident(schema)
    row = await conn.fetchrow(f"SELECT dims, updated_at FROM {q}.relation_state WHERE id = 1")
    if not row:
        return brain.empty_relation_state(CONFIG, now_ms)
    dims = row["dims"]
    if isinstance(dims, str):
        dims = json.loads(dims)
    dims = {dim: float(dims.get(dim, CONFIG["relation"]["dims"][dim])) for dim in RELATION_DIMS}
    return brain.RelationState(dims=dims, updated_at=_ms(row["updated_at"]) or now_ms)


async def _save_relation_state(conn, schema: str, state: brain.RelationState, dry_run: bool) -> None:
    if dry_run:
        return
    q = quote_ident(schema)
    await conn.execute(
        f"""
        INSERT INTO {q}.relation_state (id, dims, updated_at, revision)
        VALUES (1, $1::jsonb, $2, 1)
        ON CONFLICT (id) DO UPDATE
        SET dims = EXCLUDED.dims,
            updated_at = EXCLUDED.updated_at,
            revision = {q}.relation_state.revision + 1
        """,
        json.dumps(state.dims),
        _dt(state.updated_at),
    )


def _record_to_brain(row: Dict, now_ms: float) -> brain.MemoryRecord:
    def channel(name: str) -> brain.ChannelState:
        strength = row.get(f"s_{name}")
        updated = row.get(f"t_{name}")
        return brain.ChannelState(
            strength=float(strength if strength is not None else 0.0),
            updated_at=_ms(updated) or now_ms,
        )

    importance = row.get("importance")
    lock_source = str(row.get("lock_source") or "").strip()
    return brain.MemoryRecord(
        channels={name: channel(name) for name in ("fact", "gist", "affect")},
        importance=float(importance if importance is not None else 5) / 10.0,
        level=int(row.get("level") or 0),
        floor_level=int(row.get("floor_level") if row.get("floor_level") is not None else 3),
        locked=bool(row.get("is_permanent")) or bool(lock_source),
        read_only=False,
        promise_state=str(row.get("promise_state") or "none"),
        due_at=_ms(row.get("due_at")),
        created_at=_ms(row.get("created_at")) or now_ms,
    )


async def _compress_schema(conn, schema: str, now_ms: float, dry_run: bool,
                            max_per_run: Optional[int] = None) -> List[Dict]:
    """压缩候选：SQL 先排除 at-floor / 锁定 / pending 承诺 / 距上次太近，避免 starvation。"""
    q = quote_ident(schema)
    has_lock_source = await column_exists(conn, schema, "memories", "lock_source")
    locked_condition = "is_permanent IS NOT TRUE"
    if has_lock_source:
        locked_condition += " AND COALESCE(lock_source, '') = ''"

    compressed: List[Dict] = []
    last_id = 0
    batch = 300
    while True:
        rows = await conn.fetch(
            f"""
            SELECT id, importance, s_fact, s_gist, s_affect, t_fact, t_gist, t_affect,
                   level, floor_level, is_permanent,
                   {"lock_source," if has_lock_source else ""}
                   promise_state, due_at, created_at, last_compress_at
            FROM {q}.memories
            WHERE id > $1
              AND level < 3
              AND level < floor_level
              AND COALESCE(promise_state, 'none') <> 'pending'
              AND s_fact IS NOT NULL
              AND {locked_condition}
              AND (last_compress_at IS NULL OR last_compress_at < $2)
            ORDER BY id
            LIMIT $3
            """,
            last_id,
            _dt(now_ms) - timedelta(days=1),
            batch,
        )
        if not rows:
            break
        for row in rows:
            last_id = int(row["id"])
            record = _record_to_brain(dict(row), now_ms)
            decision = brain.evaluate_compression(
                record, CONFIG, now_ms, _ms(row["last_compress_at"])
            )
            if not decision["compress"]:
                continue
            if not dry_run:
                await conn.execute(
                    f"""UPDATE {q}.memories
                        SET level=$1, last_compress_at=$2, last_consolidated_at=$2
                        WHERE id=$3""",
                    int(decision["to"]),
                    _dt(now_ms),
                    row["id"],
                )
            compressed.append(
                {
                    "id": int(row["id"]),
                    "from": int(decision["from"]),
                    "to": int(decision["to"]),
                    "reason": decision.get("reason", ""),
                }
            )
        limit = max_per_run or int(os.getenv("MMTR_COMPRESS_MAX_PER_RUN", "2000"))
        if len(compressed) >= limit:
            break
    return compressed


async def consolidate_schema(conn, schema: str, now_ms: float, dry_run: bool = False) -> Dict:
    """单 schema 的每日巩固：事务 + advisory lock，要么全成要么回滚。"""
    summary = {
        "schema": schema,
        "relation": None,
        "compressed": [],
        "promises_broken": 0,
        "promises_surfaced": 0,
        "activations_pruned": 0,
        "backfilled": 0,
        "floor_levels_fixed": 0,
        "dry_run": dry_run,
    }
    # 在事务外读配置：缺表/异常不会毒化事务（复审 C）
    heat_params = await _load_heat_params(conn)
    async with schema_lock(conn, schema, "consolidate"):
        async with conn.transaction():
            q = quote_ident(schema)

            # 0) 增量回填：新记忆（写入时还没有 s_fact）先进入新曲线。
            #    dry-run 只统计待回填数量，绝不写库。
            params = heat_params
            if dry_run:
                summary["backfilled"] = int(
                    await conn.fetchval(
                        f"SELECT COUNT(*) FROM {quote_ident(schema)}.memories WHERE s_fact IS NULL"
                    )
                    or 0
                )
            else:
                summary["backfilled"] = await backfill_schema(
                    conn, schema, params, now=_dt(now_ms)
                )
            # 0.1) importance 被 update_memory/退役锁改过时，地板必须重算
            summary["floor_levels_fixed"] = await _ensure_floor_levels(conn, schema, dry_run)

            # 1) 关系回归（先回归，承诺 delta 再叠加）
            before = await _load_relation_state(conn, schema, now_ms)
            relation = brain.regress_relation(before, CONFIG, now_ms)

            # 2) 承诺：到期宽限期 → broken；临近 → surfaced；只处理仍 pending 的行
            promises = await conn.fetch(
                f"""
                SELECT id, due_at, promise_state FROM {q}.memories
                WHERE promise_state = 'pending' AND due_at IS NOT NULL
                ORDER BY due_at ASC
                """
            )
            broken_delta = {"applied": {}, "total": 0.0}
            for row in promises:
                due = row["due_at"]
                if due is None:
                    continue
                due_ms = _ms(due)
                if brain.should_break_promise(due_ms, "pending", now_ms, CONFIG):
                    if dry_run:
                        updated = 1
                    else:
                        result = await conn.execute(
                            f"""UPDATE {q}.memories
                                SET promise_state='broken', last_consolidated_at=$1
                                WHERE id=$2 AND promise_state='pending'""",
                            _dt(now_ms),
                            row["id"],
                        )
                        updated = int(result.split()[-1]) if result.startswith("UPDATE") else 0
                    if updated:
                        summary["promises_broken"] += 1
                        delta = brain.promise_relation_delta("broken", CONFIG)
                        applied = brain.apply_relation_deltas(relation, delta, CONFIG, now_ms)
                        for dim, change in (applied.get("applied") or {}).items():
                            broken_delta["applied"][dim] = round(
                                broken_delta["applied"].get(dim, 0.0) + change, 4
                            )
                            broken_delta["total"] += abs(change)
                        relation = brain.RelationState(dims=applied["dims"], updated_at=now_ms)
                elif brain.should_surface_promise(due_ms, "pending", now_ms, CONFIG):
                    if not dry_run:
                        await conn.execute(
                            f"""UPDATE {q}.memories
                                SET promise_surfaced_at=COALESCE(promise_surfaced_at, $1),
                                    last_consolidated_at=$1
                                WHERE id=$2 AND promise_state='pending'""",
                            _dt(now_ms),
                            row["id"],
                        )
                    summary["promises_surfaced"] += 1

            await _save_relation_state(conn, schema, relation, dry_run)
            summary["relation"] = {
                "before": before.dims,
                "after": relation.dims,
                "broken_delta": broken_delta,
            }

            # 3) 压缩阶梯（SQL 过滤掉 at-floor/锁定/pending/太近，keyset 翻页防 starvation）
            summary["compressed"] = await _compress_schema(
                conn, schema, now_ms, dry_run,
                max_per_run=int(os.getenv("MMTR_COMPRESS_MAX_PER_RUN", "2000")),
            )

            # 4) 激活历史只保留最近 90 天
            if not dry_run:
                pruned = await conn.execute(
                    f"DELETE FROM {q}.mmtr_activations WHERE activated_at < $1",
                    _dt(now_ms) - timedelta(days=90),
                )
                try:
                    summary["activations_pruned"] = int(pruned.split()[-1])
                except (IndexError, ValueError):
                    summary["activations_pruned"] = 0

            # 5) 审计行（事务内，随回滚消失）
            if not dry_run:
                await conn.execute(
                    f"INSERT INTO {q}.mmtr_consolidate_runs (run_at, summary) VALUES ($1, $2::jsonb)",
                    _dt(now_ms),
                    json.dumps(summary),
                )
    return summary


async def consolidate(dsn: str, now: Optional[datetime] = None, dry_run: bool = False) -> Dict:
    now_ms = _ms(now or datetime.now(timezone.utc))
    conn = await asyncpg.connect(dsn)
    try:
        results = []
        for schema in await list_memory_schemas(conn):
            try:
                # 老租户可能从未发过请求（P1 表还没建）：每日任务先惰性升级，
                # 避免每天刷 UndefinedTable 告警（复审 E）。
                if not await table_exists(conn, schema, "relation_state"):
                    await apply_p1_schema(conn, schema, create_indexes=False)
                results.append(await consolidate_schema(conn, schema, now_ms, dry_run=dry_run))
            except Exception as error:  # noqa: BLE001 - 单租户失败不影响其它租户
                results.append({"schema": schema, "error": f"{type(error).__name__}: {error}"})
        return {"run_at": _dt(now_ms).isoformat(), "dry_run": dry_run, "schemas": results}
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

async def _main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="MMTR × kiwi P1 工具")
    parser.add_argument("action", choices=["migrate", "backfill", "consolidate"])
    parser.add_argument("--dsn", default=os.getenv("DATABASE_URL", ""))
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-concurrent-index", action="store_true")
    args = parser.parse_args(argv)
    if not args.dsn:
        print("缺少 --dsn 或 DATABASE_URL", file=sys.stderr)
        return 2

    if args.action == "migrate":
        result = await migrate(args.dsn, concurrently=not args.no_concurrent_index)
    elif args.action == "backfill":
        result = await backfill(args.dsn, batch_size=args.batch_size)
    else:
        result = await consolidate(args.dsn, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    raise SystemExit(asyncio.run(_main(sys.argv[1:])))

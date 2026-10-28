"""MMTR × kiwi P1 集成测试（真实 PostgreSQL）。

默认连本机开发集群：postgresql://postgres@127.0.0.1:55432/postgres
可用 MMTR_TEST_DSN 覆盖；连不上时打印 SKIP 并退出 0（CI 友好）。

覆盖：
- migrate 幂等：public + 租户 schema 都补列/建表，重复执行不报错
- backfill：旧 heat → s_fact/s_gist/s_affect、floor_level、冷启动与衰减公式
- consolidate：关系回归、承诺 broken/surfaced、压缩阶梯、重复执行幂等

运行：cd _refs/kiwi-mem-dengta && python -m mmtr_brain.test_p1_pg
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
from datetime import datetime, timezone, timedelta

import asyncpg

from . import p1, brain

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE_DSN = os.getenv("MMTR_TEST_DSN", "postgresql://postgres@127.0.0.1:55432/postgres")
TEST_DB = "mmtr_p1_test"
NOW = datetime(2026, 10, 28, 0, 0, 0, tzinfo=timezone.utc)
NOW_MS = NOW.timestamp() * 1000.0

MEMORIES_DDL = """
CREATE TABLE IF NOT EXISTS memories (
    id                  SERIAL PRIMARY KEY,
    content             TEXT NOT NULL,
    title               TEXT DEFAULT '',
    importance          INTEGER DEFAULT 5,
    emotional_weight    INTEGER DEFAULT 0,
    access_count        INTEGER DEFAULT 0,
    source_session      TEXT,
    memory_type         TEXT DEFAULT 'fragment',
    embedding           TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    last_accessed       TIMESTAMPTZ DEFAULT NOW(),
    access_query_hashes JSONB DEFAULT '[]'::jsonb,
    is_permanent        BOOLEAN DEFAULT FALSE,
    valid_until         TIMESTAMPTZ
)
"""

CONFIG_DDL = """
CREATE TABLE IF NOT EXISTS gateway_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
"""


def _dsn(db: str = TEST_DB) -> str:
    base = BASE_DSN.rsplit("/", 1)[0]
    return base + "/" + db


def _db_name(dsn: str) -> str:
    return dsn.rsplit("/", 1)[-1].split("?")[0]


async def _admin(sql: str) -> None:
    conn = await asyncpg.connect(BASE_DSN)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


async def _setup() -> None:
    if _db_name(BASE_DSN) == TEST_DB:
        raise RuntimeError("MMTR_TEST_DSN 不能直接指向测试库（重跑会删掉它）")
    await _admin(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
    await _admin(f'CREATE DATABASE "{TEST_DB}"')
    conn = await asyncpg.connect(_dsn())
    try:
        await conn.execute(MEMORIES_DDL)
        await conn.execute(CONFIG_DDL)
    finally:
        await conn.close()


async def _insert_memory(conn, schema: str, **values) -> int:
    q = p1.quote_ident(schema)
    columns = list(values.keys())
    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    sql = (
        f"INSERT INTO {q}.memories ({', '.join(columns)}) "
        f"VALUES ({placeholders}) RETURNING id"
    )
    return int(await conn.fetchval(sql, *[values[c] for c in columns]))


async def conn_fetch(database, sql: str, *args) -> list:
    pool = await database.get_pool()
    async with pool.acquire() as connection:
        rows = await connection.fetch(sql, *args)
    return [dict(row) for row in rows]


async def _fetch_one(conn, schema: str, sql: str, *args) -> dict:
    q = p1.quote_ident(schema)
    row = await conn.fetchrow(sql.format(q=q), *args)
    return dict(row)


async def run() -> int:
    try:
        probe = await asyncpg.connect(BASE_DSN)
        await probe.close()
    except (OSError, asyncpg.CannotConnectNowError) as error:
        print(f"SKIP: 连不上 PostgreSQL（{type(error).__name__}: {error}）")
        return 0
    # 连上之后任何建库/迁移失败都必须暴露，不能当 SKIP
    await _setup()

    failures = []

    def check(name: str, condition: bool, detail=None):
        if condition:
            print(f"  ✓ {name}")
        else:
            failures.append(name)
            print(f"  ✗ {name} -> {detail}")

    dsn = _dsn()
    conn = await asyncpg.connect(dsn)
    try:
        # 租户 schema 用 kiwi 的方式创建（LIKE public 模板）
        tenant = "t_0123456789abcdef0123"
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{tenant}"')
        await conn.execute(f'CREATE TABLE "{tenant}".memories (LIKE public.memories INCLUDING ALL)')

        # ---------- 1. migrate ----------
        print("\n[1] migrate（public + 租户，幂等）")
        first = await p1.migrate(dsn)
        second = await p1.migrate(dsn)
        check("migrate 返回两个 schema", len(first["schemas"]) == 2, first["schemas"])
        check(
            "第二次 migrate 没有新增列（幂等）",
            sum(item.get("columns", 0) for item in second["schemas"]) == 0,
            second["schemas"],
        )
        columns = await conn.fetch(
            """
            SELECT table_schema, column_name FROM information_schema.columns
            WHERE table_name='memories' AND column_name IN ('s_fact','level','promise_state','due_at')
            """
        )
        check("public + 租户都有 P1 列", len(columns) == 8, len(columns))
        meta = await conn.fetchval("SELECT COUNT(*) FROM public.mmtr_p1_meta")
        check("迁移标记写入两行", int(meta) == 2, meta)

        # ---------- 2. backfill ----------
        print("\n[2] backfill（公式 + 冷启动 + 衰减）")
        cold = await _insert_memory(
            conn, "public", content="冷启动高重要", importance=10,
            access_count=0, emotional_weight=0,
            created_at=NOW - timedelta(days=40), last_accessed=NOW - timedelta(days=40),
        )
        mid = await _insert_memory(
            conn, "public", content="中等重要", importance=5,
            access_count=0, emotional_weight=0,
            created_at=NOW - timedelta(days=40),
        )
        low = await _insert_memory(
            conn, "public", content="低重要", importance=2,
            access_count=0, emotional_weight=0,
            created_at=NOW - timedelta(days=10),
        )
        permanent = await _insert_memory(
            conn, "public", content="锁定记忆", importance=6, is_permanent=True,
        )
        aged = await _insert_memory(
            conn, tenant, content="跨租户衰减", importance=5,
            access_count=3, emotional_weight=0,
            created_at=NOW - timedelta(days=20),
            last_accessed=NOW - timedelta(days=20),
        )

        result = await p1.backfill(dsn, batch_size=2, now=NOW)
        check("backfill 处理 4+1 行", sum(item.get("backfilled", 0) for item in result["schemas"]) == 5, result)

        cold_row = await _fetch_one(
            conn, "public", "SELECT s_fact, s_gist, s_affect, floor_level, level FROM {q}.memories WHERE id=$1", cold
        )
        check("冷启动 heat=0.8（importance=10）", math.isclose(cold_row["s_fact"], 0.8, abs_tol=1e-6), cold_row)
        check("s_gist=max(heat,0.3)", math.isclose(cold_row["s_gist"], 0.8, abs_tol=1e-6), cold_row["s_gist"])
        check("s_affect=max(heat,0.55)", math.isclose(cold_row["s_affect"], 0.8, abs_tol=1e-6), cold_row["s_affect"])
        check("importance=10 → floor_level 0", int(cold_row["floor_level"]) == 0, cold_row["floor_level"])
        check("回填后 level=0", int(cold_row["level"]) == 0, cold_row["level"])

        mid_row = await _fetch_one(conn, "public", "SELECT s_fact, floor_level FROM {q}.memories WHERE id=$1", mid)
        check("importance=5 heat=0.55", math.isclose(mid_row["s_fact"], 0.55, abs_tol=1e-6), mid_row)
        check("importance=5 → floor_level 2", int(mid_row["floor_level"]) == 2, mid_row["floor_level"])

        low_row = await _fetch_one(conn, "public", "SELECT s_fact, floor_level FROM {q}.memories WHERE id=$1", low)
        check("importance=2 heat=0.4", math.isclose(low_row["s_fact"], 0.4, abs_tol=1e-6), low_row)
        check("importance=2 → floor_level 3", int(low_row["floor_level"]) == 3, low_row["floor_level"])

        perm_row = await _fetch_one(conn, "public", "SELECT s_fact FROM {q}.memories WHERE id=$1", permanent)
        check("锁定记忆 heat=1.0", math.isclose(perm_row["s_fact"], 1.0, abs_tol=1e-6), perm_row)

        aged_row = await _fetch_one(conn, tenant, "SELECT s_fact FROM {q}.memories WHERE id=$1", aged)
        expected_aged = 0.65 * math.pow(2, -20 / 7.5) + 0.06
        check("衰减公式（access_count=3, 20 天）", math.isclose(aged_row["s_fact"], expected_aged, abs_tol=1e-4), (aged_row["s_fact"], expected_aged))

        again = await p1.backfill(dsn, now=NOW)
        check("backfill 幂等（第二次 0 行）", sum(item.get("backfilled", 0) for item in again["schemas"]) == 0, again)

        # ---------- 3. consolidate ----------
        print("\n[3] consolidate（关系回归 / 承诺 / 压缩）")
        # 关系：远离基线 42 天 → 向基线回落
        dims = dict(brain.baseline_dims(brain.DEFAULT_CONFIG))
        dims.update({"trust": 0.90, "closeness": 0.80, "tension": 0.50})
        await conn.execute(
            "INSERT INTO public.relation_state (id, dims, updated_at, revision) VALUES (1, $1::jsonb, $2, 1)",
            json.dumps(dims),
            NOW - timedelta(days=42),
        )
        # 承诺：过期 10 天 → broken；2 天后到期 → surfaced
        overdue = await _insert_memory(
            conn, "public", content="答应带伞", due_at=NOW - timedelta(days=10), promise_state="pending",
        )
        upcoming = await _insert_memory(
            conn, "public", content="周五看电影", due_at=NOW + timedelta(days=2), promise_state="pending",
        )
        # 压缩：fact 很弱 + 超过最小间隔 → 0→1；太近 → 不压；锁定 → 不压
        compressible = await _insert_memory(conn, "public", content="琐碎细节", importance=3)
        too_soon = await _insert_memory(conn, "public", content="刚压过", importance=3)
        locked = await _insert_memory(conn, "public", content="锁定不压", importance=3, is_permanent=True)
        for memory_id, level, last in (
            (compressible, 0, None),
            (too_soon, 2, NOW - timedelta(days=3)),
            (locked, 0, None),
        ):
            await conn.execute(
                """
                UPDATE public.memories
                SET s_fact=0.01, s_gist=0.05, s_affect=0.2,
                    t_fact=$2, t_gist=$2, t_affect=$2,
                    level=$3, floor_level=3, last_compress_at=$4
                WHERE id=$1
                """,
                memory_id,
                NOW - timedelta(days=120),
                level,
                last,
            )

        first_run = await p1.consolidate(dsn, now=NOW)
        schema_result = next(item for item in first_run["schemas"] if item["schema"] == "public")
        check("承诺过期 → broken", schema_result["promises_broken"] >= 1, schema_result["promises_broken"])
        check("临近承诺 → surfaced", schema_result["promises_surfaced"] >= 1, schema_result["promises_surfaced"])
        check(
            "压缩触发 0→1",
            any(item["id"] == compressible and item["to"] == 1 for item in schema_result["compressed"]),
            schema_result["compressed"],
        )
        check(
            "距上次太近不压缩",
            all(item["id"] != too_soon for item in schema_result["compressed"]),
            schema_result["compressed"],
        )
        check(
            "锁定记忆不压缩",
            all(item["id"] != locked for item in schema_result["compressed"]),
            schema_result["compressed"],
        )

        relation_row = await _fetch_one(conn, "public", "SELECT dims, updated_at, revision FROM {q}.relation_state WHERE id=1")
        relation = relation_row["dims"] if isinstance(relation_row["dims"], dict) else json.loads(relation_row["dims"])
        expected_trust = 0.30 + (0.90 - 0.30) * math.pow(0.5, 42 / 21)
        check("关系向基线回落（trust）", math.isclose(relation["trust"], expected_trust, abs_tol=0.02), relation)
        check("张力回落更快（tension≈0.10）", 0.09 < relation["tension"] < 0.12, relation["tension"])
        check("关系 revision 递增", int(relation_row["revision"]) >= 2, relation_row["revision"])

        broken_row = await _fetch_one(conn, "public", "SELECT promise_state FROM {q}.memories WHERE id=$1", overdue)
        surfaced_row = await _fetch_one(conn, "public", "SELECT promise_surfaced_at FROM {q}.memories WHERE id=$1", upcoming)
        check("过期承诺状态 broken", broken_row["promise_state"] == "broken", broken_row)
        check("临近承诺已标记 surfaced", surfaced_row["promise_surfaced_at"] is not None, surfaced_row)

        second_run = await p1.consolidate(dsn, now=NOW)
        second_schema = next(item for item in second_run["schemas"] if item["schema"] == "public")
        check("重复 consolidate 不再 broken", second_schema["promises_broken"] == 0, second_schema["promises_broken"])
        check("重复 consolidate 不再压缩", len(second_schema["compressed"]) == 0, second_schema["compressed"])
        surfaced_again = await _fetch_one(conn, "public", "SELECT promise_surfaced_at FROM {q}.memories WHERE id=$1", upcoming)
        check("surfaced 时间戳不被覆盖", surfaced_again["promise_surfaced_at"] == surfaced_row["promise_surfaced_at"], surfaced_again)

        # dry-run 不写库
        before_revision = int((await _fetch_one(conn, "public", "SELECT revision FROM {q}.relation_state WHERE id=1"))["revision"])
        dry = await p1.consolidate(dsn, now=NOW + timedelta(days=1), dry_run=True)
        dry_schema = next(item for item in dry["schemas"] if item["schema"] == "public")
        after_revision = int((await _fetch_one(conn, "public", "SELECT revision FROM {q}.relation_state WHERE id=1"))["revision"])
        check("dry-run 只读（revision 不变）", before_revision == after_revision, (before_revision, after_revision))
        check("dry-run 仍返回压缩计划", isinstance(dry_schema["compressed"], list), dry_schema["compressed"])
    finally:
        await conn.close()

    print("")
    if failures:
        print(f"✗ {len(failures)} 项不通过: {failures}")
        return 1
    print("✓ P1 集成测试全部通过（migrate / backfill / consolidate）")
    return 0


def main() -> int:
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())

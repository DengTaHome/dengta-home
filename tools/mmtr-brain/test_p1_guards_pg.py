"""MMTR × kiwi P1 守卫测试：覆盖评审指出的假通过/边界/并发/大数据路径。

独立于 test_p1_pg.py（那个测主链路），本文件专测：
- MMTR_P1_ENABLED=0 时 init_tables / ensure_tenant_schema 不因缺 P1 表而 503
- 老租户升级（先禁用建租户 → 开启后再 ensure）补 15 列 + 3 表
- 离线 migrate 后 public/租户都有 P1 索引（CONCURRENTLY 路径）
- backfill：gateway_config 覆盖、importance=0、未来时间戳、valid_until、
  锁定记忆的 gist/affect/t、与 database.calculate_heat 的抽样对比产物
- consolidate：pending 承诺不压缩、lock_source 锁定、floor 重算、
  400 条 at-floor 不造成 starvation、并发 kept 不被覆盖、精确 broken delta、
  dry-run 完全不写库、新记忆增量回填、重复执行幂等

运行：cd _refs/kiwi-mem-dengta && python -m mmtr_brain.test_p1_guards_pg
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
GATE_DB = "mmtr_p1_gates_test"
WORK_DB = "mmtr_p1_work_test"
CONCURRENT_DB = "mmtr_p1_concurrent_test"
NOW = datetime(2026, 10, 28, 0, 0, 0, tzinfo=timezone.utc)
NOW_MS = NOW.timestamp() * 1000.0
SAMPLE_PATH = os.path.join(os.path.dirname(__file__), "p1_backfill_sample.json")

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
    lock_source         TEXT,
    valid_until         TIMESTAMPTZ
)
"""

CONFIG_DDL = """
CREATE TABLE IF NOT EXISTS gateway_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)
"""


def _db_name(dsn: str) -> str:
    return dsn.rsplit("/", 1)[-1].split("?")[0]


def _with_db(dsn: str, db: str) -> str:
    return dsn.rsplit("/", 1)[0] + "/" + db


async def _admin(sql: str) -> None:
    conn = await asyncpg.connect(BASE_DSN)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


async def _recreate(db: str) -> str:
    if _db_name(BASE_DSN) == db:
        raise RuntimeError(f"MMTR_TEST_DSN 不能直接指向测试库 {db}")
    await _admin(f'DROP DATABASE IF EXISTS "{db}" WITH (FORCE)')
    await _admin(f'CREATE DATABASE "{db}"')
    dsn = _with_db(BASE_DSN, db)
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(MEMORIES_DDL)
        await conn.execute(CONFIG_DDL)
    finally:
        await conn.close()
    return dsn


async def _insert(conn, schema: str, **values) -> int:
    q = p1.quote_ident(schema)
    columns = list(values.keys())
    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    return int(
        await conn.fetchval(
            f"INSERT INTO {q}.memories ({', '.join(columns)}) VALUES ({placeholders}) RETURNING id",
            *[values[c] for c in columns],
        )
    )


async def _one(conn, schema: str, sql: str, *args) -> dict:
    q = p1.quote_ident(schema)
    row = await conn.fetchrow(sql.format(q=q), *args)
    return dict(row) if row else {}


async def _fetch(database, sql: str, *args) -> list:
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
    return [dict(row) for row in rows]


class Checks:
    def __init__(self):
        self.failures = []

    def check(self, name, condition, detail=None):
        if condition:
            print(f"  ✓ {name}")
        else:
            self.failures.append(name)
            print(f"  ✗ {name} -> {detail}")

    def close(self) -> int:
        print("")
        if self.failures:
            print(f"✗ {len(self.failures)} 项不通过: {self.failures}")
            return 1
        print("✓ P1 守卫测试全部通过")
        return 0


async def section_gating(checks: Checks) -> None:
    print("\n[1] MMTR_P1_ENABLED=0 冷启动 + 老租户升级")
    dsn = await _recreate(GATE_DB)
    os.environ["MMTR_P1_ENABLED"] = "0"
    import database

    await database.close_pool()
    database.DATABASE_URL = dsn
    try:
        await database.init_tables()
        tenant = await database.ensure_tenant_schema("gates:tenant")
        public_tables = await _fetch(
            database,
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('relation_state','mmtr_activations','mmtr_consolidate_runs')",
        )
        tenant_cols = await _fetch(
            database,
            "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='memories' AND column_name LIKE 's\\_%'",
            tenant,
        )
        checks.check("禁用时 init_tables 不建 P1 表", public_tables == [], public_tables)
        checks.check("禁用时 ensure_tenant_schema 不抛异常", bool(tenant), tenant)
        checks.check("禁用时租户无 P1 列", tenant_cols == [], tenant_cols)

        # 复审 A：禁用时 update_memory 不能引用不存在的 floor_level 列
        direct = await asyncpg.connect(dsn)
        try:
            memory_id = await direct.fetchval(
                f'INSERT INTO "{tenant}".memories (content, importance) VALUES ($1, $2) RETURNING id',
                "禁用路径更新", 5,
            )
        finally:
            await direct.close()
        token = database.set_tenant_schema(tenant)
        try:
            disabled_update = await database.update_memory(memory_id, importance=9)
        except Exception as error:  # noqa: BLE001
            disabled_update = f"{type(error).__name__}: {error}"
        finally:
            database.reset_tenant_schema(token)
        checks.check("禁用时 update_memory 不因缺列失败", disabled_update is True, disabled_update)
    except Exception as error:  # noqa: BLE001
        checks.check("禁用路径不应抛异常", False, f"{type(error).__name__}: {error}")
        return
    finally:
        await database.close_pool()

    os.environ["MMTR_P1_ENABLED"] = "1"
    try:
        await database.init_tables()
        public_tables = await _fetch(
            database,
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='relation_state'",
        )
        tenant = await database.ensure_tenant_schema("gates:tenant")
        upgraded_cols = await _fetch(
            database,
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema=$1 AND table_name='memories'
              AND column_name IN ('s_fact','s_gist','s_affect','t_fact','t_gist','t_affect','level',
                                  'floor_level','promise_state','due_at','theme_key','recall_count',
                                  'last_compress_at','promise_surfaced_at','last_consolidated_at')
            """,
            tenant,
        )
        upgraded_tables = await _fetch(
            database,
            "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name = ANY($2::text[])",
            tenant,
            ["relation_state", "mmtr_activations", "mmtr_consolidate_runs"],
        )
        checks.check("开启后 init_tables 补 public P1 表", len(public_tables) == 1, public_tables)
        checks.check("老租户升级补齐 15 列", len(upgraded_cols) == 15, len(upgraded_cols))
        checks.check("老租户升级补齐 3 张表", len(upgraded_tables) == 3, upgraded_tables)

        direct = await asyncpg.connect(dsn)
        try:
            upgraded_memory = await direct.fetchval(
                f'INSERT INTO "{tenant}".memories (content, importance) VALUES ($1, $2) RETURNING id',
                "开启路径更新", 5,
            )
        finally:
            await direct.close()
        token = database.set_tenant_schema(tenant)
        try:
            enabled_update = await database.update_memory(upgraded_memory, importance=10)
        finally:
            database.reset_tenant_schema(token)
        direct = await asyncpg.connect(dsn)
        try:
            floor_row = await direct.fetchrow(
                f'SELECT floor_level FROM "{tenant}".memories WHERE id=$1', upgraded_memory
            )
        finally:
            await direct.close()
        checks.check("开启后 update_memory 同步 floor_level",
                     enabled_update is True and int(floor_row["floor_level"]) == 0,
                     (enabled_update, dict(floor_row) if floor_row else None))

        # 离线 migrate 建索引（启动钩子不建索引，避免大表锁写）
        await p1.migrate(dsn)
        expected_indexes = {"idx_memories_p1_promise", "idx_memories_p1_level", "idx_mmtr_activations_memory"}
        index_rows = await _fetch(
            database,
            """
            SELECT n.nspname AS schema_name, c.relname AS index_name, i.indisvalid
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', $1)
              AND c.relname = ANY($2::text[])
            """,
            tenant,
            sorted(expected_indexes),
        )
        for schema_name in ("public", tenant):
            names = {row["index_name"] for row in index_rows if row["schema_name"] == schema_name}
            checks.check(f"{schema_name} 的 P1 索引集合精确匹配", names == expected_indexes, names)
        checks.check("所有 P1 索引 indisvalid=true",
                     all(row["indisvalid"] for row in index_rows), index_rows)
    finally:
        await database.close_pool()
        os.environ["MMTR_P1_ENABLED"] = "1"


async def section_backfill(checks: Checks, dsn: str) -> None:
    print("\n[2] backfill 边界 + 与旧 calculate_heat 抽样对比")
    await p1.migrate(dsn)
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            "INSERT INTO public.gateway_config (key, value) VALUES ('heat_half_life_normal','30') "
            "ON CONFLICT (key) DO UPDATE SET value='30'"
        )
        aged = await _insert(
            conn, "public", content="配置覆盖", importance=5, access_count=3,
            created_at=NOW - timedelta(days=20), last_accessed=NOW - timedelta(days=20),
        )
        zero = await _insert(conn, "public", content="importance=0", importance=0)
        future = await _insert(
            conn, "public", content="未来", importance=5, access_count=2,
            created_at=NOW + timedelta(days=10), last_accessed=NOW + timedelta(days=10),
        )
        expired = await _insert(conn, "public", content="失效", importance=5, valid_until=NOW - timedelta(days=1))
        permanent = await _insert(conn, "public", content="锁定", importance=10, is_permanent=True)

        result = await p1.backfill(dsn, now=NOW)
        checks.check("backfill 读取 gateway_config", result["params"]["half_life_normal"] == 30.0, result["params"])

        row = {
            "importance": 5, "emotional_weight": 0, "access_count": 3,
            "created_at": NOW - timedelta(days=20), "last_accessed": NOW - timedelta(days=20),
            "is_permanent": False, "valid_until": None, "access_query_hashes": [],
        }
        import database as db_module

        # calculate_heat 内部用 datetime.now()，对比时要把样例时间戳锚定到真实 now
        real_now = datetime.now(timezone.utc)
        compare_row = {**row,
                       "created_at": real_now - timedelta(days=20),
                       "last_accessed": real_now - timedelta(days=20)}
        old_heat = db_module.calculate_heat(
            compare_row,
            {"half_life_normal": 30.0, "half_life_important": 7.0, "recall_extend": 0.5,
             "threshold_high": 0.7, "threshold_medium": 0.3, "importance_line": 8, "emotion_line": 6},
        )
        new_heat = p1.kiwi_heat(compare_row, params={**p1.KIWI_HEAT_DEFAULTS, "half_life_normal": 30.0}, now=real_now)
        stored = await _one(conn, "public", "SELECT s_fact FROM {q}.memories WHERE id=$1", aged)
        checks.check("配置覆盖后与 calculate_heat 一致",
                     abs(old_heat - new_heat) < 1e-6 and abs(stored["s_fact"] - old_heat) < 1e-6,
                     (old_heat, new_heat, stored["s_fact"]))

        zero_row = await _one(conn, "public", "SELECT s_fact, floor_level FROM {q}.memories WHERE id=$1", zero)
        checks.check("importance=0 保持 0（不再 or 5）", math.isclose(zero_row["s_fact"], 0.3, abs_tol=1e-6), zero_row)
        checks.check("importance=0 → floor 3", int(zero_row["floor_level"]) == 3, zero_row)

        future_row = await _one(conn, "public", "SELECT s_fact FROM {q}.memories WHERE id=$1", future)
        # 与 p1.kiwi_heat 在同一 now + 同一 gateway_config 覆盖下精确比较
        expected_future = p1.kiwi_heat(
            {"importance": 5, "emotional_weight": 0, "access_count": 2,
             "created_at": NOW + timedelta(days=10), "last_accessed": NOW + timedelta(days=10),
             "is_permanent": False, "valid_until": None, "access_query_hashes": []},
            params={**p1.KIWI_HEAT_DEFAULTS, "half_life_normal": 30.0},
            now=NOW,
        )
        checks.check("未来时间戳与 kiwi_heat 精确一致",
                     abs(future_row["s_fact"] - expected_future) < 1e-6,
                     (future_row["s_fact"], expected_future))

        expired_row = await _one(conn, "public", "SELECT s_fact FROM {q}.memories WHERE id=$1", expired)
        checks.check("valid_until 失效 → 0", expired_row["s_fact"] == 0.0, expired_row)

        perm_row = await _one(conn, "public", "SELECT s_fact, s_gist, s_affect, t_affect FROM {q}.memories WHERE id=$1", permanent)
        checks.check("锁定记忆 gist/affect/t 均正确",
                     math.isclose(perm_row["s_gist"], 1.0) and math.isclose(perm_row["s_affect"], 1.0)
                     and perm_row["t_affect"] is not None, perm_row)

        # 抽样产物（旧 heat vs 新三通道权重）
        samples = []
        for label, sample in (
            ("cold-importance-10", {"importance": 10, "emotional_weight": 0, "access_count": 0,
                                     "created_at": NOW - timedelta(days=40), "last_accessed": NOW - timedelta(days=40)}),
            ("decayed-3recalls", {"importance": 5, "emotional_weight": 0, "access_count": 3,
                                   "created_at": NOW - timedelta(days=20), "last_accessed": NOW - timedelta(days=20)}),
            ("emotional-high", {"importance": 7, "emotional_weight": 9, "access_count": 1,
                                "created_at": NOW - timedelta(days=60), "last_accessed": NOW - timedelta(days=60)}),
            ("locked", {"importance": 10, "emotional_weight": 0, "access_count": 0,
                        "created_at": NOW - timedelta(days=100), "last_accessed": NOW - timedelta(days=100),
                        "is_permanent": True}),
        ):
            sample_row = {**sample, "is_permanent": sample.get("is_permanent", False),
                          "valid_until": None, "access_query_hashes": []}
            values = p1.backfill_values(sample_row, now=NOW, params={**p1.KIWI_HEAT_DEFAULTS})
            record = brain.MemoryRecord(
                channels={name: brain.ChannelState(strength=values[f"s_{name}"], updated_at=NOW_MS)
                          for name in ("fact", "gist", "affect")},
                importance=sample_row["importance"] / 10.0,
                level=0, floor_level=values["floor_level"], locked=bool(sample_row["is_permanent"]),
                promise_state="none", due_at=None, created_at=NOW_MS,
            )
            weights = brain.compute_weights(record, brain.DEFAULT_CONFIG, NOW_MS)
            samples.append({
                "label": label,
                "old_heat": round(p1.kiwi_heat(sample_row, now=NOW), 6),
                "s_strength": {name: round(values[f"s_{name}"], 6) for name in ("fact", "gist", "affect")},
                "new_weights": {name: round(weights[name], 6) for name in weights},
                "floor_level": values["floor_level"],
            })
        with open(SAMPLE_PATH, "w", encoding="utf-8") as handle:
            json.dump({"generated_at": NOW.isoformat(), "samples": samples}, handle, ensure_ascii=False, indent=2)
        checks.check("抽样产物写入", os.path.exists(SAMPLE_PATH), SAMPLE_PATH)
    finally:
        await conn.close()


async def section_consolidate(checks: Checks, dsn: str) -> None:
    print("\n[3] consolidate 守卫（并发/饥饿/dry-run/精确 delta）")
    conn = await asyncpg.connect(dsn)
    try:
        dims = dict(brain.baseline_dims(brain.DEFAULT_CONFIG))
        dims.update({"trust": 0.90, "closeness": 0.80, "tension": 0.50})
        await conn.execute(
            "INSERT INTO public.relation_state (id, dims, updated_at, revision) VALUES (1, $1::jsonb, $2, 1) "
            "ON CONFLICT (id) DO UPDATE SET dims=EXCLUDED.dims, updated_at=EXCLUDED.updated_at, revision=1",
            json.dumps(dims), NOW - timedelta(days=42),
        )
        overdue = await _insert(conn, "public", content="过期承诺", due_at=NOW - timedelta(days=10), promise_state="pending")
        kept_race = await _insert(conn, "public", content="并发 kept", due_at=NOW - timedelta(days=10), promise_state="pending")
        upcoming = await _insert(conn, "public", content="临近", due_at=NOW + timedelta(days=2), promise_state="pending")
        pending_weak = await _insert(conn, "public", content="pending 不压缩", importance=3,
                                     due_at=NOW + timedelta(days=2), promise_state="pending")
        weak_fact = await _insert(conn, "public", content="可压缩", importance=3)
        locked_manual = await _insert(conn, "public", content="lock_source", importance=3, lock_source="manual")
        high = await _insert(conn, "public", content="高重要", importance=10)
        new_memory = await _insert(conn, "public", content="新记忆", importance=5)

        weak = NOW - timedelta(days=120)
        await conn.execute(
            "UPDATE public.memories SET s_fact=0.01, s_gist=0.05, s_affect=0.2, "
            "t_fact=$1, t_gist=$1, t_affect=$1, level=0, floor_level=3 WHERE id = ANY($2::int[])",
            weak, [pending_weak, weak_fact, locked_manual, high],
        )
        await conn.execute("UPDATE public.memories SET promise_state='kept' WHERE id=$1", kept_race)

        first = await p1.consolidate(dsn, now=NOW)
        public = next(item for item in first["schemas"] if item["schema"] == "public")
        checks.check("broken 承诺处理", public["promises_broken"] >= 1, public["promises_broken"])
        checks.check("surfaced 承诺处理", public["promises_surfaced"] >= 1, public["promises_surfaced"])
        checks.check("新记忆增量回填", public["backfilled"] >= 1, public["backfilled"])
        checks.check("pending 承诺不压缩", all(item["id"] != pending_weak for item in public["compressed"]), public["compressed"])
        checks.check("lock_source 不压缩", all(item["id"] != locked_manual for item in public["compressed"]), public["compressed"])
        checks.check("at-floor 不压缩", all(item["id"] != high for item in public["compressed"]), public["compressed"])

        kept_row = await _one(conn, "public", "SELECT promise_state FROM {q}.memories WHERE id=$1", kept_race)
        checks.check("并发 kept 不被覆盖", kept_row["promise_state"] == "kept", kept_row)

        relation_row = await _one(conn, "public", "SELECT dims, revision FROM {q}.relation_state WHERE id=1")
        relation = relation_row["dims"] if isinstance(relation_row["dims"], dict) else json.loads(relation_row["dims"])
        regressed = brain.regress_relation(
            brain.RelationState(dims=dims, updated_at=(NOW - timedelta(days=42)).timestamp() * 1000.0),
            brain.DEFAULT_CONFIG, NOW_MS,
        )
        applied = brain.apply_relation_deltas(
            regressed, brain.promise_relation_delta("broken", brain.DEFAULT_CONFIG), brain.DEFAULT_CONFIG, NOW_MS
        )
        checks.check("精确 broken delta（trust/tension）",
                     math.isclose(relation["trust"], applied["dims"]["trust"], abs_tol=1e-6) and
                     math.isclose(relation["tension"], applied["dims"]["tension"], abs_tol=1e-6),
                     {"stored": relation, "expected": applied["dims"]})
        checks.check("summary 记录最终关系",
                     math.isclose(public["relation"]["after"]["trust"], relation["trust"], abs_tol=1e-6),
                     public["relation"])

        high_floor = await _one(conn, "public", "SELECT floor_level FROM {q}.memories WHERE id=$1", high)
        checks.check("floor_level 每日重算", int(high_floor["floor_level"]) == 0, high_floor)

        # starvation：400 条"fact 仍亮"的候选挡住后面可压缩行。
        # 它们必须通过 SQL 预过滤（level<floor_level、未锁定、无 pending、last_compress 为空），
        # 但 Python 的 fact-alive 判定会拒绝压缩；旧实现用 LIMIT 300 时目标行会被饿死。
        await conn.execute(
            """
            INSERT INTO public.memories (content, importance, s_fact, s_gist, s_affect,
                                         t_fact, t_gist, t_affect, level, floor_level)
            SELECT 'fact-alive-blocker-' || g, 5, 1.0, 0.2, 0.2, $1, $1, $1, 0, 3
            FROM generate_series(1, 400) AS g
            """, NOW,
        )
        late = await _insert(conn, "public", content="400 条之后", importance=3)
        await conn.execute(
            "UPDATE public.memories SET s_fact=0.01, s_gist=0.05, s_affect=0.2, "
            "t_fact=$1, t_gist=$1, t_affect=$1, level=0, floor_level=3 WHERE id=$2", weak, late,
        )
        second = await p1.consolidate(dsn, now=NOW)
        second_public = next(item for item in second["schemas"] if item["schema"] == "public")
        checks.check("400 条 fact-alive 候选不饿死后续压缩",
                     any(item["id"] == late for item in second_public["compressed"]), second_public["compressed"][:3])
        checks.check("重复 consolidate 不重复 broken", second_public["promises_broken"] == 0, second_public["promises_broken"])

        # dry-run：新候选 + 新过期承诺
        dry_row = await _insert(conn, "public", content="dry 候选", importance=3)
        await conn.execute(
            "UPDATE public.memories SET s_fact=0.01, s_gist=0.05, s_affect=0.2, "
            "t_fact=$1, t_gist=$1, t_affect=$1, level=0, floor_level=3 WHERE id=$2", weak, dry_row,
        )
        dry_promise = await _insert(conn, "public", content="dry 承诺", due_at=NOW - timedelta(days=10), promise_state="pending")
        runs_before = await conn.fetchval("SELECT COUNT(*) FROM public.mmtr_consolidate_runs")
        snap_level = (await _one(conn, "public", "SELECT level, last_compress_at FROM {q}.memories WHERE id=$1", dry_row))
        snap_promise = (await _one(conn, "public", "SELECT promise_state FROM {q}.memories WHERE id=$1", dry_promise))
        snap_relation = await _one(conn, "public", "SELECT dims, revision FROM {q}.relation_state WHERE id=1")

        dry = await p1.consolidate(dsn, now=NOW + timedelta(days=1), dry_run=True)
        dry_public = next(item for item in dry["schemas"] if item["schema"] == "public")
        after_level = await _one(conn, "public", "SELECT level, last_compress_at FROM {q}.memories WHERE id=$1", dry_row)
        after_promise = await _one(conn, "public", "SELECT promise_state FROM {q}.memories WHERE id=$1", dry_promise)
        after_relation = await _one(conn, "public", "SELECT dims, revision FROM {q}.relation_state WHERE id=1")
        runs_after = await conn.fetchval("SELECT COUNT(*) FROM public.mmtr_consolidate_runs")

        checks.check("dry-run 报告压缩计划", any(item["id"] == dry_row for item in dry_public["compressed"]), dry_public["compressed"][:3])
        checks.check("dry-run 不写 memories", snap_level == after_level, (snap_level, after_level))
        checks.check("dry-run 不写 promise", snap_promise == after_promise, (snap_promise, after_promise))
        checks.check("dry-run 不写 relation", snap_relation == after_relation, (snap_relation, after_relation))
        checks.check("dry-run 不写审计", runs_before == runs_after, (runs_before, runs_after))

        # 真并发：两个独立连接同时 consolidate，同一承诺只能 broken 一次。
        # 先把遗留 pending 标成 kept，保证本轮只有 race_promise 会 broken。
        race_promise = await _insert(
            conn, "public", content="并发承诺", due_at=NOW - timedelta(days=5), promise_state="pending"
        )
        await conn.execute(
            "UPDATE public.memories SET promise_state='kept' WHERE promise_state='pending' AND id<>$1",
            race_promise,
        )
        before_race = await _one(conn, "public", "SELECT dims, updated_at, revision FROM {q}.relation_state WHERE id=1")
        before_dims = before_race["dims"] if isinstance(before_race["dims"], dict) else json.loads(before_race["dims"])
        race_now = NOW + timedelta(days=3)
        race_now_ms = race_now.timestamp() * 1000.0
        race_results = await asyncio.gather(
            p1.consolidate(dsn, now=race_now),
            p1.consolidate(dsn, now=race_now),
        )
        broken_sum = sum(
            item.get("promises_broken", 0)
            for result in race_results
            for item in result["schemas"]
            if item["schema"] == "public"
        )
        checks.check("并发 consolidate 只 broken 一次", broken_sum == 1, broken_sum)

        race_row = await _one(conn, "public", "SELECT dims FROM {q}.relation_state WHERE id=1")
        race_dims = race_row["dims"] if isinstance(race_row["dims"], dict) else json.loads(race_row["dims"])
        regressed_race = brain.regress_relation(
            brain.RelationState(dims={dim: float(before_dims[dim]) for dim in brain.RELATION_DIMS},
                                updated_at=before_race["updated_at"].timestamp() * 1000.0),
            brain.DEFAULT_CONFIG, race_now_ms,
        )
        expected_race = brain.apply_relation_deltas(
            regressed_race, brain.promise_relation_delta("broken", brain.DEFAULT_CONFIG),
            brain.DEFAULT_CONFIG, race_now_ms,
        )["dims"]
        checks.check("并发 confirm 只施加一次关系 delta",
                     math.isclose(race_dims["trust"], expected_race["trust"], abs_tol=1e-6) and
                     math.isclose(race_dims["tension"], expected_race["tension"], abs_tol=1e-6),
                     {"stored": race_dims, "expected": expected_race})
    finally:
        await conn.close()


async def section_concurrent_migrate(checks: Checks) -> None:
    print("\n[4] 真并发 migrate（两个 OS 进程 + 空库 meta 竞态）")
    dsn = await _recreate(CONCURRENT_DB)
    fork_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = {**os.environ, "PYTHONUTF8": "1", "MMTR_P1_ENABLED": "1"}
    processes = [
        await asyncio.create_subprocess_exec(
            sys.executable, "-m", "mmtr_brain.p1", "migrate", "--dsn", dsn,
            cwd=fork_root, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        for _ in range(2)
    ]
    outputs = await asyncio.gather(*(proc.communicate() for proc in processes))
    codes = [proc.returncode for proc in processes]
    checks.check("两个并发 migrate 都成功（deadlock 已修）", codes == [0, 0],
                 [(code, out[-300:], err[-300:]) for code, (out, err) in zip(codes, outputs)])

    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            """
            SELECT c.relname, i.indisvalid FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='public' AND c.relname LIKE 'idx_memories_p1%' OR c.relname='idx_mmtr_activations_memory'
            """
        )
        checks.check("并发 migrate 后索引全部 valid",
                     len(rows) == 3 and all(row["indisvalid"] for row in rows),
                     [dict(row) for row in rows])
        meta = await conn.fetchval("SELECT COUNT(*) FROM public.mmtr_p1_meta")
        checks.check("meta 表竞争后仍只有一行", int(meta) == 1, meta)
    finally:
        await conn.close()


async def run() -> int:
    try:
        probe = await asyncpg.connect(BASE_DSN)
        await probe.close()
    except (OSError, asyncpg.CannotConnectNowError) as error:
        print(f"SKIP: 连不上 PostgreSQL（{type(error).__name__}: {error}）")
        return 0

    checks = Checks()
    await section_gating(checks)
    work_dsn = await _recreate(WORK_DB)
    await section_backfill(checks, work_dsn)
    await section_consolidate(checks, work_dsn)
    await section_concurrent_migrate(checks)
    return checks.close()


def main() -> int:
    return asyncio.run(run())


if __name__ == "__main__":
    sys.exit(main())

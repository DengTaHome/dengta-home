-- kiwi-mem P1 部署后验证 SQL（只读）
-- 用法：在服务器上
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < verify-p1.sql

\pset pager off
SELECT version();

-- 1) 每个 schema（public + 租户）是否补齐 15 个 P1 列
SELECT table_schema, count(*) AS p1_columns
FROM information_schema.columns
WHERE table_name = 'memories'
  AND column_name IN (
      's_fact','s_gist','s_affect','t_fact','t_gist','t_affect',
      'level','floor_level','promise_state','due_at','theme_key',
      'recall_count','last_compress_at','promise_surfaced_at','last_consolidated_at'
  )
GROUP BY table_schema
ORDER BY table_schema;

-- 2) 脑层表是否创建（public 模板 + 每个租户）
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name IN ('relation_state','mmtr_activations','mmtr_consolidate_runs','mmtr_p1_meta')
ORDER BY table_schema, table_name;

-- 3) P1 索引是否有效
SELECT n.nspname AS schema_name, c.relname AS index_name, i.indisvalid
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN ('idx_memories_p1_promise','idx_memories_p1_level','idx_mmtr_activations_memory')
ORDER BY 1, 2;

-- 4) 回填覆盖情况
SELECT count(*) AS total_memories,
       count(*) FILTER (WHERE s_fact IS NOT NULL) AS backfilled,
       count(*) FILTER (WHERE s_fact IS NULL) AS remaining
FROM public.memories;

-- 5) 关系状态（每个租户单行；首次 consolidate 前可能为空）
SELECT table_schema FROM information_schema.tables
WHERE table_name = 'relation_state' ORDER BY 1;

-- 6) 最近一次 consolidate 审计
DO $$
DECLARE
    schema_name text;
BEGIN
    FOR schema_name IN
        SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'mmtr_consolidate_runs' ORDER BY 1
    LOOP
        EXECUTE format(
            'SELECT %L AS schema, run_at, summary FROM %I.mmtr_consolidate_runs ORDER BY id DESC LIMIT 1',
            schema_name, schema_name
        );
    END LOOP;
END $$;

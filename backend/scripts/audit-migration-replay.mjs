// 迁移可重放性审计：把 backend/supabase 下全部 NNN_*.sql 按序灌进一个全新的
// pglite 数据库，验证「从零建库」这条路径真的走得通。
//
// 为什么需要它：test/multitenant-pglite.test.mjs 只应用前 12 个迁移
// (migrationNames.slice(0, 12))，013-061 从未在自动化里真正建过库。
// 新环境部署、灾后重建、迁移冲突都发生在这一段没人验证的区间里。
//
// 用法：
//   node scripts/audit-migration-replay.mjs
//   node scripts/audit-migration-replay.mjs --json out.json
//
// 退出码：全部成功 0；有失败 1。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");
const migrationDir = path.join(backendRoot, "supabase");

const jsonFlagIndex = process.argv.indexOf("--json");
const jsonOut = jsonFlagIndex > -1 ? process.argv[jsonFlagIndex + 1] : null;

const names = (await fs.readdir(migrationDir))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();

// 同一编号出现两次时，只有靠文件名字典序决定先后。这在干净库上可能侥幸成立，
// 但在已有数据的库上升级时，顺序就变成了不可控变量，值得显式报告。
const byPrefix = new Map();
for (const name of names) {
    const prefix = name.slice(0, 3);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
}
const duplicatePrefixes = [...byPrefix.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([prefix, files]) => ({ prefix, files }));

const db = new PGlite();

// pglite 不是 Supabase，但迁移里依赖的只有这几个对象：角色、auth schema 与
// auth.uid()、storage 的两张表。补齐它们，迁移本身就能按原样执行。
await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create schema storage;

    create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table storage.buckets (
        id text primary key,
        name text not null,
        public boolean not null default false,
        file_size_limit bigint,
        allowed_mime_types text[]
    );
    create table storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id),
        name text
    );
`);

const results = [];
for (const name of names) {
    const sql = await fs.readFile(path.join(migrationDir, name), "utf8");
    try {
        await db.exec(sql);
        results.push({ file: name, ok: true });
    } catch (error) {
        results.push({
            file: name,
            ok: false,
            error: String(error?.message || error).split("\n").slice(0, 3).join(" / ")
        });
    }
}

const failed = results.filter((result) => !result.ok);

const tableCounts = await db.query(`
    select table_schema, count(*)::int as count
    from information_schema.tables
    where table_schema in ('public', 'auth', 'storage')
    group by table_schema
    order by table_schema
`);

const report = {
    generatedAt: new Date().toISOString(),
    totalMigrations: names.length,
    applied: names.length - failed.length,
    failed: failed.length,
    duplicatePrefixes,
    failures: failed,
    tablesBySchema: tableCounts.rows
};

console.log(`迁移文件: ${report.totalMigrations}`);
console.log(`应用成功: ${report.applied}`);
console.log(`失败: ${report.failed}`);
if (duplicatePrefixes.length) {
    console.log(
        "重复编号: " +
            duplicatePrefixes.map(({ prefix, files }) => `${prefix} => ${files.join(" | ")}`).join("; ")
    );
}
for (const failure of failed) console.log(`  FAIL ${failure.file}: ${failure.error}`);
console.log("表数量:", JSON.stringify(tableCounts.rows.map((row) => `${row.table_schema}=${row.count}`)));

if (jsonOut) {
    await fs.writeFile(path.resolve(jsonOut), JSON.stringify(report, null, 2), "utf8");
    console.log("报告:", path.resolve(jsonOut));
}

await db.close();
process.exit(failed.length === 0 ? 0 : 1);

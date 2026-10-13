import assert from "node:assert/strict";
import { after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { writeFile } from "node:fs/promises";
import creative from "../services/companion-creative.js";

const { createCompanionCreativeCenter, encryptScopedSecret } = creative;
const owner = { userId: "11111111-1111-4111-8111-111111111111", companionId: "22222222-2222-4222-8222-222222222222" };
const artworkId = "33333333-3333-4333-8333-333333333333", providerId = "44444444-4444-4444-8444-444444444444";
const sourceJobId = "55555555-5555-4555-8555-555555555555";
const env = { MCP_ENCRYPTION_KEY: "fictional-concurrency-test-encryption-key" };
const db = new PGlite();
await db.exec(`
create table companion_creative_settings (id text primary key, user_id uuid, companion_id uuid, generation_mode text, daily_call_limit integer, monthly_call_limit integer);
create table image_provider_profiles (id uuid primary key, user_id uuid, companion_id uuid, base_url text, auth_type text, model text, enabled boolean, last_status text, last_error_code text, last_checked_at text, updated_at text);
create table companion_artworks (id uuid primary key, user_id uuid, companion_id uuid, source_job_id uuid, kind text, visibility text, state text, title text, prompt_ciphertext text, description_ciphertext text, generation_reason_ciphertext text, alt_text text, model text, provider_profile_id uuid, actual_call_count integer not null default 0, failure_code text, storage_path text, storage_bucket text, mime_type text, byte_size integer, revealed_at text, created_at text, updated_at text, deleted_at text);
create table image_generation_calls (id bigint generated always as identity primary key, user_id uuid, companion_id uuid, artwork_id uuid, provider_profile_id uuid, attempt integer, status text, model text, started_at text, completed_at text, error_code text, unique(artwork_id,attempt));
`);
const sqlTraces = [];
after(async () => {
  if (process.env.DENGTA_CREATIVE_QUERY_PROOF) await writeFile(process.env.DENGTA_CREATIVE_QUERY_PROOF, JSON.stringify({ fixtureOnly: true, engine: "PGlite PostgreSQL", includesParameters: false, queries: sqlTraces }, null, 2));
  await db.close();
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const imageResponse = () => new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200, headers: { "Content-Type": "application/json" } });
const failResponse = () => new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
const settled = promise => promise.then(value => ({ value }), error => ({ error }));
const tables = new Set(["companion_creative_settings", "image_provider_profiles", "companion_artworks", "image_generation_calls"]);
const ident = value => { assert.match(value, /^[a-z_]+$/); return '"' + value + '"'; };

async function fixture(artwork = {}) {
  await db.exec("truncate companion_creative_settings,image_provider_profiles,companion_artworks,image_generation_calls restart identity");
  let date = new Date("2026-10-10T01:00:00Z");
  const queries = [], waits = [], uploads = [], removed = [], stored = new Set(); let fail = false, pause = true, readBarrier = null, reads = 0, failLedger = false, onUpload, completionError = null, failFailureUpdate = false;
  const database = { from(table) {
    assert.ok(tables.has(table)); let mode = "unset", values, fields = "*", single = false, filters = [["user_id", "=", owner.userId], ["companion_id", "=", owner.companionId]], limit = "", order = "", promise;
    async function exec() {
      if (failLedger && table === "image_generation_calls" && mode === "insert") return { data: null, error: { code: "fictional_ledger_unavailable" } };
      const failingCompletion = completionError && table === "companion_artworks" && mode === "update" && ["ready", "ready_hidden"].includes(values.state);
      if (failingCompletion && completionError === "before") return { data: null, error: { code: "fictional_update_failed" } };
      if (failFailureUpdate && table === "companion_artworks" && mode === "update" && values.failure_code) return { data: null, error: { code: "fictional_update_failed" } };
      const params = [], bind = value => { params.push(value); return "$" + params.length; };
      let sql;
      const where = () => filters.map(([key, operator, value]) => ident(key) + " " + operator + (operator === "is" ? " null" : " " + bind(value))).join(" and ");
      if (mode === "insert") {
        const row = { ...values, user_id: owner.userId, companion_id: owner.companionId }, keys = Object.keys(row);
        sql = "insert into " + ident(table) + "(" + keys.map(ident).join(",") + ") values(" + keys.map(key => bind(row[key])).join(",") + ") returning *";
      } else if (mode === "update") {
        sql = "update " + ident(table) + " set " + Object.keys(values).map(key => ident(key) + "=" + bind(values[key])).join(",") + " where " + where() + " returning *";
      } else sql = "select " + (fields === "*" ? "*" : fields.split(",").map(ident).join(",")) + " from " + ident(table) + " where " + where() + order + limit;
      try {
        const result = await db.query(sql, params);
        sqlTraces.push({ table, mode, sql, rows: result.rows.length, nextState: values?.state || null });
        queries.push({ table, mode, filters: filters.map(([key, op]) => [key, op]), rows: result.rows.length });
        if (readBarrier && mode === "read" && table === "companion_artworks" && ++reads <= 2) await readBarrier.promise;
        return failingCompletion ? { data: null, error: { code: "fictional_response_lost" } } : { data: single ? result.rows[0] || null : result.rows, error: null };
      } catch (error) { return { data: null, error }; }
    }
    const run = () => promise ||= exec();
    const query = {
      select(value = "*") { if (mode === "unset") mode = "read"; fields = value; return query; },
      insert(value) { assert.equal(mode, "unset"); mode = "insert"; values = value; return query; }, update(value) { assert.equal(mode, "unset"); mode = "update"; values = value; return query; },
      eq(key, value) { assert.notEqual(mode, "unset", "PostgREST filters follow select/update"); filters.push([key, "=", value]); return query; }, is(key, value) { assert.notEqual(mode, "unset"); assert.equal(value, null); filters.push([key, "is", null]); return query; },
      gte(key, value) { filters.push([key, ">=", value]); return query; },
      limit(value) { limit = " limit " + Number(value); return query; }, order(key, options = {}) { order = " order by " + ident(key) + (options.ascending === false ? " desc" : " asc"); return query; },
      single() { single = true; return run(); }, maybeSingle() { single = true; return run(); }, then(resolve, reject) { return run().then(resolve, reject); },
    }; return query;
  } };
  await database.from("companion_creative_settings").insert({ id: "fixture-settings", generation_mode: "confirm" });
  await database.from("image_provider_profiles").insert({ id: providerId, base_url: "https://images.example.test/v1", auth_type: "none", model: "fictional-image", enabled: true });
  await database.from("companion_artworks").insert({ id: artworkId, kind: "doodle", visibility: "ordinary", state: "awaiting_confirmation", title: "虚构画作", actual_call_count: 0,
    prompt_ciphertext: encryptScopedSecret("fictional drawing", owner, `artwork-prompt:${artworkId}`, env), created_at: date.toISOString(), updated_at: date.toISOString(), ...artwork });
  const createCenter = () => createCompanionCreativeCenter({ database, identity: owner, env, now: () => date,
    fetchImpl() { const wait = deferred(); waits.push(wait); if (!pause || waits.length > 1) wait.resolve(fail ? failResponse() : imageResponse()); return wait.promise; },
    storage: { from() { return { async upload(path, _bytes, options) { uploads.push(path); assert.equal(options.upsert, false); if (stored.has(path)) return { error: { code: "Duplicate" } }; stored.add(path); await onUpload?.(); return { error: null }; }, async remove(paths) { removed.push(...paths); paths.forEach(path => stored.delete(path)); return { error: null }; } }; } },
  });
  const row = async () => (await db.query("select * from companion_artworks where id=$1", [artworkId])).rows[0];
  const waitForCall = async count => { for (let index = 0; index < 50 && waits.length < count; index++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(waits.length, count); };
  return { createCenter, database, queries, waits, uploads, removed, row, waitForCall,
    patch: changes => database.from("companion_artworks").update(changes).eq("id", artworkId),
    setPause(value) { pause = value; }, setFail(value) { fail = value; }, advance(ms) { date = new Date(date.getTime() + ms); },
    setFailLedger(value) { failLedger = value; }, setUploadHook(value) { onUpload = value; },
    setCompletionError(value, failMarker = false) { completionError = value; failFailureUpdate = failMarker; },
    barrier() { readBarrier = deferred(); return readBarrier; },
  };
}

test("separate center instances cannot start a second provider call while one attempt is active", async () => {
  const f = await fixture(), first = settled(f.createCenter().generateArtwork(artworkId));
  await f.waitForCall(1);
  const second = await settled(f.createCenter().generateArtwork(artworkId));
  f.waits[0].resolve(imageResponse()); const result = await first;
  assert.equal(second.error?.code, "creative_generation_in_progress"); assert.equal(f.waits.length, 1); assert.equal(result.value?.state, "ready"); assert.equal((await f.row()).state, "ready");
});

test("PostgreSQL CAS rejects a stale first snapshot with zero claimed rows", async () => {
  const f = await fixture(), barrier = f.barrier(); f.setPause(false);
  const first = settled(f.createCenter().generateArtwork(artworkId)), second = settled(f.createCenter().generateArtwork(artworkId));
  await new Promise(resolve => setTimeout(resolve, 20)); barrier.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter(result => result.value).length, 1); assert.equal(results.find(result => result.error)?.error.code, "creative_generation_in_progress"); assert.equal(f.waits.length, 1);
  assert.ok(f.queries.some(query => query.table === "companion_artworks" && query.mode === "update" && query.rows === 0));
});

for (const state of ["ready", "revealed", "cancelled", "generating"]) {
  test(`late failed attempt cannot replace ${state} or a newer attempt`, async () => {
    const f = await fixture(), first = settled(f.createCenter().generateArtwork(artworkId)); await f.waitForCall(1);
    const attempt = state === "generating" ? 2 : 1;
    await f.patch({ state, actual_call_count: attempt, storage_path: state === "ready" || state === "revealed" ? "fictional-new-image.png" : null, failure_code: null });
    f.waits[0].resolve(failResponse()); assert.ok((await first).error);
    assert.equal((await f.row()).state, state); assert.equal((await f.row()).actual_call_count, attempt); assert.equal((await f.row()).failure_code, null);
  });
}

test("late successful result cannot store over an attempt owned by another claimant", async () => {
  const f = await fixture(), first = settled(f.createCenter().generateArtwork(artworkId)); await f.waitForCall(1);
  await f.patch({ state: "generating", actual_call_count: 2 });
  f.waits[0].resolve(imageResponse()); assert.equal((await first).error?.code, "creative_generation_in_progress");
  assert.equal(f.uploads.length, 0); assert.equal((await f.row()).actual_call_count, 2);
});

test("explicit failed retry and hidden-surprise keepGeneratingForRetry both remain recoverable", async () => {
  for (const surprise of [false, true]) {
    const f = await fixture(surprise ? { visibility: "surprise", source_job_id: sourceJobId, state: "generating" } : {});
    f.setPause(false); f.setFail(true);
    const options = surprise ? { lease: { async assertOwned() {} }, keepGeneratingForRetry: true } : {};
    assert.ok((await settled(f.createCenter().generateArtwork(artworkId, options))).error);
    assert.equal((await f.row()).state, surprise ? "generating" : "failed");
    f.setFail(false); const next = await f.createCenter().generateArtwork(artworkId, options);
    assert.equal(next.state, surprise ? "ready_hidden" : "ready"); assert.equal(next.actual_call_count, 2); assert.equal(f.waits.length, 2);
  }
});

test("lost lease cannot publish or mark a newer owner failed", async () => {
  const f = await fixture({ source_job_id: sourceJobId, visibility: "surprise", state: "generating" }); let lost = false;
  const lease = { async assertOwned() { if (lost) throw Object.assign(new Error("fictional lease lost"), { code: "background_job_lease_lost" }); } };
  const first = settled(f.createCenter().generateArtwork(artworkId, { lease, keepGeneratingForRetry: true })); await f.waitForCall(1);
  lost = true; f.waits[0].resolve(imageResponse()); assert.equal((await first).error?.code, "background_job_lease_lost");
  assert.equal(f.uploads.length, 0); assert.equal((await f.row()).state, "generating"); assert.equal((await f.row()).failure_code, null);
});

test("even an owned lease cannot restart a currently active provider attempt", async () => {
  const f = await fixture({ state: "generating", source_job_id: sourceJobId, visibility: "surprise" });
  const options = { lease: { async assertOwned() {} }, keepGeneratingForRetry: true };
  const first = settled(f.createCenter().generateArtwork(artworkId, options)); await f.waitForCall(1);
  const second = await settled(f.createCenter().generateArtwork(artworkId, options));
  f.waits[0].resolve(imageResponse()); await first;
  assert.equal(second.error?.code, "creative_generation_in_progress"); assert.equal(f.waits.length, 1);
});

test("owned lease can recover an abandoned attempt after the timeout window and old completion cannot overwrite it", async () => {
  const f = await fixture({ state: "generating", source_job_id: sourceJobId, visibility: "surprise" }); let oldLeaseLost = false;
  const first = settled(f.createCenter().generateArtwork(artworkId, { lease: { async assertOwned() { if (oldLeaseLost) throw Object.assign(new Error("fixture lease lost"), { code: "background_job_lease_lost" }); } }, keepGeneratingForRetry: true }));
  await f.waitForCall(1); oldLeaseLost = true; f.advance(300_001);
  const next = await f.createCenter().generateArtwork(artworkId, { lease: { async assertOwned() {} }, keepGeneratingForRetry: true });
  assert.equal(next.state, "ready_hidden"); assert.equal(next.actual_call_count, 2); assert.match(next.storage_path, /-2\.png$/);
  f.waits[0].resolve(imageResponse()); assert.equal((await first).error?.code, "background_job_lease_lost");
  assert.equal((await f.row()).state, "ready_hidden");
  const attempts = (await db.query("select attempt,status from image_generation_calls order by attempt")).rows;
  assert.deepEqual(attempts, [{ attempt: 1, status: "cancelled" }, { attempt: 2, status: "succeeded" }]);
});

test("a crash between atomic claim and ledger insert can recover under an owned background lease", async () => {
  const f = await fixture({ state: "generating", actual_call_count: 1, source_job_id: sourceJobId, visibility: "surprise" });
  f.advance(300_001); f.setPause(false);
  const next = await f.createCenter().generateArtwork(artworkId, { lease: { async assertOwned() {} }, keepGeneratingForRetry: true });
  assert.equal(next.state, "ready_hidden"); assert.equal(next.actual_call_count, 2); assert.equal(f.waits.length, 1);
});

test("ledger insert failure never calls the provider and leaves explicit retry available", async () => {
  const f = await fixture(); f.setFailLedger(true);
  const failed = await settled(f.createCenter().generateArtwork(artworkId));
  assert.equal(failed.error?.code, "creative_call_record_failed"); assert.equal(f.waits.length, 0); assert.equal((await f.row()).state, "failed");
  f.setFailLedger(false); f.setPause(false);
  const next = await f.createCenter().generateArtwork(artworkId); assert.equal(next.state, "ready"); assert.equal(f.waits.length, 1);
});

test("zero-row completion removes only its own attempted upload and preserves the new owner's image", async () => {
  const f = await fixture(); f.setPause(false);
  f.setUploadHook(() => f.patch({ state: "ready", actual_call_count: 2, storage_path: "fictional-new-owner.png" }));
  const result = await settled(f.createCenter().generateArtwork(artworkId));
  assert.equal(result.error?.code, "creative_generation_in_progress"); assert.equal((await f.row()).state, "ready"); assert.equal((await f.row()).storage_path, "fictional-new-owner.png");
  assert.deepEqual(f.removed, f.uploads); assert.equal(f.removed.some(path => path === "fictional-new-owner.png"), false);
});

test("ready results remain idempotent and cancelled artwork is not regenerated", async () => {
  for (const state of ["ready", "ready_hidden", "revealed", "cancelled"]) {
    const f = await fixture({ state, storage_path: state === "cancelled" ? null : "fictional-stored.png" });
    const result = await settled(f.createCenter().generateArtwork(artworkId));
    assert.equal(f.waits.length, 0); assert.equal((await f.row()).state, state);
    assert.equal(state === "cancelled" ? result.error?.code : result.value?.state, state === "cancelled" ? "creative_generation_in_progress" : state);
  }
});

test("returned UPDATE error cleans an unreferenced attempt after its failure marker succeeds", async () => {
  const f = await fixture(); f.setPause(false); f.setCompletionError("before");
  assert.ok((await settled(f.createCenter().generateArtwork(artworkId))).error);
  assert.equal((await f.row()).state, "failed"); assert.deepEqual(f.removed, f.uploads);
});

test("lost UPDATE response after commit must preserve its referenced ready image", async () => {
  const f = await fixture(); f.setPause(false); f.setCompletionError("after");
  assert.ok((await settled(f.createCenter().generateArtwork(artworkId))).error);
  assert.equal((await f.row()).state, "ready"); assert.equal((await f.row()).storage_path, f.uploads[0]); assert.deepEqual(f.removed, []);
});

test("uncertain UPDATE and failed follow-up retain the upload rather than risk deleting a committed image", async () => {
  const f = await fixture(); f.setPause(false); f.setCompletionError("before", true);
  assert.ok((await settled(f.createCenter().generateArtwork(artworkId))).error);
  assert.equal((await f.row()).state, "generating"); assert.deepEqual(f.removed, []);
});

test("lease loss after upload cleans only the unreferenced attempt path", async () => {
  const f = await fixture({ state: "generating", visibility: "surprise", source_job_id: sourceJobId }); f.setPause(false); let lost = false;
  f.setUploadHook(() => { lost = true; });
  const lease = { async assertOwned() { if (lost) throw Object.assign(new Error("fixture lease lost"), { code: "background_job_lease_lost" }); } };
  assert.equal((await settled(f.createCenter().generateArtwork(artworkId, { lease, keepGeneratingForRetry: true }))).error?.code, "background_job_lease_lost");
  assert.equal((await f.row()).state, "generating"); assert.deepEqual(f.removed, f.uploads);
});

test("manual interrupted generation gets explicit recovery guidance after the timeout without another charge", async () => {
  const f = await fixture({ state: "generating", actual_call_count: 1 });
  await f.database.from("image_generation_calls").insert({ artwork_id: artworkId, provider_profile_id: providerId, attempt: 1, status: "started", model: "fictional-image", started_at: "2026-10-10T01:00:00.000Z" });
  f.advance(299_999);
  assert.equal((await settled(f.createCenter().generateArtwork(artworkId))).error?.code, "creative_generation_in_progress");
  f.advance(2);
  const result = await settled(f.createCenter().generateArtwork(artworkId));
  assert.equal(result.error?.code, "creative_generation_recovery_required");
  assert.match(result.error.message, /结果未能确认.*刷新.*删除.*重新构思.*新的接口费用/);
  assert.equal(f.waits.length, 0); assert.equal((await f.row()).actual_call_count, 1); assert.equal((await f.row()).state, "generating");
  assert.deepEqual((await db.query("select attempt,status from image_generation_calls")).rows, [{ attempt: 1, status: "started" }]);
});

test("manual ledger and rollback double failure gets recovery guidance after timeout without reclaiming", async () => {
  const f = await fixture(); f.setFailLedger(true); f.setCompletionError(null, true);
  assert.equal((await settled(f.createCenter().generateArtwork(artworkId))).error?.code, "creative_call_record_failed");
  assert.equal((await f.row()).state, "generating"); assert.equal((await f.row()).actual_call_count, 1);
  assert.equal((await settled(f.createCenter().generateArtwork(artworkId))).error?.code, "creative_generation_in_progress");
  f.advance(300_001);
  assert.equal((await settled(f.createCenter().generateArtwork(artworkId))).error?.code, "creative_generation_recovery_required");
  assert.equal(f.waits.length, 0); assert.equal((await f.row()).state, "generating"); assert.equal((await f.row()).actual_call_count, 1);
  assert.equal((await db.query("select * from image_generation_calls")).rows.length, 0);
});

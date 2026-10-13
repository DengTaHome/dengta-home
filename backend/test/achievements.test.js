"use strict";
const assert = require("node:assert/strict");
const { createAchievementsService } = require("../services/achievements");
const { createFunLabsRouter } = require("../routes/v2/fun-labs");
const { createRequestScope } = require("../services/request-scope");

function fixture() {
  const calls = [];
  const scope = { userId: require("node:crypto").randomUUID(), companionId: "fixture-companion" };
  const state = { replies: 0, failInsert: false, unlocked: [] };
  const database = { from(table) {
    const filters = [], query = { count: false, insertRows: null,
      select(_columns, options) { this.count = !!options?.head; return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      gte() { return this; }, order() { return this; }, limit() { return this; },
      insert(rows) { this.insertRows = rows; return this; },
      then(resolve, reject) {
        calls.push({ table, filters, count: this.count });
        let result;
        if (this.insertRows) {
          if (state.failInsert) result = { error: Error("fixture insert failed") };
          else { state.unlocked.push(...this.insertRows); result = { error: null }; }
        } else if (this.count) result = { count: table === "messages" ? state.replies : table === "conversations" ? 10 : 0 };
        else result = { data: table === "achievements" ? state.unlocked : [] };
        return Promise.resolve(result).then(resolve, reject);
      }
    }; return query;
  } };
  return { scope, state, calls, service: createAchievementsService({ database }) };
}

(async () => {
  const f = fixture();
  let result = await f.service.check(f.scope, new Date(), { refresh: true });
  assert.ok(!result.unlocked.includes("first_chat"), "empty sessions cannot earn first chat");
  const count = f.calls.find(x => x.table === "messages" && x.count);
  for (const pair of [["user_id", f.scope.userId], ["companion_id", f.scope.companionId], ["role", "assistant"], ["visible", true]]) assert.ok(count.filters.some(x => JSON.stringify(x) === JSON.stringify(pair)));
  f.state.replies = 1;
  result = await f.service.check(f.scope);
  assert.ok(!result.unlocked.includes("first_chat"), "cached background path stays bounded");
  result = await f.service.check(f.scope, new Date(), { refresh: true });
  assert.ok(result.unlocked.includes("first_chat"), "explicit progress refresh bypasses stale cache");
  assert.equal(result.newly.length, 1);
  result = await f.service.check(f.scope, new Date(), { refresh: true });
  assert.equal(result.newly.length, 0, "refresh does not celebrate twice");
  const fail = fixture(); fail.state.replies = 10; fail.state.failInsert = true;
  result = await fail.service.check(fail.scope, new Date(), { refresh: true });
  assert.equal(result.newly.length, 0, "failed persistence is never announced as earned");
  assert.equal(result.unlocked.length, 0);

  let unlocks = 0, ready = false;
  const router = createFunLabsRouter({ achievements: {
    check: async () => ({ unlocked: ready ? ["first_chat"] : [] }),
    unlock: async () => { unlocks++; return { unlocked: true }; }, list: async () => [],
  } });
  const handler = router.stack.find(layer => layer.route?.path === "/onboarding").route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  const companion = { id: require("node:crypto").randomUUID(), user_id: f.scope.userId, status: "active" };
  const req = { scope: createRequestScope({
    adminSupabase: { from() {} }, user: { id: f.scope.userId },
    profile: { id: f.scope.userId, status: "active", role: "member" }, companion, companions: [companion],
  }) };
  await handler(req, res, error => { throw error; });
  assert.equal(res.code, 409); assert.equal(unlocks, 0);
  ready = true; res.code = 200;
  await handler(req, res, error => { throw error; });
  assert.equal(res.code, 200); assert.equal(unlocks, 1);
  console.log("Achievements: confirmed visible replies, tenant filters, fresh refresh, no phantom awards, onboarding eligibility passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

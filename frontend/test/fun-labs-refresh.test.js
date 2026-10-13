import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFunLabsState, refreshFunLabsSections, funLabsDiagnostic, removeFunDate } from "../src/fun-labs-refresh.js";
import { achievementFailure } from "../src/achievement-action.js";
import { CONTENT_IMPORT_ERROR_FEEDBACK } from "../src/content-import-api.js";

const LOG_ID = "11111111-1111-4111-8111-111111111111";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const date = { id: "date-one", title: "Fictional date", event_date: "2026-10-01" };
function harness() {
  const token = { requestId: 0 };
  let currentToken = token, mounted = true, state = { ...emptyFunLabsState(), scope: token }, feedback;
  const calls = [], achievements = [], lock = { current: null };
  const options = { token, currentToken: () => currentToken, isMounted: () => mounted,
    request: (path, settings) => { const pending = deferred(); calls.push({ path, settings, ...pending }); return pending.promise; },
    update: change => { state = change(state); }, onAchievements: rows => achievements.push(rows),
    lock, feedback: value => { feedback = value; }, refresh: async keys => { calls.push({ refresh: keys }); } };
  return { options, calls, achievements, lock, get state() { return state; }, get feedback() { return feedback; },
    seed(value) { state = { ...state, ...value }; }, switchScope() { currentToken = {}; }, unmount() { mounted = false; } };
}
const tick = () => new Promise(resolve => queueMicrotask(resolve));

test("fast sections display before slow ones; failure retains cached records and technical metadata", async () => {
  const h = harness(); h.seed({ shots: { today: { id: "old-shot" }, recent: [] } });
  const run = refreshFunLabsSections(h.options);
  h.calls[0].resolve({ dates: [date] });
  h.calls[2].reject(Object.assign(new Error("PRIVATE_PROVIDER_BODY"), { code: "daily_shots_read_failed", status: 503, error_log_id: LOG_ID }));
  await tick();
  assert.deepEqual(h.state.dates, [date]);
  assert.equal(h.state.sections.achievements.status, "busy");
  assert.equal(h.state.sections.shots.status, "error");
  assert.equal(h.state.shots.today.id, "old-shot");
  assert.equal(h.state.sections.shots.diagnostic.error_log_id, LOG_ID);
  assert.ok(!JSON.stringify(h.state).includes("PRIVATE_PROVIDER_BODY"));
  h.calls[1].resolve({ achievements: [] }); await run;
  assert.equal(h.state.status, "partial");
});

test("selective retry does not cancel unrelated pending sections or accept stale same-section receipts", async () => {
  const h = harness(), first = refreshFunLabsSections(h.options);
  const retry = refreshFunLabsSections({ ...h.options, sections: ["shots", "shots", "unknown"] });
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].path, "/api/v2/fun-labs/daily-shots");
  h.calls[3].resolve({ today: { id: "new-shot" }, recent: [] }); await retry;
  h.calls[2].resolve({ today: { id: "stale-shot" }, recent: [] });
  h.calls[0].resolve({ dates: [date] }); h.calls[1].resolve({ achievements: [{ code: "one", title: "Done", unlocked: true }] }); await first;
  assert.equal(h.state.shots.today.id, "new-shot"); assert.deepEqual(h.state.dates, [date]);
  assert.equal(h.state.sections.achievements.status, "success"); assert.equal(h.achievements.length, 1);
});

test("switching accounts or unmounting rejects late data and achievement popups", async () => {
  for (const stop of ["switchScope", "unmount"]) {
    const h = harness(), run = refreshFunLabsSections(h.options), before = h.state;
    h[stop](); h.calls[0].resolve({ dates: [date] }); h.calls[1].resolve({ achievements: [] }); h.calls[2].reject(new Error("late")); await run;
    assert.equal(h.state, before); assert.equal(h.achievements.length, 0);
    await refreshFunLabsSections(h.options); assert.equal(h.calls.length, 3);
  }
});

test("malformed receipts preserve data and report the failed section", async () => {
  for (const [section, payload, expected] of [["dates", { dates: [{ ...date, event_date: {} }] }, "dates_receipt_invalid"], ["achievements", { achievements: [{}] }, "achievements_receipt_invalid"], ["shots", { recent: [] }, "shots_receipt_invalid"]]) {
    const h = harness(); h.seed({ dates: [date] }); const run = refreshFunLabsSections({ ...h.options, sections: [section] });
    h.calls[0].resolve(payload); await run; assert.equal(h.state.sections[section].diagnostic.error_code, expected); assert.deepEqual(h.state.dates, [date]);
  }
  assert.deepEqual(funLabsDiagnostic({ code: "secret body !", error_log_id: "<private>", status: "503" }), { error_code: "activity_load_failed", error_log_id: undefined, error_source: "dengta", http_status: undefined, upstream_status: undefined });
  const diagnosis=funLabsDiagnostic({status:503,upstream_status:522}); assert.equal(diagnosis.http_status,503); assert.equal(diagnosis.upstream_status,522);
});

for (const row of [
  { code: "first_chat", title: "Fictional", unlocked: "false" },
  { code: "first_chat", title: "Fictional" },
  { code: "first_chat", title: "Fictional", unlocked: 1 },
  { id: "first_chat", title: "Fictional", unlocked: true },
  { code: " ", title: "Fictional", unlocked: true },
]) test(`achievement read rejects ambiguous identity or unlock state: ${JSON.stringify(row)}`, async () => {
  const h = harness(), saved = [{ code: "saved", title: "Fictional", unlocked: false }];
  h.seed({ achievements: saved });
  const run = refreshFunLabsSections({ ...h.options, sections: ["achievements"] });
  h.calls[0].resolve({ achievements: [row] });
  assert.deepEqual(await run, { achievements: "error" });
  assert.deepEqual(h.state.achievements, saved);
  assert.equal(h.achievements.length, 0);
  assert.equal(h.state.sections.achievements.diagnostic.error_code, "achievements_receipt_invalid");
});

test("duplicate achievement codes never trigger unlock popups", async () => {
  const h = harness(), run = refreshFunLabsSections({ ...h.options, sections: ["achievements"] });
  h.calls[0].resolve({ achievements: [false, true].map(unlocked => ({ code: "first_chat", title: "Fictional", unlocked })) });
  await run; assert.equal(h.state.sections.achievements.status, "error"); assert.equal(h.achievements.length, 0);
});

test("achievement read accepts a real false boolean without marking it complete", async () => {
  const h = harness(), run = refreshFunLabsSections({ ...h.options, sections: ["achievements"] });
  h.calls[0].resolve({ achievements: [{ code: "first_chat", title: "Fictional", unlocked: false }] });
  await run; assert.equal(h.state.sections.achievements.status, "success"); assert.equal(h.achievements[0][0].unlocked, false);
});

test("achievement diagnostics admit known public codes and UUID log ids only", () => {
  for (const helper of [error => funLabsDiagnostic(error), error => achievementFailure(error).diagnostic]) {
    const diagnosis = helper({ code: "sk_fictional_raw_marker", error_log_id: "sk-provider-secret-123456789-fixture-6", message: "FICTIONAL_PRIVATE_BODY", status: 503 });
    assert.doesNotMatch(JSON.stringify(diagnosis), /sk_fictional|sk-fictional|FICTIONAL_PRIVATE/);
    const known = helper({ code: "request_timeout", error_log_id: LOG_ID, status: 504 });
    assert.equal(known.error_code, "request_timeout"); assert.equal(known.error_log_id, LOG_ID); assert.equal(known.http_status, 504);
  }
});

test("shared import diagnostics retain declared recovery codes without admitting raw unknown codes", () => {
  for (const code of ["import_commit_pending", "import_receipt_missing", "import_commit_rolled_back"])
    assert.equal(funLabsDiagnostic({ code }, "import_operation_failed", CONTENT_IMPORT_ERROR_FEEDBACK).error_code, code);
  assert.equal(funLabsDiagnostic({ code: "sk_fictional_raw_marker" }, "import_operation_failed", CONTENT_IMPORT_ERROR_FEEDBACK).error_code, "import_operation_failed");
});

test("date deletion waits for a matching receipt and prevents double clicks", async () => {
  const h = harness(); h.seed({ dates: [date] }); const run = removeFunDate({ ...h.options, id: date.id });
  await removeFunDate({ ...h.options, id: date.id }); assert.equal(h.calls.length, 1); assert.equal(h.feedback.status, "busy");
  h.calls[0].resolve({ removed: date.id }); await run;
  assert.deepEqual(h.state.dates, []); assert.equal(h.feedback, null); assert.equal(h.lock.current, null); assert.deepEqual(h.calls[1].refresh, ["dates"]);
});

test("failed, mismatched, and late delete receipts never falsely remove records", async () => {
  for (const scenario of ["failure", "mismatch", "scope", "unmount"]) {
    const h = harness(); h.seed({ dates: [date] }); const run = removeFunDate({ ...h.options, id: date.id });
    if (scenario === "scope") h.switchScope(); if (scenario === "unmount") h.unmount();
    if (scenario === "failure") h.calls[0].reject(Object.assign(new Error("PRIVATE_DETAIL"), { code: "request_timeout", status: 504 }));
    else h.calls[0].resolve({ removed: scenario === "mismatch" ? "another-date" : date.id });
    await run; assert.deepEqual(h.state.dates, [date]); assert.equal(h.calls.length, 1); assert.equal(h.lock.current, null);
    if (["failure", "mismatch"].includes(scenario)) { assert.equal(h.feedback.status, "error"); assert.ok(!JSON.stringify(h.feedback).includes("PRIVATE_DETAIL")); }
  }
});

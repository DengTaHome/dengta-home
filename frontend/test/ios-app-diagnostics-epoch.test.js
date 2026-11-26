import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearAccountRuntimeData, prepareAccountRuntimeData } from "../src/account-cleanup.js";
import { captureOperationFailureScope, readOperationFailures, recordOperationFailure as recordScopedOperationFailure } from "../src/operation-diagnostics.js";

const A = "61111111-1111-4111-8111-111111111111";
const B = "62222222-2222-4222-8222-222222222222";
const C = "63333333-3333-4333-8333-333333333333";
const D = "64444444-4444-4444-8444-444444444444";
const scope = (account, companion = C) => JSON.stringify([account, companion]);
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const operationFailureScope = useMemo(", source.indexOf("function App("));
const end = source.indexOf("  // 用 ref 保存作用域", start);
assert.ok(start > 0 && end > start, "exercise the diagnostic callback actually used by App");
const mountActualDiagnostics = new Function(
  "privateMediaScope", "captureOperationFailureScope", "recordScopedOperationFailure", "useMemo", "useCallback",
  source.slice(start, end) + "\nreturn recordOperationFailure;",
);
const mount = value => mountActualDiagnostics(value, captureOperationFailureScope, recordScopedOperationFailure, factory => factory(), callback => callback);
const cleanupOptions = {
  localStorage: null, sessionStorage: null, sealAccountCache() {}, purgeAccountCache: async () => {},
  workspaceCacheClearLegacy: async () => {}, stopVoiceSpeech: async () => {},
};

test("actual App diagnostics continue after same-account login while the old App callback stays retired", async () => {
  prepareAccountRuntimeData(A);
  const oldA = mount(scope(A));
  assert.ok(oldA(scope(A), "/api/v2/sessions", { code: "session_receipt_invalid" }));
  await clearAccountRuntimeData(A, cleanupOptions);
  assert.equal(oldA(scope(A), "/api/v2/sessions", { code: "session_receipt_invalid" }), null);

  prepareAccountRuntimeData(B);
  const b = mount(scope(B));
  assert.ok(b(scope(B), "/api/v2/settings", new Error("fictional B operation")));
  prepareAccountRuntimeData(A);
  const newA = mount(scope(A));
  for (const [endpoint, code] of [
    ["/api/v2/sessions", "session_receipt_invalid"],
    ["/companion/inner-monologue", "inner_monologue_receipt_invalid"],
    ["/api/v2/fun-labs/achievements", "achievements_receipt_invalid"],
  ]) assert.ok(newA(scope(A), endpoint, { code }), `new App must record ${code}`);
  assert.equal(oldA(scope(A), "/api/v2/sessions", { code: "session_receipt_invalid" }), null);
  assert.equal(recordScopedOperationFailure(scope(A), "/api/v2/settings", new Error("legacy late callback")), null,
    "raw scope strings must keep failing closed after exit");
  assert.equal(readOperationFailures(scope(A)).length, 3);
  assert.equal(readOperationFailures(scope(B)).length, 1);
  await clearAccountRuntimeData(A, cleanupOptions);
  await clearAccountRuntimeData(B, cleanupOptions);
});

test("actual App diagnostic wrapper rejects another account or companion scope", async () => {
  prepareAccountRuntimeData(A);
  const record = mount(scope(A));
  assert.equal(record(scope(B), "/api/v2/settings", new Error("wrong account")), null);
  assert.equal(record(scope(A, D), "/api/v2/settings", new Error("wrong companion")), null);
  assert.ok(record(scope(A), "/api/v2/settings", new Error("current operation")));
  assert.equal(readOperationFailures(scope(A)).length, 1);
  assert.equal(readOperationFailures(scope(A, D)).length, 0);
  await clearAccountRuntimeData(A, cleanupOptions);
});

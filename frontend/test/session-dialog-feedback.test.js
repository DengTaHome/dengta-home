import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SESSION_TITLE, readSessionRename, readSessionDelete, sessionDialogFailure } from "../src/session-dialog-feedback.js";
import { recordOperationFailure, readOperationFailures, clearOperationFailures } from "../src/operation-diagnostics.js";

const id = "10000000-0000-4000-8000-000000000001";
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });
test("rename receipt matches the exact server title and only retains session DTO fields", async () => {
  assert.equal(MAX_SESSION_TITLE, 60);
  const item = await readSessionRename(response({ session: { id, title: "fictional", model_id: null, created_at: "2026-10-07", private: "FICTIONAL_PRIVATE" } }), id, "fictional");
  assert.deepEqual(item, { id, title: "fictional", model_id: null, created_at: "2026-10-07" });
});
for (const data of [{}, { session: { id, title: "wrong title" } }, { session: { id: "bad", title: "fictional" } }, { session: null }]) {
  test(`invalid successful session receipt is rejected: ${JSON.stringify(data)}`, async () => {
    await assert.rejects(readSessionRename(response(data), id, "fictional"), { code: "session_receipt_invalid" });
  });
}
test("only 204 confirms a session deletion", async () => {
  assert.equal(await readSessionDelete(response(null, 204)), null);
  await assert.rejects(readSessionDelete(response({})), { code: "session_receipt_invalid" });
});
for (const status of [401, 403, 404, 500]) {
  test(`session HTTP ${status} failure keeps technical metadata without upstream prose`, async () => {
    let captured;
    try { await readSessionDelete(response({ message: "FICTIONAL_PRIVATE_BODY", code: "FICTIONAL_PRIVATE_CODE", error_log_id: id }, status)); } catch (error) { captured = error; }
    assert.equal(captured.status, status);
    assert.equal(captured.error_log_id, id);
    const text = sessionDialogFailure(captured);
    assert.match(text, new RegExp(`HTTP ${status}`)); assert.match(text, /日志/); assert.doesNotMatch(text, /FICTIONAL_PRIVATE/);
    assert.match(text, /先刷新页面核对/);
  });
}
test("session diagnostics isolate account scope and whitelist receipt errors", () => {
  const scope = "fictional session scope", other = "other fictional scope";
  clearOperationFailures(scope); clearOperationFailures(other);
  recordOperationFailure(scope, `/api/v2/sessions/${id}?private=FICTIONAL_PRIVATE_QUERY`, { code: "session_receipt_invalid", status: 500, error_log_id: id, message: "FICTIONAL_PRIVATE_BODY" });
  const row = readOperationFailures(scope)[0];
  assert.equal(row.code, "DT-SESSIONS"); assert.equal(row.reasonCode, "session_receipt_invalid");
  assert.equal(readOperationFailures(other).length, 0); assert.doesNotMatch(JSON.stringify(row), /FICTIONAL_PRIVATE/);
  clearOperationFailures(scope); clearOperationFailures(other);
});

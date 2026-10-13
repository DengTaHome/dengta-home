import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const start = source.indexOf("  async function confirmSessionDialog(");
const end = source.indexOf("  function scheduleCompanionInteraction(", start);
assert.ok(start >= 0 && end > start);
const body = source.slice(start, end);
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const C = "10000000-0000-4000-8000-000000000003";
const session = id => ({ id, title: `fictional ${id.at(-1)}`, model_id: null });

function fixture(type = "rename") {
  const state = { sessions: [session(A), session(B)], dialog: { type, session: session(A), value: "new fictional title" }, busy: false, feedback: "", notices: [], current: true, active: A, cleared: 0, stores: 0, aborted: 0, diagnoses: 0 };
  const dialogRef = { current: state.dialog }, sessionsRef = { current: state.sessions }, activeSessionIdRef = { current: state.active };
  const requests = [];
  const request = (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }));
  const readSessionRename = async (response, id) => {
    const data = await response.json();
    if (!response.ok || data?.session?.id !== id || typeof data.session.title !== "string") throw Object.assign(new Error("invalid receipt"), { code: "session_receipt_invalid" });
    return data.session;
  };
  const readSessionDelete = async response => {
    if (response.status !== 204) throw Object.assign(new Error("invalid receipt"), { code: "session_receipt_invalid" });
    return null;
  };
  const context = {
    dialog: state.dialog, dialogRef, sessions: state.sessions, sessionsRef, activeSessionId: state.active, activeSessionIdRef,
    sessionDialogPendingRef: { current: null }, sessionDialogRequest: { isCurrent: () => state.current, request },
    apiRequest: request,
    setSessions(value) { state.sessions = typeof value === "function" ? value(state.sessions) : value; sessionsRef.current = state.sessions; },
    setDialog(value) { state.dialog = typeof value === "function" ? value(state.dialog) : value; dialogRef.current = state.dialog; },
    setSessionDialogBusy(value) { state.busy = value; },
    setSessionDialogFeedback(value) { state.feedback = value; },
    setNotice(value) { state.notices.push(value); },
    setActiveSessionId(value) { state.active = value; }, setMessages() { state.cleared++; },
    storeSessionChatModel() { state.stores++; }, clearStoredMessageReferencesForSession() { state.stores++; },
    abortChatRequest() { state.aborted++; }, chatRequestRef: { current: null },
    recordOperationFailure() { state.diagnoses++; }, privateMediaScope: "fictional scope",
    readSessionRename, readSessionDelete, sessionDialogFailure: error => `safe failure ${error.code}`, MAX_SESSION_TITLE: 60,
  };
  const confirm = new Function(...Object.keys(context), body + "return confirmSessionDialog;")(...Object.values(context));
  const click = () => confirm({ preventDefault() {} });
  const respond = (index, data, status = type === "rename" ? 200 : 204) => {
    const response = new Response(status === 204 ? null : JSON.stringify(data), { status });
    requests[index].resolve(requests[index].options.responseReader ? requests[index].options.responseReader(response) : data);
  };
  return { state, requests, context, dialogRef, sessionsRef, activeSessionIdRef, click, respond };
}

test("session mutation uses a synchronous lock and releases it after one confirmed request", async () => {
  const h = fixture();
  const first = h.click(), duplicate = h.click();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.busy, true);
  h.respond(0, { session: { ...session(A), title: "new fictional title" } });
  await Promise.all([first, duplicate]);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.dialog, null);
});

for (const data of [{}, { session: null }, { session: session(B) }]) {
  test(`session rename invalid receipt preserves the existing list and editor: ${JSON.stringify(data)}`, async () => {
    const h = fixture(), before = h.state.sessions;
    const task = h.click(); h.respond(0, data); await task;
    assert.deepEqual(h.state.sessions, before);
    assert.equal(h.state.dialog.value, "new fictional title");
    assert.match(h.state.feedback, /session_receipt_invalid/);
    assert.equal(h.state.busy, false);
  });
}

test("session delete preserves conversations added while the request is pending", async () => {
  const h = fixture("delete"), task = h.click();
  h.state.sessions = [...h.state.sessions, session(C)]; h.sessionsRef.current = h.state.sessions;
  h.respond(0, null); await task;
  assert.deepEqual(h.state.sessions.map(item => item.id), [B, C]);
  assert.equal(h.state.stores, 2);
  assert.equal(h.state.aborted, 1);
});

test("deleting an older active conversation does not clear a newly selected conversation", async () => {
  const h = fixture("delete"), task = h.click();
  h.activeSessionIdRef.current = B; h.state.active = B;
  h.respond(0, null); await task;
  assert.equal(h.state.active, B);
  assert.equal(h.state.cleared + h.state.aborted, 0);
});

test("a late rename cannot close a replacement dialog", async () => {
  const h = fixture(), task = h.click();
  const replacement = { type: "rename", session: session(B), value: "other fictional draft" };
  h.state.dialog = replacement; h.dialogRef.current = replacement;
  h.respond(0, { session: { ...session(A), title: "new fictional title" } }); await task;
  assert.equal(h.state.dialog, replacement);
  assert.equal(h.state.sessions[0].title, "new fictional title");
});

for (const type of ["rename", "delete"]) {
  test(`late ${type} after scope change cannot mutate the new account UI or storage`, async () => {
    const h = fixture(type), before = h.state.sessions;
    const task = h.click(); h.state.current = false;
    h.respond(0, { session: { ...session(A), title: "new fictional title" } }); await task;
    assert.deepEqual(h.state.sessions, before);
    assert.equal(h.state.stores + h.state.cleared + h.state.aborted + h.state.diagnoses, 0);
    assert.equal(h.state.notices.length, 0);
  });
}

test("a non-204 delete receipt does not remove local chat records", async () => {
  const h = fixture("delete"), before = h.state.sessions, task = h.click();
  h.respond(0, {}, 200); await task;
  assert.deepEqual(h.state.sessions, before);
  assert.equal(h.state.stores + h.state.cleared, 0);
  assert.match(h.state.feedback, /session_receipt_invalid/);
});

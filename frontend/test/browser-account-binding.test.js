import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserAccountBinding } from "../src/browser-account-binding.js";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let account = A, listener;
  const bindings = [];
  const session = { getSnapshot: () => ({ user: account ? { id: account } : null }), subscribe(callback) { listener = callback; callback(); return () => { listener = null; }; } };
  const subject = createBrowserAccountBinding({ session, plugin: { setAccount: value => { bindings.push(value.accountScope); return Promise.resolve({ supported: true }); } } });
  return { subject, bindings, change(value) { account = value; listener?.(); } };
}
test("browser account binding is stable within one account and clears on logout", async () => {
  const h = fixture(), stop = h.subject.start();
  assert.deepEqual(await h.subject.request(value => value), { accountScope: A });
  assert.deepEqual(await h.subject.request(value => value), { accountScope: A });
  assert.deepEqual(h.bindings, [A]);
  h.change(""); await assert.rejects(h.subject.request(() => {}), { code: "browser_account_changed" });
  assert.deepEqual(h.bindings, [A, ""]); stop();
});
test("a late old-account cookie/browser result cannot be read into a new account", async () => {
  const h = fixture(), stop = h.subject.start(); let finish;
  const pending = h.subject.request(() => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve(); h.change(B); finish({ cookie: "synthetic-private-cookie" });
  await assert.rejects(pending, { code: "browser_account_changed" });
  assert.deepEqual(await h.subject.request(value => value), { accountScope: B });
  assert.deepEqual(h.bindings, [A, B]); stop();
});

import test from "node:test";
import assert from "node:assert/strict";
import { readTakeoutLoginState, openTakeoutLogin } from "../src/takeout-executor.js";

const capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
test("local cookie hints, absence, malformed receipts and read failures remain distinct", async () => {
  for (const [loggedIn, hasCookie] of [[true, true], [false, true], [false, false]]) {
    assert.deepEqual(await readTakeoutLoginState({ capacitor, plugin: { getLoginState: async () => ({ loggedIn, hasCookie, cookie: "fictional private value" }) } }), { status: "ready", loggedIn, hasCookie });
  }
  for (const receipt of [null, {}, { loggedIn: "false", hasCookie: true }, { loggedIn: false }]) {
    assert.equal((await readTakeoutLoginState({ capacitor, plugin: { getLoginState: async () => receipt } })).code, "takeout_login_state_invalid");
  }
  for (const code of ["browser_account_changed", "browser_account_restore_required", "browser_account_isolation_unavailable", "fictional_private_code", "toString"]) {
    const result = await readTakeoutLoginState({ capacitor, plugin: { getLoginState: async () => { throw Object.assign(Error("fictional private value"), { code }); } } });
    assert.equal(result.status, "error");
    assert.equal(result.code, code.startsWith("browser_account_") ? code : "takeout_login_check_failed");
    assert.ok(!JSON.stringify(result).includes("fictional"));
  }
});

test("a stalled native read times out, permits a new check and ignores its late reply", async () => {
  let finish;
  const pending = readTakeoutLoginState({ capacitor, timeoutMs: 15, plugin: { getLoginState: () => new Promise(resolve => { finish = resolve; }) } });
  const failed = await pending;
  assert.equal(failed.code, "takeout_login_check_timeout");
  const next = await readTakeoutLoginState({ capacitor, plugin: { getLoginState: async () => ({ loggedIn: true, hasCookie: true }) } });
  assert.equal(next.status, "ready");
  finish({ loggedIn: false, hasCookie: false });
  assert.equal((await pending).code, "takeout_login_check_timeout");
});

test("web checks never call native; opening errors preserve only public reason codes", async () => {
  let calls = 0;
  const plugin = { getLoginState: async () => { calls++; }, openLogin: async () => { calls++; } };
  const unavailable = { isNativePlatform: () => false };
  assert.equal((await readTakeoutLoginState({ capacitor: unavailable, plugin })).status, "unavailable");
  assert.equal((await openTakeoutLogin({ capacitor: unavailable, plugin })).code, "takeout_native_unavailable");
  assert.equal(calls, 0);
  let openedUrl;
  assert.equal((await openTakeoutLogin({ capacitor, plugin: { openLogin: async input => { openedUrl = input.url; return { opened: true }; } } })).ok, true);
  assert.equal(openedUrl, "https://h5.ele.me/msite/", "a default login must not open an empty URL or another site");
  for (const code of ["browser_account_changed", "browser_page_load_failed", "fictional_private_code"]) {
    const outcome = await openTakeoutLogin({ capacitor, plugin: { openLogin: async () => { throw Object.assign(Error("fictional private value"), { code }); } } });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, code.startsWith("browser_") ? code : "takeout_login_open_failed");
    assert.ok(!JSON.stringify(outcome).includes("fictional"));
  }
});

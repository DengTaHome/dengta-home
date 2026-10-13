import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { createAuthSessionManager } from "../src/auth-session.js";
import { createDuelState, playDuelRound } from "../src/intimate-duel.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "55555555-5555-4555-8555-555555555555";
const storageKey = (account = ACCOUNT_A, companion = COMPANION_A) => `dengta_intimate_duel_v3:${JSON.stringify([account, companion])}`;
const receipt = { ok: true, companion_skill: "neck", reaction: "虚构即时反应", narration: "虚构回合正文已完整收到。" };
const textOf = value => typeof value === "string" ? value : (value?.children || []).map(textOf).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function tick() { for (let index = 0; index < 50; index++) await Promise.resolve(); }

async function harness({ stored, storageFails = false, storageReadFailures = 0, storageWriteFailures = 0, strict = false, withScope = true } = {}) {
  const names = ["window", "fetch", "localStorage", "IS_REACT_ACT_ENVIRONMENT", "__duelLifecycleFixture"];
  const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const values = new Map(stored || []), reads = [], writes = [], requests = [], timers = new Map();
  const storage = {
    getItem(key) {
      reads.push(key);
      if (key.startsWith("dengta_intimate_duel") && (storageFails || storageReadFailures-- > 0)) throw new Error("FICTIONAL_PRIVATE_ARCHIVE_READ");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (key.startsWith("dengta_intimate_duel") && (storageFails || storageWriteFailures-- > 0)) throw new Error("FICTIONAL_PRIVATE_ARCHIVE_WRITE");
      writes.push({ key, value }); values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
  const sessionFor = account => ({ access_token: `fictional-${account}`, user: { id: account, email: "fixture@example.test" } });
  let session = sessionFor(ACCOUNT_A), authListener, signOuts = 0, nextTimer = 0, tree;
  let blockedSession;
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => ({ auth: {
    onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { if (blockedSession) { const wait = blockedSession; blockedSession = null; await wait.promise; } return { data: { session }, error: null }; },
    async refreshSession() { if (blockedSession) { const wait = blockedSession; blockedSession = null; await wait.promise; } return { data: { session }, error: null }; },
    async signOut() { signOuts++; session = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
  } }) });
  await manager.initialize(); manager.setActiveCompanionId(COMPANION_A);
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "__duelLifecycleFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    matchMedia() { return { matches: true }; },
  } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise((resolve, reject) => {
    assert.equal(new URL(url).origin, "http://duel.example.test", "fixtures must never reach production");
    const request = { path: new URL(url).pathname, options, reject,
      respond(data, status = 200, companion = COMPANION_A) { resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) } })); },
      respondWith: resolve,
    };
    requests.push(request);
    // Ignore transport abort so the real API and complete-body cancellation must handle it.
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false,
    appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://duel.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "duel-fictional-sdk", enforce: "pre", async transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__duelLifecycleFixture.manager;");
      if (env.DENGTA_DUEL_SOURCE && path.endsWith("/src/IntimateDuel.jsx")) return await readFile(env.DENGTA_DUEL_SOURCE, "utf8");
      return null;
    } }],
  });
  const { default: Duel } = await vite.ssrLoadModule("/src/IntimateDuel.jsx");
  const { readOperationFailures, clearOperationFailures } = await vite.ssrLoadModule("/src/operation-diagnostics.js");
  let account = withScope ? ACCOUNT_A : "", companion = withScope ? COMPANION_A : "", conversation = CONVERSATION;
  const nodes = () => tree.root.findAllByType("button");
  async function render() {
    const element = React.createElement(Duel, { aiName: "虚构伴侣", userName: "虚构用户", accountScope: account, companionScope: companion, conversationId: conversation });
    await act(async () => { if (tree) tree.update(element); else tree = TestRenderer.create(strict ? React.createElement(React.StrictMode, {}, element) : element); await tick(); });
  }
  await render();
  return {
    manager, values, reads, writes, timers, requests, render,
    text: () => textOf(tree.toJSON()),
    button: text => nodes().find(node => textOf(node) === text || node.props["aria-label"] === text),
    skill: () => nodes().find(node => node.props.className === "attack" && !node.props.disabled),
    saved: (a = ACCOUNT_A, c = COMPANION_A) => JSON.parse(values.get(storageKey(a, c))),
    signOuts: () => signOuts,
    failures: (a = ACCOUNT_A, c = COMPANION_A) => readOperationFailures(JSON.stringify([a, c])),
    async startTwice() { const click = this.skill().props.onClick; await act(async () => { click(); click(); await tick(); }); },
    async click(text) { const found = this.button(text); assert.ok(found, `visible ${text} action exists`); await act(async () => { found.props.onClick(); await tick(); }); },
    async clickTwice(text) { const found = this.button(text); assert.ok(found); const click = found.props.onClick; await act(async () => { click(); click(); await tick(); }); },
    async respond(index, data = receipt, status = 200, companionHeader) { await act(async () => { requests[index].respond(data, status, companionHeader); await tick(); }); },
    async reject(index) { await act(async () => { requests[index].reject(new Error("FICTIONAL_PRIVATE_TRANSPORT_ERROR")); await tick(); }); },
    async timeout() { await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 90_000) { timers.delete(id); timer.callback(); } await tick(); }); },
    async switchCompanion({ renderNow = false } = {}) { manager.setActiveCompanionId(COMPANION_B); companion = COMPANION_B; if (renderNow) await render(); },
    async switchAccount({ renderNow = false } = {}) { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); manager.setActiveCompanionId(COMPANION_B); account = ACCOUNT_B; companion = COMPANION_B; if (renderNow) await render(); },
    async changeConversation() { conversation = "66666666-6666-4666-8666-666666666666"; await render(); },
    blockAuth() { blockedSession = deferred(); session.expires_at = 1; authListener("TOKEN_REFRESHED", session); return blockedSession; },
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await tick(); }); tree = null; } },
    async close() { await this.unmount(); clearOperationFailures(JSON.stringify([ACCOUNT_A, COMPANION_A])); clearOperationFailures(JSON.stringify([ACCOUNT_B, COMPANION_B])); manager.destroy(); await vite.close(); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
}

test("same-tick skills make one scoped narration request with the existing DTO", async () => {
  const h = await harness(); try {
    await h.startTwice(); assert.equal(h.requests.length, 1);
    const request = h.requests[0], body = JSON.parse(request.options.body);
    assert.equal(request.path, "/api/v2/intimate-duel/narrate"); assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
    assert.equal(request.options.headers.get("Authorization"), `Bearer fictional-${ACCOUNT_A}`);
    assert.equal(body.conversation_id, CONVERSATION); assert.equal(body.round, 1);
    assert.deepEqual(Object.keys(body).sort(), ["conversation_id", "duel_id", "round", "player_name", "companion_name", "player_skill", "companion_skill", "available_companion_skills", "player", "companion", "player_combo", "companion_combo", "winner"].sort());
    assert.equal(h.saved().round, 1, "pending resources never become the saved state");
    await h.respond(0); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("already received narration and reaction display immediately without an artificial typewriter delay", async () => {
  const h = await harness(); try { await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/); assert.match(h.text(), /虚构即时反应/); } finally { await h.close(); }
});

for (const status of [400, 402, 429, 500, 503]) test(`HTTP ${status} rolls back the round instead of locally completing a fake success`, async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.respond(0, { code: status === 402 ? "provider_balance_insufficient" : "fixture_failure", message: "FICTIONAL_PRIVATE_ERROR" }, status);
    assert.deepEqual(h.saved(), initial); assert.match(h.text(), /本回合未完成/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_ERROR/);
    assert.ok(h.button("重试这一招")); if (status === 402) assert.match(h.text(), /余额不足/);
  } finally { await h.close(); }
});

test("a network failure preserves resources and allows a deliberate same-skill retry only", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.reject(0); assert.deepEqual(h.saved(), initial);
    assert.equal(h.requests.length, 1); await h.click("重试这一招"); assert.equal(h.requests.length, 2);
    assert.equal(JSON.parse(h.requests[1].options.body).player_skill, JSON.parse(h.requests[0].options.body).player_skill);
    await h.respond(1); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

for (const [label, data] of [
  ["empty JSON", {}], ["null", null], ["array", []],
  ["missing narration", { ok: true, companion_skill: "neck", reaction: "虚构反应", narration: "" }],
  ["invalid skill", { ...receipt, companion_skill: "not-a-skill" }],
  ["missing reaction", { ok: true, companion_skill: "neck", narration: "虚构正文" }],
  ["false ok", { ...receipt, ok: false }],
]) test(`a ${label} 200 receipt cannot advance or save a round`, async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.respond(0, data); assert.deepEqual(h.saved(), initial);
    assert.match(h.text(), /duel_response_invalid|duel_narration_missing/); assert.ok(h.button("重试这一招"));
  } finally { await h.close(); }
});

test("the current backend refusal DTO rolls back and identifies the provider without saving its text", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.respond(0, { ok: false, refused: true, refusal_code: "provider_boundary_residue", companion_skill: null, reaction: "", narration: "" });
    assert.deepEqual(h.saved(), initial); assert.match(h.text(), /provider_boundary_residue/); assert.ok(h.button("重试这一招"));
  } finally { await h.close(); }
});

test("a 90-second deadline covers an uncooperative fetch and clears its synchronous lock", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.timeout(); assert.equal(h.requests[0].options.signal.aborted, true);
    assert.deepEqual(h.saved(), initial); assert.match(h.text(), /duel_request_timeout/); assert.equal(h.timers.size, 0);
    await h.startTwice(); assert.equal(h.requests.length, 2); await h.respond(1);
  } finally { await h.close(); }
});

test("the complete-body deadline also recovers when headers arrived but JSON reading hangs", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); const body = deferred();
    await act(async () => { h.requests[0].respondWith({ ok: true, status: 200, headers: new Headers(), json: () => body.promise }); await tick(); });
    await h.timeout(); assert.deepEqual(h.saved(), initial); assert.match(h.text(), /duel_request_timeout/); assert.equal(h.timers.size, 0);
    await h.startTwice(); assert.equal(h.requests.length, 2); await h.respond(1);
    await act(async () => { body.resolve({ ...receipt, narration: "虚构迟到正文" }); await tick(); });
    assert.doesNotMatch(h.text(), /虚构迟到正文/); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("cancel restores only the pending round and a late reply cannot consume the following turn", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice(); await h.click("取消本回合"); assert.equal(h.requests[0].options.signal.aborted, true);
    assert.deepEqual(h.saved(), initial); assert.match(h.text(), /本回合已取消/); assert.equal(h.timers.size, 0);
    await h.startTwice(); await h.respond(0, { ...receipt, narration: "旧虚构回合" }); assert.doesNotMatch(h.text(), /旧虚构回合/);
    await h.respond(1); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("restart aborts and late success cannot overwrite a new match or its request lock", async () => {
  const h = await harness(); try {
    await h.startTwice(); const firstId = h.saved().id; await h.click("重新开始"); assert.equal(h.requests[0].options.signal.aborted, true);
    assert.notEqual(h.saved().id, firstId); assert.equal(h.saved().round, 1); const click = h.skill().props.onClick; await h.startTwice();
    await h.respond(0, { ...receipt, narration: "旧虚构重开结果" }); assert.doesNotMatch(h.text(), /旧虚构重开结果/);
    await act(async () => { click(); click(); await tick(); }); assert.equal(h.requests.length, 2); await h.respond(1); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

for (const status of [200, 401]) test(`late ${status} after a companion switch cannot replace the current auth header`, async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.switchCompanion(); await h.respond(0, status === 200 ? receipt : { code: "invalid_session", message: "FICTIONAL_PRIVATE_SESSION_ERROR" }, status, COMPANION_A);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.manager.getSnapshot().status, "authenticated"); assert.equal(h.signOuts(), 0);
    assert.equal(h.saved().round, 1); assert.doesNotMatch(h.text(), /虚构回合正文已完整收到。/);
  } finally { await h.close(); }
});

test("a request waiting for SDK session refresh is never sent with a new account's credentials", async () => {
  const h = await harness(); try {
    const auth = h.blockAuth(); await h.startTwice(); assert.equal(h.requests.length, 0); await h.switchAccount();
    await act(async () => { auth.resolve(); await tick(); }); assert.equal(h.requests.length, 0);
    assert.equal(h.saved().round, 1); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B);
  } finally { await h.close(); }
});

test("unmount aborts all work and a stale 401 cannot sign out the next account", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.unmount(); await h.switchAccount(); await h.respond(0, { code: "invalid_session" }, 401);
    assert.equal(h.requests[0].options.signal.aborted, true); assert.equal(h.timers.size, 0); assert.equal(h.signOuts(), 0);
    assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().status, "authenticated");
  } finally { await h.close(); }
});

test("changing props without an outer React key reads the separate companion archive before any write", async () => {
  const archive = playDuelRound(createDuelState({ playerName: "虚构乙用户", companionName: "虚构乙伴侣" }), "neck", () => 0).state;
  const archived = JSON.stringify(archive);
  const h = await harness({ stored: [[storageKey(ACCOUNT_A, COMPANION_B), archived]] }); try {
    await h.startTwice(); await h.respond(0); assert.equal(h.saved().round, 2);
    await h.switchCompanion({ renderNow: true }); assert.equal(h.saved(ACCOUNT_A, COMPANION_B).id, archive.id);
    assert.match(h.text(), /虚构乙伴侣/); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("legacy unscoped saves are left untouched and unavailable storage does not crash a round", async () => {
  const legacy = "FICTIONAL_LEGACY_ARCHIVE";
  const h = await harness({ stored: [["dengta_intimate_duel_v3", legacy]], storageFails: true }); try {
    assert.equal(h.values.get("dengta_intimate_duel_v3"), legacy); await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/);
  } finally { await h.close(); }
});

test("a missing account or companion disables model calls and never writes an unscoped save", async () => {
  const h = await harness({ withScope: false }); try {
    const clickable = h.skill(); if (clickable) await act(async () => { clickable.props.onClick(); await tick(); });
    assert.equal(h.requests.length, 0); assert.equal(h.writes.filter(write => write.key.startsWith("dengta_intimate_duel")).length, 0);
  } finally { await h.close(); }
});

test("StrictMode starts no model work until a deliberate skill selection", async () => {
  const h = await harness({ strict: true }); try { assert.equal(h.requests.length, 0); await h.startTwice(); assert.equal(h.requests.length, 1); await h.respond(0); assert.equal(h.saved().round, 2); } finally { await h.close(); }
});

test("a failed later round preserves the previous confirmed reply and its numeric state", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.respond(0); const confirmed = h.saved(); await h.startTwice(); await h.respond(1, {}, 503);
    assert.deepEqual(h.saved(), confirmed); assert.match(h.text(), /虚构回合正文已完整收到。/); assert.ok(h.button("重试这一招"));
    await h.clickTwice("重试这一招"); assert.equal(h.requests.length, 3); await h.respond(2); assert.equal(h.saved().round, 3);
  } finally { await h.close(); }
});

test("an empty reaction with valid narration is a supported backend response", async () => {
  const h = await harness(); try { await h.startTwice(); await h.respond(0, { ...receipt, reaction: "" }); assert.equal(h.saved().round, 2); assert.match(h.text(), /虚构回合正文已完整收到。/); } finally { await h.close(); }
});

test("a terminal player move accepts the backend's null counter-move and offers another match", async () => {
  const initial = createDuelState({ playerName: "虚构用户", companionName: "虚构伴侣" }); initial.companion.pleasure = 92;
  const h = await harness({ stored: [[storageKey(), JSON.stringify(initial)]] }); try {
    await h.startTwice(); assert.equal(JSON.parse(h.requests[0].options.body).winner, "player");
    await h.respond(0, { ...receipt, companion_skill: null }); assert.equal(h.saved().status, "finished"); assert.equal(h.saved().winner, "player");
    assert.ok(h.button("再来一局")); await h.click("再来一局"); assert.equal(h.saved().status, "active"); assert.equal(h.saved().round, 1);
  } finally { await h.close(); }
});

test("a confirmed archive restores without making a model call or changing its owner", async () => {
  const first = await harness(); let archive;
  try { await first.startTwice(); await first.respond(0); archive = JSON.stringify(first.saved()); } finally { await first.close(); }
  const h = await harness({ stored: [[storageKey(), archive]] }); try {
    assert.equal(h.requests.length, 0); assert.equal(JSON.stringify(h.saved()), archive); assert.match(h.text(), /虚构回合正文已完整收到。/);
  } finally { await h.close(); }
});

test("unknown upstream messages and credential-looking codes never enter the visible failure notice", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.respond(0, { code: "sb_secret_your_fixture_key_5", message: "FICTIONAL_PRIVATE_UPSTREAM_MESSAGE", error_log_id: "FICTIONAL_INVALID_LOG" }, 500);
    assert.match(h.text(), /错误代码：unknown/); assert.match(h.text(), /HTTP 500/);
    assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE|FICTIONAL_INVALID_LOG/); assert.ok(h.button("重试这一招"));
  } finally { await h.close(); }
});

test("a valid log UUID is displayed with its existing log-panel location", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.respond(0, { code: "provider_balance_insufficient", error_log_id: "77777777-7777-4777-8777-777777777777" }, 402);
    assert.match(h.text(), /77777777-7777-4777-8777-777777777777/); assert.match(h.text(), /错误日志/); assert.match(h.text(), /余额不足/);
  } finally { await h.close(); }
});

test("a JSON decoding failure is an invalid receipt rather than a locally narrated success", async () => {
  const h = await harness(); try {
    const initial = h.saved(); await h.startTwice();
    await act(async () => { h.requests[0].respondWith({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error("FICTIONAL_PRIVATE_PARSE_ERROR"); } }); await tick(); });
    assert.deepEqual(h.saved(), initial); assert.match(h.text(), /duel_response_invalid/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_PARSE_ERROR/);
  } finally { await h.close(); }
});

test("blocked duel persistence is visible while authentication and the complete reply still work", async () => {
  const h = await harness({ storageFails: true }); try {
    assert.match(h.text(), /本机存档不可用/); await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/);
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
  } finally { await h.close(); }
});

for (const [code, data] of [
  ["duel_response_invalid", {}],
  ["duel_narration_missing", { ...receipt, narration: "", reaction: "FICTIONAL_PRIVATE_REACTION" }],
]) test(`${code} records one scoped local diagnosis with no reply body`, async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.respond(0, data); const failures = h.failures(); assert.equal(failures.length, 1);
    assert.equal(failures[0].code, "DT-DUEL"); assert.equal(failures[0].reasonCode, code); assert.equal(failures[0].status, null);
    assert.doesNotMatch(JSON.stringify(failures), /FICTIONAL_PRIVATE|虚构即时反应|虚构回合正文|虚构用户|虚构伴侣/);
    assert.equal(h.failures(ACCOUNT_B, COMPANION_B).length, 0);
  } finally { await h.close(); }
});

test("the local complete-response timeout is recorded once while cancellation is not a failure", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.timeout(); assert.equal(h.failures().length, 1); assert.equal(h.failures()[0].reasonCode, "duel_request_timeout");
    await h.startTwice(); await h.click("取消本回合"); assert.equal(h.failures().length, 1);
  } finally { await h.close(); }
});

test("a late invalid receipt after switching scope cannot create a diagnosis in the new account", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.switchAccount({ renderNow: true }); await h.respond(0, {});
    assert.equal(h.failures().length, 0); assert.equal(h.failures(ACCOUNT_B, COMPANION_B).length, 0);
  } finally { await h.close(); }
});

test("HTTP failures keep the real API's diagnosis without recording it again in the component", async () => {
  const h = await harness(); try {
    await h.startTwice(); await h.respond(0, { code: "provider_balance_insufficient", message: "FICTIONAL_PRIVATE_UPSTREAM" }, 402);
    assert.equal(h.failures().length, 1); assert.equal(h.failures()[0].status, 402); assert.doesNotMatch(JSON.stringify(h.failures()), /FICTIONAL_PRIVATE/);
  } finally { await h.close(); }
});

test("a transient archive read failure cannot overwrite the original while in-memory rounds remain usable", async () => {
  const archived = JSON.stringify(playDuelRound(createDuelState({ playerName: "虚构存档用户", companionName: "虚构存档伴侣" }), "neck", () => 0).state);
  const h = await harness({ stored: [[storageKey(), archived]], storageReadFailures: 1 }); try {
    assert.equal(h.values.get(storageKey()), archived, "opening after a failed read preserves every saved byte");
    assert.equal(h.writes.filter(write => write.key === storageKey()).length, 0);
    assert.match(h.text(), /duel_archive_read_failed/);
    assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_ARCHIVE_READ/);
    await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/);
    assert.equal(h.values.get(storageKey()), archived, "successful temporary play cannot write over an unread archive");
    await h.click("重新读取本机存档"); assert.equal(h.saved().id, JSON.parse(archived).id);
    assert.match(h.text(), /虚构存档伴侣/); assert.doesNotMatch(h.text(), /duel_archive_read_failed/);
    assert.equal(h.requests.length, 1, "archive recovery must never request a new narration");
  } finally { await h.close(); }
});

for (const [label, archived] of [
  ["truncated JSON", '{"version":3,"logs":['], ["empty saved value", ""],
  ["unsupported version", '{"version":99,"text":"FICTIONAL_ARCHIVE"}'],
  ["null JSON", "null"], ["array JSON", "[]"], ["incomplete version-3 object", '{"version":3,"text":"FICTIONAL_ARCHIVE"}'],
]) {
  test(`a ${label} archive stays untouched after reading, retrying, cancellation, and restart`, async () => {
    const h = await harness({ stored: [[storageKey(), archived]] }); try {
      assert.equal(h.values.get(storageKey()), archived); assert.match(h.text(), /duel_archive_invalid/);
      assert.doesNotMatch(h.text(), /FICTIONAL_ARCHIVE/);
      await h.click("重新读取本机存档"); assert.equal(h.values.get(storageKey()), archived);
      await h.startTwice(); await h.click("取消本回合"); await h.respond(0);
      assert.equal(h.values.get(storageKey()), archived); assert.doesNotMatch(h.text(), /虚构回合正文已完整收到。/);
      await h.click("重新开始"); assert.equal(h.values.get(storageKey()), archived);
      assert.equal(h.writes.filter(write => write.key === storageKey()).length, 0);
    } finally { await h.close(); }
  });
}

test("an archive recovery callback captured in a previous scope cannot read or replace the next companion", async () => {
  const archived = JSON.stringify(createDuelState({ playerName: "虚构甲用户", companionName: "虚构甲伴侣" }));
  const nextArchive = JSON.stringify(playDuelRound(createDuelState({ playerName: "虚构乙用户", companionName: "虚构乙伴侣" }), "neck", () => 0).state);
  const h = await harness({ stored: [[storageKey(), archived], [storageKey(ACCOUNT_A, COMPANION_B), nextArchive]], storageReadFailures: 1 }); try {
    const recovery = h.button("重新读取本机存档"); assert.ok(recovery); const click = recovery.props.onClick;
    await h.switchCompanion({ renderNow: true });
    await act(async () => { click(); await tick(); });
    assert.equal(h.values.get(storageKey()), archived); assert.equal(h.values.get(storageKey(ACCOUNT_A, COMPANION_B)), nextArchive);
    assert.match(h.text(), /虚构乙伴侣/); assert.doesNotMatch(h.text(), /虚构甲伴侣/); assert.equal(h.requests.length, 0);
  } finally { await h.close(); }
});

test("archive recovery checks the latest bytes and preserves valid raw formatting until a confirmed state change", async () => {
  const archived = JSON.stringify(createDuelState({ playerName: "虚构存档用户", companionName: "虚构原存档伴侣" }), null, 2);
  const h = await harness({ stored: [[storageKey(), archived]], storageReadFailures: 1 }); try {
    await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/);
    const replaced = '{"version":99,"text":"FICTIONAL_ARCHIVE_CHANGED"}'; h.values.set(storageKey(), replaced);
    await h.click("重新读取本机存档"); assert.equal(h.values.get(storageKey()), replaced);
    assert.match(h.text(), /duel_archive_invalid/); assert.match(h.text(), /虚构回合正文已完整收到。/);
    assert.doesNotMatch(h.text(), /FICTIONAL_ARCHIVE_CHANGED/);
    h.values.set(storageKey(), archived); await h.click("重新读取本机存档");
    assert.equal(h.values.get(storageKey()), archived); assert.equal(h.writes.filter(write => write.key === storageKey()).length, 0);
    assert.match(h.text(), /虚构原存档伴侣/); assert.doesNotMatch(h.text(), /duel_archive_invalid|虚构回合正文已完整收到。/);
    await h.startTwice(); await h.respond(1); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("archive recovery ignores busy, changed-account, and unmounted callbacks before reading storage", async () => {
  const archived = JSON.stringify(createDuelState({ playerName: "虚构用户", companionName: "虚构伴侣" }));
  const h = await harness({ stored: [[storageKey(), archived]], storageReadFailures: 1 }); try {
    const click = h.button("重新读取本机存档").props.onClick;
    await h.startTwice(); assert.equal(h.button("重新读取本机存档").props.disabled, true);
    const before = h.reads.filter(key => key === storageKey()).length;
    await act(async () => { click(); await tick(); }); assert.equal(h.reads.filter(key => key === storageKey()).length, before);
    await h.respond(0); await h.switchAccount();
    await act(async () => { click(); await tick(); }); assert.equal(h.reads.filter(key => key === storageKey()).length, before);
    await h.unmount(); await act(async () => { click(); await tick(); });
    assert.equal(h.reads.filter(key => key === storageKey()).length, before); assert.equal(h.values.get(storageKey()), archived);
    assert.equal(h.requests.length, 1); assert.equal(h.signOuts(), 0);
  } finally { await h.close(); }
});

test("a failed write preserves the last archive and requires a fresh read before persistence resumes", async () => {
  const archived = JSON.stringify(createDuelState({ playerName: "虚构用户", companionName: "虚构存档伴侣" }));
  const h = await harness({ stored: [[storageKey(), archived]], storageWriteFailures: 1 }); try {
    await h.startTwice(); await h.respond(0); assert.match(h.text(), /duel_archive_write_failed/);
    assert.match(h.text(), /虚构回合正文已完整收到。/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_ARCHIVE_WRITE/);
    assert.equal(h.values.get(storageKey()), archived); await h.click("重新开始"); assert.equal(h.values.get(storageKey()), archived);
    await h.click("重新读取本机存档"); assert.equal(h.values.get(storageKey()), archived); assert.doesNotMatch(h.text(), /duel_archive_write_failed/);
    assert.equal(h.requests.length, 1); await h.startTwice(); await h.respond(1); assert.equal(h.saved().round, 2);
  } finally { await h.close(); }
});

test("StrictMode preserves an unreadable archive while temporary play remains available", async () => {
  const archived = '{"version":3,"text":"FICTIONAL_ARCHIVE_STRICT"}';
  const h = await harness({ stored: [[storageKey(), archived]], strict: true }); try {
    assert.match(h.text(), /duel_archive_invalid/); assert.equal(h.values.get(storageKey()), archived);
    await h.startTwice(); await h.respond(0); assert.match(h.text(), /虚构回合正文已完整收到。/);
    assert.equal(h.values.get(storageKey()), archived); assert.equal(h.writes.filter(write => write.key === storageKey()).length, 0);
  } finally { await h.close(); }
});

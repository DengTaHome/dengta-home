import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { AUTH_STATUS, createAuthSessionManager } from "../src/auth-session.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const entry = title => ({ id: title, title, content: "", created_at: "2026-10-06T08:00:00Z", source_message_count: 8 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function settle() { for (let index = 0; index < 40; index += 1) await Promise.resolve(); }

async function harness() {
  const descriptors = Object.fromEntries(["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__diaryLifecycleFixture"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const storageValues = new Map();
  const storage = { getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, String(value)), removeItem: key => storageValues.delete(key) };
  const sessionFor = account => ({ access_token: `fictional-${account}`, user: { id: account, email: "fictional@example.test" } });
  let session = sessionFor(ACCOUNT_A), authListener, signOuts = 0;
  const client = { auth: {
    onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async signOut() { signOuts += 1; session = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => client });
  await manager.initialize();
  manager.setActiveCompanionId(COMPANION_A);
  const requests = [], notices = [], timers = new Map();
  let nextTimer = 0, tree;
  const window = {
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, interval: true }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, interval: false }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible" } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__diaryLifecycleFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://diary.example.test", "the fixture must not contact production");
    const request = {
      path: new URL(url).pathname, method: options.method || "GET", body: options.body,
      companion: options.headers.get("X-DengTa-Companion-Id"), signal: options.signal,
      respond(status, data, companion = COMPANION_A) { resolve(new Response(JSON.stringify(data), { status, headers: companion ? { "X-DengTa-Companion-Id": companion } : {} })); },
      respondWith: resolve,
    };
    requests.push(request);
    // Deliberately ignore fetch abort to exercise the actual API's abort race and auth guard.
  }) });
  const vite = await createServer({
    configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false,
    appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://diary.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "diary-fixture-auth", enforce: "pre", async transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__diaryLifecycleFixture.manager;");
      if (env.DENGTA_DIARY_SOURCE && path.endsWith("/src/CompanionDiary.jsx")) return await readFile(env.DENGTA_DIARY_SOURCE, "utf8");
      return null;
    } }],
  });
  const { default: CompanionDiary } = await vite.ssrLoadModule("/src/CompanionDiary.jsx");
  let onNotice = value => notices.push(value);
  async function render({ remount = false, notice = onNotice } = {}) {
    onNotice = notice;
    const scopeKey = settingsSaveScope(manager.getSnapshot());
    const element = React.createElement(CompanionDiary, { aiName: "虚构伴侣", scopeKey, onNotice, ...(remount ? { key: scopeKey } : {}) });
    await act(async () => { if (tree) tree.update(element); else tree = TestRenderer.create(element); await settle(); });
    await act(async () => {
      for (const [id, timer] of [...timers]) if (!timer.interval && timer.delay === 0) { timers.delete(id); timer.callback(); }
      await settle();
    });
  }
  await render();
  return {
    manager, requests, notices, timers, storageValues, render,
    text: () => text(tree.toJSON()),
    button: () => tree.root.findAll(node => node.type === "button" && text(node) === "重新读取")[0],
    async respond(index, status, data, companion) { await act(async () => { requests[index].respond(status, data, companion); await settle(); }); },
    async poll() { await act(async () => { const poll = [...timers.values()].find(timer => timer.interval && timer.delay === 20_000); assert.ok(poll, "actual diary installs its 20-second poll"); poll.callback(); await settle(); }); },
    async timeout() { await act(async () => { for (const [id, timer] of [...timers]) if (!timer.interval) { timers.delete(id); timer.callback(); } await settle(); }); },
    async clickTwice() { const button = this.button(); assert.ok(button, "failed GET has a read-only recovery button"); await act(async () => { button.props.onClick(); button.props.onClick(); await settle(); }); },
    switchAccount() { session = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", session); manager.setActiveCompanionId(COMPANION_B); },
    switchCompanion() { manager.setActiveCompanionId(COMPANION_B); },
    signOuts: () => signOuts,
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await settle(); }); tree = null; } },
    async finish() {
      await this.unmount(); manager.destroy(); await vite.close();
      for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    },
  };
}

test("initial failed GET is a read failure with recovery, rather than a successful empty diary", async () => {
  const h = await harness();
  try {
    await h.respond(0, 500, { code: "fictional_read_failure" });
    assert.match(h.text(), /读取.*未完成|无法读取/);
    assert.doesNotMatch(h.text(), /第一页还留着空白/);
    assert.ok(h.button());
  } finally { await h.finish(); }
});

test("read status does not imply unavailable backend generation progress", async () => {
  const h = await harness();
  try {
    assert.doesNotMatch(h.text(), /正在检查最近的对话|正在写/);
    await h.respond(0, 200, { available: true, entries: [] });
    assert.doesNotMatch(h.text(), /正在等待新的对话/);
  } finally { await h.finish(); }
});

test("read retry deduplicates same-turn clicks and uses only GET", async () => {
  const h = await harness();
  try {
    await h.respond(0, 500, {});
    await h.clickTwice();
    assert.equal(h.requests.length, 2);
    assert.equal(h.button().props.disabled, true);
    await h.respond(1, 200, { available: true, entries: [entry("fictional-recovered")] });
    assert.match(h.text(), /fictional-recovered/);
    assert.equal(h.button(), undefined);
    assert.ok(h.requests.every(request => request.path === "/api/v2/diary" && request.method === "GET" && request.body === undefined));
  } finally { await h.finish(); }
});

test("unavailable storage has an honest read-only recovery without claiming generation readiness", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, { available: false, entries: [] });
    assert.match(h.text(), /暂时不可用/);
    assert.doesNotMatch(h.text(), /生成逻辑已经就绪|009_companion_diary/);
    await h.clickTwice();
    await h.respond(1, 200, { available: true, entries: [] });
    assert.match(h.text(), /第一页还留着空白/);
    assert.equal(h.requests.length, 2);
  } finally { await h.finish(); }
});

test("slow GET skips overlapping polls, then releases its read lock and respects visibility", async () => {
  const h = await harness();
  try {
    await h.poll(); await h.poll();
    assert.equal(h.requests.length, 1);
    await h.respond(0, 200, { available: true, entries: [entry("fictional-first")] });
    assert.match(h.text(), /fictional-first/);
    document.visibilityState = "hidden";
    await h.poll();
    assert.equal(h.requests.length, 1);
    document.visibilityState = "visible";
    await h.poll();
    assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { available: true, entries: [entry("fictional-second")] });
    assert.match(h.text(), /fictional-second/);
    assert.doesNotMatch(h.text(), /fictional-first/);
  } finally { await h.finish(); }
});

test("failed poll preserves the last successful entries and read-only retry clears the error", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, { available: true, entries: [entry("fictional-last-success")] });
    await h.poll(); await h.respond(1, 500, {});
    assert.match(h.text(), /fictional-last-success/);
    assert.ok(h.button());
    assert.equal(h.notices.length, 0, "background failures stay in the page rather than repeatedly notifying");
    await h.clickTwice();
    await h.respond(2, 200, { available: true, entries: [entry("fictional-new-success")] });
    assert.match(h.text(), /fictional-new-success/);
    assert.equal(h.button(), undefined);
  } finally { await h.finish(); }
});

test("notice callback replacement does not restart the request or the poll lifecycle", async () => {
  const h = await harness();
  try {
    const initialPoll = [...h.timers].find(([, timer]) => timer.interval)?.[0];
    const newerNotices = [];
    await h.render({ notice: value => newerNotices.push(value) });
    assert.equal(h.requests.length, 1);
    assert.equal([...h.timers].find(([, timer]) => timer.interval)?.[0], initialPoll);
    await h.respond(0, 500, {});
    assert.equal(h.notices.length, 0);
    assert.equal(newerNotices.length, 1);
  } finally { await h.finish(); }
});

test("invalid persisted dates render a fallback without crashing the actual component", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, { available: true, entries: [{ ...entry("fictional-invalid-date"), created_at: "invalid-date", source_window_start: "invalid-start", source_window_end: "2026-10-06T08:00:00Z" }] });
    assert.match(h.text(), /fictional-invalid-date/);
    assert.match(h.text(), /日期未知/);
  } finally { await h.finish(); }
});

test("request timeout exposes a recoverable read failure and permits the next poll", async () => {
  const h = await harness();
  try {
    assert.ok([...h.timers.values()].some(timer => !timer.interval && timer.delay === 15_000));
    await h.timeout();
    assert.equal(h.requests[0].signal?.aborted, true);
    assert.ok(h.button());
    await h.poll();
    assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { available: true, entries: [] });
    assert.match(h.text(), /第一页还留着空白/);
  } finally { await h.finish(); }
});

for (const switchKind of ["account", "companion"]) {
  for (const status of [200, 401]) {
    test(`late diary ${status} cannot mutate the next ${switchKind} after scope change`, async () => {
      const h = await harness();
      try {
        assert.equal(h.requests[0].companion, COMPANION_A);
        if (switchKind === "account") h.switchAccount(); else h.switchCompanion();
        await h.render();
        assert.equal(h.requests.length, 2);
        assert.equal(h.requests[1].companion, COMPANION_B);
        await h.respond(1, 200, { available: true, entries: [entry("fictional-next-scope")] }, COMPANION_B);
        await h.respond(0, status, status === 401 ? { code: "invalid_session" } : { available: true, entries: [entry("fictional-old-scope")] });
        assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
        assert.equal(h.manager.getSnapshot().user?.id, switchKind === "account" ? ACCOUNT_B : ACCOUNT_A);
        assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
        assert.equal(h.signOuts(), 0);
        assert.equal(h.requests[0].signal?.aborted, true);
        assert.match(h.text(), /fictional-next-scope/);
        assert.doesNotMatch(h.text(), /fictional-old-scope/);
        assert.equal(h.notices.length, 0);
      } finally { await h.finish(); }
    });
  }
}

test("late 401 body after fetch resolves cannot invalidate a newer account", async () => {
  const h = await harness();
  const body = deferred();
  try {
    await act(async () => {
      h.requests[0].respondWith({ status: 401, ok: false, headers: new Headers({ "X-DengTa-Companion-Id": COMPANION_A }), clone: () => ({ json: () => body.promise }), json: async () => ({ code: "invalid_session" }) });
      await settle();
    });
    h.switchAccount(); await h.render();
    await h.respond(1, 200, { available: true, entries: [entry("fictional-current-body")] }, COMPANION_B);
    await act(async () => { body.resolve({ code: "invalid_session" }); await settle(); });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
    assert.equal(h.manager.getSnapshot().user?.id, ACCOUNT_B);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
    assert.equal(h.signOuts(), 0);
    assert.match(h.text(), /fictional-current-body/);
  } finally { await h.finish(); }
});

test("unmount cancels a pending read, clears timers and silences its late receipt", async () => {
  const h = await harness();
  try {
    await h.unmount();
    assert.equal(h.timers.size, 0);
    h.switchAccount();
    await h.respond(0, 401, { code: "invalid_session" });
    assert.equal(h.signOuts(), 0);
    assert.equal(h.manager.getSnapshot().user?.id, ACCOUNT_B);
    assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
    assert.equal(h.notices.length, 0);
    assert.equal(h.requests[0].signal?.aborted, true);
  } finally { await h.finish(); }
});

for (const status of [200, 401]) {
  test(`scope guard blocks a late ${status} before the parent rerenders`, async () => {
    const h = await harness();
    try {
      h.switchAccount();
      await h.respond(0, status, status === 401 ? { code: "invalid_session" } : { available: true, entries: [entry("fictional-abandoned")] });
      assert.equal(h.manager.getSnapshot().user?.id, ACCOUNT_B);
      assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B);
      assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated);
      assert.equal(h.signOuts(), 0);
      assert.doesNotMatch(h.text(), /fictional-abandoned/);
      assert.equal(h.notices.length, 0);
    } finally { await h.finish(); }
  });
}

test("a current 401 still expires the current session through the actual auth manager", async () => {
  const h = await harness();
  try {
    await h.respond(0, 401, { code: "invalid_session" });
    assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.expired);
    assert.equal(h.manager.getSnapshot().user, null);
    assert.ok(h.signOuts() > 0, "scope protection retains current-session expiry");
  } finally { await h.finish(); }
});

test("unknown upstream messages are replaced by a reason, action and normalized code in page and notice", async () => {
  const h = await harness();
  const rawMessage = "FICTIONAL_PRIVATE_DIARY_EXCERPT_DO_NOT_DISPLAY";
  const rawCode = "FICTIONAL BAD CODE\nDO_NOT_DISPLAY";
  try {
    await h.respond(0, 500, { code: rawCode, message: rawMessage });
    assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_DIARY_EXCERPT_DO_NOT_DISPLAY|FICTIONAL BAD CODE|DO_NOT_DISPLAY/);
    assert.doesNotMatch(h.notices.join(""), /FICTIONAL_PRIVATE_DIARY_EXCERPT_DO_NOT_DISPLAY|FICTIONAL BAD CODE|DO_NOT_DISPLAY/);
    assert.match(h.text(), /现有日志尚未指出具体原因/);
    assert.match(h.text(), /先刷新核对结果/);
    assert.match(h.text(), /错误代码：unknown/);
    assert.match(h.notices[0], /错误代码：unknown/);
    await h.clickTwice();
    await h.respond(1, 200, { available: true, entries: [entry("fictional-sanitized-recovery")] });
    assert.match(h.text(), /fictional-sanitized-recovery/);
    assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
  } finally { await h.finish(); }
});

test("unknown poll failure keeps loaded entries and never displays the upstream raw message", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, { available: true, entries: [entry("fictional-retained-on-raw-error")] });
    await h.poll();
    await h.respond(1, 500, { code: "fictional_unrecognized_failure", message: "FICTIONAL_UPSTREAM_DIARY_RAW_MESSAGE" });
    assert.match(h.text(), /fictional-retained-on-raw-error/);
    assert.match(h.text(), /错误代码：fictional_unrecognized_failure/);
    assert.doesNotMatch(h.text(), /FICTIONAL_UPSTREAM_DIARY_RAW_MESSAGE/);
    assert.equal(h.notices.length, 0);
    await h.clickTwice();
    await h.respond(2, 200, { available: true, entries: [entry("fictional-recovered-after-raw-error")] });
    assert.match(h.text(), /fictional-recovered-after-raw-error/);
    assert.equal(h.button(), undefined);
    assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
  } finally { await h.finish(); }
});

for (const [label, data] of [
  ["missing fields", {}],
  ["nonboolean availability", { available: "true", entries: [] }],
  ["nonarray entries", { available: true, entries: {} }],
  ["null entries even when unavailable", { available: false, entries: null }],
]) {
  test(`invalid successful diary receipt (${label}) becomes a read failure with GET recovery`, async () => {
    const h = await harness();
    try {
      await h.respond(0, 200, data);
      assert.match(h.text(), /记忆手记读取未完成/);
      assert.match(h.text(), /错误代码：diary_receipt_invalid/);
      assert.doesNotMatch(h.text(), /第一页还留着空白|记忆手记暂时不可用/);
      await h.clickTwice();
      await h.respond(1, 200, { available: true, entries: [] });
      assert.match(h.text(), /第一页还留着空白/);
      assert.equal(h.button(), undefined);
      assert.equal(h.requests.length, 2);
      assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
    } finally { await h.finish(); }
  });
}

test("invalid successful poll receipt retains the last valid list and supports GET-only recovery", async () => {
  const h = await harness();
  try {
    await h.respond(0, 200, { available: true, entries: [entry("fictional-valid-before-bad-receipt")] });
    await h.poll(); await h.respond(1, 200, { available: true, entries: {} });
    assert.match(h.text(), /fictional-valid-before-bad-receipt/);
    assert.match(h.text(), /错误代码：diary_receipt_invalid/);
    assert.doesNotMatch(h.text(), /第一页还留着空白/);
    assert.equal(h.notices.length, 0);
    await h.clickTwice();
    await h.respond(2, 200, { available: true, entries: [entry("fictional-valid-after-bad-receipt")] });
    assert.match(h.text(), /fictional-valid-after-bad-receipt/);
    assert.equal(h.button(), undefined);
    assert.equal(h.requests.length, 3);
    assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
  } finally { await h.finish(); }
});

test("saved diary text is readable immediately after GET and after reopening", async () => {
  const h = await harness();
  const content = "虚构角色一起在灯下拼完了地图，明天还要继续寻找那条小路。";
  const saved = { ...entry("fictional-readable-entry"), content };
  try {
    await h.respond(0, 200, { available: true, entries: [saved] });
    assert.ok(h.text().includes(content), "a completed saved entry does not make the reader wait for artificial typing");
    await h.unmount();
    await h.render();
    assert.equal(h.requests.length, 2);
    await h.respond(1, 200, { available: true, entries: [saved] });
    assert.ok(h.text().includes(content), "reopening reads the completed text without replaying a typing animation");
    assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
  } finally { await h.finish(); }
});

for (const [label, malformed] of [
  ["null entry", null],
  ["object title", { ...entry("fictional-invalid-title"), title: { text: "fictional" } }],
  ["object content", { ...entry("fictional-invalid-content"), content: { text: "fictional" } }],
  ["object mood", { ...entry("fictional-invalid-mood"), mood: { text: "fictional" } }],
  ["object source count", { ...entry("fictional-invalid-count"), source_message_count: { count: 8 } }],
]) {
  test(`invalid diary entry (${label}) reports a recoverable receipt error without losing the last valid text`, async () => {
    const h = await harness();
    try {
      await h.respond(0, 200, { available: true, entries: [entry("fictional-safe-before-invalid-entry")] });
      await h.poll();
      await h.respond(1, 200, { available: true, entries: [malformed] });
      assert.match(h.text(), /fictional-safe-before-invalid-entry/);
      assert.match(h.text(), /错误代码：diary_receipt_invalid/);
      assert.equal(h.notices.length, 0, "poll failure remains local to the page");
      await h.clickTwice();
      await h.respond(2, 200, { available: true, entries: [entry("fictional-safe-after-invalid-entry")] });
      assert.match(h.text(), /fictional-safe-after-invalid-entry/);
      assert.equal(h.button(), undefined);
      assert.equal(h.requests.length, 3);
      assert.ok(h.requests.every(request => request.method === "GET" && request.body === undefined));
    } finally { await h.finish(); }
  });
}

test("new completed diary received by a poll exposes the full body without changing its source window", async () => {
  const h = await harness();
  const content = "虚构的新手记保留整段正文和标点，不需要等待逐字回放。";
  const saved = {
    ...entry("fictional-new-completed-diary"), content,
    source_window_start: "2026-10-06T07:00:00Z",
    source_window_end: "2026-10-06T08:00:00Z",
  };
  try {
    await h.respond(0, 200, { available: true, entries: [] });
    await h.poll();
    await h.respond(1, 200, { available: true, entries: [saved] });
    assert.ok(h.text().includes(content));
    assert.match(h.text(), /依据 8 条真实消息/);
    const article = h.text();
    assert.match(article, /2026年10月6日/);
    assert.match(article, / 至 /);
    assert.deepEqual(saved, {
      ...entry("fictional-new-completed-diary"), content,
      source_window_start: "2026-10-06T07:00:00Z",
      source_window_end: "2026-10-06T08:00:00Z",
    });
  } finally { await h.finish(); }
});

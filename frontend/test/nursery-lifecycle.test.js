import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "node:process";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const CHILD = "55555555-5555-4555-8555-555555555555";
const sessionFor = account => ({ access_token: `fictional-${account}`, user: { id: account, email: "fixture@example.test" } });
const snapshot = ({ mood = 20, name = null, child = true } = {}) => ({
  available: true,
  child: child ? { id: CHILD, name, display_name: name || "虚构小朋友", state_version: mood === 20 ? 0 : 1, stage: { label: "婴儿", age_days: 1 } } : null,
  state: child ? { mood, health: 50, intimacy: 20, nutrition: 50, fatigue: 20, digest_load: 0 } : null,
  bonds: [], actions: [], utterances: [], milestones: [], events: [], portrait: null, provider_calls: 0, embedding_calls: 0,
});
const portrait = { language: { learned_characters: 3, unique_characters: 2, utterances: 1 }, milestones: 0 };
const actionReceipt = (kind = "talk", actor = "user", overrides = {}) => ({
  idempotent: false,
  action: { id: "66666666-6666-4666-8666-666666666666", actor, kind,
    effective_at: "2026-10-08T01:00:00.000Z", applied_at: "2026-10-08T01:00:00.000Z" },
  ...snapshot({ mood: 77 }),
  ...overrides,
});
const values = new Map();
let sdkSession = sessionFor(ACCOUNT_A), authListener, signOutCalls = [], tree, manager;
const timers = new Map(), requests = [], notices = [];
let timerId = 0;
const timer = (kind, callback, delay) => { const id = ++timerId; timers.set(id, { kind, callback, delay }); return id; };
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
const fixture = {
  authOptions: {
    supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage,
    createClientFn: () => ({ auth: {
      async getSession() { return { data: { session: sdkSession }, error: null }; },
      onAuthStateChange(listener) { authListener = listener; return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut(options) { signOutCalls.push(options); sdkSession = null; authListener?.("SIGNED_OUT", null); return { error: null }; },
    } }),
  },
};
const globalNames = ["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__nurseryLifecycleFixture"];
const descriptors = Object.fromEntries(globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__nurseryLifecycleFixture = fixture;
globalThis.window = {
  setTimeout: (callback, delay) => timer("timeout", callback, delay), clearTimeout: id => timers.delete(id),
  setInterval: (callback, delay) => timer("interval", callback, delay), clearInterval: id => timers.delete(id),
};
globalThis.document = { visibilityState: "visible" };
globalThis.fetch = (url, options = {}) => new Promise((fulfill, reject) => {
  const request = {
    path: new URL(url).pathname, method: options.method || "GET", options,
    respond(data, status = 200, companion = COMPANION_A) {
      fulfill(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) } }));
    },
    reject,
  };
  requests.push(request);
});

const cacheDir = mkdtempSync(join(tmpdir(), "dengta-nursery-lifecycle-"));
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), cacheDir, appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
  plugins: [{ name: "nursery-fictional-sdk", enforce: "pre", load(id) {
    const normalized = id.replaceAll("\\", "/");
    if (normalized.endsWith("/src/auth-session.js")) {
      return readFileSync(id, "utf8").replace("export const authSession = createAuthSessionManager();", "export const authSession = createAuthSessionManager(globalThis.__nurseryLifecycleFixture.authOptions);");
    }
    if (env.DENGTA_NURSERY_SOURCE && normalized.endsWith("/src/Nursery.jsx")) return readFileSync(env.DENGTA_NURSERY_SOURCE, "utf8");
  } }],
});
const { default: Nursery } = await vite.ssrLoadModule("/src/Nursery.jsx");
({ authSession: manager } = await vite.ssrLoadModule("/src/auth-session.js"));
await manager.initialize();
manager.setActiveCompanionId(COMPANION_A);
const tick = async () => { for (let index = 0; index < 45; index++) await Promise.resolve(); };
const body = () => JSON.stringify(tree?.toJSON());
const textOf = node => typeof node === "string" ? node : node.children.map(textOf).join("");
const button = text => tree.root.findAllByType("button").find(node => textOf(node).includes(text));
const birthButton = () => button("迎接她回家") || button("正在出生");
const speech = () => tree.root.findByType("textarea");
const speechForm = () => tree.root.findByProps({ className: "nursery-speech-form" });
const nameForm = () => tree.root.findByProps({ className: "nursery-name-form" });
const mutations = () => requests.filter(request => request.method === "POST");
const reads = () => requests.filter(request => request.method === "GET" && request.path === "/api/v2/nursery");
const mood = () => tree.root.findAllByProps({ className: "nursery-meter" }).find(node => node.findByType("small").children.join("") === "心情").findByType("strong").children.join("");
async function runTimers(kind, delay) {
  await act(async () => {
    for (const [id, entry] of [...timers]) {
      if (entry.kind !== kind || entry.delay !== delay) continue;
      if (kind === "timeout") timers.delete(id);
      entry.callback();
    }
    await tick();
  });
}
async function mount({ strict = false, onNotice = message => notices.push(message) } = {}) {
  await act(async () => {
    const component = React.createElement(Nursery, { aiName: "虚构伴侣", onNotice });
    tree = TestRenderer.create(strict ? React.createElement(React.StrictMode, {}, component) : component);
    await tick();
  });
  await runTimers("timeout", 0);
}
async function respond(request, data, status = 200, companion) {
  await act(async () => { request.respond(data, status, companion); await tick(); });
}
async function mountWithChild() { await mount(); await respond(reads()[0], snapshot()); }
async function editSpeech(text) { await act(async () => speech().props.onChange({ target: { value: text } })); }
async function submitSpeech() { await act(async () => { speechForm().props.onSubmit({ preventDefault() {} }); await tick(); }); }
async function unmount() { if (tree) await act(async () => { tree.unmount(); await tick(); }); tree = null; }
function switchAccount() { sdkSession = sessionFor(ACCOUNT_B); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(COMPANION_B); }

afterEach(async () => {
  await unmount();
  requests.length = 0; notices.length = 0; timers.clear(); signOutCalls = [];
  sdkSession = sessionFor(ACCOUNT_A); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(COMPANION_A);
  document.visibilityState = "visible";
});
after(async () => {
  await vite.close(); manager.destroy();
  const target = resolve(cacheDir), parent = resolve(dirname(cacheDir));
  assert.ok(parent === resolve(tmpdir()) && target.startsWith(`${parent}${sep}dengta-nursery-lifecycle-`));
  rmSync(target, { recursive: true, force: true });
  for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
});

test("failed initial GET displays a read failure instead of inviting a birth", async () => {
  await mount(); await respond(reads()[0], { code: "api_request_failed" }, 500);
  assert.match(body(), /家庭状态读取失败/);
  assert.equal(birthButton(), undefined);
  assert.ok(button("重新读取家庭状态"));
});

test("initial read recovery sends GET only and accepts the backend's child-null snapshot", async () => {
  await mount(); await respond(reads()[0], { code: "api_request_failed" }, 500);
  const retry = button("重新读取家庭状态"); assert.ok(retry);
  await act(async () => { retry.props.onClick(); await tick(); });
  await respond(reads()[1], snapshot({ child: false }));
  assert.ok(birthButton()); assert.equal(mutations().length, 0); assert.equal(reads().length, 2);
});

test("same-tick birth clicks send one POST with its existing client action field", async () => {
  await mount(); await respond(reads()[0], snapshot({ child: false }));
  await act(async () => { const click = birthButton().props.onClick; click(); click(); await tick(); });
  assert.equal(mutations().length, 1);
  assert.equal(birthButton().props.disabled, true);
  assert.deepEqual(Object.keys(JSON.parse(mutations()[0].options.body)), ["client_action_id"]);
  await respond(mutations()[0], { created: true, ...snapshot() }, 201);
  assert.match(body(), /虚构小朋友/);
});

test("same-tick care and speech calls share a synchronous mutation lock", async () => {
  await mountWithChild(); await editSpeech("虚构提交内容");
  await act(async () => {
    const submit = speechForm().props.onSubmit;
    button("安抚").props.onClick(); submit({ preventDefault() {} }); await tick();
  });
  assert.equal(mutations().length, 1);
  assert.equal(JSON.parse(mutations()[0].options.body).action, "soothe");
  assert.equal(tree.root.findByProps({ "aria-label": "发送给孩子" }).props.disabled, true);
});

test("a confirmed speech preserves a new exact draft typed during its POST", async () => {
  await mountWithChild(); await editSpeech("  虚构提交内容  "); await submitSpeech();
  assert.equal(JSON.parse(mutations()[0].options.body).text, "虚构提交内容");
  const next = "  新的虚构草稿\r\n第二行🌱  "; await editSpeech(next);
  await respond(mutations()[0], actionReceipt());
  assert.equal(speech().props.value, next); assert.equal(mood(), "77");
});

test("a confirmed speech still clears its unchanged exact submitted draft", async () => {
  await mountWithChild(); await editSpeech("  虚构提交内容  "); await submitSpeech();
  await respond(mutations()[0], actionReceipt());
  assert.equal(speech().props.value, ""); assert.equal(mutations().length, 1);
});

test("a late polling GET cannot replace a confirmed action snapshot", async () => {
  await mountWithChild(); await runTimers("interval", 60 * 1000);
  const oldRead = reads()[1]; assert.ok(oldRead);
  await act(async () => { button("安抚").props.onClick(); await tick(); });
  await respond(mutations()[0], actionReceipt("soothe"));
  await respond(oldRead, snapshot());
  assert.equal(mood(), "77"); assert.equal(mutations().length, 1);
});

test("two overlapping polling reads accept only the latest requested snapshot", async () => {
  await mountWithChild(); await runTimers("interval", 60 * 1000); await runTimers("interval", 60 * 1000);
  await respond(reads()[2], snapshot({ mood: 77 })); await respond(reads()[1], snapshot());
  assert.equal(mood(), "77"); assert.equal(mutations().length, 0);
});

test("a failed polling read keeps the accepted child visible and offers read recovery", async () => {
  await mountWithChild(); await runTimers("interval", 60 * 1000);
  await respond(reads()[1], { code: "api_request_failed" }, 500);
  assert.match(body(), /虚构小朋友/); assert.match(body(), /家庭状态读取失败/);
  assert.ok(button("重新读取家庭状态")); assert.equal(birthButton(), undefined);
});

test("polling during a pending write does not start another state read", async () => {
  await mountWithChild(); await act(async () => { button("安抚").props.onClick(); await tick(); });
  await runTimers("interval", 60 * 1000);
  assert.equal(reads().length, 1); assert.equal(mutations().length, 1);
});

test("failed POST keeps the draft and recovers by GET without repeating the write", async () => {
  await mountWithChild(); await runTimers("interval", 60 * 1000);
  await respond(reads()[1], { code: "api_request_failed" }, 500);
  await editSpeech("虚构未确认提交"); await submitSpeech();
  await respond(mutations()[0], { code: "api_request_failed", message: "FICTIONAL_PRIVATE_RESPONSE" }, 500);
  assert.equal(speech().props.value, "虚构未确认提交");
  assert.match(body(), /操作结果尚未确认/); assert.match(body(), /家庭状态读取失败/);
  assert.doesNotMatch(body(), /FICTIONAL_PRIVATE_RESPONSE/);
  const retry = button("重新读取家庭状态"); assert.ok(retry);
  await act(async () => { retry.props.onClick(); await tick(); });
  await respond(reads()[2], snapshot({ mood: 77 }));
  assert.equal(mutations().length, 1); assert.equal(speech().props.value, "虚构未确认提交"); assert.equal(mood(), "77");
});

test("a network read failure and a 503 use explicit recovery without scheduled retries", async () => {
  await mount(); await act(async () => { reads()[0].reject(new Error("fictional network failure")); await tick(); });
  assert.match(body(), /家庭状态读取失败/); assert.equal(reads().length, 1);
  assert.equal([...timers.values()].filter(entry => entry.kind === "timeout").length, 0);
  await act(async () => { button("重新读取家庭状态").props.onClick(); await tick(); });
  await respond(reads()[1], { code: "api_request_failed" }, 503);
  assert.match(body(), /家庭状态读取失败/); assert.equal(reads().length, 2); assert.equal(mutations().length, 0);
  assert.equal([...timers.values()].filter(entry => entry.kind === "timeout").length, 0);
});

test("companion care uses its existing endpoint and one client action id under a same-tick double click", async () => {
  await mountWithChild();
  await act(async () => { const click = button("让虚构伴侣陪她一会").props.onClick; click(); click(); await tick(); });
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].path, `/api/v2/nursery/children/${CHILD}/companion-actions`);
  assert.deepEqual(Object.keys(JSON.parse(mutations()[0].options.body)), ["client_action_id"]);
  await respond(mutations()[0], actionReceipt("soothe", "companion")); assert.equal(mood(), "77");
});

test("naming keeps its existing candidate contract and a failed request preserves newer text", async () => {
  await mountWithChild();
  await act(async () => nameForm().findByType("input").props.onChange({ target: { value: "虚构甲，虚构乙\n虚构丙,虚构丁" } }));
  await act(async () => { const submit = nameForm().props.onSubmit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick(); });
  assert.equal(mutations().length, 1);
  assert.deepEqual(JSON.parse(mutations()[0].options.body).candidates, ["虚构甲", "虚构乙", "虚构丙"]);
  await act(async () => nameForm().findByType("input").props.onChange({ target: { value: "  后来的虚构名字  " } }));
  await respond(mutations()[0], { code: "nursery_name_conflict" }, 409);
  assert.equal(nameForm().findByType("input").props.value, "  后来的虚构名字  ");
});

test("portrait reads share the operation lock and cannot release a pending care operation", async () => {
  await mountWithChild();
  await act(async () => { button("安抚").props.onClick(); button("成长画像").props.onClick(); await tick(); });
  assert.equal(requests.length, 2); assert.equal(mutations().length, 1);
  await respond(mutations()[0], actionReceipt("soothe"));
  await act(async () => { button("成长画像").props.onClick(); await tick(); });
  const portraitRead = requests.find(request => request.path.endsWith("/portrait")); assert.ok(portraitRead);
  await respond(portraitRead, { portrait }); assert.match(body(), /学过 .*3.* 个字/);
});

test("a portrait failure can be retried as a read without a care POST", async () => {
  await mountWithChild(); await act(async () => { button("成长画像").props.onClick(); await tick(); });
  await respond(requests.find(request => request.path.endsWith("/portrait")), { code: "api_request_failed" }, 500);
  await act(async () => { button("成长画像").props.onClick(); await tick(); });
  const portraitReads = requests.filter(request => request.path.endsWith("/portrait"));
  assert.equal(portraitReads.length, 2); assert.equal(mutations().length, 0);
  await respond(portraitReads[1], { portrait }); assert.match(body(), /学过 .*3.* 个字/);
});

for (const route of ["initial", "action", "portrait"]) {
  for (const status of [200, 401]) {
    test(`a late ${route} ${status} after unmount cannot mutate the next account or its companion`, async () => {
      await mount();
      let pending = reads()[0], result = snapshot();
      if (route !== "initial") {
        await respond(pending, snapshot());
        await act(async () => { button(route === "action" ? "安抚" : "成长画像").props.onClick(); await tick(); });
        pending = requests.at(-1); result = route === "portrait" ? { portrait } : actionReceipt("soothe");
      }
      await unmount(); switchAccount(); const noticeCount = notices.length;
      await respond(pending, status === 401 ? { code: "invalid_session" } : result, status);
      assert.equal(manager.getSnapshot().user?.id, ACCOUNT_B);
      assert.equal(manager.getSnapshot().activeCompanionId, COMPANION_B);
      assert.equal(manager.getSnapshot().status, "authenticated");
      assert.equal(signOutCalls.length, 0); assert.equal(notices.length, noticeCount);
      assert.equal(pending.options.signal?.aborted, true); assert.equal(timers.size, 0);
    });
  }
}

test("a late old-companion response cannot overwrite the current companion header before remount", async () => {
  await mount(); const pending = reads()[0]; manager.setActiveCompanionId(COMPANION_B);
  await respond(pending, snapshot(), 200, COMPANION_A);
  assert.equal(manager.getSnapshot().activeCompanionId, COMPANION_B);
  assert.doesNotMatch(body(), /虚构小朋友/);
});

test("a scoped React key remount discards old drafts and starts only the new account's GET", async () => {
  await mountWithChild(); await editSpeech("原账号的虚构草稿");
  await act(async () => { button("安抚").props.onClick(); await tick(); }); const oldWrite = mutations()[0];
  switchAccount();
  await act(async () => { tree.update(React.createElement(Nursery, { key: `${ACCOUNT_B}:${COMPANION_B}`, onNotice: message => notices.push(message) })); await tick(); });
  assert.doesNotMatch(body(), /原账号的虚构草稿|虚构小朋友/); assert.equal(oldWrite.options.signal?.aborted, true);
  await runTimers("timeout", 0); const currentRead = reads()[1];
  assert.equal(currentRead.options.headers.get("X-DengTa-Companion-Id"), COMPANION_B);
  assert.equal(currentRead.options.headers.get("Authorization"), `Bearer fictional-${ACCOUNT_B}`);
  await respond(oldWrite, { code: "invalid_session" }, 401); await respond(currentRead, snapshot(), 200, COMPANION_B);
  assert.equal(speech().props.value, ""); assert.equal(manager.getSnapshot().user?.id, ACCOUNT_B);
  assert.equal(manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(signOutCalls.length, 0); assert.equal(mutations().length, 1);
});

test("a current-scope 401 still expires the real auth manager", async () => {
  await mount(); await respond(reads()[0], { code: "invalid_session" }, 401);
  assert.equal(manager.getSnapshot().status, "expired"); assert.equal(manager.getSnapshot().user, null);
  assert.ok(signOutCalls.length > 0); assert.ok(signOutCalls.every(options => options?.scope === "local"));
});

test("updating the notice callback does not restart the mounted page's request lifecycle", async () => {
  await mountWithChild();
  await act(async () => { tree.update(React.createElement(Nursery, { aiName: "虚构伴侣", onNotice: message => notices.push(`new:${message}`) })); await tick(); });
  await runTimers("timeout", 0);
  assert.equal(reads().length, 1);
  assert.equal([...timers.values()].filter(entry => entry.kind === "interval").length, 1);
});

test("StrictMode keeps one active poll timer and teardown cancels the current request", async () => {
  await mount({ strict: true }); assert.equal(reads().length, 1);
  assert.equal([...timers.values()].filter(entry => entry.kind === "interval").length, 1);
  assert.equal(reads()[0].options.headers.get("X-DengTa-Companion-Id"), COMPANION_A);
  assert.equal(reads()[0].options.headers.get("Authorization"), `Bearer fictional-${ACCOUNT_A}`);
  await unmount(); assert.equal(timers.size, 0); assert.equal(reads()[0].options.signal?.aborted, true);
});

test("hidden pages do not poll and unavailable schema responses never offer a birth", async () => {
  await mount();
  await respond(reads()[0], { available: false, child: null, message: "虚构数据库准备中", provider_calls: 0, embedding_calls: 0 });
  document.visibilityState = "hidden"; await runTimers("interval", 60 * 1000);
  assert.equal(reads().length, 1); assert.equal(birthButton(), undefined); assert.match(body(), /育儿房正在准备/);
});

for (const [label, data] of [["empty object", {}], ["null", null], ["missing child", { available: true }]]) {
  test(`an HTTP 200 ${label} is not evidence of an empty nursery`, async () => {
    await mount(); await respond(reads()[0], data);
    assert.match(body(), /家庭状态读取失败/); assert.equal(birthButton(), undefined);
    assert.ok(button("重新读取家庭状态")); assert.equal(mutations().length, 0);
  });
}

test("an incomplete HTTP 200 polling result preserves the accepted child and its state", async () => {
  await mountWithChild(); await runTimers("interval", 60 * 1000); await respond(reads()[1], {});
  assert.match(body(), /家庭状态读取失败/); assert.match(body(), /虚构小朋友/); assert.equal(mood(), "20");
  assert.equal(birthButton(), undefined);
});

for (const [label, data] of [["empty object", {}], ["child-null GET snapshot", snapshot({ child: false })]]) {
  test(`a speech POST 200 ${label} does not clear its draft or confirm a write`, async () => {
    await mountWithChild(); await editSpeech("  虚构原始草稿\r\n正文  "); await submitSpeech();
    await respond(mutations()[0], data);
    assert.match(body(), /操作结果尚未确认/); assert.equal(speech().props.value, "  虚构原始草稿\r\n正文  ");
    assert.equal(mood(), "20"); assert.equal(birthButton(), undefined); assert.equal(mutations().length, 1);
  });
}

test("an empty birth POST receipt remains unconfirmed and offers only GET recovery", async () => {
  await mount(); await respond(reads()[0], snapshot({ child: false }));
  await act(async () => { birthButton().props.onClick(); await tick(); }); await respond(mutations()[0], {});
  assert.match(body(), /操作结果尚未确认/); assert.ok(button("重新读取家庭状态"));
  await act(async () => { button("重新读取家庭状态").props.onClick(); await tick(); });
  await respond(reads()[1], snapshot()); assert.equal(mutations().length, 1); assert.match(body(), /虚构小朋友/);
});

test("an empty naming POST receipt preserves the exact candidate draft", async () => {
  await mountWithChild(); const raw = "  虚构甲，虚构乙  ";
  await act(async () => nameForm().findByType("input").props.onChange({ target: { value: raw } }));
  await act(async () => { nameForm().props.onSubmit({ preventDefault() {} }); await tick(); });
  await respond(mutations()[0], {});
  assert.equal(nameForm().findByType("input").props.value, raw); assert.match(body(), /操作结果尚未确认/);
  assert.equal(mutations().length, 1);
});

test("an empty portrait receipt exposes a retryable read failure rather than an empty expanded portrait", async () => {
  await mountWithChild(); await act(async () => { button("成长画像").props.onClick(); await tick(); });
  await respond(requests.find(request => request.path.endsWith("/portrait")), {});
  assert.match(body(), /成长画像读取失败/); assert.match(textOf(button("成长画像")), /查看/);
  assert.equal(mutations().length, 0);
});

test("invalid or absent milestone dates remain visible with an unknown-time label", async () => {
  await mount();
  await respond(reads()[0], {
    ...snapshot(), milestones: [
      { id: "fictional-invalid-date", title: "虚构旧记录", note: "", created_at: "FICTIONAL_INVALID_DATE" },
      { id: "fictional-missing-date", title: "虚构无时间记录", note: "", created_at: null },
      { id: "fictional-valid-date", title: "虚构完整记录", note: "", created_at: "2026-10-07T01:00:00.000Z" },
    ],
  });
  const times = tree.root.findAllByType("time").map(textOf);
  assert.deepEqual(times.slice(0, 2), ["时间未知", "时间未知"]);
  assert.notEqual(times[2], "时间未知"); assert.match(body(), /虚构旧记录/); assert.match(body(), /虚构小朋友/);
});

for (const [label, receipt] of [
  ["GET snapshot without an action", snapshot({ mood: 77 })],
  ["action without a write-confirmation flag", { action: actionReceipt().action, ...snapshot({ mood: 77 }) }],
  ["unapplied action", actionReceipt("talk", "user", { action: { ...actionReceipt().action, applied_at: null } })],
  ["wrong action kind", actionReceipt("teach")],
  ["wrong caregiver", actionReceipt("talk", "companion")],
]) {
  test(`a speech POST ${label} preserves its exact draft and accepted state`, async () => {
    await mountWithChild(); const raw = "  虚构原始草稿\r\n第二行🌱  ";
    await editSpeech(raw); await submitSpeech(); await respond(mutations()[0], receipt);
    assert.equal(speech().props.value, raw); assert.equal(mood(), "20");
    assert.match(body(), /操作结果尚未确认/); assert.match(body(), /nursery_response_invalid/);
    assert.equal(mutations().length, 1);
  });
}

test("a birth POST containing only a GET snapshot does not confirm birth", async () => {
  await mount(); await respond(reads()[0], snapshot({ child: false }));
  await act(async () => { birthButton().props.onClick(); await tick(); });
  await respond(mutations()[0], snapshot());
  assert.match(body(), /操作结果尚未确认/); assert.doesNotMatch(body(), /虚构小朋友/);
  assert.equal(mutations().length, 1); assert.ok(button("重新读取家庭状态"));
});

test("an existing-child birth receipt is valid without creating another child", async () => {
  await mount(); await respond(reads()[0], snapshot({ child: false }));
  await act(async () => { birthButton().props.onClick(); await tick(); });
  await respond(mutations()[0], { created: false, ...snapshot() });
  assert.match(body(), /虚构小朋友/); assert.doesNotMatch(body(), /操作结果尚未确认/);
  assert.equal(mutations().length, 1);
});

for (const [label, receipt] of [
  ["GET snapshot without chosen name", snapshot()],
  ["name outside submitted candidates", { idempotent: false, chosen_name: "虚构丙", ...snapshot({ name: "虚构丙" }) }],
  ["chosen name mismatching child", { idempotent: false, chosen_name: "虚构甲", ...snapshot() }],
]) {
  test(`a naming POST ${label} preserves the exact candidates`, async () => {
    await mountWithChild(); const raw = "  虚构甲，虚构乙  ";
    await act(async () => nameForm().findByType("input").props.onChange({ target: { value: raw } }));
    await act(async () => { nameForm().props.onSubmit({ preventDefault() {} }); await tick(); });
    await respond(mutations()[0], receipt);
    assert.equal(nameForm().findByType("input").props.value, raw);
    assert.match(body(), /操作结果尚未确认/); assert.equal(mutations().length, 1);
  });
}

for (const idempotent of [false, true]) {
  test(`a valid ${idempotent ? "idempotent" : "new"} naming receipt accepts the selected candidate`, async () => {
    await mountWithChild();
    await act(async () => nameForm().findByType("input").props.onChange({ target: { value: "虚构甲，虚构乙" } }));
    await act(async () => { nameForm().props.onSubmit({ preventDefault() {} }); await tick(); });
    await respond(mutations()[0], { idempotent, chosen_name: "虚构乙", ...snapshot({ name: "虚构乙" }) });
    assert.equal(tree.root.findByType("h2").children.join(""), "虚构乙");
    assert.doesNotMatch(body(), /操作结果尚未确认/); assert.equal(mutations().length, 1);
    await unmount(); await mount(); await respond(reads()[1], snapshot({ name: "虚构乙" }));
    assert.equal(tree.root.findByType("h2").children.join(""), "虚构乙");
    assert.equal(mutations().length, 1);
  });
}

test("a valid idempotent speech receipt is accepted without another POST", async () => {
  await mountWithChild(); await editSpeech("虚构提交内容"); await submitSpeech();
  await respond(mutations()[0], actionReceipt("talk", "user", { idempotent: true }));
  assert.equal(speech().props.value, ""); assert.equal(mood(), "77");
  assert.equal(mutations().length, 1); assert.doesNotMatch(body(), /操作结果尚未确认/);
});

test("zero attachment and trust values remain zero in the relationship cards", async () => {
  await mount();
  await respond(reads()[0], { ...snapshot(), bonds: [
    { caregiver_kind: "user", attachment: 0, trust: 0 },
    { caregiver_kind: "companion", attachment: 9, trust: 0 },
  ] });
  const cards = tree.root.findByProps({ className: "nursery-bonds" }).findAllByType("div");
  assert.deepEqual(cards.map(card => card.findByType("strong").children.join("")), ["0", "9"]);
  assert.deepEqual(cards.map(card => card.findByType("small").children.join("")), ["安心 0", "安心 0"]);
});

test("unconfirmed write blocks stale mutation handlers until an explicit successful state check", async () => {
  await mountWithChild();await editSpeech("虚构保留草稿");
  const oldSpeech=speechForm().props.onSubmit,oldCare=button("安抚").props.onClick;
  await submitSpeech();await respond(mutations()[0],snapshot({mood:77}));
  assert.equal(speechForm().findByProps({"aria-label":"发送给孩子"}).props.disabled,true);
  assert.equal(button("安抚").props.disabled,true);
  await act(async()=>{oldSpeech({preventDefault(){}});oldCare();await tick();});assert.equal(mutations().length,1);
  await act(async()=>{button("重新读取家庭状态").props.onClick();await tick();});
  await respond(reads()[1],{code:"api_request_failed"},503);assert.equal(button("安抚").props.disabled,true);
  await act(async()=>{button("重新读取家庭状态").props.onClick();await tick();});
  await respond(reads()[2],snapshot({mood:77}));assert.equal(button("安抚").props.disabled,false);
  assert.equal(speech().props.value,"虚构保留草稿");assert.equal(mutations().length,1);
});

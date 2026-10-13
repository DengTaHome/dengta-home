import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";
import { apiRequest } from "../src/api.js";
import { createAuthSessionManager } from "../src/auth-session.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Extract actual App source: ${start}`);
  return source.slice(first, last);
}
const states = extract("  const [moments,", "  const [isLoading,");
const operations = extract("  const [isPostingMoment,", "  const [dialog,");
const refs = extract("  const pendingMomentLikesRef =", "  const draftSettingsRef =");
const load = extract("  const getMomentsRequestScope =", '  useEffect(() => {\n    if (activeView === "moments")');
const mutations = extract("  async function postMoment(", "  function changeView(");
const render = extract("  function renderMoments()", "  function renderDiscover()");
const errorFeedback = extract("function momentFailureMessage(", "async function prepareMomentImage(");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const entry = (id = "moment-a", liked = false) => ({ id, author: "assistant", content: "Fictional moment", images: [], comments: [], user_liked: liked });
const json = (data, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const listing = (entries = [entry()]) => json({ available: true, entries });
const postReceipt = () => json({ moment: { id: "created", author: "user" } }, 201);
const commentReceipt = () => json({ comment: { id: "comment-created", moment_id: "moment-a", author: "user" } }, 201);
const fixture = { calls: [], authSession: null, api: null, transport: null, imageReader: async () => ({ type: "image/png", data: "synthetic", preview: "data:image/png;base64,synthetic" }) };
globalThis.__momentsLifecycleFixture = fixture;
const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
globalThis.window = { setTimeout, clearTimeout };
globalThis.fetch = async (url, options) => {
  const call = { url, method: options.method || "GET", options };
  fixture.calls.push(call);
  return fixture.transport(call);
};
fixture.request = (path, options) => apiRequest(path, { ...options, retry: false });
const cacheDir = await mkdtemp(join(tmpdir(), "dengta-moments-lifecycle-"));
const vite = await createServer({
  configFile: false, cacheDir, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{
    name: "actual-moments-handlers-and-ui",
    resolveId(id) { if (id === "virtual:moments-lifecycle") return "\0virtual:moments-lifecycle.jsx"; },
    async load(id) {
      if (id !== "\0virtual:moments-lifecycle.jsx") return;
      return (await transformWithOxc(`
        import {useState,useRef,useCallback,useLayoutEffect} from "react";
        import {createScopedSettingsSession,settingsSaveScope} from "/src/settings-save-scope.js";
        import {toggleMomentLikeOptimistically} from "/src/moment-like.js";
        import {describeOperationError} from "/src/operation-error-help.js";
        const fixture=globalThis.__momentsLifecycleFixture;
        const apiRequest=(...args)=>fixture.request(...args);
        const prepareMomentImage=(...args)=>fixture.imageReader(...args);
        const FeatureAtmosphere=()=>null, TypewriterText=({text})=>text, AuthenticatedImage=()=>null;
        const formatDateTime=()=>"synthetic date";
        ${errorFeedback}
        export default function MomentsHarness({privateMediaScope}) {
          const authSession=fixture.authSession;
          const activeSessionId=null, effectiveAiName="Fictional companion";
          const setImageViewer=()=>{};
          const componentMountedRef=useRef(true),settingsScopeControllerRef=useRef(null);
          useLayoutEffect(()=>{
            componentMountedRef.current=true;
            const controller=new AbortController();settingsScopeControllerRef.current=controller;
            return()=>{componentMountedRef.current=false;controller.abort();};
          },[privateMediaScope]);
          ${states}
          ${operations}
          ${refs}
          ${load}
          ${mutations}
          ${render}
          fixture.api={loadMoments,postMoment,postComment,toggleMomentLike,selectMomentImages,
            setMomentDraft,setMomentImages,setCommentDrafts,
            read:()=>({moments,momentsAvailable,momentsLoading,momentsLoadError,momentDraft,momentImages,commentDrafts,isPostingMoment,pendingMomentLikes,pendingMomentComments,notice})};
          return renderMoments();
        }
      `, "moments-lifecycle.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
    },
  }],
});
const { default: Harness } = await vite.ssrLoadModule("virtual:moments-lifecycle");
let tree;
async function mount({ expired = false } = {}) {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  const refresh = deferred();
  const session = { access_token: "synthetic-token", expires_at: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600), user: { id: ACCOUNT } };
  let refreshes = 0;
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    refreshSession: () => { refreshes += 1; return refresh.promise; },
    signOut: async () => ({ error: null }),
  };
  fixture.authSession = createAuthSessionManager({ supabaseUrl: "https://synthetic.example.test", supabaseAnonKey: "synthetic-public-key", storage, createClientFn: () => ({ auth }) });
  await fixture.authSession.initialize(); fixture.authSession.setActiveCompanionId(A);
  fixture.calls = []; fixture.transport = () => listing();
  await act(async () => { tree = TestRenderer.create(React.createElement(Harness, { privateMediaScope: JSON.stringify([ACCOUNT, A]) })); });
  return { refresh, session, refreshes: () => refreshes };
}
const read = () => fixture.api.read();
const writes = () => fixture.calls.filter(call => call.method === "POST");
const snapshot = () => JSON.stringify(tree.toJSON());
const event = { preventDefault() {} };
async function draft(value = "  Fictional post\r\n  ") { await act(async () => { fixture.api.setMomentDraft(value); }); }
async function comments(value = "  Fictional comment\r\n  ") { await act(async () => { fixture.api.setCommentDrafts({ "moment-a": value }); }); }
async function initialList() { await act(async () => { await fixture.api.loadMoments(); }); }
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
after(async () => {
  await vite.close();
  assert.equal(dirname(resolve(cacheDir)), resolve(tmpdir()));
  assert.ok(basename(cacheDir).startsWith("dengta-moments-lifecycle-"));
  // Optimizer cache writes can briefly overlap close; keep retries inside this verified temp directory.
  await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  globalThis.window = oldWindow; globalThis.fetch = oldFetch; delete globalThis.__momentsLifecycleFixture;
});

test("same-render posting uses one POST and leaves its busy button until the receipt", async () => {
  await mount(); await draft(); const pending = deferred(); fixture.transport = call => call.method === "POST" ? pending.promise : listing();
  const submit = tree.root.findByType("form").props.onSubmit; let first, second;
  await act(async () => { first = submit(event); second = submit(event); await tick(); });
  assert.equal(writes().length, 1); assert.equal(tree.root.findByProps({ className: "moment-submit" }).props.disabled, true);
  await act(async () => { pending.resolve(postReceipt()); await Promise.all([first, second]); });
  assert.equal(read().momentDraft, ""); assert.equal(read().isPostingMoment, false); assert.match(read().notice, /动态已经发布/);
});
test("post success only removes submitted images and preserves later raw text and images", async () => {
  await mount(); await draft(); await act(async () => fixture.api.setMomentImages([{ id: "old", type: "image/png", data: "synthetic", preview: "synthetic" }]));
  const pending = deferred(); fixture.transport = call => call.method === "POST" ? pending.promise : listing(); let run;
  await act(async () => { run = fixture.api.postMoment(event); await tick(); });
  const later = "  Fictional NEW draft\r\n  "; await draft(later);
  await act(async () => fixture.api.setMomentImages(current => [...current, { id: "new", type: "image/png", data: "synthetic-new", preview: "synthetic" }]));
  await act(async () => { pending.resolve(postReceipt()); await run; });
  assert.equal(read().momentDraft, later); assert.deepEqual(read().momentImages.map(item => item.id), ["new"]);
});
test("comment Enter and button in the same render share one request and preserve newer draft", async () => {
  await mount(); await initialList(); await comments(); const pending = deferred(); fixture.transport = call => call.method === "POST" ? pending.promise : listing();
  const input = tree.root.findByProps({ placeholder: "写一条评论" }); const button = tree.root.findByProps({ className: "comment-box" }).findByType("button"); let run;
  await act(async () => { input.props.onKeyDown({ key: "Enter", preventDefault() {} }); run = button.props.onClick(); await tick(); });
  assert.equal(writes().length, 1); assert.equal(tree.root.findByProps({ className: "comment-box" }).findByType("button").props["aria-busy"], true);
  await comments("  New unsent comment\r\n  ");
  await act(async () => { pending.resolve(commentReceipt()); await run; await tick(); });
  assert.equal(read().commentDrafts["moment-a"], "  New unsent comment\r\n  "); assert.equal(Boolean(read().pendingMomentComments["moment-a"]), false);
});
test("unchanged comment draft clears only after a matching comment receipt", async () => {
  await mount(); await comments(); fixture.transport = call => call.method === "POST" ? commentReceipt() : listing();
  await act(async () => { await fixture.api.postComment("moment-a"); }); assert.equal(read().commentDrafts["moment-a"], "");
});
test("inverted GET completion accepts only the latest requested list", async () => {
  await mount(); const reads = []; fixture.transport = () => { const pending = deferred(); reads.push(pending); return pending.promise; }; let old, recent;
  await act(async () => { old = fixture.api.loadMoments(); recent = fixture.api.loadMoments(); await tick(); });
  await act(async () => { reads[1].resolve(listing([entry("newer")])); await recent; });
  await act(async () => { reads[0].resolve(listing([entry("older")])); await old; }); assert.equal(read().moments[0].id, "newer");
});
test("a GET started before posting cannot erase the new confirmed list", async () => {
  await mount(); await draft(); const old = deferred(); let count = 0;
  fixture.transport = call => call.method === "POST" ? postReceipt() : ++count === 1 ? old.promise : listing([entry("created")]); let run;
  await act(async () => { run = fixture.api.loadMoments(); await tick(); });
  await act(async () => { await fixture.api.postMoment(event); });
  await act(async () => { old.resolve(listing([])); await run; }); assert.equal(read().moments[0].id, "created");
});
test("bad JSON, missing entries, malformed entries and HTTP errors keep existing list with failure feedback", async () => {
  await mount(); await initialList();
  for (const bad of [() => new Response("not-json", { status: 200 }), () => json({ available: true }), () => json({ available: true, entries: [{}] }), () => json({ code: "synthetic_failure" }, 500)]) {
    fixture.transport = bad; await act(async () => { await fixture.api.loadMoments(); });
    assert.equal(read().moments[0].id, "moment-a"); assert.ok(read().momentsLoadError); assert.match(snapshot(), /role.*alert/);
  }
  fixture.transport = () => listing(); await act(async () => { await fixture.api.loadMoments(); }); assert.equal(read().momentsLoadError, "");
});
test("initial loading and failure cannot claim the space has no moments", async () => {
  await mount(); assert.doesNotMatch(snapshot(), /这里还没有动态/); const pending = deferred(); fixture.transport = () => pending.promise; let run;
  await act(async () => { run = fixture.api.loadMoments(); await tick(); }); assert.match(snapshot(), /正在读取动态/);
  await act(async () => { pending.resolve(json({}, 500)); await run; }); assert.doesNotMatch(snapshot(), /这里还没有动态/); assert.match(snapshot(), /暂时无法确认动态列表/);
});
test("a failed write releases the loading state of its invalidated older read", async () => {
  await mount(); await draft(); const pending = deferred(); fixture.transport = call => call.method === "POST" ? json({}, 500) : pending.promise; let old;
  await act(async () => { old = fixture.api.loadMoments(); await tick(); }); assert.equal(read().momentsLoading, true);
  await act(async () => { await fixture.api.postMoment(event); }); assert.equal(read().momentsLoading, false);
  await act(async () => { pending.resolve(listing()); await old; }); assert.equal(read().momentsAvailable, null);
});
test("unavailable storage can be checked again with a read-only refresh", async () => {
  await mount(); fixture.transport = () => json({ available: false, entries: [] }); await initialList(); assert.match(snapshot(), /暂时不可用/);
  const button = tree.root.findByType("button"); fixture.transport = () => listing();
  await act(async () => { button.props.onClick(); await tick(); }); assert.equal(read().momentsAvailable, true); assert.equal(writes().length, 0);
});
test("201 without a post receipt and 204 retain the raw draft and do not report published", async () => {
  await mount(); const original = "  Fictional unchanged post\r\n  ";
  for (const status of [201, 204]) {
    await draft(original); fixture.transport = call => call.method === "POST" ? json({}, status) : listing();
    await act(async () => { await fixture.api.postMoment(event); }); assert.equal(read().momentDraft, original); assert.doesNotMatch(read().notice, /动态已经发布/); assert.match(read().notice, /请先刷新动态核对/); assert.match(read().notice, /moment_post_receipt_invalid/);
  }
});
test("missing, wrong-target and wrong-author comment receipts retain raw comment", async () => {
  await mount(); const original = "  Fictional unchanged comment\r\n  "; await comments(original);
  for (const data of [{}, { comment: { id: "other", moment_id: "wrong", author: "user" } }, { comment: { id: "other", moment_id: "moment-a", author: "assistant" } }]) {
    fixture.transport = call => call.method === "POST" ? json(data, 201) : listing();
    await act(async () => { await fixture.api.postComment("moment-a"); }); assert.equal(read().commentDrafts["moment-a"], original); assert.match(read().notice, /评论结果尚未确认/); assert.match(read().notice, /moment_comment_receipt_invalid/);
  }
});
test("confirmed write followed by failed list refresh stays saved and permits a read-only refresh", async () => {
  await mount(); await draft(); fixture.transport = call => call.method === "POST" ? postReceipt() : json({}, 500);
  await act(async () => { await fixture.api.postMoment(event); }); assert.equal(read().momentDraft, ""); assert.match(read().notice, /动态已经保存/); assert.ok(read().momentsLoadError);
  const count = writes().length; fixture.transport = () => listing();
  await act(async () => { tree.root.findAllByType("button").find(button => button.children.includes("刷新动态")).props.onClick(); await tick(); }); assert.equal(writes().length, count); assert.equal(read().momentsLoadError, "");
});
test("like remains immediate and deduplicated, and missing receipt rolls back", async () => {
  await mount(); await initialList(); const pending = deferred(); fixture.transport = call => call.method === "POST" ? pending.promise : listing([entry("moment-a", true)]); let first, second;
  const toggle = fixture.api.toggleMomentLike, original = read().moments[0];
  await act(async () => { first = toggle(original); second = toggle(original); await tick(); }); assert.equal(writes().length, 1); assert.equal(read().moments[0].user_liked, true);
  await act(async () => { pending.resolve(json({ moment: { id: "moment-a", user_liked: true } })); await Promise.all([first, second]); });
  fixture.transport = () => json({}); await act(async () => { await fixture.api.toggleMomentLike(read().moments[0]); }); assert.equal(read().moments[0].user_liked, true); assert.match(read().notice, /点赞回执不完整/); assert.match(read().notice, /moment_like_receipt_invalid/);
});
test("real auth refresh cannot send an old post under the next companion", async () => {
  const m = await mount({ expired: true }); await draft(); let run;
  await act(async () => { run = fixture.api.postMoment(event); await tick(); }); assert.equal(m.refreshes(), 1); assert.equal(writes().length, 0);
  fixture.authSession.setActiveCompanionId(B); m.refresh.resolve({ data: { session: { ...m.session, expires_at: Math.floor(Date.now() / 1000) + 3600 } } });
  await act(async () => { await run; }); assert.equal(writes().length, 0); assert.equal(read().momentDraft.trim(), "Fictional post"); assert.equal(fixture.authSession.getSnapshot().activeCompanionId, B);
});
test("late real-auth moments response cannot switch the active companion back", async () => {
  await mount(); const pending = deferred(); fixture.transport = () => pending.promise; let run;
  await act(async () => { run = fixture.api.loadMoments(); await tick(); }); fixture.authSession.setActiveCompanionId(B);
  await act(async () => { pending.resolve(json({ available: true, entries: [] }, 200, { "X-DengTa-Companion-Id": A })); await run; });
  assert.equal(fixture.authSession.getSnapshot().activeCompanionId, B); assert.equal(read().momentsAvailable, null);
});
test("unmount aborts the old POST and prevents its follow-up GET or companion capture", async () => {
  await mount(); await draft(); const pending = deferred(); fixture.transport = () => pending.promise; let run;
  await act(async () => { run = fixture.api.postMoment(event); await tick(); }); assert.equal(writes().length, 1);
  await act(async () => { tree.unmount(); }); tree = null; fixture.authSession.setActiveCompanionId(B);
  pending.resolve(json({ moment: { id: "created", author: "user" } }, 201, { "X-DengTa-Companion-Id": A })); await run; await tick();
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.authSession.getSnapshot().activeCompanionId, B);
});
test("pending image preparation cannot add an old selection after unmount", async () => {
  await mount(); const image = deferred(); fixture.imageReader = () => image.promise; let run;
  await act(async () => { run = fixture.api.selectMomentImages({ target: { files: [{ name: "fictional.png", lastModified: 1 }], value: "old" } }); });
  await act(async () => { tree.unmount(); }); tree = null; image.resolve({ type: "image/png", data: "synthetic", preview: "synthetic" }); await run;
  fixture.imageReader = async () => ({ type: "image/png", data: "synthetic", preview: "synthetic" }); assert.equal(fixture.calls.length, 0);
});

const rawFailure = () => json({ code: "synthetic_dynamic_failure", message: "FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY" }, 500);
function assertSafeFailure(text) {
  assert.doesNotMatch(text, /FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY/);
  assert.match(text, /错误代码：synthetic_dynamic_failure/);
  assert.match(text, /操作没有完成确认/);
  assert.match(text, /先刷新核对结果/);
}
test("a failed GET exposes safe reason, action and code without raw upstream message", async () => {
  await mount(); await initialList(); fixture.transport = rawFailure;
  await act(async () => { await fixture.api.loadMoments(); });
  assertSafeFailure(read().momentsLoadError); assertSafeFailure(read().notice); assertSafeFailure(snapshot());
  assert.equal(read().moments[0].id, "moment-a");
});
test("a failed post keeps the draft and exposes safe reason, action and code", async () => {
  await mount(); await draft(); fixture.transport = rawFailure;
  await act(async () => { await fixture.api.postMoment(event); });
  assertSafeFailure(read().notice); assert.equal(read().momentDraft, "  Fictional post\r\n  "); assert.equal(read().isPostingMoment, false);
});
test("a failed comment keeps the draft and exposes safe reason, action and code", async () => {
  await mount(); await initialList(); await comments(); fixture.transport = rawFailure;
  await act(async () => { await fixture.api.postComment("moment-a"); });
  assertSafeFailure(read().notice); assert.equal(read().commentDrafts["moment-a"], "  Fictional comment\r\n  "); assert.equal(Boolean(read().pendingMomentComments["moment-a"]), false);
});
test("a failed like rolls back and exposes safe reason, action and code", async () => {
  await mount(); await initialList(); fixture.transport = rawFailure;
  await act(async () => { await fixture.api.toggleMomentLike(read().moments[0]); });
  assertSafeFailure(read().notice); assert.equal(read().moments[0].user_liked, false); assert.equal(Boolean(read().pendingMomentLikes["moment-a"]), false);
});
test("invalid upstream codes normalize to unknown without displaying their raw values", async () => {
  await mount(); fixture.transport = () => json({ code: "sk-provider-secret-123456789-fixture-7", message: "FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY" }, 500);
  await act(async () => { await fixture.api.loadMoments(); });
  assert.doesNotMatch(snapshot(), /FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY|sk-provider-secret-123456789-fixture-7/); assert.match(read().momentsLoadError, /错误代码：unknown/);
});
test("image preparation failures use fixed guidance without raw browser errors", async () => {
  await mount(); fixture.imageReader = async () => { throw new Error("FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY"); };
  try {
    await act(async () => { await fixture.api.selectMomentImages({ target: { files: [{ name: "fictional.png", lastModified: 1 }], value: "old" } }); });
    assert.doesNotMatch(read().notice, /FICTIONAL_RAW_DYNAMIC_BODY_DO_NOT_DISPLAY/); assert.match(read().notice, /moment_image_prepare_failed/); assert.match(read().notice, /JPG.*PNG.*WebP.*GIF/);
  } finally { fixture.imageReader = async () => ({ type: "image/png", data: "synthetic", preview: "synthetic" }); }
});

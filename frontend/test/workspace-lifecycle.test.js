import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import { env } from "node:process";
import { setImmediate } from "node:timers";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import "fake-indexeddb/auto";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CA = "33333333-3333-4333-8333-333333333333";
const CB = "44444444-4444-4444-8444-444444444444";
const sessionFor = account => ({ access_token: `fictional-${account}`, user: { id: account } });
let sdkSession = sessionFor(A), authListener, tree, manager, confirmations = [], confirmAnswer = true, promptAnswer = "new.txt", clipboard = "虚构粘贴内容", leaveGuard, guardRegistrations = 0, guardCleanups = 0;
const storageRows = new Map(), requests = [], timers = new Map(), listeners = new Map(), downloads = [], signOuts = [];
let timerId = 0;
const fixture = { authOptions: {
  supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder",
  storage: { getItem: key => storageRows.get(key) ?? null, setItem: (key, value) => storageRows.set(key, String(value)), removeItem: key => storageRows.delete(key) },
  createClientFn: () => ({ auth: {
    async getSession() { return { data: { session: sdkSession }, error: null }; },
    onAuthStateChange(callback) { authListener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { signOuts.push(true); sdkSession = null; authListener("SIGNED_OUT", null); return { error: null }; },
  } }),
} };
const names = ["window", "document", "navigator", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__workspaceLifecycleFixture"];
const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__workspaceLifecycleFixture = fixture;
globalThis.window = {
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  confirm(text) { confirmations.push(text); return confirmAnswer; }, prompt() { return promptAnswer; },
  addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
};
globalThis.document = { body: { appendChild() {} }, createElement() { return { click() { downloads.push({ name: this.download, url: this.href }); }, remove() {} }; }, execCommand: () => false };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { readText: async () => clipboard, writeText: async () => {} } } });
globalThis.fetch = (url, options = {}) => new Promise((fulfill, reject) => {
  const target = new URL(url);
  requests.push({ path: target.pathname, query: target.searchParams, method: options.method || "GET", options,
    respond(data, status = 200, companion = CA) { fulfill(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...(companion ? { "X-DengTa-Companion-Id": companion } : {}) } })); }, raw: fulfill, reject,
  });
});
const cacheDir = mkdtempSync(join(tmpdir(), "dengta-workspace-lifecycle-"));
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), cacheDir, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{ name: "workspace-fictional-sdk", enforce: "pre", load(id) {
    const path = id.replaceAll("\\", "/");
    if (path.endsWith("/src/auth-session.js")) return readFileSync(id, "utf8").replace("export const authSession = createAuthSessionManager();", "export const authSession = createAuthSessionManager(globalThis.__workspaceLifecycleFixture.authOptions);");
    if (env.DENGTA_WORKSPACE_SOURCE && path.endsWith("/src/WorkspaceManager.jsx")) return readFileSync(env.DENGTA_WORKSPACE_SOURCE, "utf8");
    if (env.DENGTA_WORKSPACE_API_SOURCE && path.endsWith("/src/workspace-api.js")) return readFileSync(env.DENGTA_WORKSPACE_API_SOURCE, "utf8");
  } }],
});
const { default: WorkspaceManager } = await vite.ssrLoadModule("/src/WorkspaceManager.jsx");
({ authSession: manager } = await vite.ssrLoadModule("/src/auth-session.js"));
const cache = await vite.ssrLoadModule("/src/workspace-cache.js");
await manager.initialize(); manager.setActiveCompanionId(CA);
const tick = async () => { for (let index = 0; index < 8; index++) await new Promise(setImmediate); };
const textOf = node => typeof node === "string" ? node : node.children.map(textOf).join("");
const button = text => tree.root.findAllByType("button").find(node => textOf(node).includes(text));
const fileButton = name => tree.root.findAllByProps({ className: "workspace-file-name" }).find(node => textOf(node.findByType("strong")) === name);
const deleteButton = () => tree.root.findAllByType("button").find(node => textOf(node) === "删除");
const editor = () => tree.root.findAllByType("textarea").find(node => String(node.props["aria-label"]).startsWith("编辑 "));
const body = () => JSON.stringify(tree?.toJSON());
const reads = () => requests.filter(row => row.method === "GET" && row.path.endsWith("/tree"));
const fileReads = () => requests.filter(row => row.method === "GET" && row.path.endsWith("/file"));
const writes = () => requests.filter(row => row.method === "PUT");
const deletes = () => requests.filter(row => row.method === "DELETE");
const treeReceipt = (path = "/") => ({ ok: true, path, entries: [{ name: "note.txt", type: "file", size: 8 }, { name: "second.txt", type: "file", size: 8 }, { name: "docs", type: "dir", size: 0 }] });
const fileReceipt = (path, content = "虚构原文", truncated = false) => ({ ok: true, path, chars: content.length, content, truncated });
async function click(node) { assert.ok(node, "button exists"); await act(async () => { node.props.onClick(); await tick(); }); }
async function respond(request, data, status = 200, companion) { assert.ok(request, "request exists"); await act(async () => { request.respond(data, status, companion); await tick(); }); }
const registerLeaveGuard = callback => { leaveGuard = callback; guardRegistrations++; return () => { if (leaveGuard === callback) leaveGuard = null; guardCleanups++; }; };
async function mount({ strict = false } = {}) { await act(async () => { const component = React.createElement(WorkspaceManager, { accountScope: A, registerLeaveGuard }); tree = TestRenderer.create(strict ? React.createElement(React.StrictMode, {}, component) : component); await tick(); }); await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.callback(); } await tick(); }); }
async function ready() { await mount(); await respond(reads()[0], treeReceipt()); const stats = requests.find(row => row.path.endsWith("/stats")); await respond(stats, { ok: true, files: 2, bytes: 16, partial: false }); }
async function open(name = "note.txt") { await click(fileButton(name)); await respond(fileReads().at(-1), fileReceipt(name)); }
async function draft(text = "虚构待保存草稿") { await act(async () => editor().props.onChange({ target: { value: text } })); }
async function newDraft() { promptAnswer = "new.txt"; await click(button("新建文件")); await draft(); }
async function importFile(file) { await act(async () => { tree.root.findByProps({ type: "file" }).props.onChange({ target: { files: [file] } }); await tick(); }); }
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); await tick(); }); tree = null;
  requests.length = 0; timers.clear(); listeners.clear(); downloads.length = 0; confirmations = []; confirmAnswer = true; promptAnswer = "new.txt"; clipboard = "虚构粘贴内容"; signOuts.length = 0; navigator.clipboard.readText = async () => clipboard; leaveGuard = null; guardRegistrations = 0; guardCleanups = 0;
  sdkSession = sessionFor(A); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(CA);
  await cache.workspaceCacheClear(A); await cache.workspaceCacheClear(B);
});
after(async () => {
  await vite.close(); manager.destroy(); assert.ok(resolve(cacheDir).startsWith(`${resolve(tmpdir())}${sep}dengta-workspace-lifecycle-`)); rmSync(cacheDir, { recursive: true, force: true });
  for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
});

test("closing an unsaved draft requires consent and declining preserves exact content", async () => {
  await ready(); await open(); await draft("  虚构草稿\n🌱  "); confirmAnswer = false; await click(button("关闭"));
  assert.equal(confirmations.length, 1); assert.equal(editor().props.value, "  虚构草稿\n🌱  "); assert.equal(writes().length, 0);
});
test("directory navigation cannot silently discard unsaved content", async () => {
  await ready(); await open(); await draft(); confirmAnswer = false; await click(fileButton("docs"));
  assert.equal(editor().props.value, "虚构待保存草稿"); assert.equal(reads().length, 1);
});
test("opening another file and new file both preserve a declined dirty draft", async () => {
  await ready(); await open(); await draft(); confirmAnswer = false; await click(fileButton("second.txt")); await click(button("新建文件"));
  assert.equal(fileReads().length, 1); assert.equal(editor().props.value, "虚构待保存草稿"); assert.equal(confirmations.length, 2);
});
test("new file supports advertised relative subdirectories instead of silently rewriting slashes", async () => {
  await ready(); promptAnswer = "docs/note.md"; await click(button("新建文件")); await draft(); await click(button("保存"));
  assert.equal(JSON.parse(writes()[0].options.body).path, "docs/note.md");
});
test("new file rejects traversal without sending a write or silently renaming", async () => {
  await ready(); promptAnswer = "../note.md"; await click(button("新建文件"));
  assert.equal(tree.root.findAllByType("textarea").length, 0); assert.match(body(), /workspace_path_invalid/); assert.equal(writes().length, 0);
});
test("same-tick save handler starts one PUT and preserves a newer draft after receipt", async () => {
  await ready(); await newDraft(); const save = button("保存").props.onClick;
  await act(async () => { save(); save(); await tick(); }); assert.equal(writes().length, 1);
  await draft("新的虚构草稿"); await respond(writes()[0], { ok: true, path: "new.txt", mode: "overwrite", chars: new Blob(["虚构待保存草稿"]).size });
  assert.equal(editor().props.value, "新的虚构草稿"); assert.equal(button("保存").props.disabled, false); assert.match(body(), /未保存/);
});
test("an incomplete success receipt cannot clear dirty text or report save success", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: true });
  assert.match(body(), /workspace_write_receipt_invalid/); assert.equal(button("保存").props.disabled, true); assert.doesNotMatch(body(), /已保存 new.txt/);
});
test("an error envelope must not expose its raw storage diagnostic", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: false, error: "fictional private storage message", code: "fictional_storage_failure" });
  assert.doesNotMatch(body(), /fictional private storage message/); assert.match(body(), /fictional_storage_failure/); assert.match(body(), /核对|读取/);
});
test("import overwrite requires an actual choice and declining sends no confirmation PUT", async () => {
  await ready(); confirmAnswer = false; await importFile({ name: "note.txt", size: 4, text: async () => "test" });
  await respond(writes()[0], { ok: false, code: "confirmation_required", message: "fictional diagnostic" });
  assert.equal(confirmations.length, 1); assert.equal(writes().length, 1); assert.doesNotMatch(body(), /已覆盖导入/);
});
test("the import lock starts before asynchronous local file reading", async () => {
  await ready(); let release; const text = new Promise(resolve => { release = resolve; }); const file = { name: "new.txt", size: 4, text: () => text };
  await importFile(file); await importFile(file); await act(async () => { release("test"); await tick(); });
  assert.equal(writes().length, 1);
});
test("a rejected text reader is a visible local read failure and submits no empty replacement", async () => {
  await ready(); await importFile({ name: "note.txt", size: 4, text: async () => { throw new Error("fictional raw local failure"); } });
  assert.match(body(), /workspace_import_read_failed/); assert.doesNotMatch(body(), /fictional raw local failure/); assert.equal(writes().length, 0);
});
test("same-tick clipboard imports cannot create two writes", async () => {
  await ready(); const handler = button("粘贴为文件").props.onClick;
  await act(async () => { handler(); handler(); await tick(); }); assert.equal(writes().length, 1);
});
test("a malformed delete receipt keeps the accepted file and local cache", async () => {
  await cache.workspaceCacheWrite(A, "note.txt", "虚构缓存"); await ready(); await open(); await click(button("删除")); await respond(deletes()[0], { ok: true });
  assert.match(body(), /workspace_delete_receipt_invalid/); assert.equal(editor().props.value, "虚构原文"); assert.equal((await cache.workspaceCacheRead(A, "note.txt")).content, "虚构原文");
});
test("a mismatched file receipt cannot display or cache another path's text", async () => {
  await ready(); await click(fileButton("note.txt")); await respond(fileReads()[0], fileReceipt("second.txt", "不应显示的虚构正文"));
  assert.equal(editor().props.value, ""); assert.equal(editor().props.readOnly, true); assert.match(body(), /workspace_file_receipt_invalid/); assert.equal(await cache.workspaceCacheRead(A, "note.txt"), undefined);
});
test("truncated current editor downloads explicitly indicate preview-only output", async () => {
  await ready(); await click(fileButton("note.txt")); await respond(fileReads()[0], fileReceipt("note.txt", "虚构预览", true)); await click(button("下载当前内容"));
  assert.match(body(), /已发起下载 note.txt（仅当前预览）/); assert.equal(downloads.length, 1); assert.equal(editor().props.readOnly, true);
});
test("unmount aborts actual requests and a late 401 cannot sign out the new account", async () => {
  await ready(); await click(fileButton("note.txt")); const request = fileReads()[0];
  await act(async () => tree.unmount()); tree = null; sdkSession = sessionFor(B); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(CB);
  await act(async () => { request.respond({ code: "invalid_session" }, 401, CB); await tick(); });
  assert.equal(request.options.signal?.aborted, true); assert.equal(manager.getSnapshot().user?.id, B); assert.equal(signOuts.length, 0); assert.equal(await cache.workspaceCacheRead(B, "note.txt"), undefined);
});
test("after account changes an outstanding clipboard read cannot submit into that new account", async () => {
  await ready(); let release; navigator.clipboard.readText = () => new Promise(resolve => { release = resolve; }); await click(button("粘贴为文件"));
  sdkSession = sessionFor(B); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(CB);
  await act(async () => { release("旧账号的虚构草稿"); await tick(); });
  assert.equal(writes().length, 0); navigator.clipboard.readText = async () => clipboard;
});
test("file failure offers a GET-only reread recovery without automatically writing", async () => {
  await ready(); await click(fileButton("note.txt")); await respond(fileReads()[0], { ok: false, error: "fictional raw failed read" });
  assert.ok(button("重新读取文件")); await click(button("重新读取文件")); await respond(fileReads()[1], fileReceipt("note.txt"));
  assert.equal(editor().props.value, "虚构原文"); assert.equal(writes().length, 0); assert.doesNotMatch(body(), /fictional raw failed read/);
});
test("invalid agents preview never turns undefined or raw object data into an accepted preview", async () => {
  await ready(); await click(button("每轮注入")); await respond(requests.find(row => row.path.endsWith("agents-md")), { ok: true });
  assert.match(body(), /workspace_agents_receipt_invalid/); assert.equal(tree.root.findAllByType("pre").length, 0);
});
test("a directory 200 envelope without entries cannot claim a verified empty cloud directory", async () => {
  await mount(); await respond(reads()[0], { ok: true, path: "/" });
  assert.match(body(), /workspace_tree_receipt_invalid/); assert.doesNotMatch(body(), /这个目录还是空的/); assert.ok(button("刷新"));
});
test("StrictMode cleanup leaves one active initial read and no permanently aborted workspace", async () => {
  await mount({ strict: true }); assert.equal(reads().length, 1); assert.equal(reads()[0].options.signal.aborted, false);
  await respond(reads()[0], treeReceipt()); assert.ok(fileButton("note.txt"));
});
test("pending file read is aborted on unmount and a late body cannot enter the account cache", async () => {
  await ready(); await click(fileButton("note.txt")); const request = fileReads()[0];
  await act(async () => tree.unmount()); tree = null; await respond(request, fileReceipt("note.txt", "late fictional content"));
  assert.equal(request.options.signal.aborted, true); assert.equal(await cache.workspaceCacheRead(A, "note.txt"), undefined);
});
test("old read completion cannot replace a new local draft or release its current state", async () => {
  await ready(); await click(fileButton("note.txt")); const request = fileReads()[0];
  await click(button("新建文件")); await draft("新的虚构内容"); await respond(request, fileReceipt("note.txt", "late old read"));
  assert.equal(editor().props.value, "新的虚构内容"); assert.match(editor().props["aria-label"], /new.txt/); assert.equal(await cache.workspaceCacheRead(A, "note.txt"), undefined);
});
test("a valid empty file is readable and cacheable without forcing a write", async () => {
  await ready(); await click(fileButton("note.txt")); await respond(fileReads()[0], fileReceipt("note.txt", ""));
  assert.equal(editor().props.value, ""); assert.equal(editor().props.readOnly, false); assert.equal((await cache.workspaceCacheRead(A, "note.txt")).content, ""); assert.equal(writes().length, 0);
});
test("a failed file read keeps its old account cache read-only and supports cached download", async () => {
  await cache.workspaceCacheWrite(A, "note.txt", "虚构缓存副本"); await ready(); await click(fileButton("note.txt")); await respond(fileReads()[0], { ok: false, error: "fictional raw storage failure" });
  assert.equal(editor().props.value, "虚构缓存副本"); assert.equal(editor().props.readOnly, true); assert.equal(button("保存").props.disabled, true); await click(button("下载当前内容")); assert.equal(downloads.length, 1);
  assert.doesNotMatch(body(), /fictional raw storage failure/);
});
test("unknown credential-looking envelope code is reduced to unknown without raw details", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: false, code: "sk-provider-secret-123456789-fixture-10", error: "raw fictional message" });
  assert.match(body(), /错误代码：unknown/); assert.doesNotMatch(body(), /sk-fictional|raw fictional message/);
});
test("acknowledged overwrite sends one explicit confirmation and caches the submitted exact text", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: false, code: "confirmation_required" });
  assert.equal(writes().length, 2); assert.equal(confirmations.length, 1); assert.equal(JSON.parse(writes()[1].options.body).confirm, true);
  await respond(writes()[1], { ok: true, path: "new.txt", mode: "overwrite", chars: new Blob(["虚构待保存草稿"]).size });
  assert.equal(button("保存").props.disabled, true); assert.equal((await cache.workspaceCacheRead(A, "new.txt")).content, "虚构待保存草稿");
});
test("a wrong write path cannot satisfy the save even with matching bytes", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: true, path: "other.txt", mode: "overwrite", chars: new Blob(["虚构待保存草稿"]).size });
  assert.match(body(), /workspace_write_receipt_invalid/); assert.equal(button("保存").props.disabled, true); assert.equal(await cache.workspaceCacheRead(A, "new.txt"), undefined);
});
test("a pending local import is canceled by unmount before any PUT reaches the network", async () => {
  await ready(); let release; const text = new Promise(resolve => { release = resolve; }); await importFile({ name: "note.txt", size: 4, text: () => text });
  await act(async () => tree.unmount()); tree = null; await act(async () => { release("test"); await tick(); }); assert.equal(writes().length, 0);
});
test("single-file size rejection happens before any local text reader runs", async () => {
  await ready(); let called = 0; await importFile({ name: "too-big.txt", size: 5 * 1024 * 1024 + 1, text: async () => { called++; return "test"; } });
  assert.equal(called, 0); assert.equal(writes().length, 0); assert.match(body(), /workspace_import_too_large/);
});
test("nested draft verifies the exact cloud path without discarding or rewriting the draft", async () => {
  await ready(); promptAnswer = "docs/note.md"; await click(button("新建文件")); await draft(); confirmAnswer = false; await click(button("重新读取文件"));
  assert.equal(fileReads()[0].query.get("path"), "docs/note.md");assert.equal(confirmations.length,0);
  await respond(fileReads()[0], fileReceipt("docs/note.md")); assert.equal(editor().props.value, "虚构待保存草稿");assert.equal(writes().length,0);
});
test("dirty draft registers a browser-close warning and removes it after close acceptance", async () => {
  await ready(); await newDraft(); const warn = listeners.get("beforeunload"); assert.equal(typeof warn, "function"); let prevented = false;
  const event = { preventDefault() { prevented = true; } }; warn(event); assert.equal(prevented, true); assert.equal(event.returnValue, "");
  await click(button("关闭")); assert.equal(listeners.has("beforeunload"), false);
});
test("a full 200-row cloud listing is explicitly described as potentially partial", async () => {
  await mount(); await respond(reads()[0], { ok: true, path: "/", entries: Array.from({ length: 200 }, (_, index) => ({ name: `file-${index}.txt`, type: "file", size: 0 })) });
  assert.match(body(), /不能据此确认已显示全部文件/); assert.equal(tree.root.findAllByProps({ className: "workspace-file-row" }).length, 200);
});
test("request timeout releases busy state, guards the unconfirmed write and retains draft", async () => {
  await ready(); await newDraft(); await click(button("保存"));
  await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 15_000) { timers.delete(id); timer.callback(); } await tick(); });
  assert.match(body(), /request_timeout/); assert.equal(writes().length, 1); assert.equal(writes()[0].options.signal.aborted, true); assert.equal(editor().props.value, "虚构待保存草稿"); assert.equal(button("保存").props.disabled, true); assert.equal(button("核对未确认文件").props.disabled, false);
});
test("timeout bounds JSON body parsing too and a late write receipt cannot clear the draft", async () => {
  await ready(); await newDraft(); await click(button("保存")); let release;
  await act(async () => { writes()[0].raw({ status: 200, ok: true, headers: new Headers(), json: () => new Promise(resolve => { release = resolve; }) }); await tick(); });
  await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 15_000) { timers.delete(id); timer.callback(); } await tick(); });
  assert.match(body(), /request_timeout/); assert.equal(button("保存").props.disabled, true); assert.equal(button("核对未确认文件").props.disabled, false);
  await act(async () => { release({ ok: true, path: "new.txt", mode: "overwrite", chars: new Blob(["虚构待保存草稿"]).size }); await tick(); });
  assert.match(body(), /未保存/); assert.doesNotMatch(body(), /已保存 new.txt/); assert.equal(await cache.workspaceCacheRead(A, "new.txt"), undefined);
});

test("a timed-out same-scope 401 body cannot expire the active login", async () => {
  await ready(); await newDraft(); await click(button("保存")); let release;
  await act(async () => {
    writes()[0].raw({ status: 401, ok: false, headers: new Headers(), clone: () => ({ json: () => new Promise(resolve => { release = resolve; }) }) });
    await tick();
  });
  assert.equal(typeof release, "function");
  await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 15_000) { timers.delete(id); timer.callback(); } await tick(); });
  assert.match(body(), /request_timeout/); assert.equal(manager.getSnapshot().status, "authenticated");
  await act(async () => { release({ code: "invalid_session" }); await tick(); });
  assert.equal(manager.getSnapshot().status, "authenticated"); assert.equal(signOuts.length, 0);
  assert.equal(editor().props.value, "虚构待保存草稿"); assert.equal(writes().length, 1);
});
test("cache failure is reported as unavailable rather than a confirmed zero-file offline listing", async () => {
  const old = globalThis.indexedDB; await ready(); Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { throw new Error("fictional IDB private error"); } } });
  try {
    await click(button("刷新")); await respond(reads()[1], { ok: false, error: "fictional cloud error" });
    assert.match(body(), /不能据此认定目录为空/); assert.match(body(), /workspace_cache_failed/); assert.ok(fileButton("note.txt")); assert.doesNotMatch(body(), /fictional IDB private error|fictional cloud error/);
  } finally { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: old }); }
});
test("clearing cache confirms its account-only scope and keeps the current dirty editor", async () => {
  await cache.workspaceCacheWrite(A, "note.txt", "fixture A"); await cache.workspaceCacheWrite(B, "note.txt", "fixture B"); await ready(); await newDraft();
  await click(button("清理缓存")); assert.equal((await cache.workspaceCacheList(A)).length, 0); assert.equal((await cache.workspaceCacheRead(B, "note.txt")).content, "fixture B");
  assert.equal(editor().props.value, "虚构待保存草稿"); assert.match(body(), /未保存/); assert.match(confirmations[0], /云端文件和其他账号/); assert.equal(writes().length, 0); assert.equal(deletes().length, 0);
});
test("false execCommand does not claim clipboard copy succeeded", async () => {
  await ready(); await open(); const previous = navigator.clipboard.writeText; navigator.clipboard.writeText = async () => { throw new Error("fictional denied permission"); };
  try { await click(button("复制")); assert.match(body(), /复制失败/); assert.doesNotMatch(body(), /已复制 ✓/); } finally { navigator.clipboard.writeText = previous; }
});
test("global navigation guard observes same-tick exact edits and cancellation preserves the draft", async () => {
  await ready(); await newDraft(); confirmAnswer = false; assert.equal(typeof leaveGuard, "function"); const originalGuard = leaveGuard;
  await act(async () => { editor().props.onChange({ target: { value: "  同一帧的新草稿\n🌱  " } }); assert.equal(leaveGuard(), false); });
  assert.equal(leaveGuard, originalGuard); assert.equal(editor().props.value, "  同一帧的新草稿\n🌱  "); assert.equal(guardRegistrations, 1);
  confirmAnswer = true; assert.equal(leaveGuard(), true); assert.equal(writes().length, 0);
});
test("clean draft can leave without a prompt; pending local read temporarily blocks the guard", async () => {
  await ready(); assert.equal(leaveGuard(), true); assert.equal(confirmations.length, 0);
  let release; await importFile({ name: "note.txt", size: 4, text: () => new Promise(resolve => { release = resolve; }) });
  assert.equal(leaveGuard(), false); await act(async () => { release("test"); await tick(); }); await respond(writes()[0], { ok: true, path: "note.txt", mode: "overwrite", chars: 4 });
  assert.equal(leaveGuard(), true);
});
test("unmount unregisters only its own navigation guard and aborts the original scope", async () => {
  await ready(); const old = leaveGuard; await act(async () => tree.unmount()); tree = null;
  assert.equal(leaveGuard, null); assert.equal(guardCleanups, 1); assert.equal(old(), false);
});
test("StrictMode registers a usable final guard and balances registration cleanup", async () => {
  await mount({ strict: true }); await respond(reads()[0], treeReceipt()); assert.equal(typeof leaveGuard, "function"); assert.equal(leaveGuard(), true); assert.equal(guardRegistrations - guardCleanups, 1);
  await act(async () => tree.unmount()); tree = null; assert.equal(guardRegistrations, guardCleanups); assert.equal(leaveGuard, null);
});
test("local file read timeout releases its lock with no PUT even when the old reader finishes later", async () => {
  await ready(); await newDraft(); let release; await importFile({ name: "note.txt", size: 4, text: () => new Promise(resolve => { release = resolve; }) });
  await act(async () => { for (const [id, timer] of [...timers]) if (timer.delay === 15_000) { timers.delete(id); timer.callback(); } await tick(); });
  assert.match(body(), /workspace_import_read_timeout/); assert.equal(editor().props.value, "虚构待保存草稿"); assert.equal(writes().length, 0); assert.equal(button("新建文件").props.disabled, false);
  await act(async () => { release("test"); await tick(); }); assert.equal(writes().length, 0);
});
test("failed browser download retains content and produces a local error instead of throwing", async () => {
  await ready(); await open(); const previous = document.createElement; document.createElement = () => { throw new Error("fictional download denied"); };
  try { await click(button("下载当前内容")); assert.match(body(), /workspace_download_failed/); assert.equal(editor().props.value, "虚构原文"); assert.doesNotMatch(body(), /fictional download denied/); } finally { document.createElement = previous; }
});
test("same-tick file open holds the local import lock until its read has completed", async () => {
  await ready(); const opening = fileButton("note.txt").props.onClick; const paste = button("粘贴为文件").props.onClick;
  await act(async () => { opening(); paste(); await tick(); }); assert.equal(writes().length, 0); assert.equal(fileReads().length, 1);
  await respond(fileReads()[0], fileReceipt("note.txt")); assert.equal(editor().props.value, "虚构原文");
});

for (const kind of ["different", "same", "truncated", "failure", "new-edit"]) test(`cloud verification preserves drafts and never repeats a write: ${kind}`, async () => {
  await ready(); await open(); await draft("  精确草稿\n🌱  ");
  const original = editor().props.value;
  await click(button("重新读取文件"));
  if (kind === "new-edit") await draft("  更新的草稿\n  ");
  await respond(fileReads().at(-1), kind === "failure" ? { ok: false, code: "workspace_file_unavailable", error: "fictional private body" }
    : fileReceipt("note.txt", kind === "different" ? "云端原文" : original, kind === "truncated"), kind === "failure" ? 503 : 200);
  assert.equal(editor().props.value, kind === "new-edit" ? "  更新的草稿\n  " : original);
  assert.equal(writes().length, 0); assert.equal(deletes().length, 0); assert.equal(confirmations.length, 0);
  if (kind === "same") assert.doesNotMatch(body(), /● 未保存/);
  else assert.match(body(), /● 未保存/);
  if (kind === "truncated") assert.match(body(), /仅部分预览|不能用来确认保存/);
  if (kind === "failure") assert.doesNotMatch(body(), /fictional private body/);
});

test("same-tick clicks on one file start only one cloud read", async () => {
  await ready(); const handler = fileButton("note.txt").props.onClick;
  await act(async () => { handler(); handler(); await tick(); });
  assert.equal(fileReads().length, 1);
  await respond(fileReads()[0], fileReceipt("note.txt"));
  assert.equal(editor().props.value, "虚构原文"); assert.equal(writes().length, 0);
});

test("same-tick typing and copying use the exact latest editor draft", async () => {
  await ready(); await open(); const copy = button("复制").props.onClick;
  const previous = navigator.clipboard.writeText, copied = [], raw = "  虚构最新正文\r\n🌱  ";
  navigator.clipboard.writeText = async text => copied.push(text);
  try {
    await act(async () => { editor().props.onChange({ target: { value: raw } }); copy(); await tick(); });
    assert.deepEqual(copied, [raw]); assert.equal(writes().length, 0);
  } finally { navigator.clipboard.writeText = previous; }
});

test("same-tick typing and downloading use the exact latest editor draft", async () => {
  await ready(); await open(); const download = button("下载当前内容").props.onClick;
  const previous = URL.createObjectURL, blobs = [], raw = "  虚构下载原文\r\n🌱  ";
  URL.createObjectURL = blob => { blobs.push(blob); return "blob:fictional-workspace-download"; };
  try {
    await act(async () => { editor().props.onChange({ target: { value: raw } }); download(); await tick(); });
    assert.equal(blobs.length, 1); assert.equal(await blobs[0].text(), raw); assert.equal(writes().length, 0);
  } finally { URL.createObjectURL = previous; }
});

test("an unconfirmed save blocks stale writes until the same file is checked and the user explicitly continues", async () => {
  await ready(); await newDraft(); const save = button("保存").props.onClick, paste = button("粘贴为文件").props.onClick;
  await click(button("保存")); await respond(writes()[0], { ok: true });
  await act(async () => { save(); paste(); await tick(); });
  assert.equal(writes().length, 1); assert.equal(button("保存").props.disabled, true);
  await click(button("重新读取文件")); await respond(fileReads()[0], { ok: false, code: "workspace_file_unavailable" });
  assert.equal(button("保存").props.disabled, true); assert.equal(editor().props.value, "虚构待保存草稿");
  await click(button("重新读取文件")); await respond(fileReads()[1], fileReceipt("new.txt", "虚构云端旧正文"));
  assert.equal(writes().length, 1); assert.equal(button("保存").props.disabled, true);
  await click(button("已核对现状，继续手动操作")); assert.equal(button("保存").props.disabled, false);
  assert.equal(editor().props.value, "虚构待保存草稿");
});

test("an unconfirmed delete remains guarded after ordinary refresh and requires checking its target then explicit continuation", async () => {
  await ready(); const remove = deleteButton().props.onClick;
  await click(deleteButton()); await respond(deletes()[0], { ok: true });
  await act(async () => { remove(); await tick(); });
  assert.equal(deletes().length, 1); assert.equal(deleteButton().props.disabled, true);
  await click(button("刷新")); await respond(reads()[1], { ok: true, path: "/" });
  assert.equal(button("粘贴为文件").props.disabled, true);
  await click(button("刷新")); await respond(reads()[2], treeReceipt());
  assert.equal(deleteButton().props.disabled, true);
  await click(button("核对删除目标目录")); await respond(reads()[3], treeReceipt());
  assert.equal(deleteButton().props.disabled, true); assert.match(body(), /这不是前次删除回执/);
  await click(button("已核对现状，继续手动操作"));
  assert.equal(deleteButton().props.disabled, false); assert.equal(deletes().length, 1);
});

test("a failed clipboard write retains its exact candidate for download without replacing another dirty file", async () => {
  await ready(); await newDraft(); clipboard = "  虚构粘贴候选\r\n🌱  "; promptAnswer = "docs/pasted.txt";
  await click(button("粘贴为文件")); await respond(writes()[0], { ok: true });
  assert.equal(editor().props.value, "虚构待保存草稿");
  const download = button("下载未确认内容"); assert.ok(download);
  const previous = URL.createObjectURL, blobs = [];
  URL.createObjectURL = blob => { blobs.push(blob); return "blob:fictional-workspace-candidate"; };
  try { await click(download); assert.equal(await blobs[0].text(), clipboard); }
  finally { URL.createObjectURL = previous; }
  assert.equal(downloads[0].name, "pasted.txt"); assert.equal(writes().length, 1);
});

test("confirmed exact text survives close, directory return, unmount and reopening through GET only", async () => {
  await ready(); await open(); const raw = "  虚构已确认正文\r\n🌱  "; await draft(raw);
  await click(button("保存")); await respond(writes()[0], { ok: true, path: "note.txt", mode: "overwrite", chars: new Blob([raw]).size });
  assert.equal(JSON.parse(writes()[0].options.body).content, raw);
  await respond(reads()[1], treeReceipt()); await click(button("关闭")); await click(fileButton("docs"));
  await respond(reads()[2], { ok: true, path: "docs", entries: [] }); await click(button("工作区根目录"));
  await respond(reads()[3], treeReceipt());
  await act(async () => { tree.unmount(); await tick(); }); tree = null;
  await mount(); await respond(reads()[4], treeReceipt()); await click(fileButton("note.txt"));
  await respond(fileReads()[1], fileReceipt("note.txt", raw));
  assert.equal(editor().props.value, raw); assert.equal(writes().length, 1); assert.equal(deletes().length, 0);
});

for (const status of [200, 401]) test(`a late write ${status} cannot alter a switched companion or cache a new account's files`, async () => {
  await ready(); await newDraft(); await click(button("保存")); const pending = writes()[0];
  sdkSession = sessionFor(B); authListener("SIGNED_IN", sdkSession); manager.setActiveCompanionId(CB);
  await respond(pending, status === 200 ? { ok: true, path: "new.txt", mode: "overwrite", chars: new Blob(["虚构待保存草稿"]).size } : { code: "invalid_session" }, status, CA);
  assert.equal(manager.getSnapshot().user?.id, B); assert.equal(manager.getSnapshot().activeCompanionId, CB);
  assert.equal(signOuts.length, 0); assert.equal(await cache.workspaceCacheRead(B, "new.txt"), undefined);
  assert.doesNotMatch(body(), /已保存 new.txt/); assert.equal(writes().length, 1);
});

for (const [label, data, status] of [
  ["explicit 403", { code: "forbidden", message: "FICTIONAL_PRIVATE_STORAGE_ERROR" }, 403],
  ["explicit 413", { code: "payload_too_large" }, 413],
  ["rejected storage envelope", { ok: false, code: "workspace_operation_failed", error: "FICTIONAL_PRIVATE_STORAGE_ERROR" }, 200],
]) test(`a ${label} keeps the exact draft and permits an explicit retry`, async () => {
  await ready(); await newDraft(); const raw = "  虚构明确失败草稿\r\n🌱  "; await draft(raw);
  await click(button("保存")); await respond(writes()[0], data, status);
  assert.equal(editor().props.value, raw); assert.equal(button("保存").props.disabled, false);
  assert.equal(button("核对未确认文件"), undefined); assert.doesNotMatch(body(), /FICTIONAL_PRIVATE_STORAGE_ERROR/);
  assert.doesNotMatch(body(), /写入可能已经到达云端/);
  assert.equal(writes().length, 1); await click(button("保存")); assert.equal(writes().length, 2);
});

test("an uncertain clipboard import is checked only at its exact path and preserves a newer editor draft", async () => {
  await ready(); await newDraft(); const candidate = "  虚构粘贴候选\r\n🌱  "; clipboard = candidate; promptAnswer = "docs/pasted.txt";
  await click(button("粘贴为文件")); await respond(writes()[0], { ok: true });
  await draft("  后来的编辑草稿  "); await click(button("重新读取文件"));
  await respond(fileReads()[0], fileReceipt("new.txt", "与导入无关的虚构正文"));
  assert.equal(button("保存").props.disabled, true); assert.equal(button("已核对现状，继续手动操作"), undefined);
  await click(button("核对未确认文件")); assert.equal(fileReads()[1].query.get("path"), "docs/pasted.txt");
  await respond(fileReads()[1], fileReceipt("docs/pasted.txt", candidate));
  assert.equal(editor().props.value, "  后来的编辑草稿  "); assert.equal(button("保存").props.disabled, false);
  assert.match(body(), /已核对当前内容/); assert.equal(writes().length, 1);
});

test("matching the submitted file does not clear a newer exact draft typed while checking", async () => {
  await ready(); await newDraft(); const submitted = editor().props.value;
  await click(button("保存")); await respond(writes()[0], { ok: true });
  await click(button("核对未确认文件")); await draft("  较新的虚构草稿\r\n🌱  ");
  await respond(fileReads()[0], fileReceipt("new.txt", submitted));
  assert.equal(editor().props.value, "  较新的虚构草稿\r\n🌱  "); assert.match(body(), /● 未保存/);
  assert.equal(button("保存").props.disabled, false); assert.equal(writes().length, 1);
});

for (const kind of ["wrong path", "truncated", "empty envelope"]) test(`a ${kind} verification keeps the import candidate guarded and downloadable`, async () => {
  await ready(); const raw = "  虚构本地文件原文\r\n🌱  ";
  await importFile({ name: "note.txt", size: new Blob([raw]).size, text: async () => raw }); await respond(writes()[0], { ok: true });
  await click(button("核对未确认文件"));
  await respond(fileReads()[0], kind === "empty envelope" ? { ok: true } : fileReceipt(kind === "wrong path" ? "second.txt" : "note.txt", raw, kind === "truncated"));
  assert.equal(button("粘贴为文件").props.disabled, true); assert.ok(button("下载未确认内容"));
  assert.equal(button("已核对现状，继续手动操作"), undefined); assert.equal(writes().length, 1);
});

test("a full 200-row target directory cannot establish that an unlisted deletion target is absent", async () => {
  await ready(); await click(deleteButton()); await respond(deletes()[0], { ok: true });
  await click(button("核对删除目标目录"));
  await respond(reads()[1], { ok: true, path: "/", entries: Array.from({ length: 200 }, (_, index) => ({ name: `fictional-${index}.txt`, type: "file", size: 0 })) });
  assert.match(body(), /未列出目标文件不能证明它已不存在/); assert.equal(button("已核对现状，继续手动操作"), undefined);
  assert.equal(deleteButton().props.disabled, true); assert.equal(deletes().length, 1);
});

test("checking a nested delete target uses its original directory while ordinary navigation remains available", async () => {
  await ready(); await click(fileButton("docs")); await respond(reads()[1], treeReceipt("docs"));
  await click(deleteButton()); assert.equal(deletes()[0].query.get("path"), "docs/note.txt"); await respond(deletes()[0], { ok: true });
  await click(button("工作区根目录")); await respond(reads()[2], treeReceipt());
  await click(button("核对删除目标目录")); assert.equal(reads()[3].query.get("path"), "docs");
  await respond(reads()[3], { ok: true, path: "docs", entries: [] });
  assert.match(body(), /本次完整目录列表未列出目标文件/); assert.doesNotMatch(body(), /已删除 docs\/note.txt/);
  assert.equal(deletes().length, 1); await click(button("已核对现状，继续手动操作")); assert.equal(deleteButton().props.disabled, false);
});

test("import success preserves exact source bytes through close and a later file read", async () => {
  await ready(); const raw = "  虚构导入原文\r\n🌱  ";
  await importFile({ name: "note.txt", size: new Blob([raw]).size, text: async () => raw });
  assert.deepEqual(JSON.parse(writes()[0].options.body), { path: "note.txt", content: raw, mode: "overwrite", confirm: false });
  await respond(writes()[0], { ok: true, path: "note.txt", mode: "overwrite", chars: new Blob([raw]).size });
  await respond(reads()[1], treeReceipt()); await click(fileButton("note.txt")); await respond(fileReads()[0], fileReceipt("note.txt", raw));
  await click(button("关闭")); await click(fileButton("note.txt")); await respond(fileReads()[1], fileReceipt("note.txt", raw));
  assert.equal(editor().props.value, raw); assert.equal(button("保存").props.disabled, true); assert.equal(writes().length, 1);
});

test("a stale checked-result button cannot release a later uncertain write", async () => {
  await ready(); await newDraft(); await click(button("保存")); await respond(writes()[0], { ok: true });
  await click(button("核对未确认文件")); await respond(fileReads()[0], fileReceipt("new.txt", "虚构不同云端正文"));
  const oldContinue = button("已核对现状，继续手动操作").props.onClick;
  await click(button("已核对现状，继续手动操作")); await click(button("保存")); await respond(writes()[1], { ok: true });
  await act(async () => { oldContinue(); await tick(); });
  assert.equal(button("保存").props.disabled, true); assert.equal(writes().length, 2);
});

test("an explicitly rejected clipboard write retains its exact candidate without guarding future writes", async () => {
  await ready(); clipboard = "  虚构拒绝提交副本\r\n🌱  "; promptAnswer = "docs/pasted.txt";
  await click(button("粘贴为文件")); await respond(writes()[0], { code: "forbidden" }, 403);
  assert.equal(button("粘贴为文件").props.disabled, false); assert.equal(button("核对未确认文件"), undefined);
  const previous = URL.createObjectURL, blobs = [], candidate = clipboard; clipboard = "后来的虚构剪贴板";
  URL.createObjectURL = blob => { blobs.push(blob); return "blob:fictional-rejected-candidate"; };
  try { await click(button("下载提交副本")); assert.equal(await blobs[0].text(), candidate); }
  finally { URL.createObjectURL = previous; }
  assert.equal(writes().length, 1); assert.match(body(), /写入明确未完成/);
});

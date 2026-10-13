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

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111", ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333", COMPANION_B = "44444444-4444-4444-8444-444444444444";
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const connection = (type = "supabase_memory", name = "fictional-saved") => ({ id: "fictional-connection-" + type, connection_type: type, name, enabled: true, credential_configured: true, credential_state: "available", credential_reentry_required: false, last_status: "connected", ...(type === "supabase_memory" ? { project_url: "https://fixture6example.supabase.co", table_name: "dengta_memories", read_tools: ["search_external_memories"] } : { endpoint: "https://fictional.example.test/mcp", read_tools: ["search_memories"] }) });
const list = (...connections) => ({ ok: true, connections });
const health = (count = 7) => ({ configured: true, reachable: true, tenant_verified: true, memory_enabled: true, embedding_available: true, total_memories: count, with_embedding: count, ok: true });
const testReceipt = type => ({ ok: true, result: type === "supabase_memory" ? { connection_type: type, table_name: "dengta_memories", record_count: 4, sample_columns: ["id", "summary", "updated_at"] } : { connection_type: type, tools: [{ name: "search_memories" }, { name: "write_memory" }], read_tools: ["search_memories"] } });
async function settle() { for (let i = 0; i < 50; i += 1) await Promise.resolve(); }

async function harness(kind = "external", { signedIn = true, companion = COMPANION_A, omitScope = false } = {}) {
  const descriptors = Object.fromEntries(["window", "fetch", "IS_REACT_ACT_ENVIRONMENT", "__memoryUiFixture"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const stored = new Map();
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) };
  const sessionFor = account => ({ access_token: "fictional-" + account, user: { id: account, email: "fictional@example.test" } });
  let session = signedIn ? sessionFor(ACCOUNT_A) : null, listener, signOuts = 0, refreshGate;
  const sdk = { auth: {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session }, error: null }; },
    async refreshSession() { return refreshGate ? refreshGate.promise : { data: { session }, error: null }; },
    async signOut() { signOuts += 1; session = null; listener?.("SIGNED_OUT", null); return { error: null }; },
  } };
  const manager = createAuthSessionManager({ supabaseUrl: "https://fictional.example.test", supabaseAnonKey: "fictional-public-placeholder", storage, createClientFn: () => sdk });
  await manager.initialize();
  if (companion) manager.setActiveCompanionId(companion);
  const requests = [], events = [], timers = new Map();
  let nextTimer = 0, tree, confirms = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    confirm() { confirms += 1; return true; }, dispatchEvent(event) { events.push(event.type); },
  } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "__memoryUiFixture", { configurable: true, value: { manager } });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: (url, options) => new Promise(resolve => {
    assert.equal(new URL(url).origin, "http://memory.example.test", "fixture never contacts production or an external memory database");
    requests.push({ path: new URL(url).pathname + new URL(url).search, method: options.method || "GET", body: options.body, companion: options.headers.get("X-DengTa-Companion-Id"), authorization: options.headers.get("Authorization"), signal: options.signal,
      respond(status, data, responseCompanion = companion) { resolve(new Response(JSON.stringify(data), { status, headers: responseCompanion ? { "X-DengTa-Companion-Id": responseCompanion } : {} })); }, respondWith: resolve });
    // Ignore transport abort intentionally to exercise real API and lifecycle cancellation.
  }) });
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("http://memory.example.test"), "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""), "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("") },
    plugins: [{ name: "memory-fixture-auth-and-baseline", enforce: "pre", async transform(source, id) {
      const path = id.replaceAll("\\", "/").split("?")[0];
      if (path.endsWith("/src/auth-session.js")) return source.replace("export const authSession = createAuthSessionManager();", "export const authSession = globalThis.__memoryUiFixture.manager;");
      if (env.DENGTA_MEMORY_UI_BASELINE && /\/(MemoryGatewayStatus|ExternalMemoryConnections)\.jsx$/.test(path)) return await readFile(env.DENGTA_MEMORY_UI_BASELINE + "/" + path.split("/").at(-1), "utf8");
      return null;
    } }] });
  const { default: Component } = await vite.ssrLoadModule(kind === "external" ? "/src/ExternalMemoryConnections.jsx" : "/src/MemoryGatewayStatus.jsx");
  async function render() {
    await act(async () => {
      const element = React.createElement(Component, omitScope ? {} : { scopeKey: settingsSaveScope(manager.getSnapshot()) });
      if (tree) tree.update(element); else tree = TestRenderer.create(element);
      await settle();
    });
  }
  await render();
  const article = type => tree.root.findAll(node => node.type === "article").find(node => text(node).includes(type === "supabase_memory" ? "Supabase 专用记忆库" : "Ombre Brain MCP"));
  const button = (label, type) => (type ? article(type) : tree.root).findAll(node => node.type === "button" && text(node) === label)[0];
  return { manager, requests, events, timers, render, text: () => text(tree.toJSON()), button,
    input(label, type = "supabase_memory") { return article(type).findAll(node => node.type === "label").find(node => text(node).startsWith(label)).findByType("input"); },
    async edit(label, value, type = "supabase_memory") { await act(async () => { this.input(label, type).props.onChange({ target: { value } }); await settle(); }); },
    async click(label, type, twice = false) { const target = button(label, type); assert.ok(target, "actual UI contains " + label); await act(async () => { target.props.onClick(); if (twice) target.props.onClick(); await settle(); }); },
    async expand(type = "supabase_memory") { const target = article(type).findAll(node => node.type === "button" && Object.hasOwn(node.props, "aria-expanded"))[0]; if (!target.props["aria-expanded"]) await act(async () => { target.props.onClick(); await settle(); }); },
    async fill(type = "supabase_memory") { await this.expand(type); await this.edit("显示名称", "fictional-draft", type); await this.edit(type === "supabase_memory" ? "Supabase Project URL" : "完整 HTTPS MCP 地址", type === "supabase_memory" ? "https://fixture6example.supabase.co" : "https://fictional.example.test/mcp", type); await this.edit(type === "supabase_memory" ? "Publishable / anon public key" : "Bearer Token", "fictional-read-only-credential", type); },
    async respond(index, status, data, responseCompanion) { await act(async () => { assert.ok(requests[index], "expected request " + index); requests[index].respond(status, data, responseCompanion); await settle(); }); },
    async timeout() { await act(async () => { for (const [id, timer] of [...timers]) { if (timers.delete(id)) timer.callback(); } await settle(); }); },
    switchScope(account = false) { if (account) { session = sessionFor(ACCOUNT_B); listener("SIGNED_IN", session); } manager.setActiveCompanionId(COMPANION_B); },
    holdRefresh() { session.expires_at = 1; listener("TOKEN_REFRESHED", session); refreshGate = deferred(); return refreshGate; },
    signOuts: () => signOuts, confirms: () => confirms,
    async unmount() { if (tree) { await act(async () => { tree.unmount(); await settle(); }); tree = null; } },
    async finish() { await this.unmount(); manager.destroy(); await vite.close(); for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } },
  };
}

test("failed connection list has a GET-only recovery and never labels unknown as zero configured", async () => {
  const h = await harness();
  try { await h.respond(0, 503, { code: "fictional_read_error", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /尚未读取成功/); assert.doesNotMatch(h.text(), /0 个已配置|FICTIONAL_PRIVATE_BODY/); await h.click("重新读取连接", undefined, true); assert.equal(h.requests.length, 2); await h.respond(1, 200, list()); assert.match(h.text(), /0 个已配置/); assert.ok(h.requests.every(r => r.method === "GET")); } finally { await h.finish(); }
});

for (const bad of [{}, { ok: true }, { ok: true, connections: {} }, list({ ...connection(), enabled: "yes" }), list(connection(), connection())]) {
  test("malformed successful list cannot erase or fake confirmation: " + JSON.stringify(bad).slice(0, 40), async () => {
    const h = await harness();
    try { await h.respond(0, 200, bad); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.doesNotMatch(h.text(), /0 个已配置/); } finally { await h.finish(); }
  });
}

test("list response preserves fields typed after the read began", async () => {
  const h = await harness();
  try { await h.fill(); await h.respond(0, 200, list(connection())); assert.equal(h.input("显示名称").props.value, "fictional-draft"); assert.equal(h.input("Publishable / anon public key").props.value, "fictional-read-only-credential"); } finally { await h.finish(); }
});

for (const action of ["测试当前填写（不保存）", "加密保存", "测试已保存连接", "只读预览", "导入当前账号", "移除连接"]) {
  test("same-turn double click submits one " + action, async () => {
    const h = await harness();
    try { await h.respond(0, 200, list(connection())); await h.fill(); await h.click(action, "supabase_memory", true); assert.equal(h.requests.length, 2); assert.equal(h.button(action === "加密保存" ? "保存中…" : action === "导入当前账号" ? "导入中…" : action === "只读预览" ? "预览中…" : action === "移除连接" ? "移除中…" : "测试中…", "supabase_memory").props.disabled, true); if (["移除连接", "导入当前账号"].includes(action)) assert.equal(h.confirms(), 1); } finally { await h.finish(); }
  });
}

test("successful save preserves newer name and credential draft and never resends it", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill(); await h.click("加密保存", "supabase_memory"); await h.edit("显示名称", "fictional-new-draft"); await h.edit("Publishable / anon public key", "fictional-new-credential"); await h.respond(1, 200, { ok: true, connection: connection() }); assert.equal(h.input("显示名称").props.value, "fictional-new-draft"); assert.equal(h.input("Publishable / anon public key").props.value, "fictional-new-credential"); assert.match(h.text(), /新输入已保留，尚未保存/); assert.equal(JSON.parse(h.requests[1].body).name, "fictional-draft"); assert.equal(h.requests.length, 2); } finally { await h.finish(); }
});

test("saved test preserves unsaved edits and shows recognized read tool count rather than all tools as recall", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection("ombre_brain_mcp"))); await h.fill("ombre_brain_mcp"); await h.click("测试已保存连接", "ombre_brain_mcp"); await h.respond(1, 200, { ...testReceipt("ombre_brain_mcp"), message: "FICTIONAL_PRIVATE_BODY" }); assert.equal(h.input("显示名称", "ombre_brain_mcp").props.value, "fictional-draft"); assert.match(h.text(), /1 个只读记忆工具（工具总数 2）/); assert.match(h.text(), /实际聊天召回仍待验证/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_BODY/); assert.equal(h.requests.length, 2); } finally { await h.finish(); }
});

test("MCP initialize without supported read tools is an explicit incomplete capability", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill("ombre_brain_mcp"); await h.click("测试当前填写（不保存）", "ombre_brain_mcp"); await h.respond(1, 200, { ok: true, result: { connection_type: "ombre_brain_mcp", tools: [{ name: "write_memory" }], read_tools: [] } }); assert.match(h.text(), /没有受支持的只读记忆工具/); assert.match(h.text(), /聊天召回未通过/); } finally { await h.finish(); }
});

for (const action of ["测试当前填写（不保存）", "加密保存", "测试已保存连接", "只读预览", "导入当前账号", "移除连接"]) {
  test("invalid 200 receipt is not success and keeps state for " + action, async () => {
    const h = await harness();
    try { await h.respond(0, 200, list(connection())); await h.fill(); await h.click(action, "supabase_memory"); await h.respond(1, 200, {}); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.equal(h.input("显示名称").props.value, "fictional-draft"); assert.ok(h.button("测试已保存连接", "supabase_memory")); assert.equal(h.events.length, 0); assert.equal(h.requests.length, 2); } finally { await h.finish(); }
  });
}

test("unknown action error body and credential-looking error code never render", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill(); await h.click("加密保存", "supabase_memory"); await h.respond(1, 502, { code: "sk-fictional-secret", message: "FICTIONAL_PRIVATE_BODY" }); assert.doesNotMatch(h.text(), /sk-fictional-secret|FICTIONAL_PRIVATE_BODY/); assert.match(h.text(), /错误代码：unknown/); assert.match(h.text(), /避免重复保存、导入或移除/); } finally { await h.finish(); }
});

test("known error shows stable reason and upstream HTTP without raw message", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill("ombre_brain_mcp"); await h.click("测试当前填写（不保存）", "ombre_brain_mcp"); await h.respond(1, 502, { code: "OMBRE_MCP_UPSTREAM_ERROR", upstream_status: 404, message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /\/mcp 路径/); assert.match(h.text(), /上游 HTTP 404/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_BODY/); } finally { await h.finish(); }
});

test("write result after an older refresh cannot restore the pre-save connection", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection())); await h.fill(); await h.click("重新读取连接"); await h.click("加密保存", "supabase_memory"); await h.respond(2, 200, { ok: true, connection: connection("supabase_memory", "fictional-new-saved") }); await h.respond(1, 200, list(connection())); assert.equal(h.input("显示名称").props.value, "fictional-new-saved"); assert.equal(h.requests.length, 3); } finally { await h.finish(); }
});

test("preview failure retains the last confirmed preview and malformed dates do not show Invalid Date", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection())); await h.expand(); await h.click("只读预览", "supabase_memory"); await h.respond(1, 200, { ok: true, result: { connection_type: "supabase_memory", read_only: true }, items: [{ id: "fictional-preview", summary: "FICTIONAL_PREVIEW_SENTINEL", updated_at: "bad-date" }], total: 1 }); assert.match(h.text(), /时间未知/); await h.click("只读预览", "supabase_memory"); await h.respond(2, 503, { code: "fictional_read_error" }); assert.match(h.text(), /FICTIONAL_PREVIEW_SENTINEL/); assert.doesNotMatch(h.text(), /Invalid Date/); } finally { await h.finish(); }
});

test("confirmed atomic import dispatches one refresh event with actual synchronized count", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection())); await h.expand(); await h.click("导入当前账号", "supabase_memory", true); await h.respond(1, 200, { ok: true, result: { connection_type: "supabase_memory", read_only_source: true, count_mode: "synchronized", synchronized: 3, imported: 3, updated: null, skipped: 1, total: 4 } }); assert.match(h.text(), /已同步 3 条/); assert.deepEqual(h.events, ["dengta:memories-imported"]); assert.equal(h.requests.length, 2); } finally { await h.finish(); }
});

for (const kind of ["external", "kiwi"]) {
  for (const switchAccount of [false, true]) {
    for (const status of [200, 401]) {
      test(`${kind} late ${status} after ${switchAccount ? "account" : "companion"} switch cannot mutate new scope or expire it`, async () => {
        const h = await harness(kind);
        try {
          if (kind === "kiwi") await h.click("检测连接与账号范围");
          h.switchScope(switchAccount); await h.render();
          if (kind === "kiwi") await h.click("检测连接与账号范围");
          assert.equal(h.requests[1].companion, COMPANION_B);
          await h.respond(1, 200, kind === "kiwi" ? health(9) : list(connection("supabase_memory", "fictional-new-scope")), COMPANION_B);
          await h.respond(0, status, status === 401 ? { code: "invalid_session" } : kind === "kiwi" ? health(777) : list(connection("supabase_memory", "fictional-old-scope")), COMPANION_A);
          assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.manager.getSnapshot().user.id, switchAccount ? ACCOUNT_B : ACCOUNT_A); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); assert.equal(h.requests[0].signal.aborted, true);
          if (kind === "kiwi") { assert.match(h.text(), /9 条记忆/); assert.doesNotMatch(h.text(), /777 条记忆/); } else { await h.expand(); assert.equal(h.input("显示名称").props.value, "fictional-new-scope"); }
        } finally { await h.finish(); }
      });
    }
  }
}

for (const kind of ["external", "kiwi"]) {
  test(kind + " unmount cancels pending transport and clears deadlines", async () => {
    const h = await harness(kind);
    try { if (kind === "kiwi") await h.click("检测连接与账号范围"); await h.unmount(); assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.timers.size, 0); h.switchScope(true); await h.respond(0, 401, { code: "invalid_session" }); assert.equal(h.signOuts(), 0); } finally { await h.finish(); }
  });
  test(kind + " stalled JSON body times out and permits manual recovery", async () => {
    const h = await harness(kind), body = deferred();
    try { if (kind === "kiwi") await h.click("检测连接与账号范围"); await act(async () => { h.requests[0].respondWith({ status: 200, ok: true, headers: new Headers(), json: () => body.promise }); await settle(); }); await h.timeout(); assert.match(h.text(), /request_timeout/); await h.click(kind === "kiwi" ? "检测连接与账号范围" : "重新读取连接"); assert.equal(h.requests.length, 2); await h.respond(1, 200, kind === "kiwi" ? health(5) : list()); await act(async () => { body.resolve(kind === "kiwi" ? health(777) : list(connection())); await settle(); }); if (kind === "kiwi") assert.doesNotMatch(h.text(), /777 条记忆/); else assert.match(h.text(), /0 个已配置/); } finally { await h.finish(); }
  });
  test(kind + " missing identity causes no network request", async () => {
    const h = await harness(kind, { signedIn: false, companion: null });
    try { if (kind === "kiwi") await h.click("检测连接与账号范围"); assert.equal(h.requests.length, 0); } finally { await h.finish(); }
  });
  test(kind + " current 401 still invalidates real auth manager", async () => {
    const h = await harness(kind);
    try { if (kind === "kiwi") await h.click("检测连接与账号范围"); await h.respond(0, 401, { code: "invalid_session" }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.expired); assert.ok(h.signOuts() > 0); } finally { await h.finish(); }
  });
}

test("draft body waiting for actual auth refresh never sends with a different companion", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill(); const gate = h.holdRefresh(); await h.click("加密保存", "supabase_memory"); assert.equal(h.requests.length, 1); h.switchScope(); await act(async () => { gate.resolve({ data: { session: null } }); await settle(); }); assert.equal(h.requests.length, 1); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); } finally { await h.finish(); }
});

test("Kiwi same-turn checks are one GET and health success is not recall success", async () => {
  const h = await harness("kiwi", { omitScope: true });
  try { await h.click("检测连接与账号范围", undefined, true); assert.equal(h.requests.length, 1); await h.respond(0, 200, health(7)); assert.match(h.text(), /实际聊天召回仍待验证/); assert.ok(h.requests.every(r => r.method === "GET" && r.body === undefined)); } finally { await h.finish(); }
});

for (const bad of [{}, { configured: true, reachable: true, tenant_verified: false }, { ...health(), total_memories: -1 }, { ...health(), embedding_available: "yes" }]) {
  test("Kiwi malformed health receipt is never connection success: " + JSON.stringify(bad).slice(0, 35), async () => {
    const h = await harness("kiwi");
    try { await h.click("检测连接与账号范围"); await h.respond(0, 200, bad); assert.match(h.text(), /memory_ui_receipt_invalid/); assert.doesNotMatch(h.text(), /账号与伴侣范围已确认/); } finally { await h.finish(); }
  });
}

test("Kiwi unknown failed status never exposes its raw message or malformed code", async () => {
  const h = await harness("kiwi");
  try { await h.click("检测连接与账号范围"); await h.respond(0, 200, { configured: true, reachable: false, error: "sk-fictional-secret", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /错误代码：unknown/); assert.doesNotMatch(h.text(), /sk-fictional-secret|FICTIONAL_PRIVATE_BODY/); } finally { await h.finish(); }
});

test("Kiwi missing memory feature is not reported as valid zero-memory recall", async () => {
  const h = await harness("kiwi");
  try { await h.click("检测连接与账号范围"); await h.respond(0, 200, { ...health(0), memory_enabled: false }); assert.match(h.text(), /网关未确认记忆功能可用/); assert.doesNotMatch(h.text(), /0 条记忆/); } finally { await h.finish(); }
});

test("refresh preserves unsaved inputs entered before the GET began", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection())); await h.fill(); await h.click("重新读取连接"); await h.respond(1, 200, list(connection())); assert.equal(h.input("显示名称").props.value, "fictional-draft"); assert.equal(h.input("Publishable / anon public key").props.value, "fictional-read-only-credential"); } finally { await h.finish(); }
});

test("successful unedited save clears only the submitted credential and makes future reads hydratable", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list()); await h.fill(); await h.click("加密保存", "supabase_memory"); await h.respond(1, 200, { ok: true, connection: connection() }); assert.equal(h.input("Publishable / anon public key").props.value, ""); assert.equal(h.input("显示名称").props.value, "fictional-saved"); assert.doesNotMatch(h.text(), /新输入已保留/); await h.click("重新读取连接"); await h.respond(2, 200, list(connection("supabase_memory", "fictional-refreshed"))); assert.equal(h.input("显示名称").props.value, "fictional-refreshed"); } finally { await h.finish(); }
});

test("confirmed deletion retains new form draft instead of silently deleting typed replacements", async () => {
  const h = await harness();
  try { await h.respond(0, 200, list(connection())); await h.expand(); await h.click("移除连接", "supabase_memory"); await h.edit("显示名称", "fictional-replacement"); await h.respond(1, 200, { ok: true, deleted: true, connection_type: "supabase_memory" }); assert.equal(h.input("显示名称").props.value, "fictional-replacement"); assert.match(h.text(), /新输入已保留，尚未保存/); assert.equal(h.button("测试已保存连接", "supabase_memory"), undefined); } finally { await h.finish(); }
});

for (const status of [200, 401]) {
  test("late save " + status + " cannot attach old config or invalidate the new account", async () => {
    const h = await harness();
    try { await h.respond(0, 200, list()); await h.fill(); await h.click("加密保存", "supabase_memory"); h.switchScope(true); await h.render(); await h.respond(2, 200, list(), COMPANION_B); await h.respond(1, status, status === 401 ? { code: "invalid_session" } : { ok: true, connection: connection() }, COMPANION_A); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); assert.match(h.text(), /0 个已配置/); assert.equal(h.requests[1].signal.aborted, true); assert.equal(h.events.length, 0); } finally { await h.finish(); }
  });
}

test("late Kiwi 401 JSON clone cannot expire a new account after response headers", async () => {
  const h = await harness("kiwi"), body = deferred();
  try { await h.click("检测连接与账号范围"); await act(async () => { h.requests[0].respondWith({ status: 401, ok: false, headers: new Headers({ "X-DengTa-Companion-Id": COMPANION_A }), clone: () => ({ json: () => body.promise }), json: async () => ({ code: "invalid_session" }) }); await settle(); }); h.switchScope(true); await h.render(); await h.click("检测连接与账号范围"); await h.respond(1, 200, health(9), COMPANION_B); await act(async () => { body.resolve({ code: "invalid_session" }); await settle(); }); assert.equal(h.manager.getSnapshot().user.id, ACCOUNT_B); assert.equal(h.manager.getSnapshot().activeCompanionId, COMPANION_B); assert.equal(h.signOuts(), 0); assert.match(h.text(), /9 条记忆/); } finally { await h.finish(); }
});

test("failed Kiwi recheck labels retained health as previous result and can recover without writes", async () => {
  const h = await harness("kiwi");
  try { await h.click("检测连接与账号范围"); await h.respond(0, 200, health()); await h.click("检测连接与账号范围"); await h.respond(1, 503, { code: "fictional_failed_health", message: "FICTIONAL_PRIVATE_BODY" }); assert.match(h.text(), /上次检测/); assert.match(h.text(), /7 条记忆/); assert.doesNotMatch(h.text(), /FICTIONAL_PRIVATE_BODY/); await h.click("检测连接与账号范围"); await h.respond(2, 200, { ...health(), embedding_available: false, ok: false }); assert.match(h.text(), /语义召回未通过/); assert.ok(h.requests.every(r => r.method === "GET")); } finally { await h.finish(); }
});

test("timed-out Kiwi 401 JSON clone cannot expire the session after a successful manual recheck", async () => {
  const h = await harness("kiwi"), body = deferred();
  try { await h.click("检测连接与账号范围"); await act(async () => { h.requests[0].respondWith({ status: 401, ok: false, headers: new Headers(), clone: () => ({ json: () => body.promise }), json: async () => ({ code: "invalid_session" }) }); await settle(); }); await h.timeout(); assert.match(h.text(), /request_timeout/); await h.click("检测连接与账号范围"); await h.respond(1, 200, health(9)); await act(async () => { body.resolve({ code: "invalid_session" }); await settle(); }); assert.equal(h.manager.getSnapshot().status, AUTH_STATUS.authenticated); assert.equal(h.signOuts(), 0); assert.match(h.text(), /9 条记忆/); } finally { await h.finish(); }
});

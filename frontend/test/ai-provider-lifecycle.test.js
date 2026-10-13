import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const originalDraft = { name: "Fixture interface", base_url: "https://fictional.example.test/v1", credential: "synthetic-placeholder", default_model: "fixture-model" };
const latestDraft = { name: "  下一份草稿  ", base_url: "https://next.example.test/v1", credential: "synthetic-next-placeholder", default_model: "  新模型  " };
const fixture = {
  calls: [], profiles: [], statusEvents: [], invalidations: [], account: "fictional-account-a", companion: "fictional-companion-a",
  holdInitialProfiles: false, holdInitialStatus: false, failNextProfiles: false, failInitialStatus: false,
  auth: {
    getSnapshot() { return { user: { id: fixture.account }, activeCompanionId: fixture.companion }; },
    async getRequestContext() { return { accessToken: `synthetic-${fixture.account}`, companionId: fixture.companion }; },
    captureCompanionFromResponse() {},
    async invalidateSession() { fixture.invalidations.push(fixture.account); },
  },
  fetch(url, options) {
    const call = { path: new URL(url).pathname, options, ...deferred() };
    this.calls.push(call);
    if (options.method === "GET") {
      if (call.path.endsWith("/status")) {
        if (!this.holdInitialStatus || this.calls.filter(item => item.path.endsWith("/status")).length > 1) {
          call.resolve(this.failInitialStatus ? response({ code: "api_request_failed" }, 503) : response({ available: true }));
        }
      } else if (call.path.endsWith("/manage")) {
        if (!this.holdInitialProfiles || profileReads().length > 1) {
          if (this.failNextProfiles) { this.failNextProfiles = false; call.resolve(response({ code: "api_request_failed" }, 503)); }
          else call.resolve(response({ profiles: this.profiles }));
        }
      } else throw new Error(`Unexpected fictional GET: ${call.path}`);
    }
    return call.promise;
  },
};
globalThis.__aiProviderFixture = fixture;
const descriptors = Object.fromEntries(["window", "fetch"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, confirm: () => true } });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: (...args) => fixture.fetch(...args) });
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true },
  plugins: [{ name: "fictional-provider-auth", load(id) {
    if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__aiProviderFixture.auth;";
  } }],
});
const { default: AiProviderCenter } = await vite.ssrLoadModule("/src/AiProviderCenter.jsx");
let tree;
const form = () => tree.root.findByProps({ className: "provider-create-card" });
const placeholders = { name: "例如：我的 New API", base_url: "https://你的网关域名/v1", credential: "粘贴服务商生成的 API Key", default_model: "例如：gpt-5.5" };
const draft = () => Object.fromEntries(Object.entries(placeholders).map(([key, placeholder]) => [key, form().findByProps({ placeholder }).props.value]));
const mutations = () => fixture.calls.filter(call => call.options.method !== "GET");
const profileReads = () => fixture.calls.filter(call => call.options.method === "GET" && call.path.endsWith("/manage"));
const buttons = () => tree.root.findAllByType("button");
const button = text => buttons().find(item => item.children.join("") === text) || buttons().find(item => item.children.join("").includes(text));
const feedback = () => tree.root.findAllByProps({ className: "provider-feedback" }).map(item => item.children.join("")).join("\n");
const savedNames = () => tree.root.findAll(item => item.type === "article").map(item => item.findByProps({ className: "provider-profile-head" }).findByType("strong").children.join(""));
async function tick() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
async function mount() { await act(async () => { tree = TestRenderer.create(React.createElement(AiProviderCenter, { onStatusChange: value => fixture.statusEvents.push(value) })); await tick(); }); }
async function fill(values = originalDraft) { await act(async () => { for (const [key, value] of Object.entries(values)) form().findByProps({ placeholder: placeholders[key] }).props.onChange({ target: { value } }); }); }
async function submit() { await act(async () => { form().props.onSubmit({ preventDefault() {} }); await tick(); }); }
async function saveSuccess(index = 0) {
  const call = mutations()[index], payload = JSON.parse(call.options.body);
  fixture.profiles = [{ ...payload, id: `fixture-${index}`, credential: "", auth_configured: true }];
  await act(async () => { call.resolve(response({ profile: fixture.profiles[0] }, 201)); await tick(); });
}
afterEach(async () => {
  if (tree) await act(async () => { tree.unmount(); await tick(); }); tree = null;
  fixture.calls.length = 0; fixture.profiles = []; fixture.statusEvents.length = 0; fixture.invalidations.length = 0;
  fixture.account = "fictional-account-a"; fixture.companion = "fictional-companion-a";
  fixture.holdInitialProfiles = false; fixture.holdInitialStatus = false; fixture.failNextProfiles = false; fixture.failInitialStatus = false;
});
after(async () => { await vite.close(); delete globalThis.__aiProviderFixture; for (const [name, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });

test("same-tick create submissions send one POST and expose a busy save button", async () => {
  await mount(); await fill();
  await act(async () => { const submit = form().props.onSubmit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick(); });
  assert.equal(mutations().length, 1);
  assert.equal(button("保存中").props.disabled, true);
  await saveSuccess();
  assert.deepEqual(draft(), { name: "", base_url: "", credential: "", default_model: "" });
});

test("a confirmed create preserves the new raw draft entered while the POST is pending", async () => {
  await mount(); await fill(); await submit(); await fill(latestDraft); await saveSuccess();
  assert.deepEqual(draft(), latestDraft);
  assert.deepEqual(savedNames(), [originalDraft.name]);
  assert.match(feedback(), /已加密保存/);
});

test("POST failure retains the draft and reports an unconfirmed save without exposing the raw response", async () => {
  await mount(); await fill(); await submit();
  await act(async () => { mutations()[0].resolve(response({ error: "AI_PROVIDER_REQUEST_FAILED", message: "FICTIONAL_PRIVATE_UPSTREAM_BODY" }, 503)); await tick(); });
  assert.deepEqual(draft(), originalDraft);
  assert.match(feedback(), /保存结果尚未确认/);
  assert.doesNotMatch(feedback(), /FICTIONAL_PRIVATE_UPSTREAM_BODY/);
  assert.equal(button("安全保存接口").props.disabled, false);
});

test("a confirmed save followed by a failed list refresh offers GET-only recovery without another POST", async () => {
  await mount(); await fill(); await submit(); fixture.failNextProfiles = true; await saveSuccess();
  assert.match(feedback(), /已加密保存.*列表刷新失败/s);
  assert.match(feedback(), /勿重复/);
  assert.deepEqual(draft(), { name: "", base_url: "", credential: "", default_model: "" });
  const retry = button("刷新接口列表"); assert.ok(retry, "a failed refresh needs a visible retry action");
  await act(async () => { retry.props.onClick(); await tick(); });
  assert.equal(mutations().length, 1); assert.deepEqual(savedNames(), [originalDraft.name]);
});

test("the late initial list cannot replace the newer list recovered after a create", async () => {
  fixture.holdInitialProfiles = true; await mount(); await fill(); await submit(); await saveSuccess();
  assert.deepEqual(savedNames(), [originalDraft.name]);
  await act(async () => { profileReads()[0].resolve(response({ profiles: [] })); await tick(); });
  assert.deepEqual(savedNames(), [originalDraft.name]);
});

test("a delayed draft probe cannot attach its models or success message to an edited gateway", async () => {
  await mount(); await fill();
  await act(async () => { button("检查模型目录但不保存").props.onClick(); await tick(); });
  await fill(latestDraft);
  await act(async () => { mutations()[0].resolve(response({ models: ["old-gateway-model"] })); await tick(); });
  assert.equal(form().findByType("datalist").findAllByType("option").length, 0);
  assert.doesNotMatch(feedback(), /发现 1 个模型/);
  assert.deepEqual(draft(), latestDraft);
});

test("completion after panel unmount cannot start follow-up reads or notify the parent", async () => {
  await mount(); await fill(); await submit(); const call = mutations()[0];
  await act(async () => tree.unmount()); tree = null;
  const reads = profileReads().length, statuses = fixture.statusEvents.length;
  await act(async () => { call.resolve(response({ profile: { id: "old-fixture" } }, 201)); await tick(); });
  assert.equal(profileReads().length, reads); assert.equal(fixture.statusEvents.length, statuses);
});

test("saved-profile edits typed during a probe survive its server list refresh without another mutation", async () => {
  fixture.profiles = [{ ...originalDraft, credential: "", auth_configured: true, id: "existing-fixture", protocol: "openai-chat", enabled: true }];
  await mount();
  await act(async () => { button("检查模型目录").props.onClick(); await tick(); });
  const article = tree.root.findByType("article");
  await act(async () => { article.findByProps({ placeholder: placeholders.name }).props.onChange({ target: { value: "  unsaved profile edit  " } }); });
  await act(async () => { mutations()[0].resolve(response({ models: ["stored-gateway-model"] })); await tick(); });
  assert.deepEqual(savedNames(), ["  unsaved profile edit  "]);
  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].path, "/api/ai-providers/manage/existing-fixture/test");
  assert.equal(mutations()[0].options.body, undefined, "saved-profile probes keep using only the saved backend configuration");
});

test("a saved-profile PUT clears only submitted edits while retaining newer unsaved fields", async () => {
  fixture.profiles = [{ ...originalDraft, credential: "", auth_configured: true, id: "existing-fixture", protocol: "openai-chat", enabled: true }];
  await mount();
  const article = () => tree.root.findByType("article");
  await act(async () => { article().findByProps({ placeholder: placeholders.name }).props.onChange({ target: { value: "Submitted profile name" } }); });
  await act(async () => { button("保存修改").props.onClick(); await tick(); });
  const payload = JSON.parse(mutations()[0].options.body);
  await act(async () => {
    article().findByProps({ placeholder: placeholders.name }).props.onChange({ target: { value: "  New unsaved name  " } });
    article().findByType("textarea").props.onChange({ target: { value: "  New note\r\n第二行  " } });
  });
  fixture.profiles = [{ ...payload, id: "existing-fixture", credential: "", auth_configured: true }];
  await act(async () => { mutations()[0].resolve(response({ profile: fixture.profiles[0] })); await tick(); });
  assert.deepEqual(savedNames(), ["  New unsaved name  "]);
  assert.equal(article().findByType("textarea").props.value, "  New note\r\n第二行  ");
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].options.method, "PUT");
  assert.equal(payload.name, "Submitted profile name");
});

test("a pending make-default receipt preserves a later unsaved default selection", async () => {
  fixture.profiles = ["first-fixture", "second-fixture"].map(id => ({ ...originalDraft, name: id, credential: "", auth_configured: true, id, protocol: "openai-chat", enabled: true, is_default: false }));
  await mount();
  await act(async () => { button("设为下次聊天首选").props.onClick(); await tick(); });
  const second = tree.root.findAllByType("article")[1];
  await act(async () => { second.findAllByProps({ type: "checkbox" })[1].props.onChange({ target: { checked: true } }); });
  fixture.profiles = fixture.profiles.map(profile => ({ ...profile, is_default: profile.id === "first-fixture" }));
  await act(async () => { mutations()[0].resolve(response({ profile: fixture.profiles[0] })); await tick(); });
  const articles = tree.root.findAllByType("article");
  assert.equal(articles[0].findAllByProps({ type: "checkbox" })[1].props.checked, false);
  assert.equal(articles[1].findAllByProps({ type: "checkbox" })[1].props.checked, true);
  assert.equal(mutations().length, 1);
  assert.equal(mutations()[0].path, "/api/ai-providers/manage/first-fixture/default");
  assert.equal(mutations()[0].options.body, undefined);
});

for (const switchKind of ["account", "companion"]) {
  test(`an old status 401 after a ${switchKind} switch does not invalidate the new session`, async () => {
    fixture.holdInitialStatus = true; await mount();
    if (switchKind === "account") fixture.account = "fictional-account-b";
    fixture.companion = "fictional-companion-b";
    await act(async () => { fixture.calls.find(call => call.path.endsWith("/status")).resolve(response({ code: "invalid_session" }, 401)); await tick(); });
    assert.equal(fixture.invalidations.length, 0);
    assert.equal(fixture.statusEvents.length, 0);
  });
}

test("a failed initial status read is unknown, offers an explicit retry, and never claims a missing migration", async () => {
  fixture.failInitialStatus = true; await mount();
  assert.doesNotMatch(tree.root.findByProps({ className: "provider-state pending" }).children.join(""), /等待数据库迁移/);
  const retry = button("刷新接口列表"); assert.ok(retry);
  fixture.failInitialStatus = false;
  await act(async () => { retry.props.onClick(); await tick(); });
  assert.match(tree.root.findByProps({ className: "provider-state ready" }).children.join(""), /数据库已就绪/);
  assert.equal(mutations().length, 0);
});

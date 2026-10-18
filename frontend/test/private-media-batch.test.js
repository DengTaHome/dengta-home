import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const scopeA = JSON.stringify(["fictional-account-a", "fictional-companion-a"]);
const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
const emptyCatalog = () => ({ assets: [], preferences: {} });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fixture = {
  snapshot: {}, listeners: new Set(), catalogs: new Map(), calls: [], reads: [], aborted: [], behavior: null,
  setScope(scope) {
    const [account, companion] = JSON.parse(scope);
    this.snapshot = { user: { id: account }, activeCompanionId: companion };
    for (const listener of this.listeners) listener();
  },
  scope() { return JSON.stringify([this.snapshot.user.id, this.snapshot.activeCompanionId]); },
  read() {
    const scope = this.scope();
    this.reads.push(scope);
    return Promise.resolve(structuredClone(this.catalogs.get(scope) || emptyCatalog()));
  },
  async fetch(path, options) {
    assert.equal(path, "/api/v2/private-media/assets");
    assert.equal(options.method, "POST");
    assert.equal(options.retry, false, "uploads cannot be replayed automatically");
    assert.equal(options.body.get("purpose"), "custom_sticker");
    const context = await options.authSession.getRequestContext();
    assert.equal(context.companionId, this.snapshot.activeCompanionId);
    options.signal.throwIfAborted();
    const call = { name: options.body.get("file").name, scope: this.scope(), options };
    this.calls.push(call);
    return this.behavior(call, this.calls.length - 1);
  },
  save(call, id) {
    const asset = { id, purpose: "custom_sticker", display_name: call.name, alt_text: "Fictional drawing", mood_tags: [] };
    this.catalogs.get(call.scope).assets.push(asset);
    return Response.json({ ok: true, asset }, { status: 201 });
  },
  waitForAbort(call) {
    return new Promise((resolve, reject) => {
      call.options.signal.addEventListener("abort", () => {
        this.aborted.push(call.name);
        reject(new DOMException("Synthetic cancelled upload", "AbortError"));
      }, { once: true });
    });
  },
};
globalThis.__privateMediaBatchFixture = fixture;
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", envFile: false,
  server: { middlewareMode: true, hmr: false },
  plugins: [{
    name: "private-media-batch-boundaries", enforce: "pre",
    transform(code, id) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/src/MediaSettings.jsx") || path.endsWith("/src/private-media-api.js")) {
        return code.replace('"./api.js"', '"virtual:batch-api"')
          .replace('"./auth-session.js"', '"virtual:batch-auth"')
          .replace('"./PrivateMedia"', '"virtual:batch-image"');
      }
    },
    resolveId(id) { if (id.startsWith("virtual:batch-")) return "\0" + id; },
    load(id) {
      if (id === "\0virtual:batch-image") return "export const AuthenticatedImage=()=>null;";
      if (id === "\0virtual:batch-api") return `
        const fixture=globalThis.__privateMediaBatchFixture;
        export const apiFetch=(path,options)=>fixture.fetch(path,options);
        export const apiRequest=()=>{throw new Error("Unexpected API request");};
      `;
      if (id === "\0virtual:batch-auth") return `
        const fixture=globalThis.__privateMediaBatchFixture;
        export const authSession={
          getSnapshot:()=>fixture.snapshot,
          subscribe:listener=>{fixture.listeners.add(listener);return()=>fixture.listeners.delete(listener);},
          getRequestContext:async()=>({companionId:fixture.snapshot.activeCompanionId})
        };
      `;
    },
  }],
});
let tree, current;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
try {
  const { usePrivateMediaCatalog } = await vite.ssrLoadModule("/src/use-private-media-catalog.js");
  const { default: MediaSettings } = await vite.ssrLoadModule("/src/MediaSettings.jsx");
  const readCatalog = () => fixture.read();
  function Harness({ scope = scopeA, show = true }) {
    current = usePrivateMediaCatalog(scope, false, readCatalog);
    return show && React.createElement(MediaSettings, {
      key: scope, catalog: current.catalog, loading: current.loading, error: current.error,
      onRefresh: current.refresh, onCatalogChange: current.updateCatalog,
    });
  }
  const mount = async behavior => {
    fixture.setScope(scopeA);
    fixture.catalogs = new Map([[scopeA, emptyCatalog()]]);
    fixture.calls = []; fixture.reads = []; fixture.aborted = []; fixture.behavior = behavior;
    await act(async () => { tree = TestRenderer.create(React.createElement(Harness)); });
    assert.deepEqual(fixture.reads, [scopeA]);
  };
  const update = async props => {
    await act(async () => {
      if (props.scope) fixture.setScope(props.scope);
      tree.update(React.createElement(Harness, props));
      await tick();
    });
  };
  const unmount = async () => { await act(async () => { tree.unmount(); await tick(); }); tree = null; };
  const upload = async (files, duplicate = false) => {
    const input = tree.root.findAllByType("input").find(node => node.props.type === "file" && node.props.multiple);
    assert.ok(input && !input.props.disabled);
    await act(async () => {
      input.props.onChange({ target: { files, value: "fixture" } });
      if (duplicate) input.props.onChange({ target: { files, value: "fixture" } });
      await tick();
    });
  };
  const files = () => ["first", "second", "third"].map(name => new File(["fictional image"], `${name}.png`, { type: "image/png" }));
  const partialBatch = (call, index) => index === 0 ? fixture.save(call, ids[0]) : fixture.waitForAbort(call);
  const assertPartialStart = () => {
    assert.deepEqual(fixture.calls.map(call => call.name), ["first.png", "second.png"]);
    assert.ok(tree.root.findAllByType("input").filter(node => node.props.type === "file").every(node => node.props.disabled));
  };

  await mount(partialBatch);
  await upload(files(), true);
  assertPartialStart();
  await update({ show: false });
  assert.deepEqual(fixture.aborted, ["second.png"]);
  assert.deepEqual(fixture.calls.map(call => call.name), ["first.png", "second.png"], "closing must not submit a third file or replay the first");
  assert.deepEqual(fixture.reads, [scopeA, scopeA], "the still-mounted parent must reconcile the confirmed first image");
  assert.deepEqual(current.catalog.assets.map(asset => asset.id), [ids[0]]);
  await update({ show: true });
  assert.ok(tree.root.findAllByType("input").some(node => node.props.value === "first.png"));
  assert.equal(fixture.reads.length, 2, "reopening the sheet must not be needed to refresh the shared catalog");
  await unmount();

  for (const scopeB of [JSON.stringify(["fictional-account-b", "fictional-companion-a"]), JSON.stringify(["fictional-account-a", "fictional-companion-b"])]) {
    await mount(partialBatch);
    await upload(files());
    assertPartialStart();
    fixture.catalogs.set(scopeB, emptyCatalog());
    await update({ scope: scopeB });
    assert.deepEqual(fixture.reads, [scopeA, scopeB], "an interrupted old batch cannot refresh either account after switching");
    assert.deepEqual(fixture.aborted, ["second.png"]);
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(current.catalog.assets, []);
    assert.ok(tree.root.findAllByType("input").every(node => node.props.value !== "first.png"));
    assert.doesNotMatch(text(tree.toJSON()), /已确认上传/);
    await unmount();
  }

  await mount(partialBatch);
  await upload(files());
  await unmount();
  assert.deepEqual(fixture.aborted, ["second.png"]);
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual(fixture.reads, [scopeA], "a parent hook that has unmounted cannot start a catalog request");

  await mount((call, index) => index === 1
    ? Response.json({ code: "synthetic_upload_failed", message: "private upstream body" }, { status: 503 })
    : fixture.save(call, ids[index === 0 ? 0 : 1]));
  await upload([new File(["fictional"], "first.png", { type: "image/png" }),
    new File(["fictional"], "unsupported.svg", { type: "image/svg+xml" }),
    new File(["fictional"], "failed.webp", { type: "image/webp" }),
    new File(["fictional"], "last.jpg", { type: "image/jpeg" })]);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(fixture.reads, [scopeA, scopeA]);
  assert.match(text(tree.toJSON()), /已确认上传 2 \/ 4/);
  assert.match(text(tree.toJSON()), /sticker_format_unsupported/);
  assert.match(text(tree.toJSON()), /synthetic_upload_failed/);
  assert.doesNotMatch(text(tree.toJSON()), /private upstream body/);
  assert.ok(tree.root.findAllByType("input").filter(node => node.props.type === "file").every(node => !node.props.disabled));
  await unmount();

  await mount(() => Response.json({}, { status: 201 }));
  await upload(files().slice(0, 1));
  assert.match(text(tree.toJSON()), /已确认上传 0 \/ 1/);
  assert.match(text(tree.toJSON()), /private_media_receipt_invalid/);
  assert.deepEqual(fixture.reads, [scopeA, scopeA], "an ambiguous receipt still reconciles the catalog");
  assert.equal(fixture.calls.length, 1);
  await act(async () => tree.root.findByProps({ className: "media-refresh-button" }).props.onClick());
  assert.equal(fixture.calls.length, 1, "manual verification cannot replay an ambiguous upload");
  assert.deepEqual(current.catalog.assets, []);
  await unmount();

  console.log("Actual media batch UI + parent hook passed: validated receipts, partial close reconciliation, account/companion switches, parent unmount, mixed failures, no replay, same-render lock.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  delete globalThis.__privateMediaBatchFixture;
  if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
}

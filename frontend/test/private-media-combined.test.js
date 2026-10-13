import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { selectedPrivateMedia } from "../src/private-media.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const previousWindow = globalThis.window;
globalThis.window = { confirm: () => true };
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const ids = {
  avatar: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  other: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  background: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  sticker: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const scopeA = JSON.stringify(["fictional-account-a", "fictional-companion-a"]);
const avatarCatalog = (id, name) => ({
  assets: [{ id, purpose: "user_avatar", display_name: name }],
  preferences: { user_avatar_asset_id: id },
});
const withoutAsset = (catalog, id) => ({
  ...catalog,
  assets: catalog.assets.filter(asset => asset.id !== id),
  preferences: Object.fromEntries(Object.entries(catalog.preferences).filter(([, value]) => value !== id)),
});
const fixture = {
  activeScope: scopeA, catalogs: new Map(), reads: [], mutations: [], nextReadError: null, action: null,
  async read() {
    this.reads.push(this.activeScope);
    if (this.nextReadError) {
      const error = this.nextReadError;
      this.nextReadError = null;
      throw error;
    }
    return structuredClone(this.catalogs.get(this.activeScope));
  },
  mutate(kind, payload) {
    this.mutations.push({ scope: this.activeScope, kind, ...payload });
    return this.action.promise;
  },
};
globalThis.__privateMediaCombinedFixture = fixture;
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
  plugins: [{
    name: "private-media-combined-fixture", enforce: "pre",
    transform(code, id) {
      const path = id.replaceAll("\\", "/");
      if (path.endsWith("/src/MediaSettings.jsx") || path.endsWith("/src/use-private-media-catalog.js")) {
        return code.replace('"./private-media-api.js"', '"virtual:combined-media-api"')
          .replace('"./PrivateMedia"', '"virtual:combined-media-image"');
      }
    },
    resolveId(id) { if (id.startsWith("virtual:combined-media-")) return "\0" + id; },
    load(id) {
      if (id === "\0virtual:combined-media-image") return "export const AuthenticatedImage=()=>null;";
      if (id === "\0virtual:combined-media-api") return `
        const fixture=globalThis.__privateMediaCombinedFixture;
        export const privateMediaFileWarning=()=>"";
        export const getPrivateMediaCatalog=()=>fixture.read();
        export const uploadPrivateMediaAsset=payload=>fixture.mutate("upload",payload);
        export const updatePrivateMediaPreferences=payload=>fixture.mutate("preference",payload);
        export const patchPrivateMediaAsset=(id,changes)=>fixture.mutate("patch",{id,changes});
        export const archivePrivateMediaAsset=(id,permanent)=>fixture.mutate("archive",{id,permanent});
      `;
    },
  }],
});
let tree, current;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
try {
  const { usePrivateMediaCatalog } = await vite.ssrLoadModule("/src/use-private-media-catalog.js");
  const { default: MediaSettings } = await vite.ssrLoadModule("/src/MediaSettings.jsx");
  function Harness({ scope = scopeA, show = true }) {
    current = usePrivateMediaCatalog(scope);
    return React.createElement("div", null,
      React.createElement("output", null, selectedPrivateMedia(current.catalog, "user_avatar")?.id || "default-avatar"),
      show && React.createElement(MediaSettings, {
        key: scope, catalog: current.catalog, loading: current.loading, error: current.error,
        onRefresh: current.refresh, onCatalogChange: current.updateCatalog,
      }));
  }
  const mount = async () => {
    fixture.activeScope = scopeA;
    fixture.catalogs = new Map([[scopeA, avatarCatalog(ids.avatar, "Fictional A avatar")]]);
    fixture.reads = []; fixture.mutations = []; fixture.nextReadError = null; fixture.action = deferred();
    await act(async () => { tree = TestRenderer.create(React.createElement(Harness)); });
    assert.equal(selectedPrivateMedia(current.catalog, "user_avatar").id, ids.avatar);
  };
  const update = async props => {
    fixture.activeScope = props.scope || scopeA;
    await act(async () => tree.update(React.createElement(Harness, props)));
  };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const deleteAvatar = async () => {
    const button = tree.root.findAllByType("button").find(node => node.children.includes("删除"));
    assert.ok(button && !button.props.disabled);
    await act(async () => button.props.onClick());
    assert.equal(fixture.mutations.length, 1);
    assert.deepEqual(fixture.mutations[0], { scope: scopeA, kind: "archive", id: ids.avatar, permanent: true });
  };
  const completeDeletion = async () => {
    fixture.catalogs.set(scopeA, withoutAsset(fixture.catalogs.get(scopeA), ids.avatar));
    await act(async () => fixture.action.resolve({ ok: true }));
  };

  await mount();
  await deleteAvatar();
  await update({ show: false });
  await completeDeletion();
  assert.equal(current.catalog.assets.length, 0, "same-scope navigation must reconcile a successful deletion after the panel closes");
  assert.equal(selectedPrivateMedia(current.catalog, "user_avatar"), null);
  assert.deepEqual(fixture.reads, [scopeA, scopeA], "closing only the panel still permits the scope-safe parent refresh");
  await update({ show: true });
  assert.doesNotMatch(text(tree.toJSON()), /Fictional A avatar/);
  assert.equal(fixture.reads.length, 2, "reopening cannot be needed to repair the shared catalog");
  await unmount();

  for (const scopeB of [
    JSON.stringify(["fictional-account-a", "fictional-companion-b"]),
    JSON.stringify(["fictional-account-b", "fictional-companion-a"]),
  ]) {
    await mount();
    await deleteAvatar();
    fixture.catalogs.set(scopeB, avatarCatalog(ids.other, "Fictional B avatar"));
    await update({ scope: scopeB });
    const acceptedB = current.catalog;
    const readsBeforeCompletion = fixture.reads.length;
    await completeDeletion();
    assert.equal(fixture.reads.length, readsBeforeCompletion, "the old mutation must not start a read for the new account or companion");
    assert.strictEqual(current.catalog, acceptedB, "the old optimistic deletion must not commit into the new scope");
    assert.equal(selectedPrivateMedia(current.catalog, "user_avatar").id, ids.other);
    assert.match(text(tree.toJSON()), /Fictional B avatar/);
    assert.doesNotMatch(text(tree.toJSON()), /private_media_refresh_failed/);
    await unmount();
  }

  await mount();
  await deleteAvatar();
  await unmount();
  const readsBeforeUnmountedCompletion = fixture.reads.length;
  await completeDeletion();
  assert.equal(fixture.reads.length, readsBeforeUnmountedCompletion, "a completed mutation cannot start a read after the parent hook unmounts");

  await mount();
  await deleteAvatar();
  const latest = {
    assets: [
      ...current.catalog.assets,
      { id: ids.background, purpose: "chat_background", display_name: "Fictional background" },
      { id: ids.sticker, purpose: "custom_sticker", display_name: "Fictional sticker" },
    ],
    preferences: { user_avatar_asset_id: ids.avatar, chat_background_asset_id: ids.background },
  };
  fixture.catalogs.set(scopeA, latest);
  await act(async () => current.updateCatalog(latest));
  fixture.nextReadError = Object.assign(new Error("Fictional catalog unavailable"), {
    code: "private_media_catalog_unavailable", status: 503,
  });
  await completeDeletion();
  assert.deepEqual(current.catalog.assets.map(asset => asset.id), [ids.background, ids.sticker], "functional deletion must preserve updates received while the mutation was pending");
  assert.equal(Object.hasOwn(current.catalog.preferences, "user_avatar_asset_id"), false);
  assert.equal(current.catalog.preferences.chat_background_asset_id, ids.background);
  assert.equal(selectedPrivateMedia(current.catalog, "user_avatar"), null);
  assert.equal(current.loading, false);
  assert.match(current.error, /private_media_catalog_unavailable/);
  assert.match(text(tree.toJSON()), /操作已提交[\s\S]*private_media_refresh_failed/);
  const refreshButton = tree.root.findByProps({ className: "media-refresh-button" });
  assert.equal(refreshButton.props.disabled, false, "manual recovery must remain available after a failed refresh");
  await act(async () => refreshButton.props.onClick());
  assert.equal(current.error, "");
  assert.doesNotMatch(text(tree.toJSON()), /private_media_refresh_failed/);
  assert.equal(fixture.mutations.length, 1, "manual recovery must not repeat the completed deletion");
  assert.equal(fixture.reads.length, 3);
  assert.deepEqual(current.catalog, fixture.catalogs.get(scopeA));
  await unmount();

  console.log("Actual media catalog + settings passed: same-scope close, account/companion switches, parent unmount, functional deletion, failed refresh and manual recovery.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  delete globalThis.__privateMediaCombinedFixture;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

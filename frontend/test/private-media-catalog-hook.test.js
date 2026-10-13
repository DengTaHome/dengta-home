import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { StrictMode, act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree, current, calls = [], renders = [];
const load = () => { const request = deferred(); calls.push(request); return request.promise; };
const catalog = name => ({ assets: [{ id: name }], preferences: { companion_avatar_asset_id: name } });
try {
  const { usePrivateMediaCatalog } = await vite.ssrLoadModule("/src/use-private-media-catalog.js");
  function Harness({ scope, disabled }) {
    current = usePrivateMediaCatalog(scope, disabled, load);
    renders.push({ scope, catalog: current.catalog, loading: current.loading });
    return React.createElement("output", null, current.catalog?.assets?.[0]?.id || "default");
  }
  const mount = async (scope, strict = false, disabled = false) => {
    calls = []; renders = [];
    await act(async () => { tree = TestRenderer.create(strict ? React.createElement(StrictMode, null, React.createElement(Harness, { scope, disabled })) : React.createElement(Harness, { scope, disabled })); });
  };
  const update = async scope => { await act(async () => tree.update(React.createElement(Harness, { scope }))); };
  const resolve = async (index, value) => { await act(async () => calls[index].resolve(value)); };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  await mount("account-a/companion-a");
  await resolve(0, catalog("avatar-a"));
  const oldRefresh = current.refresh, oldUpdate = current.updateCatalog;
  const beforeSwitch = renders.length;
  await update("account-a/companion-b");
  assert.equal(current.catalog, null);
  assert.ok(renders.slice(beforeSwitch).every(render => render.catalog === null), "new scope never paints old avatar while awaiting its directory");
  await act(async () => { await oldRefresh(); oldUpdate(catalog("old-overwrite")); });
  assert.equal(calls.length, 2, "old scope callbacks cannot fetch or commit against the current scope");
  await resolve(1, catalog("avatar-b"));
  assert.equal(current.catalog.assets[0].id, "avatar-b");

  let firstRead, lastRead;
  await act(async () => { firstRead = current.refresh(); lastRead = current.refresh(); });
  await resolve(3, catalog("latest-b"));
  await resolve(2, catalog("stale-b"));
  assert.equal(await firstRead, null);
  assert.equal((await lastRead).assets[0].id, "latest-b");
  assert.equal(current.catalog.assets[0].id, "latest-b", "older refresh never overwrites latest receipt");
  await unmount();

  await mount("a");
  await update("b");
  await update("a");
  await resolve(0, catalog("first-a"));
  await resolve(1, catalog("b"));
  assert.equal(current.catalog, null, "A-B-A cannot revive a request from the first visit");
  await resolve(2, catalog("second-a"));
  assert.equal(current.catalog.assets[0].id, "second-a");
  await unmount();

  await mount("failing-scope");
  await act(async () => calls[0].reject(Object.assign(new Error("读取失败"), { code: "private_media_catalog_unavailable", status: 503 })));
  assert.match(current.error, /private_media_catalog_unavailable/);
  assert.equal(current.loading, false);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.equal(calls.length, 1, "a failed read does not cause an automatic render/retry loop");
  let retry;
  await act(async () => { retry = current.refresh(); });
  await resolve(1, catalog("recovered"));
  await retry;
  assert.equal(current.error, "");
  assert.equal(current.catalog.assets[0].id, "recovered");
  let pending;
  await act(async () => { pending = current.refresh(); current.updateCatalog(previous => ({ ...previous, assets: [] })); });
  await resolve(2, catalog("deleted-avatar"));
  await pending;
  assert.equal(current.catalog.assets.length, 0, "an optimistic completed deletion invalidates older pending directory reads");
  const afterUnmount = renders.length;
  await unmount();
  await act(async () => { await current.refresh(); current.updateCatalog(catalog("late")); });
  assert.equal(calls.length, 3);
  assert.equal(renders.length, afterUnmount);

  await mount("strict", true);
  assert.equal(calls.length, 2);
  await resolve(0, catalog("strict-old"));
  assert.equal(current.catalog, null);
  await resolve(1, catalog("strict-current"));
  assert.equal(current.catalog.assets[0].id, "strict-current");
  await unmount();
  await mount("preview", false, true);
  assert.equal(calls.length, 0);
  await act(async () => { await current.refresh(); current.updateCatalog(catalog("preview")); });
  assert.equal(calls.length, 0);
  assert.equal(current.catalog, null);
  await unmount();
  console.log("Actual scoped media hook passed: render isolation, account/companion identity, A-B-A, out-of-order reads, manual recovery, deletion, StrictMode and disabled preview.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = { calls: [], action: async () => ({}), reads: 0 };
globalThis.__privateMediaFixture = fixture;
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
  plugins: [{
    name: "private-media-fixture", enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/MediaSettings.jsx")) {
        return code.replace('"./private-media-api.js"', '"virtual:private-media-api"')
          .replace('"./PrivateMedia"', '"virtual:private-media-image"');
      }
    },
    resolveId(id) { if (id.startsWith("virtual:private-media-")) return "\0" + id; },
    load(id) {
      if (id === "\0virtual:private-media-image") return 'export const AuthenticatedImage=()=>null;';
      if (id === "\0virtual:private-media-api") return `
        const fixture=globalThis.__privateMediaFixture;
        export const privateMediaFileWarning=()=>"";
        export const getPrivateMediaCatalog=async()=>{fixture.reads++;return {assets:[],preferences:{}};};
        export const uploadPrivateMediaAsset=payload=>{fixture.calls.push(payload);return fixture.action();};
        export const updatePrivateMediaPreferences=payload=>{fixture.calls.push(payload);return fixture.action();};
        export const patchPrivateMediaAsset=()=>fixture.action();
        export const archivePrivateMediaAsset=()=>fixture.action();
      `;
    },
  }],
});
let tree;
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
try {
  const { default: MediaSettings } = await vite.ssrLoadModule("/src/MediaSettings.jsx");
  const mount = async props => {
    await act(async () => { tree = TestRenderer.create(React.createElement(MediaSettings, {
      catalog: { assets: [], preferences: {} }, loading: false, onRefresh: async () => ({ assets: [], preferences: {} }), ...props,
    })); });
  };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  {
    const wait = deferred(); fixture.action = () => wait.promise;
    await mount();
    const inputs = tree.root.findAll(node => node.type === "input" && node.props.type === "file");
    await act(async () => {
      inputs[0].props.onChange({ target: { files: [{ name: "fictional-a.png" }], value: "" } });
      inputs[1].props.onChange({ target: { files: [{ name: "fictional-b.png" }], value: "" } });
    });
    assert.equal(fixture.calls.length, 1, "two upload callbacks in the same render must start only one mutation");
    assert.ok(tree.root.findAll(node => node.type === "input" && node.props.type === "file").every(node => node.props.disabled), "all upload entrances lock together");
    await act(async () => wait.resolve({}));
    assert.ok(tree.root.findAll(node => node.type === "input" && node.props.type === "file").every(node => !node.props.disabled));
    await unmount();
  }
  {
    const wait = deferred(); fixture.action = () => wait.promise;
    let refreshes = 0, commits = 0;
    await mount({ onRefresh: async () => { refreshes++; return {}; }, onCatalogChange: () => commits++ });
    await act(async () => tree.root.findAll(node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [{}], value: "" } }));
    await unmount();
    const reads = fixture.reads;
    await act(async () => wait.resolve({}));
    assert.equal(refreshes, 1, "a completed mutation calls the parent's scope-safe refresh even after this panel closes");
    assert.equal(fixture.reads, reads, "old completion cannot invoke a global current-account read");
    assert.equal(commits, 0);
  }
  {
    fixture.action = async () => ({});
    await mount({ onRefresh: async () => null });
    await act(async () => tree.root.findAll(node => node.type === "input" && node.props.type === "file")[0].props.onChange({ target: { files: [{}], value: "" } }));
    assert.match(text(tree.toJSON()), /private_media_refresh_failed/);
    assert.match(text(tree.toJSON()), /操作已提交/);
    await unmount();
  }
  console.log("Actual media settings lifecycle passed: same-render deduplication, all upload locks, unmount, refresh receipt.");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  delete globalThis.__privateMediaFixture;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

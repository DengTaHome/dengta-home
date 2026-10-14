import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const state = source.match(/const \[imageViewer, setImageViewer\] = useState\(null\);/)[0];
const callbackStart = source.indexOf("  const handleImagePreview = useCallback(");
const callbackEnd = source.indexOf("\n  const ", callbackStart + 1);
const callback = source.slice(callbackStart, callbackEnd);
const viewerStart = source.indexOf("      {imageViewer && (");
const viewerEnd = source.indexOf("\n      )}", viewerStart) + 9;
const viewer = source.slice(viewerStart, viewerEnd);
assert.ok(callbackStart > 0 && viewerStart > 0 && viewerEnd > viewerStart);
assert.match(source, /<MediaSettings[\s\S]*?onPreview=\{handleImagePreview\}/);
const viewerImport = source.match(/^import ImageViewer[^;]+;/m)?.[0]?.replace('"./ImageViewer.jsx"', '"/src/ImageViewer.jsx"') || "";
const fixture = {};
globalThis.__imagePreviewFixture = fixture;
const vite = await createServer({ configFile: false, envDir: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "actual-image-preview-app-fragment", enforce: "pre",
  transform(code, id) { if (id.replaceAll("\\", "/").endsWith("/ImageViewer.jsx")) return code.replace('"react-dom"', '"virtual:image-preview-portal"'); },
  resolveId(id) { if (id === "virtual:image-preview-harness") return "\0virtual:image-preview-harness.jsx"; if (id === "virtual:image-preview-portal") return "\0virtual:image-preview-portal"; },
  async load(id) {
    if (id === "\0virtual:image-preview-portal") return "export const createPortal=(child,target)=>{globalThis.__imagePreviewFixture.portals.push(target);return child;};";
    if (id !== "\0virtual:image-preview-harness.jsx") return;
    return (await transformWithOxc(`
      import React,{useState,useCallback,useRef} from "react";
      import {useSettingsSheetNavigation} from "/src/useSettingsSheetNavigation.js";
      ${viewerImport}
      export default function Harness({privateMediaScope="fictional-a"}){
        ${state}
        ${callback}
        const [isSettingsOpen,setIsSettingsOpen]=useState(true);
        const panelRef=useRef(null);
        useSettingsSheetNavigation({isOpen:isSettingsOpen,scopeKey:privateMediaScope,panelRef,onClose:()=>setIsSettingsOpen(false)});
        return <div className={"app-shell"+(isSettingsOpen?" is-settings-open":"")}>
          {isSettingsOpen && <section className="settings-sheet" role="dialog" tabIndex={-1} ref={panelRef}><button onClick={()=>handleImagePreview("https://media.example.test/fictional.svg","虚构图片")}>预览虚构图片</button><output>appearance</output></section>}
          ${viewer}
        </div>;
      }
    `, "image-preview-harness.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
  },
}] });
const { default: Harness } = await vite.ssrLoadModule("virtual:image-preview-harness");
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; delete globalThis.document; });
after(async () => { await vite.close(); delete globalThis.__imagePreviewFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

function node(name, inside) {
  return { name, inside, isConnected: true, tabIndex: 0, matches: () => false, getClientRects: () => [{}],
    closest(selector) { return selector.includes("role=") ? inside === "viewer" ? fixture.viewer : fixture.settings : null; },
    focus(options) { fixture.doc.activeElement = this; fixture.focus.push({ name, options }); },
  };
}
async function mount() {
  fixture.portals = []; fixture.focus = []; fixture.listeners = []; fixture.image = null;
  fixture.opener = node("settings-image-opener", "settings");
  fixture.close = node("image-close", "viewer");
  fixture.doc = { body: { style: { overflow: "auto" } }, activeElement: fixture.opener, defaultView: { getComputedStyle: () => ({ visibility: "visible" }) },
    addEventListener(name, fn) { fixture.listeners.push({ name, fn }); },
    removeEventListener(name, fn) { fixture.listeners = fixture.listeners.filter(entry => entry.name !== name || entry.fn !== fn); },
  };
  const panel = (name, controls) => ({ name, isConnected: true, ownerDocument: fixture.doc, tabIndex: -1,
    contains: value => value === (name === "viewer" ? fixture.viewer : fixture.settings) || controls.includes(value),
    querySelector: () => null, querySelectorAll: () => controls,
    focus(options) { fixture.doc.activeElement = this; fixture.focus.push({ name, options }); },
    closest: () => name === "viewer" ? fixture.viewer : fixture.settings,
  });
  fixture.settings = panel("settings", [fixture.opener]); fixture.viewer = panel("viewer", [fixture.close]);
  globalThis.document = fixture.doc;
  await act(async () => { tree = TestRenderer.create(React.createElement(Harness), { createNodeMock: element => element.props.className === "settings-sheet" ? fixture.settings : element.props.className === "image-viewer" ? fixture.viewer : null }); });
}
const button = text => tree.root.findAllByType("button").find(value => value.props["aria-label"] === text || value.children.join("") === text);
async function open() { await act(async () => button("预览虚构图片").props.onClick()); }
async function key(key, extra = {}) {
  const event = { key, target: fixture.doc.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  await act(async () => { for (const entry of [...fixture.listeners]) if (entry.name === "keydown") entry.fn(event); });
  return event;
}

test("the actual App preview uses a body Portal instead of the settings-hidden app sibling", async () => {
  await mount(); await open();
  assert.ok(fixture.portals.includes(fixture.doc.body), "the actual image preview must escape the app-shell settings visibility rule");
  assert.ok(fixture.viewer.contains(fixture.doc.activeElement));
  assert.equal(tree.root.findAllByType("output")[0].children.join(""), "appearance");
});

test("Escape closes only the preview, keeps the category and restores its opener without scrolling", async () => {
  await mount(); await open();
  assert.ok(fixture.viewer.contains(fixture.doc.activeElement));
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
    assert.equal((await key("Escape", extra)).defaultPrevented, false);
    assert.ok(button("关闭图片预览"));
  }
  assert.equal((await key("Escape")).defaultPrevented, true);
  assert.equal(tree.root.findAllByProps({ className: "image-viewer" }).length, 0);
  assert.equal(tree.root.findAllByProps({ className: "settings-sheet" }).length, 1);
  assert.equal(tree.root.findAllByType("output")[0].children.join(""), "appearance");
  assert.equal(fixture.doc.activeElement, fixture.opener);
  assert.deepEqual(fixture.focus.at(-1).options, { preventScroll: true });
});

test("preview Tab stays inside; closing never takes focus away from a newer dialog", async () => {
  await mount(); await open();
  fixture.doc.activeElement = fixture.close;
  assert.equal((await key("Tab")).defaultPrevented, true);
  assert.equal(fixture.doc.activeElement, fixture.close);
  assert.equal((await key("Tab", { shiftKey: true })).defaultPrevented, true);
  const newer = { isConnected: true, focus() {} };
  fixture.doc.activeElement = newer;
  await act(async () => button("关闭图片预览").props.onClick());
  assert.equal(fixture.doc.activeElement, newer);
});

test("changing account or companion closes the old preview without restoring the old opener", async () => {
  await mount(); await open();
  const before = fixture.focus.filter(entry => entry.name === "settings-image-opener").length;
  await act(async () => tree.update(React.createElement(Harness, { privateMediaScope: "fictional-b" })));
  assert.equal(tree.root.findAllByProps({ className: "image-viewer" }).length, 0);
  assert.equal(fixture.focus.filter(entry => entry.name === "settings-image-opener").length, before);
  await open();
  assert.equal(tree.root.findAllByProps({ className: "image-viewer" }).length, 1);
});

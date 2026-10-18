import test, { after } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = { listeners: new Map(), removed: [], notices: [], exits: 0, keyboard: false };
globalThis.__backFixture = fixture;
fixture.App = { addListener: async (name, callback) => { fixture.listeners.set(name, callback); return { remove() { if (fixture.listeners.get(name) === callback) fixture.listeners.delete(name); fixture.removed.push(name); } }; }, exitApp: async () => { fixture.exits++; } };
fixture.Native = { dismissKeyboard: async () => { const hidden = fixture.keyboard; fixture.keyboard = false; return { hidden }; } };
const vite = await createServer({ configFile: false, envDir: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, ssr: { noExternal: ["@capacitor/core", "@capacitor/app"] }, plugins: [{
  name: "actual-native-back-flow",
  resolveId(id) { if (["@capacitor/core", "@capacitor/app", "virtual:back-flow", "virtual:back-hook"].includes(id)) return "\0" + id; },
  async load(id) {
    if (id === "\0virtual:back-hook") return readFileSync(new URL("../src/useAppBackNavigation.js", import.meta.url), "utf8")
      .replace('import { Capacitor, registerPlugin } from "@capacitor/core";', 'const Capacitor={getPlatform:()=>"android"}; const registerPlugin=()=>globalThis.__backFixture.Native;')
      .replace('import { App } from "@capacitor/app";', 'const App=globalThis.__backFixture.App;')
      .replace('"./app-back-navigation.js"', '"/src/app-back-navigation.js"');
    if (id === "\0@capacitor/core") return 'export const Capacitor={getPlatform:()=>"android"}; export const registerPlugin=()=>globalThis.__backFixture.Native;';
    if (id === "\0@capacitor/app") return "export const App=globalThis.__backFixture.App;";
    if (id !== "\0virtual:back-flow") return;
    return (await transformWithOxc(`
      import {useState} from "react";
      import {useAppBackNavigation,useBackLayer} from "virtual:back-hook";
      const f=globalThis.__backFixture;
      export default function Harness({scope="fictional-a"}){
        const [view,setView]=useState("chat"),[panel,setPanel]=useState(false);
        f.setView=setView; f.setPanel=setPanel; f.view=view; f.panel=panel;
        useBackLayer(panel,()=>setPanel(false),200);
        useAppBackNavigation({scope,view,layerKey:String(panel),changeView:value=>{setView(value);return true;},showNotice:value=>f.notices.push(value),closeLayer:()=>false});
        return <span>{view}</span>;
      }`, "back-flow.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
  },
}] });
const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
const documentListeners = new Map();
Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener: (name, callback) => documentListeners.set(name, callback), removeEventListener: name => documentListeners.delete(name) } });
const { default: Harness } = await vite.ssrLoadModule("virtual:back-flow");
let tree;
after(async () => {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else delete globalThis.document;
  delete globalThis.__backFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});
const back = async () => { await act(async () => { fixture.listeners.get("backButton")(); for (let n = 0; n < 8; n++) await Promise.resolve(); }); };

test("actual native hook closes keyboard and registered panel, returns through pages, then confirms exit", async () => {
  await act(async () => { tree = TestRenderer.create(React.createElement(Harness)); });
  await act(async () => { fixture.setView("diary"); });
  await act(async () => { fixture.setPanel(true); });
  fixture.keyboard = true; await back(); assert.equal(fixture.panel, true);
  await back(); assert.equal(fixture.panel, false); assert.equal(fixture.view, "diary");
  await back(); assert.equal(fixture.view, "chat"); assert.equal(fixture.exits, 0);
  await back(); assert.equal(fixture.notices.at(-1), "再返回一次退出灯塔"); assert.equal(fixture.exits, 0);
  await act(async () => fixture.listeners.get("appStateChange")({ isActive: false }));
  await back(); assert.equal(fixture.exits, 0);
  await back(); assert.equal(fixture.exits, 1);
});

test("home navigation clears page history; scope change and unmount remove armed exit and native listeners", async () => {
  const prior = fixture.exits;
  await act(async () => fixture.setView("music"));
  await act(async () => fixture.setView("chat"));
  await back(); assert.equal(fixture.view, "chat"); assert.equal(fixture.exits, prior);
  await act(async () => tree.update(React.createElement(Harness, { scope: "fictional-b" })));
  await back(); assert.equal(fixture.exits, prior);
  await act(async () => tree.unmount()); tree = null;
  assert.equal(fixture.listeners.size, 0); assert.equal(documentListeners.size, 0);
});

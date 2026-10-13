import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const functionBlock = name => {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf("\n  }", start) + 4;
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
};
const hookStart = source.indexOf("  useSettingsSheetNavigation({");
assert.ok(hookStart > 0, "actual App wires the settings sheet lifecycle");
const hookCall = source.slice(hookStart, source.indexOf("  });", hookStart) + 5);
const shellStart = source.indexOf("      {isSettingsOpen && ("), shellEnd = source.indexOf("\n\n      {dialog && (", shellStart);
const shell = source.slice(shellStart, shellEnd);
assert.ok(shell.includes("ref={settingsPanelRef}") && shell.includes("tabIndex={-1}"));
const gearStart = source.lastIndexOf("            <button", source.indexOf('className="settings-gear-button"'));
const gear = source.slice(gearStart, source.indexOf("</button>", gearStart) + 9);
const fixture = {};
globalThis.__settingsSheetFixture = fixture;
const vite = await createServer({ configFile: false, envDir: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "actual-settings-sheet-navigation",
  resolveId(id) { if (id === "virtual:settings-sheet-navigation") return "\0virtual:settings-sheet-navigation.jsx"; },
  async load(id) {
    if (id !== "\0virtual:settings-sheet-navigation.jsx") return;
    return (await transformWithOxc(`
      import {useState,useRef} from "react";
      import {useSettingsSheetNavigation} from "/src/useSettingsSheetNavigation.js";
      const fixture=globalThis.__settingsSheetFixture;
      const SettingsFlowField=()=>null;
      export default function Harness({privateMediaScope="fictional-a"}){
        const [isSettingsOpen,setIsSettingsOpen]=useState(false),[settingsCategory,setSettingsCategory]=useState(null),[settingsFocusTarget,setSettingsFocusTarget]=useState("");
        const settingsPanelRef=useRef(null),settingsScrollRef=useRef(null),settingsScrollIdleTimerRef=useRef(null),hasLoadedSettingsRef=useRef(true),draftSettingsRef=useRef({fictional:"exact draft"});
        const closeComposerMenu=()=>{},requestStatusPanelClose=()=>{},setIsSidebarOpen=()=>{},setIsMobileNavOpen=()=>{},handleSettingsScroll=()=>{};
        const scheduleSettingsAutosave=(draft,options)=>fixture.saves.push({draft,options});
        const window={clearTimeout:()=>{}};
        ${functionBlock("openSettingsPanel")}
        ${functionBlock("closeSettingsPanel")}
        ${hookCall}
        fixture.api={setIsSettingsOpen,setSettingsCategory,setSettingsFocusTarget};
        const renderSettings=()=> <form onSubmit={()=>fixture.submits++}><input aria-label="虚构设置输入"/></form>;
        return <div>${gear}${shell}<output>{settingsCategory}{settingsFocusTarget}</output></div>;
      }
    `, "settings-sheet-navigation.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
  },
}] });
const { default: Harness } = await vite.ssrLoadModule("virtual:settings-sheet-navigation");
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
after(async () => { await vite.close(); delete globalThis.__settingsSheetFixture; delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

function node(name, { inside = true, visible = true, disabled = false, hidden = false, dialog = null } = {}) {
  return {
    name, inside, tabIndex: 0, isConnected: true,
    focus() { fixture.doc.activeElement = this; fixture.focus.push(name); },
    matches: () => disabled,
    closest(selector) { return selector.includes("role=") ? dialog : hidden ? {} : null; },
    getClientRects: () => visible ? [{}] : [],
  };
}
async function mount() {
  fixture.focus = []; fixture.saves = []; fixture.submits = 0; fixture.listeners = new Set();
  fixture.opener = node("settings-opener", { inside: false });
  fixture.doc = { body: {}, activeElement: fixture.opener, defaultView: { getComputedStyle: () => ({ visibility: "visible" }) },
    addEventListener(type, callback) { assert.equal(type, "keydown"); fixture.listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, "keydown"); fixture.listeners.delete(callback); },
  };
  fixture.done = node("Done"); fixture.input = node("visible-input"); fixture.last = node("last-control");
  fixture.panel = { ownerDocument: fixture.doc, contains: element => element?.inside === true,
    querySelector: () => fixture.done, querySelectorAll: () => [fixture.done, node("hidden-input", { hidden: true }), fixture.input, node("disabled-control", { disabled: true }), fixture.last, node("display-none", { visible: false })],
    focus() { fixture.doc.activeElement = this; fixture.focus.push("sheet"); },
  };
  fixture.scroll = { closest: () => ({ classList: { remove() {} } }) };
  await act(async () => { tree = TestRenderer.create(React.createElement(Harness), { createNodeMock: element => element.props.className === "settings-sheet" ? fixture.panel : element.props.className === "settings-sheet-scroll" ? fixture.scroll : null }); });
}
const button = name => tree.root.findAllByType("button").find(value => value.props["aria-label"] === name || value.children.join("") === name);
async function open() { await act(async () => button("打开设置").props.onClick()); }
async function close() { await act(async () => button("Done").props.onClick()); }
async function key(name, extra = {}, callback = [...fixture.listeners][0]) {
  const event = { key: name, target: fixture.doc.activeElement, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, ...extra };
  await act(async () => callback?.(event));
  return event;
}

test("actual App opening moves focus inside; Done preserves the existing one-shot autosave and returns focus", async () => {
  await mount(); await open();
  assert.equal(fixture.doc.activeElement, fixture.done);
  await close();
  assert.equal(fixture.doc.activeElement, fixture.opener);
  assert.deepEqual(fixture.saves, [{ draft: { fictional: "exact draft" }, options: { immediate: true } }]);
  assert.equal(fixture.submits, 0);
  assert.equal(fixture.listeners.size, 0);
});

test("Tab boundaries wrap through enabled visible controls; ordinary Tab remains native", async () => {
  await mount(); await open();
  fixture.doc.activeElement = fixture.last;
  assert.equal((await key("Tab")).prevented, 1);
  assert.equal(fixture.doc.activeElement, fixture.done);
  assert.equal((await key("Tab", { shiftKey: true })).prevented, 1);
  assert.equal(fixture.doc.activeElement, fixture.last);
  fixture.doc.activeElement = fixture.input;
  assert.equal((await key("Tab")).prevented, 0);
  fixture.doc.activeElement = fixture.opener;
  await key("Tab"); assert.equal(fixture.doc.activeElement, fixture.done);
  assert.equal(fixture.submits, 0);
});

test("Escape respects child consumption, IME and modifiers, then closes once without submitting or waiting for saving", async () => {
  await mount(); await open();
  const oldListener = [...fixture.listeners][0];
  for (const extra of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
    assert.equal((await key("Escape", extra)).prevented, 0);
    assert.ok(button("Done"));
  }
  assert.equal((await key("Enter")).prevented, 0);
  assert.equal(fixture.saves.length, 0);
  const event = await key("Escape");
  assert.equal(event.prevented, 1); assert.equal(event.stopped, 1);
  await key("Escape", {}, oldListener);
  assert.equal(fixture.saves.length, 1);
  assert.equal(fixture.submits, 0);
  assert.equal(fixture.doc.activeElement, fixture.opener);
});

test("another dialog keeps its own Escape and Tab; closing settings never steals its focus", async () => {
  await mount(); await open();
  const overlay = node("other-dialog-control", { inside: false, dialog: {} });
  fixture.doc.activeElement = overlay;
  assert.equal((await key("Escape")).prevented, 0);
  assert.equal((await key("Tab")).prevented, 0);
  await close();
  assert.equal(fixture.doc.activeElement, overlay);
});

test("scope changes invalidate old controls and never focus the previous account's opener", async () => {
  await mount(); await open();
  const oldListener = [...fixture.listeners][0];
  await act(async () => tree.update(React.createElement(Harness, { privateMediaScope: "fictional-b" })));
  await key("Escape", {}, oldListener);
  assert.ok(button("Done")); assert.equal(fixture.saves.length, 0);
  await close();
  assert.notEqual(fixture.doc.activeElement, fixture.opener);
  assert.equal(fixture.focus.filter(value => value === "settings-opener").length, 0);
});

test("an empty or temporarily disabled sheet retains a Tab stop on the panel", async () => {
  await mount(); await open();
  fixture.panel.querySelectorAll = () => [];
  assert.equal((await key("Tab")).prevented, 1);
  assert.equal(fixture.doc.activeElement, fixture.panel);
});

test("unmount removes keyboard handling; a saved old event cannot close or submit", async () => {
  await mount(); await open();
  const oldListener = [...fixture.listeners][0];
  await act(async () => tree.unmount()); tree = null;
  assert.equal(fixture.listeners.size, 0);
  await key("Escape", {}, oldListener);
  assert.equal(fixture.saves.length, 0);
  assert.equal(fixture.submits, 0);
});

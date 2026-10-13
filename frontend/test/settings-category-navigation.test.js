import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const start = source.indexOf("        {!settingsCategory ? (") >= 0 ? source.indexOf("        {!settingsCategory ? (") : source.indexOf('        <div hidden={Boolean(settingsCategory)}>');
const end = source.indexOf('            {settingsCategory === "appearance"', start);
assert.ok(start > 0 && end > start, "extract actual App settings home and category heading");
const prefix = source.slice(start, end);
const usesNavigation = source.includes('from "./useSettingsCategoryNavigation.js"');
const hookStart = source.indexOf("  const settingsCategoryNavigation = useSettingsCategoryNavigation({");
const hookCall = usesNavigation ? source.slice(hookStart, source.indexOf("  });", hookStart) + 5) : "";
const fixture = { scroll: null, focus: [], api: null };
globalThis.__settingsCategoryFixture = fixture;
const oldStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => null, setItem() {} };
const vite = await createServer({ configFile: false, envFile: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "actual-settings-category-navigation",
  resolveId(id) { if (id === "virtual:category-navigation") return "\0virtual:category-navigation.jsx"; },
  async load(id) {
    if (id !== "\0virtual:category-navigation.jsx") return;
    return (await transformWithOxc(`
      import {useState,useRef} from "react";
      import {ArrowLeft} from "lucide-react";
      import SettingsHome from "/src/SettingsHome.jsx";
      ${usesNavigation ? 'import {useSettingsCategoryNavigation} from "/src/useSettingsCategoryNavigation.js";' : ""}
      const fixture=globalThis.__settingsCategoryFixture;
      const SETTINGS_CATEGORIES=[{id:"persona",label:"个性化与记忆"},{id:"services",label:"模型与服务"},{id:"fun",label:"成就与新玩法"},{id:"logs",label:"错误日志"}];
      export default function Harness({privateMediaScope="fictional-a"}) {
        const [settingsCategory,setSettingsCategory]=useState(null);
        const [isSettingsOpen,setIsSettingsOpen]=useState(true);
        const settingsFocusTarget="";
        const settingsScrollRef=useRef(fixture.scroll);
        ${hookCall}
        fixture.api={setIsSettingsOpen,setSettingsCategory};
        return isSettingsOpen ? <div>${prefix}<p>Virtual category content</p></>)${usesNavigation ? ": null" : ""}} </div> : null;
      }
    `, "category-navigation.jsx", {lang:"jsx",jsx:{runtime:"automatic"}})).code;
  },
}] });
const { default: Harness } = await vite.ssrLoadModule("virtual:category-navigation");
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
after(async () => { await vite.close(); globalThis.localStorage = oldStorage; delete globalThis.__settingsCategoryFixture; });
async function mount() {
  fixture.focus=[];
  fixture.scroll={scrollTop:0,scrollTo({top}){this.scrollTop=top;},querySelector(){return {focus:()=>fixture.focus.push("category-back")};}};
  await act(async () => { tree=TestRenderer.create(React.createElement(Harness)); });
}
const input=()=>tree.root.findByProps({type:"search"});
const button=(label)=>tree.root.findAllByType("button").find(node=>node.props["aria-label"]===label || node.children.join("").includes(label));
async function search(value){await act(async()=>input().props.onChange({target:{value}}));}
async function open(id, target={isConnected:true,focus:()=>fixture.focus.push(id)}){
  const entry=tree.root.findByProps({"data-settings-category":id});
  await act(async()=>entry.props.onClick({currentTarget:target}));
}
async function back(){await act(async()=>button("返回设置分类").props.onClick());}

test("entering a category starts at the top; back restores the selected entry and list position",async()=>{
  await mount();fixture.scroll.scrollTop=480;
  await open("logs");
  assert.equal(fixture.scroll.scrollTop,0);
  assert.equal(fixture.focus.at(-1),"category-back");
  fixture.scroll.scrollTop=320;
  await back();
  assert.equal(fixture.scroll.scrollTop,480);
  assert.equal(fixture.focus.at(-1),"logs");
});
test("returning from a search result preserves the query and can clear it explicitly",async()=>{
  await mount();await search("错误");await open("logs");await back();
  assert.equal(input().props.value,"错误");
  await act(async()=>button("清空设置搜索").props.onClick());
  assert.equal(input().props.value,"");
});
test("an optional quick editor remains open when navigating back without writing settings",async()=>{
  await mount();await act(async()=>button("整理常用入口").props.onClick());
  await open("logs");await back();
  assert.equal(tree.root.findAllByProps({className:"settings-home-quick-editor"}).length,1);
});
test("a new scope resets transient home search and never restores the previous target",async()=>{
  await mount();await search("错误");await open("logs");
  await act(async()=>tree.update(React.createElement(Harness,{privateMediaScope:"fictional-b"})));
  await back();
  assert.equal(input().props.value,"");
  assert.notEqual(fixture.focus.at(-1),"logs");
});
test("closing and reopening starts with a fresh search instead of resurrecting prior UI",async()=>{
  await mount();await search("错误");
  await act(async()=>fixture.api.setIsSettingsOpen(false));
  await act(async()=>fixture.api.setIsSettingsOpen(true));
  assert.equal(input().props.value,"");
  assert.equal(fixture.scroll.scrollTop,0);
});
test("stale category controls cannot redirect a hidden home or another scope",async()=>{
  await mount();
  const stale=tree.root.findByProps({"data-settings-category":"persona"}).props.onClick;
  await open("logs");
  await act(async()=>stale({currentTarget:{isConnected:true}}));
  assert.equal(tree.root.findByProps({className:"settings-category-heading"}).findByType("h3").children.join(""),"错误日志");
  await act(async()=>tree.update(React.createElement(Harness,{privateMediaScope:"fictional-b"})));
  await back();
  await act(async()=>stale({currentTarget:{isConnected:true}}));
  assert.equal(tree.root.findAllByProps({"aria-label":"返回设置分类"}).length,0);
});

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { setImmediate } from "node:timers";
import { createServer, transformWithOxc } from "vite";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ configFile:false,envDir:false,root:fileURLToPath(new URL("..",import.meta.url)),appType:"custom",logLevel:"silent",server:{middlewareMode:true},plugins:[{
  name:"actual-sticker-settings", resolveId(id){if(id==="virtual:sticker-settings")return "\0sticker-settings.jsx";},
  async load(id){if(id!=="\0sticker-settings.jsx")return;
    const code=readFileSync(new URL("../src/StickerImportSettings.jsx",import.meta.url),"utf8")
      .replace('import { apiRequest } from "./api.js";', 'const apiRequest=()=>{throw new Error("must inject request")};')
      .replace('import { authSession } from "./auth-session.js";', 'const authSession=null;')
      .replace('import "./sticker-import.css";',"").replaceAll('from "./','from "/src/');
    return (await transformWithOxc(code,"sticker-settings.jsx",{lang:"jsx",jsx:{runtime:"automatic"}})).code;
  },
}] });
const {default:Settings,StickerSource}=await vite.ssrLoadModule("virtual:sticker-settings");
const text=node=>typeof node==="string"?node:(Array.isArray(node)?node:node?.children||[]).map(text).join("");
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
let tree;
after(async()=>{if(tree)await act(async()=>tree.unmount());await vite.close();delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
function sessionFixture(){let value={user:{id:"account-a"},activeCompanionId:"companion-a"};const listeners=new Set();return {getSnapshot:()=>value,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},change(next){value=next;for(const f of listeners)f();}};}
const checkbox=()=>tree.root.findByProps({type:"checkbox"});
const input=()=>tree.root.findAllByType("input").find(node=>node.props.placeholder);
async function mount(props){if(tree)await act(async()=>tree.unmount());await act(async()=>{tree=TestRenderer.create(React.createElement(Settings,props));await flush();});}

test("missing schema keeps the switch and import disabled without breaking the media view",async()=>{
  const calls=[];await mount({session:sessionFixture(),request:async(path)=>{calls.push(path);return {schema_available:false,bilibili_enabled:false};}});
  assert.equal(checkbox().props.disabled,true);assert.match(text(tree.toJSON()),/原有上传和发送不受影响/);assert.equal(calls.length,1);
});
test("permission requires confirmed save; a failed save keeps the previous state",async()=>{
  const calls=[];await mount({session:sessionFixture(),request:async(path,options)=>{
    calls.push({path,options});if(options?.method)throw {code:"sticker_import_storage_failed"};return {schema_available:true,bilibili_enabled:false};}});
  await act(async()=>{checkbox().props.onChange({target:{checked:true}});await flush();});
  assert.equal(checkbox().props.checked,false);assert.match(text(tree.toJSON()),/sticker_import_storage_failed/);
  assert.deepEqual(JSON.parse(calls[1].options.body),{bilibili_enabled:true});
});
test("rapid duplicate submits are blocked; an uncertain failure reuses the same request ID",async()=>{
  const pending=deferred(), imports=[];let refresh=0;
  const request=async(path,options)=>{
    if(!path.endsWith("/bilibili"))return {schema_available:true,bilibili_enabled:false};
    imports.push(JSON.parse(options.body));if(imports.length===1)return pending.promise;
    return {ok:true,asset:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",purpose:"custom_sticker",status:"active"},source:{provider:"bilibili",bvid:"BV1234567890",title:"虚构封面",creator:"虚构作者"},replayed:true};
  };
  await mount({session:sessionFixture(),request,onRefresh:async()=>{refresh++;return {};}});
  await act(async()=>input().props.onChange({target:{value:"BV1234567890"}}));
  await act(async()=>{const submit=tree.root.findByType("form").props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});await flush();});
  assert.equal(imports.length,1);
  await act(async()=>{pending.resolve({ok:false});await flush();});
  assert.match(text(tree.toJSON()),/sticker_import_receipt_invalid/);
  await act(async()=>{tree.root.findByType("form").props.onSubmit({preventDefault(){}});await flush();});
  assert.equal(imports.length,2);assert.equal(imports[0].client_request_id,imports[1].client_request_id);assert.equal(refresh,1);
  assert.match(text(tree.toJSON()),/已找回上次导入/);assert.equal(tree.root.findByType("a").props.href,"https://www.bilibili.com/video/BV1234567890");
});
test("switching companions aborts a pending import and ignores late results",async()=>{
  const pending=deferred(), session=sessionFixture();let signal,refresh=0;
  await mount({session,onRefresh:()=>{refresh++;},request:async(path,options)=>{
    if(path.endsWith("/bilibili")){signal=options.signal;return pending.promise;}return {schema_available:true,bilibili_enabled:false};}});
  await act(async()=>input().props.onChange({target:{value:"BV1234567890"}}));
  await act(async()=>{tree.root.findByType("form").props.onSubmit({preventDefault(){}});await flush();});
  await act(async()=>{session.change({user:{id:"account-a"},activeCompanionId:"companion-b"});await flush();});
  assert.equal(signal.aborted,true);assert.equal(input().props.value,"");
  await act(async()=>{pending.resolve({ok:true,asset:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",purpose:"custom_sticker",status:"active"},source:{provider:"bilibili",bvid:"BV1234567890"}});await flush();});
  assert.equal(refresh,0);assert.doesNotMatch(text(tree.toJSON()),/已保存到表情包架/);assert.equal(checkbox().props.disabled,false);
});
test("source lookup is on demand and never opens an upstream supplied URL",async()=>{
  if(tree)await act(async()=>tree.unmount());let calls=0;
  await act(async()=>{tree=TestRenderer.create(React.createElement(StickerSource,{assetId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",session:sessionFixture(),request:async()=>{calls++;return {source:{provider:"bilibili",bvid:"BV1234567890",page_url:"javascript:alert(1)",title:"虚构来源"}};}}));await flush();});
  assert.equal(calls,0);await act(async()=>{tree.root.findByType("button").props.onClick();await flush();});
  assert.equal(calls,1);assert.equal(tree.root.findByType("a").props.href,"https://www.bilibili.com/video/BV1234567890");
});

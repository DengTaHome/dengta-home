import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";
import { apiRequest } from "../src/api.js";
import { createAuthSessionManager } from "../src/auth-session.js";
import { copyDiscoveryLink, discoveryValue } from "../src/discovery-feed.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8").replaceAll("\r\n","\n");
function extract(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>0&&last>first,start);return source.slice(first,last);}
const state=extract("  const [discoverSnapshot,","  const [distillState,");
const scope=extract("  const getMomentsRequestScope =","  const loadMoments =");
const render=extract("  function renderDiscover()","  function renderTakeout()");
const ACCOUNT="11111111-1111-4111-8111-111111111111",A="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",B="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const video=(bvid="BV17x411w7KC")=>({bvid,title:"Fictional video",author:"Fixture",cover:"//example.test/cover.png",play:0,duration:"00:10"});
const interests=()=>({profile:{interests:[{term:"Fixture interest",count:2}]}});
const recommend=()=>({recommend:{reason:"Fixture reason",videos:[video()]}});
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...headers}});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const fixture={manager:null,calls:[],api:null,transport:null};
const oldFetch=globalThis.fetch,oldWindow=globalThis.window,oldStorage=globalThis.localStorage;
globalThis.__discoveryFixture=fixture;
globalThis.window={setTimeout,clearTimeout};
globalThis.fetch=(url,options)=>{const call={url,options,companion:options.headers.get("X-DengTa-Companion-Id")};fixture.calls.push(call);return fixture.transport(call);};
fixture.request=(path,options)=>apiRequest(path,options);
const vite=await createServer({configFile:false,envFile:false,root:fileURLToPath(new URL("..",import.meta.url)),appType:"custom",logLevel:"silent",server:{middlewareMode:true},plugins:[{
  name:"actual-discovery-lifecycle",resolveId(id){if(id==="virtual:discovery-lifecycle")return "\0virtual:discovery-lifecycle.jsx";},
  async load(id){if(id!=="\0virtual:discovery-lifecycle.jsx")return;return (await transformWithOxc(`
    import {useState,useRef,useMemo,useEffect,useLayoutEffect,useCallback} from "react";
    import {createScopedSettingsSession,settingsSaveScope} from "/src/settings-save-scope.js";
    import {withAchievementDeadline} from "/src/achievement-action.js";
    import {copyDiscoveryLink,emptyDiscoveryState,refreshDiscovery,DISCOVERY_ERROR_FEEDBACK} from "/src/discovery-feed.js";
    import ChatErrorLog from "/src/ChatErrorLog.jsx";
    const fixture=globalThis.__discoveryFixture;
    const apiRequest=(...args)=>fixture.request(...args);
    export default function Harness({companionScope=${JSON.stringify(A)}}){
      const accountStorageScope=${JSON.stringify(ACCOUNT)},privateMediaScope=JSON.stringify([accountStorageScope,companionScope]);
      const authSession=fixture.manager;
      const componentMountedRef=useRef(true),settingsScopeControllerRef=useRef(null);
      useLayoutEffect(()=>{componentMountedRef.current=true;const controller=new AbortController();settingsScopeControllerRef.current=controller;return()=>{componentMountedRef.current=false;controller.abort();};},[privateMediaScope]);
      const funToken=useMemo(()=>({scope:privateMediaScope}),[privateMediaScope]);
      const funTokenRef=useRef(funToken);funTokenRef.current=funToken;
      const [notice,setNotice]=useState("");
      const openCompanionActivity=()=>{};
      ${scope}${state}${render}
      fixture.api={loadDiscover,read:()=>({discoverState,notice})};
      return renderDiscover();
    }
  `,"discovery-lifecycle.jsx",{lang:"jsx",jsx:{runtime:"automatic"}})).code;}
}]});
const {default:Harness}=await vite.ssrLoadModule("virtual:discovery-lifecycle");
let tree;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const normal=call=>json(call.url.includes("/interests")?interests():recommend());
async function mount(transport=normal, strict=false){
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  globalThis.localStorage=storage;
  const session={access_token:"synthetic-token",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:ACCOUNT}};
  const auth={getSession:async()=>({data:{session},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})};
  fixture.manager=createAuthSessionManager({supabaseUrl:"https://synthetic.example.test",supabaseAnonKey:"synthetic-public-key",storage,createClientFn:()=>({auth})});
  await fixture.manager.initialize();fixture.manager.setActiveCompanionId(A);fixture.calls=[];fixture.transport=transport;
  await act(async()=>{const element=React.createElement(Harness);tree=TestRenderer.create(strict?React.createElement(React.StrictMode,null,element):element);await tick();});
}
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;});
after(async()=>{await vite.close();globalThis.fetch=oldFetch;globalThis.window=oldWindow;globalThis.localStorage=oldStorage;delete globalThis.__discoveryFixture;});
const read=()=>fixture.api.read().discoverState;

test("same-tick refresh clicks produce one scoped batch and preserve the current exclusion list",async()=>{
  await mount();fixture.calls=[];const pending=deferred();fixture.transport=()=>pending.promise;let first,second;
  await act(async()=>{first=fixture.api.loadDiscover();second=fixture.api.loadDiscover();await tick();});
  assert.equal(fixture.calls.length,2);assert.equal(read().busy,true);
  assert.ok(fixture.calls.some(call=>call.url.includes("exclude=BV17x411w7KC")));
  await act(async()=>{pending.resolve(json({profile:interests().profile,recommend:recommend().recommend}));await Promise.all([first,second]);});
  assert.equal(read().busy,false);assert.equal(read().recommend.videos.length,1);
});
test("StrictMode effect replay cancels the old batch without leaving a permanent busy lock",async()=>{
  await mount(normal,true);
  assert.equal(read().busy,false);
  assert.equal(read().sections.recommend.status,"success");
  assert.equal(fixture.calls.length,2);
});
test("successful interests appear immediately while recommendations are still pending; errors retain saved videos",async()=>{
  await mount();const pending=deferred();fixture.transport=call=>call.url.includes("/interests")?json({profile:{interests:[{term:"New interest"}]}}):pending.promise;let run;
  await act(async()=>{run=fixture.api.loadDiscover();await tick();});
  assert.equal(read().interests[0].term,"New interest");assert.equal(read().busy,true);
  await act(async()=>{pending.resolve(json({code:"interest_unavailable",error:"FICTIONAL_PRIVATE_BODY"},503));await run;});
  assert.equal(read().busy,false);assert.equal(read().recommend.videos.length,1);
  assert.match(JSON.stringify(tree.toJSON()),/interest_unavailable/);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/FICTIONAL_PRIVATE_BODY/);
});
test("a companion switch aborts old reads; late headers cannot revert global identity or override new UI",async()=>{
  const pending=deferred();await mount(()=>pending.promise);
  const oldCalls=fixture.calls.slice();fixture.transport=normal;fixture.manager.setActiveCompanionId(B);
  await act(async()=>{tree.update(React.createElement(Harness,{companionScope:B}));await tick();});
  assert.ok(oldCalls.every(call=>call.options.signal.aborted));
  await act(async()=>{pending.resolve(json({profile:interests().profile,recommend:recommend().recommend},200,{"X-DengTa-Companion-Id":A}));await tick();});
  assert.equal(fixture.manager.getSnapshot().activeCompanionId,B);assert.equal(read().busy,false);assert.equal(read().recommend.videos[0].title,"Fictional video");
});
test("a stale same-instance callback cannot send requests for the new scope",async()=>{
  await mount();const stale=fixture.api.loadDiscover;fixture.manager.setActiveCompanionId(B);
  await act(async()=>tree.update(React.createElement(Harness,{companionScope:B})));
  fixture.calls=[];await act(async()=>stale());assert.equal(fixture.calls.length,0);
});
test("unmount cancels transport even if the synthetic upstream never resolves",async()=>{
  const pending=deferred();await mount(()=>pending.promise);const calls=fixture.calls.slice();
  await act(async()=>tree.unmount());tree=null;assert.ok(calls.every(call=>call.options.signal.aborted));
});
test("502 is reported once instead of retrying under another identity",async()=>{
  await mount(()=>json({code:"interest_unavailable",error:"FICTIONAL_PRIVATE_BODY"},502));
  assert.equal(fixture.calls.length,2);assert.equal(read().busy,false);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/FICTIONAL_PRIVATE_BODY/);
});
test("empty recommendations are valid and do not pretend that loading failed",async()=>{
  await mount(call=>json(call.url.includes("/interests")?{profile:{interests:[]}}:{recommend:{videos:[]}}));
  assert.equal(read().sections.recommend.status,"success");assert.match(JSON.stringify(tree.toJSON()),/这次没有找到匹配/);
});
for(const body of [{recommend:{videos:[null]}},{recommend:{videos:{length:1}}},{recommend:{videos:[{...video(),cover:123}]}},{recommend:{videos:[{...video(),title:{private:"FICTIONAL_PRIVATE_BODY"}}]}},{recommend:{videos:[video()],reason:{private:"FICTIONAL_PRIVATE_BODY"}}}])test(`invalid video receipt ${JSON.stringify(body)} cannot crash the actual discovery JSX`,async()=>{
  await mount(call=>json(call.url.includes("/interests")?interests():body));
  assert.equal(read().sections.recommend.diagnostic.error_code,"discover_recommend_invalid");assert.doesNotMatch(JSON.stringify(tree.toJSON()),/FICTIONAL_PRIVATE_BODY/);
});
test("invalid interest rows have precise diagnostics while valid videos remain available",async()=>{
  await mount(call=>json(call.url.includes("/interests")?{profile:{interests:[null]}}:recommend()));
  assert.equal(read().sections.interests.diagnostic.error_code,"discover_interests_invalid");assert.equal(read().recommend.videos.length,1);
});
test("optional covers fall back safely, duplicate videos are removed, and zero play counts remain valid",()=>{
  const feed=discoveryValue("recommend",{recommend:{videos:[{...video(),cover:"javascript:alert(1)"},video()]}});
  assert.equal(feed.videos.length,1);assert.equal(feed.videos[0].cover,"");assert.equal(feed.videos[0].play,0);
});
test("coercible array video identifiers are rejected instead of bypassing receipt validation and deduplication",()=>{
  assert.throws(()=>discoveryValue("recommend",{recommend:{videos:[{...video(),bvid:[video().bvid]}]}}),{code:"discover_recommend_invalid"});
});
test("copy confirms only after clipboard completion and gives actionable failure instead of false success",async()=>{
  const pending=deferred(),messages=[];let current=true;
  const options={current:()=>current,feedback:message=>messages.push(message)};
  const run=copyDiscoveryLink(video().bvid,{...options,clipboard:{writeText:()=>pending.promise}});
  assert.equal(messages.length,0);pending.resolve();await run;assert.deepEqual(messages,["已复制视频链接。"]);
  messages.length=0;await copyDiscoveryLink(video().bvid,{...options,clipboard:{}});assert.match(messages[0],/clipboard_write_failed/);
  messages.length=0;await copyDiscoveryLink(video().bvid,{...options,clipboard:{writeText:async()=>{throw Error("FICTIONAL_PRIVATE_BODY");}}});assert.doesNotMatch(messages[0],/FICTIONAL_PRIVATE_BODY/);
  messages.length=0;current=false;await copyDiscoveryLink(video().bvid,options);assert.equal(messages.length,0);
});

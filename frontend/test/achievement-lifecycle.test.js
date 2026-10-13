import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";
import { apiRequest } from "../src/api.js";
import { createAuthSessionManager } from "../src/auth-session.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}
const state = extract("  const funScope = JSON.stringify(", "\n  const [coWatchDanmaku,");
const scope = extract("  const getMomentsRequestScope =", "  const loadMoments =");
const actions = extract("  const refreshFunLabs = useCallback(", "  function handleGuideAction(");
const guide = extract("  function renderAchievementGuide()", "  async function removeSpecialDate(");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const json = (data, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const row = (code = "first_chat", unlocked = true) => ({ code, title: "Fictional achievement", unlocked, custom: false });
const list = () => json({ achievements: [row()] });
const custom = () => ({ id: "custom-id", code: "custom:fixture", title: "Fixture title", description: "condition", emoji: "🎯", unlocked: false, custom: true });
const receipt = kind => kind === "create" ? json({ achievement: custom() }) : kind === "delete" ? json({ removed: "custom-id" })
  : kind === "unlock" ? json({ unlocked: { code: "custom:fixture", unlocked: true } })
    : json({ unlocked: { code: "onboarding_1", unlocked: true }, achievements: [row(), row("onboarding_1")] });
const fixture = { calls: [], api: null, manager: null, transport: () => list() };
globalThis.__achievementLifecycleFixture = fixture;
const oldWindow = globalThis.window, oldFetch = globalThis.fetch, oldStorage = globalThis.localStorage;
globalThis.window = { setTimeout, clearTimeout };
globalThis.fetch = async (url, options) => {
  const call = { url, method: options.method || "GET", options }; fixture.calls.push(call); return fixture.transport(call);
};
fixture.request = (path, options) => apiRequest(path, { ...options, authSession: options?.authSession || fixture.manager, retry: false });
const optionalImport = source.includes('from "./achievement-action.js"')
  ? 'import {validateAchievementReceipt,achievementFailure,withAchievementDeadline,ACHIEVEMENT_ERROR_FEEDBACK} from "/src/achievement-action.js";' : "";
const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "actual-achievement-actions",
  resolveId(id) { if (id === "virtual:achievement-lifecycle") return "\0virtual:achievement-lifecycle.jsx"; },
  async load(id) {
    if (id !== "\0virtual:achievement-lifecycle.jsx") return;
    return (await transformWithOxc(`
      import {useState,useRef,useMemo,useEffect,useCallback,useLayoutEffect} from "react";
      import {createScopedSettingsSession,settingsSaveScope} from "/src/settings-save-scope.js";
      import {emptyFunLabsState,refreshFunLabsSections} from "/src/fun-labs-refresh.js";
      import {freshAchievements,guideStorageKey} from "/src/achievement-guide.js";
      import {recordOperationFailure} from "/src/operation-diagnostics.js";
      import AchievementGuide from "/src/AchievementGuide.jsx";
      ${optionalImport}
      const fixture=globalThis.__achievementLifecycleFixture;
      const apiRequest=(...args)=>fixture.request(...args);
      export default function Harness({companionScope=A}) {
        const accountStorageScope=${JSON.stringify(ACCOUNT)}, privateMediaScope=JSON.stringify([accountStorageScope,companionScope]);
        const authSession=fixture.manager;
        const componentMountedRef=useRef(true),settingsScopeControllerRef=useRef(null),unlockedCodesRef=useRef(null);
        const [,setAchievementPopup]=useState(null),[notice,setNotice]=useState("");
        useLayoutEffect(()=>{componentMountedRef.current=true;const controller=new AbortController();settingsScopeControllerRef.current=controller;return()=>{componentMountedRef.current=false;controller.abort();};},[privateMediaScope]);
        ${state}
        ${scope}
        ${actions}
        const changeView=()=>{},handleGuideAction=()=>{};
        ${guide}
        fixture.api={addCustomAchievement,reviewCustomAchievementCreation,resumeCustomAchievementCreation,unlockCustomAchievement,removeCustomAchievement,completeOnboarding,refreshFunLabs,handleMusicUnderstandingSaved,openAchievementGuide,setCustomAchievement,
          read:()=>({customAchievement,customAchievementBusy,customAchievementRecovery,notice,funLabsState})};
        return renderAchievementGuide();
      }
    `.replace("companionScope=A", `companionScope=${JSON.stringify(A)}`), "achievement-lifecycle.jsx", {lang:"jsx",jsx:{runtime:"automatic"}})).code;
  }
}] });
const { default: Harness } = await vite.ssrLoadModule("virtual:achievement-lifecycle");
let tree;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function mount({ expired = false } = {}) {
  const values = new Map(), refresh = deferred();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  globalThis.localStorage = storage;
  const session = { access_token: "synthetic-token", expires_at: Math.floor(Date.now()/1000)+(expired?-60:3600), user:{id:ACCOUNT} };
  const auth = { getSession: async()=>({data:{session},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),refreshSession:()=>refresh.promise,signOut:async()=>({error:null}) };
  fixture.manager=createAuthSessionManager({supabaseUrl:"https://synthetic.example.test",supabaseAnonKey:"synthetic-public-key",storage,createClientFn:()=>({auth})});
  await fixture.manager.initialize(); fixture.manager.setActiveCompanionId(A);
  fixture.calls=[];fixture.transport=()=>list();
  await act(async()=>{tree=TestRenderer.create(React.createElement(Harness));});
  return { refresh, session };
}
const writes=()=>fixture.calls.filter(call=>call.method!=="GET");
const read=()=>fixture.api.read();
const snapshot=()=>JSON.stringify(tree.toJSON());
async function fill(){await act(async()=>fixture.api.setCustomAchievement({title:"  Fixture title  ",emoji:"🎯",description:" condition\r\n "}));}
afterEach(async()=>{if(tree)await act(async()=>tree.unmount());tree=null;});
after(async()=>{await vite.close();globalThis.window=oldWindow;globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;delete globalThis.__achievementLifecycleFixture;});

for(const kind of ["create","unlock","delete","onboarding"]){
  const invoke=()=>kind==="create"?fixture.api.addCustomAchievement():kind==="unlock"?fixture.api.unlockCustomAchievement("custom:fixture"):kind==="delete"?fixture.api.removeCustomAchievement("custom-id"):fixture.api.completeOnboarding();
  test(`${kind}: same-tick submissions issue one mutation`,async()=>{
    await mount();await fill();const pending=deferred();fixture.transport=call=>call.method==="GET"?list():pending.promise;let first,second;
    await act(async()=>{first=invoke();second=invoke();await tick();});
    const count=writes().length;
    await act(async()=>{pending.resolve(receipt(kind));await Promise.allSettled([first,second]);});
    assert.equal(count,1);
  });
  for(const body of [{},null])test(`${kind}: incomplete HTTP 200 never confirms success (${JSON.stringify(body)})`,async()=>{
    await mount();await fill();fixture.transport=call=>call.method==="GET"?list():json(body);
    await act(async()=>{await Promise.allSettled([invoke()]);});
    if(kind==="create"){
      assert.equal(read().customAchievement.title,"  Fixture title  ");
      assert.equal(read().customAchievementRecovery.status,"pending");
      await act(async()=>fixture.api.addCustomAchievement());
      assert.equal(writes().length,1);
    }
    assert.match(read().notice,/回执|尚未确认/);
    assert.equal(fixture.calls.filter(call=>call.method==="GET").length,0);
  });
  test(`${kind}: companion changed during auth refresh prevents old body transport`,async()=>{
    const{refresh,session}=await mount({expired:true});await fill();let run;
    await act(async()=>{run=invoke();await tick();fixture.manager.setActiveCompanionId(B);refresh.resolve({data:{session:{...session,expires_at:Math.floor(Date.now()/1000)+3600}},error:null});await Promise.allSettled([run]);});
    assert.equal(writes().length,0);
  });
  test(`${kind}: a late 401 cannot sign out the new companion scope`,async()=>{
    await mount();await fill();const pending=deferred();fixture.transport=()=>pending.promise;let run;
    await act(async()=>{run=invoke();await tick();});
    fixture.manager.setActiveCompanionId(B);
    await act(async()=>{pending.resolve(json({code:"authentication_required",error:"FICTIONAL_PRIVATE_BODY"},401));await Promise.allSettled([run]);});
    assert.equal(fixture.manager.getSnapshot().status,"authenticated");assert.equal(fixture.manager.getSnapshot().activeCompanionId,B);
    assert.doesNotMatch(read().notice,/FICTIONAL_PRIVATE_BODY/);
  });
}
test("Use route expands without writable browser storage",async()=>{
  await mount();globalThis.localStorage={getItem(){throw Error("disabled");},setItem(){throw Error("disabled");}};
  await act(async()=>fixture.api.openAchievementGuide());
  assert.equal(tree.root.findAllByType("nav").length,1);
});
test("guide collect uses one in-flight request and keeps confirmed reward after a failed GET",async()=>{
  await mount();await act(async()=>{await fixture.api.refreshFunLabs(["achievements"]);fixture.api.openAchievementGuide();});
  const button=text=>tree.root.findAllByType("button").find(node=>node.children.join("").includes(text));
  await act(async()=>button("留一份小纪念").props.onClick());
  const pending=deferred();fixture.transport=call=>call.method==="GET"?json({code:"achievements_load_failed",error:"FICTIONAL_PRIVATE_BODY"},503):pending.promise;
  await act(async()=>{const click=button("收下入门纪念").props.onClick;click();click();await tick();});
  const count=writes().length;
  await act(async()=>{pending.resolve(receipt("onboarding"));await tick();});
  assert.equal(count,1);
  assert.match(snapshot(),/纪念已收好/);assert.doesNotMatch(snapshot(),/FICTIONAL_PRIVATE_BODY/);
});
test("explicit guide opening is consumed once and later collapse survives remount",async()=>{
  await mount();await act(async()=>fixture.api.openAchievementGuide());
  const collapse=()=>tree.root.findAllByType("button").find(node=>node.children.join("").includes("先自己逛逛"));
  await act(async()=>collapse().props.onClick());assert.equal(tree.root.findAllByType("nav").length,0);
  await act(async()=>{tree.unmount();tree=TestRenderer.create(React.createElement(Harness));});
  assert.equal(tree.root.findAllByType("nav").length,0);
});
test("creation JSON deadline stops busy feedback, keeps adding paused and rejects late confirmation",async()=>{
  await mount();await fill();const body=deferred(),started=deferred();let deadline;
  fixture.transport=()=>({ok:true,status:200,headers:new Headers(),json:()=>{started.resolve();return body.promise;}});
  const previous=globalThis.setTimeout;
  globalThis.setTimeout=(callback,delay,...args)=>delay===12_000?(deadline=callback,-100):previous(callback,delay,...args);
  try {
    let run;await act(async()=>{run=fixture.api.addCustomAchievement();await started.promise;});
    assert.equal(typeof deadline,"function");await act(async()=>{deadline();await run;});
    assert.equal(read().customAchievementBusy,false);assert.equal(read().customAchievement.title,"  Fixture title  ");assert.match(read().notice,/request_timeout/);
    assert.equal(read().customAchievementRecovery.status,"pending");
    await act(async()=>fixture.api.addCustomAchievement());assert.equal(writes().length,1);
    await act(async()=>{body.resolve({achievement:custom()});await tick();});
    assert.equal(read().customAchievement.title,"  Fixture title  ");assert.equal(writes().length,1);assert.equal(fixture.calls.filter(call=>call.method==="GET").length,0);
  } finally {globalThis.setTimeout=previous;}
});

for (const status of [408,503]) test(`real HTTP ${status} creation failure requires a scoped list read and explicit review before retry`,async()=>{
  await mount();await fill();
  fixture.transport=call=>call.method==="GET"?list():json({code:"synthetic_write_failure",error:"FICTIONAL_PRIVATE_BODY"},status);
  await act(async()=>fixture.api.addCustomAchievement());
  assert.equal(writes().length,1);assert.equal(read().customAchievementRecovery.status,"pending");
  await act(async()=>{fixture.api.resumeCustomAchievementCreation();await fixture.api.addCustomAchievement();});
  assert.equal(writes().length,1);
  await act(async()=>fixture.api.reviewCustomAchievementCreation());
  const get=fixture.calls.find(call=>call.method==="GET");
  assert.ok(get.url.endsWith("/api/v2/fun-labs/achievements"));
  assert.equal(get.options.headers.get("X-DengTa-Companion-Id"),A);
  assert.equal(read().customAchievementRecovery.status,"reviewed");
  assert.equal(read().customAchievement.title,"  Fixture title  ");
  assert.doesNotMatch(read().notice,/FICTIONAL_PRIVATE_BODY/);
  await act(async()=>fixture.api.addCustomAchievement());assert.equal(writes().length,1);
  await act(async()=>fixture.api.resumeCustomAchievementCreation());assert.equal(read().customAchievementRecovery,null);
  fixture.transport=call=>call.method==="GET"?list():receipt("create");
  await act(async()=>fixture.api.addCustomAchievement());assert.equal(writes().length,2);
});

test("real explicit rejection allows retry while an ok:false response never clears a draft",async()=>{
  await mount();await fill();fixture.transport=()=>json({code:"achievement_title_required",error:"FICTIONAL_PRIVATE_BODY"},400);
  await act(async()=>fixture.api.addCustomAchievement());
  assert.equal(read().customAchievementRecovery,null);assert.match(read().notice,/未被接受/);
  fixture.transport=()=>json({ok:false,achievement:custom(),error:"FICTIONAL_PRIVATE_BODY"});
  await act(async()=>fixture.api.addCustomAchievement());
  assert.equal(writes().length,2);assert.equal(read().customAchievementRecovery,null);
  assert.equal(read().customAchievement.title,"  Fixture title  ");
  assert.equal(fixture.calls.filter(call=>call.method==="GET").length,0);
  assert.doesNotMatch(read().notice,/FICTIONAL_PRIVATE_BODY/);
});

test("companion changed before recovery list transport prevents cross-companion reads and old resume",async()=>{
  await mount();await fill();fixture.transport=()=>json({},503);
  await act(async()=>fixture.api.addCustomAchievement());
  const stateBefore=read().customAchievementRecovery;
  fixture.manager.setActiveCompanionId(B);
  await act(async()=>{await fixture.api.reviewCustomAchievementCreation();fixture.api.resumeCustomAchievementCreation();});
  assert.equal(fixture.calls.filter(call=>call.method==="GET").length,0);
  assert.equal(read().customAchievementRecovery,stateBefore);
  assert.equal(read().customAchievement.title,"  Fixture title  ");
});

test("confirmed music analysis refreshes scoped achievements with GET only", async()=>{
  await mount();
  await act(async()=>fixture.api.handleMusicUnderstandingSaved({scope:JSON.stringify([ACCOUNT,A]),providerTrackId:"1001"}));
  assert.equal(fixture.calls.length,1);
  assert.ok(fixture.calls[0].url.endsWith("/api/v2/fun-labs/achievements"));
  assert.equal(fixture.calls[0].options.headers.get("X-DengTa-Companion-Id"),A);
  assert.equal(writes().length,0);
});

test("old music save callbacks cannot refresh after companion change or unmount",async()=>{
  await mount();const oldSaved=fixture.api.handleMusicUnderstandingSaved;
  fixture.manager.setActiveCompanionId(B);
  await act(async()=>oldSaved({scope:JSON.stringify([ACCOUNT,A])}));
  assert.equal(fixture.calls.length,0);
  await act(async()=>tree.update(React.createElement(Harness,{companionScope:B})));
  await act(async()=>oldSaved({scope:JSON.stringify([ACCOUNT,A])}));
  assert.equal(fixture.calls.length,0);
  const currentSaved=fixture.api.handleMusicUnderstandingSaved;
  await act(async()=>tree.unmount());tree=null;
  await act(async()=>currentSaved({scope:JSON.stringify([ACCOUNT,B])}));
  assert.equal(fixture.calls.length,0);
});

test("music save receipt from another account or companion never refreshes achievements",async()=>{
  await mount();
  for(const scope of [JSON.stringify(["other-account",A]),JSON.stringify([ACCOUNT,B]),undefined]) {
    await act(async()=>fixture.api.handleMusicUnderstandingSaved({scope}));
  }
  assert.equal(fixture.calls.length,0);
});

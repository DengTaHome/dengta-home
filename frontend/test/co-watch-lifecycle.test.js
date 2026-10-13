import assert from "node:assert/strict";
import { createCoWatchLifecycle } from "../src/co-watch-lifecycle.js";
import { coWatchRequestOptions } from "../src/co-watch-request-scope.js";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function fixture() {
  let identity={accountScope:"account-a",companionScope:"companion-a"},session=null;
  const calls=[],busy=[],starts=[],ends=[];
  const lifecycle=createCoWatchLifecycle({getIdentity:()=>identity,getSession:()=>session,isBusy:()=>false,idFactory:()=>"2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
    createSession:(input,options)=>{const request=deferred();calls.push({kind:"start",input,options,...request});return request.promise;},
    endSession:(id,input,options)=>{const request=deferred();calls.push({kind:"stop",id,input,options,...request});return request.promise;},
    onBusy:value=>busy.push(value),onStarted:value=>{starts.push(value);session=value;},onEnded:value=>{ends.push(value);session=null;}});
  return {lifecycle,calls,busy,starts,ends,setIdentity:value=>{identity=value;},setSession:value=>{session=value;},getSession:()=>session};
}
const input={sessionMode:"direct_media",mediaUrl:"https://media.example.test/a.mp4",sourceApp:"dengta-direct-media"};
const active=id=>({id,status:"active",sessionMode:"direct_media",sourceApp:input.sourceApp});
{
 const f=fixture(),p=f.lifecycle.start(input);assert.equal((await f.lifecycle.start(input)).code,"co_watch_operation_busy");assert.equal(f.calls.length,1);
 const request=f.calls[0];assert.equal(request.options.accountScope,"account-a");assert.equal(request.options.companionScope,"companion-a");
 request.resolve(active(request.input.sessionId));assert.equal((await p).ok,true);assert.equal(f.starts.length,1);assert.deepEqual(f.busy,[true,false]);
 assert.equal((await f.lifecycle.start(input)).ok,true);assert.equal(f.calls.length,1);
 assert.equal((await f.lifecycle.start({...input,mediaUrl:"https://media.example.test/b.mp4"})).code,"co_watch_active_conflict");assert.equal(f.calls.length,1);
}
{
 const f=fixture(),p=f.lifecycle.start(input),id=f.calls[0].input.sessionId;
 f.calls[0].reject(Object.assign(Error("请求超时"),{code:"request_timeout"}));assert.equal((await p).ok,false);
 const retry=f.lifecycle.start(input);assert.equal(f.calls[1].input.sessionId,id);
 f.calls[1].resolve(active(id));assert.equal((await retry).ok,true);
}
{
 const f=fixture(),p=f.lifecycle.start(input),id=f.calls[0].input.sessionId;
 f.calls[0].reject(Error("请求超时"));await p;f.setSession(active(id));
 assert.equal((await f.lifecycle.start(input)).ok,true);assert.equal(f.calls.length,1);assert.equal(f.starts.length,1);
}
{
 const f=fixture(),stamp=f.lifecycle.capture(),p=f.lifecycle.start(input),old=f.calls[0];assert.equal(f.lifecycle.current(stamp),false);
 f.setIdentity({accountScope:"account-a",companionScope:"companion-b"});f.lifecycle.invalidate();assert.equal(old.options.signal.aborted,true);
 const newer=f.lifecycle.start(input),latest=f.calls[1];old.resolve(active(old.input.sessionId));assert.equal((await p).code,"co_watch_scope_changed");
 assert.equal(f.starts.length,0);assert.deepEqual(f.busy,[true,false,true]);
 latest.resolve(active(latest.input.sessionId));assert.equal((await newer).ok,true);assert.equal(f.starts.length,1);
 assert.equal((await f.lifecycle.stop({accountScope:"account-a",companionScope:"companion-a"})).code,"co_watch_scope_changed");
 assert.equal(f.calls.length,2);
}
{
 const f=fixture();f.setSession(active("old"));const p=f.lifecycle.stop({sessionId:"old"});assert.equal((await f.lifecycle.stop({sessionId:"old"})).code,"co_watch_operation_busy");
 f.setSession(active("new"));f.calls[0].resolve({id:"old",status:"ended"});assert.equal((await p).code,"co_watch_session_changed");assert.equal(f.getSession().id,"new");assert.equal(f.ends.length,0);
 assert.equal((await f.lifecycle.stop({sessionId:"old"})).code,"co_watch_session_changed");assert.equal(f.calls.length,1);
}
{
 const f=fixture();f.setSession(active("old"));let p=f.lifecycle.stop({sessionId:"old"});f.calls[0].reject(Error("网络断开"));assert.equal((await p).ok,false);assert.equal(f.getSession().id,"old");
 p=f.lifecycle.stop({sessionId:"old"});f.calls[1].resolve(active("old"));assert.equal((await p).code,"co_watch_receipt_invalid");assert.equal(f.ends.length,0);
 p=f.lifecycle.stop({sessionId:"old"});f.calls[2].resolve({id:"old",status:"ended"});assert.equal((await p).ok,true);assert.equal(f.getSession(),null);
}
{
 const f=fixture(),p=f.lifecycle.start(input);f.calls[0].resolve(active("different-device"));assert.equal((await p).code,"co_watch_active_conflict");assert.equal(f.starts.length,0);
}
{
 let snapshot={user:{id:"account-a"},activeCompanionId:"companion-a"},captures=0,invalidations=0;
 const pending=deferred(),controller=new AbortController();
 const auth={getSnapshot:()=>snapshot,getRequestContext:()=>pending.promise,captureCompanionFromResponse:()=>captures++,invalidateSession:()=>invalidations++};
 const options=coWatchRequestOptions({accountScope:"account-a",companionScope:"companion-a",signal:controller.signal},auth);
 const p=options.authSession.getRequestContext();snapshot={user:{id:"account-b"},activeCompanionId:"companion-b"};pending.resolve({companionId:"companion-b",accessToken:"fictional-token"});
 await assert.rejects(p,{code:"co_watch_scope_changed"});options.authSession.captureCompanionFromResponse({});options.authSession.invalidateSession();assert.equal(captures,0);assert.equal(invalidations,0);
 snapshot={user:{id:"account-a"},activeCompanionId:"companion-a"};controller.abort();await assert.rejects(options.authSession.getRequestContext(),{name:"AbortError"});
}
const requests=[];
globalThis.__coWatchWireFixture={auth:{getSnapshot:()=>({user:{id:"account-a"},activeCompanionId:"companion-a"}),getRequestContext:async()=>({companionId:"companion-a",accessToken:"fictional-token"})},
  request:async(path,options)=>{requests.push({path,options});await options.authSession?.getRequestContext();return {session:{id:"2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",status:options.method==="PATCH"?"ended":"active",session_mode:"direct_media"},messages:[]};}};
const vite=await createServer({root:fileURLToPath(new URL("..",import.meta.url)),appType:"custom",logLevel:"silent",server:{middlewareMode:true},plugins:[{name:"co-watch-wire-fixture",enforce:"pre",load(id){
 if(id.replaceAll("\\","/").endsWith("/src/api.js"))return 'export const apiRequest=(...args)=>globalThis.__coWatchWireFixture.request(...args);';
 if(id.replaceAll("\\","/").endsWith("/src/auth-session.js"))return 'export const authSession=globalThis.__coWatchWireFixture.auth;';
}}]});
try{
 const api=await vite.ssrLoadModule("/src/co-watch.js");
 const controller=new AbortController(),options={accountScope:"account-a",companionScope:"companion-a",signal:controller.signal},id="2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50";
 assert.equal((await api.createCoWatchSession({...input,sessionId:id},options)).id,id);
 assert.equal(JSON.parse(requests[0].options.body).session_id,id);assert.equal(requests[0].options.signal,controller.signal);
 await api.endCoWatchSession(id,{},options);await api.patchCoWatchPlayback(id,{},options);await api.readActiveCoWatchSession({},options);await api.readCoWatchDialog({id,conversationId:"fixture-conversation"},options);
 assert.equal(requests.length,5);assert.ok(requests.every(request=>request.options.authSession&&request.options.signal===controller.signal));
}finally{await vite.close();delete globalThis.__coWatchWireFixture;}
console.log("Co-watch lifecycle passed: synchronous locking, retry identity, stale scope/session rejection, valid end receipts, scoped authentication and actual API serialization");

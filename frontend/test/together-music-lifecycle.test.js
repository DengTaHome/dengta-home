import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window={setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:()=>null}};
const identity={accountScope:'account-a',companionScope:'companion-a'};
const active={id:'session-a',status:'active',sessionMode:'listening',musicPlaylistId:'p',musicPlaylistItemId:'track'};
const playlist={id:'p',name:'Fixture playlist',items:[{id:'track',title:'Fixture song',url:'https://media.example.test/music.mp3',duration:60}]};
const queue={session_id:active.id,revision:0,items:[]};
const seeded={...queue,revision:1,current_queue_item_id:'entry',items:[{id:'entry',item_id:'track',playlist_id:'p',title:'Fixture song'}]};
const calls=[];let failQueue=false;
globalThis.__musicFixture={auth:{getSnapshot:()=>({user:{id:identity.accountScope},activeCompanionId:identity.companionScope}),getRequestContext:async()=>({accessToken:'fictional',companionId:identity.companionScope})},
 request:async(path,options={})=>{
  await options.authSession?.getRequestContext();calls.push({path,options});
  if(path.endsWith('/queue/operations')) {if(failQueue){failQueue=false;throw Object.assign(Error('fixture queue timeout'),{code:'request_timeout'});}return {queue:seeded};}
  if(path.endsWith('/queue'))return queue;
  if(path==='/api/v2/music/playlists')return {playlists:[playlist]};
  if(path==='/api/v2/music/playlists/p')return {playlist};
  if(path.endsWith('/favorites'))return {favorites:[]};
  if(path.endsWith('/connections/manage'))return {connections:[]};
  if(path.endsWith('/cookie-session'))return {session:{connected:false}};
  throw Error('unexpected fixture path '+path);
 }};
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'music-api-fixture',enforce:'pre',load(id){
 if(id.replaceAll('\\','/').endsWith('/src/api.js'))return 'export const apiRequest=(...args)=>globalThis.__musicFixture.request(...args);export const apiFetch=apiRequest;';
 if(id.replaceAll('\\','/').endsWith('/src/auth-session.js'))return 'export const authSession=globalThis.__musicFixture.auth;';
}}]});
let tree,starts=0,ends=0,resolveStart,resolveEnd;
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
const props={...identity,onStart:()=>{starts++;return new Promise(resolve=>{resolveStart=resolve;});},onEnd:()=>{ends++;return new Promise(resolve=>{resolveEnd=resolve;});}};
const button=text=>tree.root.findAllByType('button').find(n=>n.children.includes(text));
try{
 const {default:Music}=await vite.ssrLoadModule('/src/TogetherMusic.jsx');
 async function mount(){await act(async()=>{tree=TestRenderer.create(React.createElement(Music,props));await settle();});assert.equal(tree.root.findByType('audio').props.src,undefined,'empty player must not request the page itself as media');await act(async()=>{tree.root.findAllByType('select').find(n=>n.findAllByType('option').some(o=>o.props.value==='p')).props.onChange({target:{value:'p'}});await settle();});assert.equal(tree.root.findByType('audio').props.src,playlist.items[0].url,'selecting a playable song must attach its exact media source');}
 await mount();
 await act(async()=>{const click=button('开始一起听').props.onClick;click();click();});assert.equal(starts,1,'synchronous duplicate click must only create one session');
 await act(async()=>{resolveStart({ok:false,code:'fixture_start_failure',message:'fixture failed'});await settle();});assert.match(JSON.stringify(tree.toJSON()),/fixture_start_failure/);assert.equal(calls.filter(c=>c.path.endsWith('/queue/operations')).length,0);
 await act(async()=>{button('开始一起听').props.onClick();});assert.equal(starts,2);
 failQueue=true;
 await act(async()=>{tree.update(React.createElement(Music,{...props,session:active}));resolveStart({...active,ok:true});await settle();});
 assert.match(JSON.stringify(tree.toJSON()),/request_timeout/);assert.ok(button('重试载入队列'));
 const failed=calls.filter(c=>c.path.endsWith('/queue/operations')).at(-1);assert.ok(failed);
 await act(async()=>{button('重试载入队列').props.onClick();await settle();});
 const retry=calls.filter(c=>c.path.endsWith('/queue/operations')).at(-1);assert.equal(JSON.parse(retry.options.body).request_id,JSON.parse(failed.options.body).request_id);assert.equal(starts,2,'queue retry must not start another session');assert.equal(button('重试载入队列'),undefined);
 await act(async()=>{const click=button('结束本场').props.onClick;click();click();});assert.equal(ends,1);
 await act(async()=>{resolveEnd({ok:false,code:'fixture_stop_failure',message:'fixture failed'});await settle();});assert.match(JSON.stringify(tree.toJSON()),/fixture_stop_failure/);assert.ok(button('结束本场'));assert.match(JSON.stringify(tree.toJSON()),/Fixture song/);
 await act(async()=>tree.unmount());
 await mount();const count=calls.filter(c=>c.path.endsWith('/queue/operations')).length;
 await act(async()=>button('开始一起听').props.onClick());await act(async()=>tree.unmount());
 await act(async()=>{resolveStart({...active,ok:true});await settle();});assert.equal(calls.filter(c=>c.path.endsWith('/queue/operations')).length,count,'unmounted startup must not seed a queue');
 assert.ok(calls.filter(c=>c.path.includes('/queue')).every(c=>c.options.signal&&c.options.authSession),'actual queue adapter receives scope and cancellation');
 console.log('TogetherMusic component: duplicate start/end, exact failure codes, queue-only retry with stable ID, retained session and unmount cancellation passed');
}finally{await vite.close();delete globalThis.__musicFixture;}

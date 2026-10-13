import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map(), timers = new Map(), requests = [];
let sequence = 0, tree, Together, vite;
globalThis.window = { setTimeout(fn) { const id=++sequence; timers.set(id,fn); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval() { return ++sequence; }, clearInterval() {} };
globalThis.document = { hidden:false, body:{style:{}} };
globalThis.sessionStorage = { getItem:key=>storage.get(key) ?? null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) };
globalThis.__watchHandoff = (url,options) => new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}));
const props = { accountScope:'fictional-account', companionScope:'fictional-companion', screenState:{}, feedback:{} };
const first = 'https://www.bilibili.com/video/BV1234567890', second = 'https://www.bilibili.com/video/BVabcdefghij';
const request = (url=first) => ({id:'fictional-selection',query:'虚构待选视频',pageUrl:url,...props});
const page = url => ({page_url:url,embed_url:'https://fixture.example.test/player',provider:'fixture',title:'虚构解析结果'});
const button = name => tree.root.findAllByType('button').find(node=>node.children.includes(name));
const json = () => JSON.stringify(tree.toJSON());
async function tick() { await act(async()=>{ const tasks=[...timers.values()];timers.clear();for(const task of tasks)task(); }); }
async function mount(extra={}) { storage.clear();timers.clear();requests.length=0;await act(async()=>{tree=TestRenderer.create(React.createElement(Together,{...props,...extra}));});await tick(); }
async function update(extra={}) { await act(async()=>tree.update(React.createElement(Together,{...props,...extra})));await tick(); }
async function unmount() { if(tree)await act(async()=>{tree.unmount();tree=null;}); }
before(async()=>{
  vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{
    name:'fictional-handoff-boundaries',enforce:'pre',
    transform(code,id) { if(id.replaceAll('\\','/').endsWith('/Together.jsx'))return code.replace('"./co-watch"','"virtual:handoff-api"').replace('"./api.js"','"virtual:handoff-base"').replace('"./BilibiliQrLogin.jsx"','"virtual:handoff-placeholder"').replace('"./TogetherMusic.jsx"','"virtual:handoff-placeholder"'); },
    resolveId(id) { if(id.startsWith('virtual:handoff-'))return '\0'+id; },
    load(id) {
      if(id==='\0virtual:handoff-api')return 'export const resolveCoWatchPage=(...args)=>globalThis.__watchHandoff(...args); export const formatMediaTime=()=>"0:00";';
      if(id==='\0virtual:handoff-base')return 'export const API_BASE_URL="https://fixture.example.test";';
      if(id==='\0virtual:handoff-placeholder')return 'export default function Placeholder(){return null;}';
    },
  }]});
  ({default:Together}=await vite.ssrLoadModule('/src/Together.jsx'));
});
after(async()=>{await unmount();await vite.close();delete globalThis.__watchHandoff;});

test('idle incoming recommendation is parsed once without starting or playing a session',async()=>{
  let starts=0;
  try { await mount({externalPageUrl:first,watchRequest:request(),onStartDirect(){starts++;}});assert.equal(requests.length,1);assert.equal(requests[0].url,first);await act(async()=>requests[0].resolve(page(first)));assert.equal(starts,0);assert.equal(tree.root.findByType('iframe').props.src,page(first).embed_url); }
  finally { await unmount(); }
});

for(const [name,extra] of [
  ['direct',{session:{id:'fictional-active',status:'active',sourceApp:'dengta-direct-media'}}],
  ['web',{session:{id:'fictional-active',status:'active',sourceApp:'dengta-web-page'}}],
  ['screen',{session:{id:'fictional-active',status:'active'},screenState:{active:true,watchTogetherEnabled:true}}],
  ['music',{session:{id:'fictional-active',status:'active',sessionMode:'listening'}}],
  ['busy',{busy:true}],
]) test(`incoming recommendation stays explicitly pending during ${name} activity`,async()=>{
  try { await mount({...extra,externalPageUrl:first,watchRequest:request()});assert.equal(requests.length,0,'the current activity must not be replaced');assert.ok(json().includes('已收到待选视频'));assert.equal(button('载入待选视频').props.disabled,true); }
  finally { await unmount(); }
});

test('ending the current activity enables explicit loading instead of losing the incoming link',async()=>{
  const incoming=request();
  try { await mount({session:{id:'fictional-active',status:'active',sourceApp:'dengta-direct-media'},externalPageUrl:first,watchRequest:incoming});await update({externalPageUrl:first,watchRequest:incoming});assert.equal(requests.length,0);assert.equal(button('载入待选视频').props.disabled,false);await act(async()=>button('载入待选视频').props.onClick());assert.equal(requests.length,1);assert.equal(requests[0].url,first); }
  finally { await unmount(); }
});

test('ignored selection stays ignored after busy clears, but a new click on the same video is accepted',async()=>{
  const incoming=request();
  try { await mount({busy:true,externalPageUrl:first,watchRequest:incoming});await act(async()=>button('忽略这条推荐').props.onClick());await update({externalPageUrl:first,watchRequest:incoming});assert.equal(requests.length,0);assert.ok(!json().includes('已收到待选视频'));await update({externalPageUrl:first,watchRequest:request()});assert.equal(requests.length,1); }
  finally { await unmount(); }
});

test('newer selection wins and an old pending button cannot load or dismiss it',async()=>{
  try { await mount({busy:true,externalPageUrl:first,watchRequest:request()});const oldLoad=button('载入待选视频').props.onClick,oldIgnore=button('忽略这条推荐').props.onClick;const newer=request(second);await update({busy:true,externalPageUrl:second,watchRequest:newer});await update({externalPageUrl:second,watchRequest:newer});await act(async()=>{oldLoad();oldIgnore();});assert.equal(requests.length,0);assert.ok(json().includes('已收到待选视频'));await act(async()=>button('载入待选视频').props.onClick());assert.equal(requests[0].url,second); }
  finally { await unmount(); }
});

test('scope change and unmount invalidate pending handlers and never auto-start activity',async()=>{
  try { await mount({busy:true,externalPageUrl:first,watchRequest:request()});const oldLoad=button('载入待选视频').props.onClick;await update({accountScope:'fictional-other'});await act(async()=>oldLoad());assert.equal(requests.length,0);assert.ok(!json().includes('已收到待选视频'));await unmount();await act(async()=>oldLoad());assert.equal(requests.length,0); }
  finally { await unmount(); }
});

test('new incoming link aborts the older parse and keeps late title out of the new page',async()=>{
  try { await mount({externalPageUrl:first,watchRequest:request()});const old=requests[0];await update({externalPageUrl:second,watchRequest:request(second)});assert.equal(old.options.signal.aborted,true);await act(async()=>old.resolve({...page(first),title:'旧虚构解析迟到'}));assert.ok(!json().includes('旧虚构解析迟到'));await act(async()=>requests[1].resolve(page(second)));assert.ok(json().includes('虚构解析结果')); }
  finally { await unmount(); }
});

test('clearing an incoming link cancels its scheduled parse and hides an existing pending card',async()=>{
  try {
    await mount();
    await act(async()=>tree.update(React.createElement(Together,{...props,externalPageUrl:first,watchRequest:request()})));
    const stale=[...timers.values()];
    await update();
    await act(async()=>{for(const callback of stale)callback();});
    assert.equal(requests.length,0);assert.ok(!json().includes('已收到待选视频'));
    await update({busy:true,externalPageUrl:first,watchRequest:request()});
    assert.ok(json().includes('已收到待选视频'));
    await update();assert.ok(!json().includes('已收到待选视频'));
  } finally {await unmount();}
});

test('switching to music cancels an incoming parse and does not leak a pending video into the music page',async()=>{
  try {
    await mount();
    const incoming=request();
    await act(async()=>tree.update(React.createElement(Together,{...props,externalPageUrl:first,watchRequest:incoming})));
    const stale=[...timers.values()];
    await update({externalPageUrl:first,watchRequest:incoming,viewKind:'music'});
    await act(async()=>{for(const callback of stale)callback();});
    assert.equal(requests.length,0);assert.ok(!json().includes('已收到待选视频'));
  } finally {await unmount();}
});

import assert from 'node:assert/strict';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { storeDirectMediaSession, readDirectMediaSession } from '../src/direct-media.js';
import { createAuthSessionManager } from '../src/auth-session.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout };
globalThis.document = { hidden: false };
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const requests = [];
globalThis.__togetherRequest = (path, options = {}) => new Promise(resolve => requests.push({ path, options, resolve }));
const healthAccount='11111111-1111-4111-8111-111111111111',healthCompanion='33333333-3333-4333-8333-333333333333';
const authRows=new Map(),authStorage={getItem:key=>authRows.get(key),setItem:(key,value)=>authRows.set(key,value),removeItem:key=>authRows.delete(key)};
const healthManager=createAuthSessionManager({supabaseUrl:'https://fictional.example.test',supabaseAnonKey:'fictional-public-placeholder',storage:authStorage,createClientFn:()=>({auth:{
  getSession:async()=>({data:{session:{access_token:'fictional-session',user:{id:healthAccount}}},error:null}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
}})});
await healthManager.initialize();healthManager.setActiveCompanionId(healthCompanion);globalThis.__togetherAuthManager=healthManager;
const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  plugins: [{ name: 'together-api-fixture', enforce: 'pre', load(id) {
    if (id.replaceAll('\\', '/').endsWith('/src/api.js')) return 'export const apiRequest = (...args) => globalThis.__togetherRequest(...args); export const apiFetch = apiRequest; export const API_BASE_URL = "http://fixture.invalid";';
  }, transform(source,id) {
    if(id.replaceAll('\\','/').endsWith('/src/auth-session.js'))return source.replace('export const authSession = createAuthSessionManager();','export const authSession = globalThis.__togetherAuthManager;');
  } }] });
let tree, healthTree;
const props = { aiName: 'Fixture', accountScope: 'test-account', companionScope: 'test-companion', screenState: {}, feedback: {}, onStopDirect: async () => ({ ok: true }) };
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
try {
  const { default: Together } = await vite.ssrLoadModule('/src/Together.jsx');
  await act(async () => { tree = TestRenderer.create(React.createElement(Together, props)); });
  const button = text => tree.root.findAllByType('button').find(node => node.children.includes(text));
  await act(async () => button('网页一起看').props.onClick());
  const url = () => tree.root.findAllByType('input').find(node => node.props.type === 'url');
  await act(async () => url().props.onChange({ target: { value: 'https://fixture.invalid/old' } }));
  await act(async () => { button('解析并载入').props.onClick(); await settle(); });
  const old = requests.find(item => item.path.includes('/page-resolve'));
  await act(async () => url().props.onChange({ target: { value: 'https://fixture.invalid/new' } }));
  await act(async () => { button('解析并载入').props.onClick(); await settle(); });
  const newer = requests.filter(item => item.path.includes('/page-resolve')).at(-1);
  assert.equal(old.options.signal.aborted, true);
  await act(async () => { newer.resolve({ page: { page_url: 'https://fixture.invalid/new', embed_url: 'https://fixture.invalid/embed', title: 'new fixture' } }); await settle(); });
  await act(async () => { old.resolve({ page: { page_url: 'https://fixture.invalid/old', embed_url: 'https://fixture.invalid/embed', title: 'old fixture' } }); await settle(); });
  assert.match([...storage.values()].join(''), /new fixture/); assert.doesNotMatch([...storage.values()].join(''), /old fixture/);
  assert.ok(storage.has('dengta_together_web_page_v2:' + JSON.stringify(['test-account', 'test-companion'])));
  assert.equal(tree.root.findByType('iframe').props.src, 'https://fixture.invalid/embed');
  await act(async () => tree.update(React.createElement(Together, { ...props, session: { id: 'fixture-session', status: 'active', sourceApp: 'dengta-web-page' } })));
  await act(async () => { button('结束本场').props.onClick(); await settle(); });
  assert.equal(storage.size, 0, 'ending the web session removes its restored page');
  await act(async () => tree.unmount());

  storeDirectMediaSession(globalThis.sessionStorage,props.accountScope,{url:'https://media.example.test/old.mp4'},props.companionScope);
  let starts=0,startResolve;
  await act(async()=>{tree=TestRenderer.create(React.createElement(Together,{...props,onStartDirect:()=>{starts++;return new Promise(resolve=>{startResolve=resolve;});}}));});
  await act(async()=>{const click=button('开始直链共看').props.onClick;void click();void click();});
  assert.equal(starts,1);assert.equal(button('载入播放器').props.disabled,true);
  assert.equal(button('网页一起看').props.disabled, true, 'pending media operation locks the mode selector');
  await act(async()=>button('网页一起看').props.onClick());
  assert.equal(button('DengTa 视频直链').props['aria-selected'], true, 'stale click handler cannot change mode before the receipt');
  await act(async()=>startResolve({ok:false,message:'测试启动失败'}));
  assert.match(JSON.stringify(tree.toJSON()),/测试启动失败/);assert.ok(readDirectMediaSession(globalThis.sessionStorage,props.accountScope,props.companionScope));
  assert.equal(button('网页一起看').props.disabled, false, 'failed start releases the mode selector');
  await act(async()=>button('网页一起看').props.onClick());
  assert.equal(button('网页一起看').props['aria-selected'], true);
  await act(async()=>tree.unmount());
  let stopped=0,stopResolve;
  const active={id:'direct-fixture',status:'active',sourceApp:'dengta-direct-media'};
  await act(async()=>{tree=TestRenderer.create(React.createElement(Together,{...props,session:active,onStopDirect:()=>{stopped++;return new Promise(resolve=>{stopResolve=resolve;});}}));});
  await act(async()=>{const click=button('结束本场').props.onClick;void click();void click();});assert.equal(stopped,1);
  await act(async()=>tree.unmount());
  storeDirectMediaSession(globalThis.sessionStorage,props.accountScope,{url:'https://media.example.test/new.mp4'},props.companionScope);
  await act(async()=>stopResolve({ok:true}));
  assert.equal(readDirectMediaSession(globalThis.sessionStorage,props.accountScope,props.companionScope).url,'https://media.example.test/new.mp4','late stop must not clear the reopened player');
  await act(async()=>{tree=TestRenderer.create(React.createElement(Together,{...props,session:active,onStopDirect:async()=>({ok:false,message:'测试结束失败'})}));});
  await act(async()=>button('结束本场').props.onClick());assert.match(JSON.stringify(tree.toJSON()),/测试结束失败/);
  assert.equal(readDirectMediaSession(globalThis.sessionStorage,props.accountScope,props.companionScope).url,'https://media.example.test/new.mp4');
  await act(async()=>tree.unmount());

  const { default: Health } = await vite.ssrLoadModule('/src/MemoryGatewayStatus.jsx');
  await act(async () => { healthTree = TestRenderer.create(React.createElement(Health)); });
  await act(async () => { const check = healthTree.root.findByType('button').props.onClick; check(); check(); await settle(); });
  const checks = requests.filter(item => item.path === '/api/v2/memory/health'); assert.equal(checks.length, 1);
  await act(async () => { checks[0].resolve({ configured:true,reachable:false,error: 'kiwi_mem_tenant_unverified',status:200 }); await settle(); });
  assert.match(JSON.stringify(healthTree.toJSON()), /X-Tenant-Id/);
  await act(async () => { healthTree.root.findByType('button').props.onClick(); await settle(); });
  const late = requests.at(-1);
  await act(async () => healthTree.unmount()); assert.equal(late.options.signal.aborted, true);
  late.resolve({ configured:true,reachable:true,tenant_verified:true,memory_enabled:true,embedding_available:true,total_memories:0 });
  console.log('Together and memory health lifecycle passed: stale resolve, cache clear, double click, unmount');
} finally { await vite.close(); healthManager.destroy();delete globalThis.__togetherRequest;delete globalThis.__togetherAuthManager; }

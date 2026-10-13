import assert from 'node:assert/strict';
import React,{act} from 'react';
import TestRenderer from 'react-test-renderer';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.window={setTimeout,clearTimeout,setInterval,clearInterval,localStorage:{getItem:()=>null}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
const accountA={accountScope:'account-a',companionScope:'companion-a'},accountB={accountScope:'account-b',companionScope:'companion-b'};
let identity=accountA, connected=true, handler=null, upload=null,browser=null,browserCalls=0,cookieReads=0;
const saved={id:'p',name:'Fixture saved',items:[{id:'track',title:'Fixture song',url:'https://media.example.test/audio.mp3'}]};
const calls=[];
globalThis.__musicUiFixture={auth:{getSnapshot:()=>({user:{id:identity.accountScope},activeCompanionId:identity.companionScope}),getRequestContext:async()=>({accessToken:'fictional',companionId:identity.companionScope})},
 request:async(path,options={})=>{
  const context=await options.authSession?.getRequestContext();calls.push({path,options,companion:context?.companionId});
  const result=handler?.(path,options);if(result!==undefined)return result;
  if(path==='/api/v2/music/playlists')return {playlists:[saved,{...saved,id:'q',name:'Second playlist'}]};
  if(path.includes('/music/playlists/'))return {playlist:saved};
  if(path.endsWith('/favorites'))return {favorites:[]};
  if(path.endsWith('/connections/manage'))return {connections:[{id:'c',name:'Fixture connection',provider_profile:'netease_cloud_music',enabled:true,auth_configured:true}]};
  if(path.endsWith('/connections/c/status'))return {status:{available:true,logged_in:true,account_name:'Fixture account'}};
  if(path.includes('/providers/netease/playlists?'))return {playlists:[]};
  if(path.endsWith('/cookie-session'))return {session:{connected,account_name:'Fixture account'}};
  throw Error('unexpected fixture request '+path);
 },fetch:async(path,options)=>{
  const context=await options.authSession?.getRequestContext();calls.push({path,options,companion:context?.companionId});return upload.promise;
 },open:()=>{browserCalls++;return browser.promise;},cookie:async()=>{cookieReads++;return {cookie:'fictional-cookie'};}};
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'music-ui-fixture',enforce:'pre',load(id){
 const normalized=id.replaceAll('\\','/');
 if(normalized.endsWith('/src/api.js'))return 'export const apiRequest=(...args)=>globalThis.__musicUiFixture.request(...args);export const apiFetch=(...args)=>globalThis.__musicUiFixture.fetch(...args);';
 if(normalized.endsWith('/src/auth-session.js'))return 'export const authSession=globalThis.__musicUiFixture.auth;';
 if(normalized.endsWith('/src/browser-launcher.js'))return 'export const browserLauncherAvailable=()=>true;export const openBuiltInBrowser=()=>globalThis.__musicUiFixture.open();export const readBrowserCookie=()=>globalThis.__musicUiFixture.cookie();';
 if(normalized.endsWith('/src/netease-playback.js'))return 'export const openNeteasePlayback=async()=>({opened:true});export const validateNeteaseResource=(resourceType,resourceId)=>({resourceType,resourceId});';
}}]});
let tree,notified=0;
const button=text=>tree.root.findAllByType('button').find(node=>node.children.includes(text));
const output=()=>JSON.stringify(tree.toJSON());
try{
 const {default:Settings}=await vite.ssrLoadModule('/src/MusicSettings.jsx'),{default:Music}=await vite.ssrLoadModule('/src/TogetherMusic.jsx');
 async function mount(Component,props={}){await act(async()=>{tree=TestRenderer.create(React.createElement(Component,{...identity,...props}));await settle();});}
 await mount(Settings);assert.match(output(),/Fixture account/,'server status object must render as text without crashing');
 const old=deferred(),newer=deferred();handler=path=>path.endsWith('/playlists/p')?old.promise:path.endsWith('/playlists/q')?newer.promise:undefined;
 const select=id=>tree.root.findAllByType('button').find(node=>node.props.className==='music-playlist-summary'&&node.children[0].children.includes(id));
 await act(async()=>{select('Fixture saved').props.onClick();await settle();});const oldRead=calls.at(-1);
 await act(async()=>{select('Second playlist').props.onClick();await settle();});assert.equal(oldRead.options.signal.aborted,true);
 await act(async()=>{newer.resolve({playlist:{...saved,id:'q',name:'New playlist detail'}});await settle();});
 await act(async()=>{old.resolve({playlist:{...saved,name:'Old playlist detail'}});await settle();});assert.match(output(),/New playlist detail/);assert.doesNotMatch(output(),/Old playlist detail/);
 await act(async()=>tree.unmount());handler=null;

 const initialLibrary=deferred();let reads=0;handler=path=>path==='/api/v2/music/playlists'?(++reads===1?initialLibrary.promise:{playlists:[{...saved,name:'Latest library'}]}):undefined;
 await mount(Settings);const oldLibrary=calls.findLast(c=>c.path==='/api/v2/music/playlists');
 await act(async()=>{button('刷新').props.onClick();await settle();});assert.equal(oldLibrary.options.signal.aborted,true);
 await act(async()=>{initialLibrary.resolve({playlists:[{...saved,name:'Stale library'}]});await settle();});assert.match(output(),/Latest library/);assert.doesNotMatch(output(),/Stale library/);
 await act(async()=>tree.unmount());handler=null;

 await mount(Settings,{compact:true,onImported:()=>notified++});const pending=deferred();handler=path=>path.endsWith('/playlists/import')?pending.promise:undefined;
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'https://media.example.test/audio.mp3'}}));
 const before=calls.filter(c=>c.path.endsWith('/playlists/import')).length;
 await act(async()=>{const click=button('导入歌单').props.onClick;click();click();await settle();});assert.equal(calls.filter(c=>c.path.endsWith('/playlists/import')).length,before+1);
 const oldImport=calls.at(-1);identity=accountB;
 await act(async()=>{tree.update(React.createElement(Settings,{...identity,key:'new-scope',compact:true,onImported:()=>notified++}));await settle();});assert.equal(oldImport.options.signal.aborted,true);
 await act(async()=>{pending.resolve({playlist:{...saved,name:'Old private playlist'}});await settle();});assert.equal(notified,0);assert.doesNotMatch(output(),/Old private playlist/);
 await act(async()=>tree.unmount());identity=accountA;handler=null;

 await mount(Settings,{compact:true});upload=deferred();const input=tree.root.findAllByType('label').find(node=>node.children.some(child=>typeof child==='string'&&child.startsWith('上传本机音频'))).findByType('input');
 const control={files:[new File(['fixture'],'fixture.mp3',{type:'audio/mpeg'})],value:'fixture'};const importsBefore=calls.filter(c=>c.path.endsWith('/playlists/import')).length;
 await act(async()=>{input.props.onChange({currentTarget:control});await settle();});const uploading=calls.at(-1);
 await act(async()=>tree.unmount());assert.equal(uploading.options.signal.aborted,true);
 await act(async()=>{upload.resolve(new Response(JSON.stringify({audio:{url:'https://media.example.test/audio.mp3',title:'Fixture'}})));await settle();});assert.equal(calls.filter(c=>c.path.endsWith('/playlists/import')).length,importsBefore,'closed upload cannot continue creating playlist');

 connected=true;await mount(Music);const disconnect=deferred();handler=(path,options)=>path.endsWith('/cookie-session')&&options.method==='DELETE'?disconnect.promise:undefined;
 await act(async()=>{const click=button('断开').props.onClick;click();click();await settle();});assert.equal(calls.filter(c=>c.path.endsWith('/cookie-session')&&c.options.method==='DELETE').length,1);
 await act(async()=>{disconnect.reject(Object.assign(Error('fixture disconnect failed'),{code:'fixture_disconnect_failed',status:503}));await settle();});assert.match(output(),/已连接：Fixture account/);assert.match(output(),/fixture_disconnect_failed/);assert.match(output(),/503/);assert.ok(button('断开'));
 handler=(path,options)=>path.endsWith('/cookie-session')&&options.method==='DELETE'?{session:{connected:false}}:undefined;
 await act(async()=>{button('断开').props.onClick();await settle();});assert.ok(button('内置浏览器登录'));await act(async()=>tree.unmount());

 connected=false;handler=null;browser=deferred();await mount(Music);const savesBefore=calls.filter(c=>c.path.endsWith('/cookie-session')&&c.options.method==='POST').length;
 await act(async()=>{const click=button('内置浏览器登录').props.onClick;click();click();});assert.equal(browserCalls,1);
 identity=accountB;await act(async()=>tree.unmount());await act(async()=>{browser.resolve({ok:true});await settle();});assert.equal(cookieReads,0,'cancelled native login must not extract old cookie');assert.equal(calls.filter(c=>c.path.endsWith('/cookie-session')&&c.options.method==='POST').length,savesBefore);
 identity=accountA;connected=false;browser=deferred();const initialCookie=deferred();
 handler=(path,options)=>path.endsWith('/cookie-session')?(options.method==='POST'?{session:{connected:true,account_name:'New login'}}:initialCookie.promise):undefined;
 await mount(Music);const checking=calls.findLast(c=>c.path.endsWith('/cookie-session')&&!c.options.method);
 await act(async()=>{button('内置浏览器登录').props.onClick();await settle();});assert.equal(checking.options.signal.aborted,true,'login replaces the pending initial state read');
 await act(async()=>{browser.resolve({ok:true});await settle();});assert.match(output(),/已连接：New login/);
 await act(async()=>{initialCookie.resolve({session:{connected:false}});await settle();});assert.match(output(),/已连接：New login/,'late initial state cannot undo a confirmed login');
 await act(async()=>tree.unmount());
 console.log('Music UI: nested provider status, latest playlist, scoped import, duplicate actions, upload cancellation, honest disconnect failure/retry, cancelled native login and stale login check passed');
}finally{await vite.close();delete globalThis.__musicUiFixture;}

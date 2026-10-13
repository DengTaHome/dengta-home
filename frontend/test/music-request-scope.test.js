import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createMusicRequestScope } from '../src/music-request-scope.js';
import { musicErrorMessage, runMusicTask } from '../src/music-operation-feedback.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
let snapshot={user:{id:'account-a'},activeCompanionId:'companion-a'};
const auth={getSnapshot:()=>snapshot,getRequestContext:async()=>({accessToken:'fictional-token',companionId:snapshot.activeCompanionId})};
const identity=()=>({accountScope:snapshot.user.id,companionScope:snapshot.activeCompanionId});
{
 const scope=createMusicRequestScope(auth);scope.bind(identity());let calls=0,applied=0;const d=deferred();
 const first=runMusicTask(scope,'write',()=>{calls++;return d.promise;},{onSuccess:()=>applied++});
 assert.equal((await runMusicTask(scope,'write',()=>{calls++;})).cancelled,true);assert.equal(calls,1);
 const oldOptions=scope.capture().options;snapshot={user:{id:'account-b'},activeCompanionId:'companion-b'};scope.bind(identity());assert.equal(oldOptions.signal.aborted,true);
 const next=deferred(),second=runMusicTask(scope,'write',()=>next.promise);d.resolve('old');await first;assert.equal(applied,0);assert.equal(scope.busy('write'),true,'old finally cannot unlock new work');next.resolve('new');await second;assert.equal(scope.busy('write'),false);
 const old=scope.begin('read'),newer=scope.begin('read',{replace:true});assert.equal(old.options.signal.aborted,true);assert.equal(scope.current(old),false);assert.equal(scope.current(newer),true);scope.finish(old);assert.equal(scope.busy('read'),true);scope.cancelKey('read');assert.equal(scope.busy('read'),false);
 const cancelled=scope.begin('upload');scope.invalidate();assert.equal(cancelled.options.signal.aborted,true);assert.equal(scope.current(cancelled),false);
}
snapshot={user:{id:'account-a'},activeCompanionId:'companion-a'};
let handler=null;const calls=[];
globalThis.__musicScopeFixture={auth,request:async(path,options)=>{
 const context=await options.authSession?.getRequestContext();calls.push({path,options,companion:context?.companionId});
 if(handler)return handler(path,options);
 if(path.endsWith('/cookie-session'))return {session:{connected:options.method==='POST'}};
 if(path.endsWith('/connections/provision'))return {connection:{id:'connection-a',name:'Fixture'}};
 if(path.endsWith('/status'))return {status:{logged_in:true,account_name:'Fixture account'}};
 if(path.endsWith('/ai-play-requests?delivery=claim-v1'))return {requests:[],delivery_protocol:'claim-v1'};
 if(path.endsWith('/claim'))return {claimed:true,committed:false,request:{id:'fixture-request'}};
 if(path.endsWith('/commit'))return {ok:true,committed:true,replayed:false,request:{id:'fixture-request'}};
 if(path.includes('/ai-play-requests/'))return {ok:true};
 if(path.includes('/favorites/'))return {favorite:{item_id:'track-a'},deleted:{item_id:'track-a'}};
 return {playlist:{id:'playlist-a',name:'Fixture',items:[]},playlists:[],items:[],favorites:[]};
},fetch:async(path,options)=>{
 const context=await options.authSession?.getRequestContext();calls.push({path,options,companion:context?.companionId});
 return new Response(JSON.stringify({audio:{url:'https://media.example.test/audio.mp3',title:'Fixture'}}));
}};
const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true},plugins:[{name:'music-scope-fixture',enforce:'pre',load(id){
 const normalized=id.replaceAll('\\','/');
 if(normalized.endsWith('/src/api.js'))return 'export const apiRequest=(...args)=>globalThis.__musicScopeFixture.request(...args);export const apiFetch=(...args)=>globalThis.__musicScopeFixture.fetch(...args);';
 if(normalized.endsWith('/src/auth-session.js'))return 'export const authSession=globalThis.__musicScopeFixture.auth;';
}}]});
try{
 const api=await vite.ssrLoadModule('/src/music-listening.js');const controller=new AbortController(),options={...identity(),signal:controller.signal};
 const operations=[['listNeteaseConnections',[]],['connectNeteaseMcp',[{name:'Fixture',endpoint:'https://mcp.example.test'}]],['getNeteaseConnectionStatus',['connection-a']],['listNeteasePlaylists',['connection-a']],['getNeteasePlaylist',['connection-a','1']],['searchNeteaseMusic',['connection-a','Fixture']],['importNeteaseShare',['connection-a','https://music.163.com/#/song?id=1']],['readNeteaseCookieSession',[]],['saveNeteaseCookieSession',['fictional-cookie']],['clearNeteaseCookieSession',[]],['requestExternalMusicPlayback',['song','1']],['cookieSearchNetease',['Fixture',10]],['cookieGetMyPlaylists',[]],['cookieGetPlaylistTracks',['1']],['cookieGetDailyRecommend',[]],['cookieGetPlayHistory',[20]],['cookieLikeSong',['1',true]],['cookieCreatePlaylist',['Fixture',false]],['cookieAddToPlaylist',['1',['2']]],['cookieRemoveFromPlaylist',['1',['2']]],['importMusicPlaylist',[{content:'https://media.example.test/audio.mp3'}]],['uploadLocalMusicFile',[new File(['fixture'],'fixture.mp3',{type:'audio/mpeg'})]],['listMusicPlaylists',[]],['getMusicPlaylist',['playlist-a']],['deleteMusicPlaylist',['playlist-a']],['listMusicFavorites',[]],['putMusicFavorite',['track-a']],['deleteMusicFavorite',['track-a']]];
 for(const [name,args]of operations)await api[name](...args,options);
 await api.claimAiMusicPlayRequest('fixture-request','fixture-token',options);await api.commitAiMusicPlayRequest('fixture-request','fixture-token',options);await api.listAiMusicPlayRequests(options);await api.reportAiMusicPlayResult('fixture-request',{status:'played'},options);
 assert.equal(calls.length,32);assert.ok(calls.every(c=>c.options.signal===controller.signal&&c.options.authSession&&c.companion==='companion-a'));
 assert.equal((await api.getNeteaseConnectionStatus('connection-a',options)).account_name,'Fixture account','unwrap server status envelope');
 const pending=deferred();handler=()=>pending.promise;const old=api.listMusicFavorites();await new Promise(resolve=>setTimeout(resolve,0));snapshot={user:{id:'account-b'},activeCompanionId:'companion-b'};pending.resolve({favorites:[{item_id:'old-private-item'}]});await assert.rejects(old,{code:'music_scope_changed'});
 const count=calls.length;await assert.rejects(api.putMusicFavorite('track-a',options),{code:'music_scope_changed'});assert.equal(calls.length,count,'stale writes cannot dispatch');
 snapshot={user:{id:'account-a'},activeCompanionId:'companion-a'};handler=async()=>({});
 await assert.rejects(api.importNeteaseShare('', 'https://music.163.com/#/song?id=1',options),{code:'music_import_receipt_invalid'});
 await assert.rejects(api.clearNeteaseCookieSession(options),{code:'music_cookie_receipt_invalid'});
 await assert.rejects(api.connectNeteaseMcp({},options),{code:'music_connection_receipt_invalid'});
 await assert.rejects(api.listAiMusicPlayRequests(options),{code:'music_ai_delivery_protocol_required'});
 await assert.rejects(api.reportAiMusicPlayResult('fixture-request',{status:'played'},options),{code:'music_ai_result_receipt_invalid'});
 await assert.rejects(api.claimAiMusicPlayRequest('fixture-request','fixture-token',options),{code:'music_ai_delivery_receipt_invalid'});
 await assert.rejects(api.commitAiMusicPlayRequest('fixture-request','fixture-token',options),{code:'music_ai_delivery_receipt_invalid'});
 handler=async()=>({requests:null,delivery_protocol:'claim-v1'});await assert.rejects(api.listAiMusicPlayRequests(options),{code:'music_ai_requests_receipt_invalid'});
 controller.abort();await assert.rejects(api.deleteMusicFavorite('track-a',options),{name:'AbortError'});
 const message=musicErrorMessage({message:'Authorization: Bearer fictional-secret-token-000000',code:'fixture_failure',status:502,error_log_id:'fixture-log'},'连接失败，请重试。');
 assert.doesNotMatch(message,/fictional-secret|Authorization|Bearer/);assert.match(message,/fixture_failure/);assert.match(message,/502/);assert.match(message,/Logged|日志/);
 assert.doesNotMatch(message,/Source: dengta/,'an unknown error source must not be attributed to DengTa');
 assert.match(musicErrorMessage({message:'保存回执缺失',code:'music_import_receipt_invalid'},'请刷新。'),/music_import_receipt_invalid/,'local receipt errors must show their code without HTTP metadata');
 assert.equal((musicErrorMessage({message,code:'fixture_failure',status:502},'请刷新。').match(/错误代码 \/ Code:/g)||[]).length,1,'already formatted errors must not repeat the diagnostic');
 console.log('Music scope: all 32 exported API methods, fixed authentication, cancelled/stale writes, status unwrap, exact receipts, task locks and redacted diagnostics passed');
}finally{await vite.close();delete globalThis.__musicScopeFixture;}

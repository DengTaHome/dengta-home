import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { createMusicQueueRequests } from '../src/music-queue-requests.js';
import { createMusicPlaybackSync } from '../src/music-playback-sync.js';
import { createNowPlayingSync } from '../src/music-now-playing-sync.js';
import { createCoWatchLifecycle } from '../src/co-watch-lifecycle.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const identity = {accountScope:'account-a',companionScope:'companion-a'};
const queue = (sessionId='s',revision=0) => ({sessionId,revision,items:[]});
const conflict = code => Object.assign(Error('fixture conflict'),{status:409,code});
{
 let scope=identity, attempts=0, id=0; const applied=[], busy=[], calls=[];
 const controller=createMusicQueueRequests({getIdentity:()=>scope,onBusy:v=>busy.push(v),onQueue:q=>applied.push(q),idFactory:()=>`request-${++id}`,
  readQueue:async(s,options)=>{calls.push(options);return queue(s,attempts);},applyOperation:async(s,input,options)=>{calls.push(options);applied.push(input);if(++attempts===1)throw Error('network');return {queue:queue(s,2)};}});
 controller.bind('s'); const operation={type:'replace',item_ids:['track']};
 await assert.rejects(controller.operate(operation)); await controller.operate({type:'set_mode'}); await controller.operate(operation);
 const mutations=applied.filter(v=>v.requestId); assert.equal(mutations[0].requestId,mutations[2].requestId);assert.equal(id,2);assert.equal(busy.at(-1),false);
 assert.ok(calls.every(o=>o.accountScope===identity.accountScope&&o.companionScope===identity.companionScope));
 scope={...identity,companionScope:'b'};
 const p=controller.operate(operation);scope={...identity,companionScope:'c'};
 await assert.rejects(p,{code:'music_queue_scope_changed'});assert.equal(busy.at(-1),false,'a stale job still releases its own lock');
}
{
 const reads=[],mutations=[], busy=[],applied=[];let id=0;
 const controller=createMusicQueueRequests({getIdentity:()=>identity,onBusy:v=>busy.push(v),onQueue:q=>applied.push(q),idFactory:()=>`id-${++id}`,
  readQueue:(s,options)=>{const d=deferred();reads.push({s,options,...d});return d.promise;},applyOperation:async(s,input)=>{mutations.push(input);if(mutations.length===1)throw conflict('music_queue_revision_conflict');return {queue:queue(s,3)};}});
 controller.bind('s');const p=controller.operate({type:'advance'},{retryConflict:true});await flush();reads[0].resolve(queue('s',1));await flush();reads[1].resolve(queue('s',2));await p;
 assert.deepEqual(mutations.map(v=>v.expectedRevision),[1,2]);assert.equal(mutations[0].requestId,mutations[1].requestId);assert.equal(id,1);
 const old=controller.operate({type:'advance'});await flush();const rejectOld=assert.rejects(old,{code:'music_queue_scope_changed'});
 controller.bind('new');assert.equal(reads[2].options.signal.aborted,true);
 const next=controller.operate({type:'set_mode'});await flush();const applyCount=applied.length;reads[2].resolve(queue('s',3));await rejectOld;assert.equal(busy.at(-1),true,'old finish cannot unlock new session');assert.equal(applied.length,applyCount,'stale queue is not applied');
 reads[3].resolve(queue('new',1));await next;assert.equal(busy.at(-1),false);
 const late=controller.operate({type:'advance'});const rejectLate=assert.rejects(late,{code:'music_queue_scope_changed'});controller.invalidate();await rejectLate;assert.equal(reads.length,4,'unmounted queued work never reaches API');
}
{
 const controller=createMusicQueueRequests({getIdentity:()=>identity,onBusy:()=>{},onQueue:()=>{},readQueue:async()=>queue('wrong'),applyOperation:()=>{throw Error('must not mutate');}});
 controller.bind('s');await assert.rejects(controller.operate({type:'advance'}),{code:'music_queue_receipt_invalid'});
}
function playbackFixture(){
 let scope=identity, session={id:'s',status:'active',sessionMode:'listening',revision:0,musicPlaylistId:'p'};
 const calls=[],errors=[],applied=[];
 const capture=()=>JSON.stringify(scope),current=s=>s===capture();
 const helper=createMusicPlaybackSync({getIdentity:()=>scope,getSession:()=>session,capture,current,onError:e=>errors.push(e),onApplied:s=>{session=s;applied.push(s);},
  patchPlayback:(id,input,options)=>{const d=deferred();calls.push({id,input,options,...d});return d.promise;},readSession:async()=>({...session,revision:4})});
 return {helper,calls,errors,applied,capture,current,getSession:()=>session,setSession:s=>{session=s;},setScope:s=>{scope=s;}};
}
{
 const f=playbackFixture();const p=f.helper.submit({sessionId:'s',mediaPositionSeconds:1});f.helper.submit({sessionId:'s',mediaPositionSeconds:2});f.helper.submit({sessionId:'s',mediaPositionSeconds:3});
 f.calls[0].resolve({...f.getSession(),revision:1});await flush();assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.mediaPositionSeconds,3);assert.equal(f.calls[1].input.revision,1);
 f.calls[1].resolve({...f.getSession(),revision:2});assert.equal(await p,true);
 const old=f.helper.submit({sessionId:'s'});f.setScope({...identity,companionScope:'b'});f.helper.invalidate();assert.equal(f.calls[2].options.signal.aborted,true);
 const next=f.helper.submit({sessionId:'s'});f.calls[2].resolve({...f.getSession(),revision:50});assert.equal(await old,false);assert.equal(f.applied.length,2);
 f.calls[3].resolve({...f.getSession(),revision:3});assert.equal(await next,true);
 assert.equal(await f.helper.submit({sessionId:'s',companionScope:'a'}),false);
}
{
 const f=playbackFixture(),p=f.helper.submit({sessionId:'s',mediaPositionSeconds:8});f.calls[0].reject(conflict('co_watch_playback_revision_conflict'));await flush();assert.equal(f.calls[1].input.revision,4);
 f.calls[1].reject(conflict('co_watch_playback_revision_conflict'));await p;assert.equal(f.calls.length,2);assert.equal(f.errors.length,1,'only one conflict retry');
 const bad=f.helper.submit({sessionId:'s'});f.calls[2].resolve({...f.getSession(),id:'wrong'});await bad;assert.equal(f.errors.at(-1).code,'music_playback_receipt_invalid');
}
{
 const f=playbackFixture(),reads=[],submits=[];let unmatched=0;
 const helper=createNowPlayingSync({getIdentity:()=>identity,getSession:f.getSession,capture:f.capture,current:f.current,onUnmatched:()=>unmatched++,submit:async s=>{submits.push(s);return true;},readPlaylist:(id,options)=>{const d=deferred();reads.push({id,options,...d});return d.promise;}});
 const song={title:'Fixture Song',artist:'Artist'};const p=helper.sync(song);reads[0].resolve({id:'p',items:[{id:'actual-id',title:song.title,artist:song.artist}]});assert.equal(await p,true);assert.equal(submits[0].musicPlaylistItemId,'actual-id');
 const missing=helper.sync({title:'missing'});reads[1].resolve({id:'p',items:[]});assert.equal(await missing,false);assert.equal(submits.length,1);assert.equal(unmatched,1);
 const ambiguous=helper.sync(song);reads[2].resolve({id:'p',items:[{id:'1',...song},{id:'2',...song}]});await ambiguous;assert.equal(submits.length,1);assert.equal(unmatched,2);
 const stale=helper.sync(song);f.setSession({...f.getSession(),musicPlaylistId:'new'});reads[3].resolve({id:'p',items:[{id:'old',...song}]});assert.equal(await stale,false);assert.equal(submits.length,1);
 const cancelled=helper.sync(song);helper.invalidate();assert.equal(reads[4].options.signal.aborted,true);reads[4].resolve({id:'new',items:[{id:'late',...song}]});assert.equal(await cancelled,false);
}
{
 let session={id:'music',status:'active',sessionMode:'listening'},ends=0;
 const helper=createCoWatchLifecycle({getIdentity:()=>identity,getSession:()=>session,isBusy:()=>false,onBusy:()=>{},createSession:()=>{throw Error('duplicate start');},endSession:async()=>{ends++;return {...session,status:'ended'};},onStarted:s=>{session=s;},onEnded:()=>{session=null;}});
 assert.equal((await helper.start({sessionMode:'listening',reuseActiveMode:true})).session.id,'music');
 assert.equal((await helper.stop({sessionMode:'screen'})).code,'co_watch_active_conflict');assert.equal(ends,0);
 assert.equal((await helper.stop({sessionMode:'listening'})).ok,true);assert.equal(ends,1);
}
console.log('Music lifecycle: stable retry IDs, queue conflict recovery, scope cancellation, owner locks, latest playback, receipt validation and exact native-song matching passed');

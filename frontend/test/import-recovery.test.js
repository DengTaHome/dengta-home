import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { importCheckpointKey, readImportCheckpoint, saveImportCheckpoint, clearImportCheckpoint, importCommitReceipt } from '../src/import-checkpoint.js';
import { fingerprintImportFile } from '../src/import-file-fingerprint.js';
import { createImportRequestClient } from '../src/import-request-scope.js';
import { importAttemptPrefix, readImportAttempts, saveImportAttempt, clearImportAttempt } from '../src/import-attempt-receipt.js';

test('small import attempts retain only technical metadata and isolate each account, companion and receipt',()=>{
  const values=new Map(),store={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const prefix=importAttemptPrefix('receipt-account','receipt-companion');
  const row={version:1,importId:'small-1',kind:'world_book',startedAt:123,content:'private',filename:'private',decisions:['private'],token:'private'};
  assert.equal(saveImportAttempt(prefix,row,store),true);
  assert.equal(saveImportAttempt(prefix,{...row,importId:'small-2',startedAt:124},store),true);
  assert.equal([...values.values()].join('').includes('private'),false);
  values.set(prefix+'corrupt','{');
  values.set(prefix+'mismatched',JSON.stringify({...row,importId:'other-id'}));
  assert.deepEqual(readImportAttempts(prefix,store).map(x=>x.importId),['small-1','small-2']);
  assert.deepEqual(readImportAttempts(importAttemptPrefix('other-account','receipt-companion'),store),[]);
  assert.deepEqual(readImportAttempts(importAttemptPrefix('receipt-account','other-companion'),store),[]);
  assert.equal(clearImportAttempt(prefix,'small-1',store),true);
  assert.deepEqual(readImportAttempts(prefix,store).map(x=>x.importId),['small-2']);
  assert.equal(clearImportAttempt(prefix,'small-2',store),true);
  assert.notEqual(importAttemptPrefix('a.b','c'),importAttemptPrefix('a','b.c'));
  saveImportAttempt(prefix,row,store);
  values.delete(prefix+row.importId);
  assert.deepEqual(readImportAttempts(prefix,store),[],'another tab clearing a confirmed receipt removes it from the next read');
  assert.equal(saveImportAttempt(prefix,{...row,importId:'bad.id'},store),false);
  assert.equal(saveImportAttempt(null,row,store),false);
});

test('blocked storage preserves uncertain small import IDs across same-tab remounts',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked');}});
  const prefix=importAttemptPrefix('blocked-attempt-account','companion');
  const row={version:1,importId:'blocked-attempt',kind:'chat_history',startedAt:456};
  try {
    assert.equal(saveImportAttempt(prefix,row),false);
    assert.deepEqual(readImportAttempts(prefix),[row]);
    assert.equal(clearImportAttempt(prefix,row.importId),false);
    assert.deepEqual(readImportAttempts(prefix),[]);
  } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});

function storage() { const values=new Map();return {values,getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}; }
const digest='a'.repeat(64);
test('checkpoint isolates account, companion and import type and stores only byte receipt metadata',()=>{
  const store=storage(),key=importCheckpointKey('account','companion','world_book',digest);
  assert.notEqual(key,importCheckpointKey('other','companion','world_book',digest));
  assert.notEqual(key,importCheckpointKey('account','other','world_book',digest));
  assert.notEqual(key,importCheckpointKey('account','companion','chat_history',digest));
  assert.equal(importCheckpointKey('','','world_book',digest),null);
  const pending={importId:'preview-1',startByte:12,endByte:90,commitAttempted:true};
  assert.equal(saveImportCheckpoint(key,{version:1,totalBytes:100,nextByte:12,pending,content:'private',filename:'private',token:'private'},store),true);
  assert.equal([...store.values.values()].join('').includes('private'),false);
  assert.deepEqual(readImportCheckpoint(key,100,store),{version:1,totalBytes:100,nextByte:12,pending});
  assert.equal(readImportCheckpoint(key,101,store),null);
  assert.equal(clearImportCheckpoint(key,store),true);
  assert.equal(readImportCheckpoint(key,100,store),null);
});
test('malformed offsets, corrupt storage and unavailable storage do not restore a checkpoint',()=>{
  const store=storage(),key='key';
  for(const record of [{version:1,totalBytes:100,nextByte:101},{version:1,totalBytes:100,nextByte:0,pending:{importId:'x',startByte:1,endByte:2}},{version:1,totalBytes:1024**3+1,nextByte:0}]) assert.equal(saveImportCheckpoint(key,record,store),false);
  store.setItem(key,'not JSON');assert.equal(readImportCheckpoint(key,100,store),null);
  const broken={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
  assert.equal(readImportCheckpoint(key,100,broken),null);
  assert.equal(saveImportCheckpoint(key,{version:1,totalBytes:100,nextByte:0},broken),false);
});
test('commit must have a matching completed receipt rather than just HTTP success',()=>{
  const valid={result:{import:{id:'x',status:'committed'},accepted_count:2}};
  assert.equal(importCommitReceipt(valid,'x'),valid.result);
  for(const data of [{ok:true},{result:{import:{id:'other',status:'committed'}}},{import:{id:'x',status:'preview'}}]) assert.throws(()=>importCommitReceipt(data,'x'),{code:'import_commit_receipt_invalid'});
});
test('blocked localStorage getter falls back to a usable in-memory operation',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('blocked');}});
  try {
    assert.equal(readImportCheckpoint('key',100),null);
    assert.equal(saveImportCheckpoint('key',{version:1,totalBytes:100,nextByte:0}),false);
    assert.equal(clearImportCheckpoint('key'),false);
  } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
test('whole-file fingerprint detects middle changes, uses bounded slices and reports completion',async()=>{
  const bytes=Buffer.alloc(3*1024*1024+9,65),sizes=[],progress=[];
  const file=new File([bytes],'synthetic.txt');
  const tracked={name:file.name,size:file.size,slice:(start,end)=>{sizes.push(end-start);return file.slice(start,end);}};
  assert.equal(await fingerprintImportFile(tracked,{onProgress:p=>progress.push(p)}),createHash('sha256').update(bytes).digest('hex'));
  assert.equal(Math.max(...sizes),1024*1024);
  assert.equal(progress.at(-1).readBytes,bytes.length);
  bytes[1024*1024+2]=66;
  assert.notEqual(await fingerprintImportFile(new File([bytes],'synthetic.txt')),await fingerprintImportFile(file));
});
test('file identity check rejects disguised binary and stops after cancellation',async()=>{
  await assert.rejects(fingerprintImportFile(new File(['PKfake'],'fake.txt')),{code:'import_binary_disguised'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(fingerprintImportFile(new File(['text'],'small.txt'),{signal:controller.signal}),{name:'AbortError'});
  const later=new AbortController();let reads=0;
  const file=new File(['a'.repeat(2*1024*1024)],'synthetic.txt');
  const tracked={name:file.name,size:file.size,slice:(s,e)=>{reads++;if(reads===2)later.abort();return file.slice(s,e);}};
  await assert.rejects(fingerprintImportFile(tracked,{signal:later.signal}),{name:'AbortError'});
  assert.equal(reads,2);
});
test('auth refresh cannot dispatch to a different companion and stale 401 cannot invalidate a new account',async()=>{
  let snapshot={user:{id:'a'},activeCompanionId:'c'},sent=0,invalidations=0,captures=0,release;
  const auth={getSnapshot:()=>snapshot,getRequestContext:()=>new Promise(r=>{release=r;}),invalidateSession:()=>invalidations++,captureCompanionFromResponse:()=>captures++};
  const client={apiRequest:async(path,options)=>{await options.authSession.getRequestContext();sent++;return{};}};
  const scoped=createImportRequestClient({accountScope:'a',companionScope:'c',auth,client});
  const request=scoped.apiRequest('/preview');snapshot={user:{id:'a'},activeCompanionId:'d'};release({companionId:'d'});
  await assert.rejects(request,{code:'import_scope_changed'});assert.equal(sent,0);
  snapshot={user:{id:'a'},activeCompanionId:'c'};
  client.apiRequest=async(path,options)=>{snapshot={user:{id:'b'},activeCompanionId:'c'};options.authSession.invalidateSession();options.authSession.captureCompanionFromResponse({});return{};};
  await assert.rejects(scoped.apiRequest('/commit'),{code:'import_scope_changed'});
  assert.equal(invalidations,0);assert.equal(captures,0);
});

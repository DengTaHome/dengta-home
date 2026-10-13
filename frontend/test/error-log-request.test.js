import assert from 'node:assert/strict';
import {requestErrorLog} from '../src/error-log-request.js';
let requestedPath;
assert.deepEqual(await requestErrorLog(42,async(path,options)=>{requestedPath=path;assert.equal(options.retry,false);return {log:{id:42}};}),{id:42});assert.equal(requestedPath,'/api/errors/42');
for(const stage of ['authentication','body']){
 let signal;
 await assert.rejects(requestErrorLog(42,async(_,options)=>{signal=options.signal;if(stage==='body')await Promise.resolve();return new Promise(()=>{});},5),{code:'request_timeout'});
 assert.equal(signal.aborted,true,stage+' waits must release the UI and abort the request');
}
const failure=Object.assign(new Error('not found'),{status:404});await assert.rejects(requestErrorLog(42,async()=>{throw failure;},50),{status:404});
console.log('Log numeric ID, end-to-end deadline, cancellation and HTTP failure propagation passed');

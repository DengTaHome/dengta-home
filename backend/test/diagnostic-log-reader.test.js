const assert = require('node:assert/strict');
const { diagnosticLogId, readDiagnosticLog } = require('../services/diagnostic-log-reader');
const { createTenantDatabase } = require('../services/request-scope');
const userId='11111111-1111-4111-8111-111111111111', companionId='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333';
const oldId='44444444-4444-4444-8444-444444444444';
const rows=[{id:'42',user_id:userId,companion_id:companionId,error_code:'request_timeout',message:'private text'}, {id:oldId,user_id:userId,companion_id:companionId}];
let queries=0;
const adminSupabase={from(table){assert.equal(table,'chat_error_logs');queries++;const where={};const builder={select(){return builder;},eq(k,v){where[k]=v;return builder;},async maybeSingle(){return {data:rows.find(row=>Object.entries(where).every(([k,v])=>row[k]===v))||null,error:null};}};return builder;}};
(async()=>{
 for(const input of [42,'42','9223372036854775807',oldId])assert.equal(diagnosticLogId(input),String(input));
 for(const input of ['0','-1','1e3','42 or 1=1','9223372036854775808','12/34','',null])assert.equal(diagnosticLogId(input),null);
 const db=createTenantDatabase({adminSupabase,tenant:{userId,companionId}});
 assert.equal((await readDiagnosticLog(db,42)).id,'42');assert.equal((await readDiagnosticLog(db,oldId)).id,oldId);
 assert.ok(!JSON.stringify(await readDiagnosticLog(db,42)).includes('private text'));
 await assert.rejects(readDiagnosticLog(createTenantDatabase({adminSupabase,tenant:{userId:other,companionId}}),'42'),{status:404});
 await assert.rejects(readDiagnosticLog(createTenantDatabase({adminSupabase,tenant:{userId,companionId:other}}),'42'),{status:404});
 const before=queries;await assert.rejects(readDiagnosticLog(db,'42/secret'),{status:400});assert.equal(queries,before);
 console.log('Numeric/UUID log reads, validation, redaction and cross-account/companion isolation passed');
})().catch(e=>{console.error(e);process.exitCode=1});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { memoryImportFeedback } = require('../services/memory-import-feedback');
const fs = require('node:fs');
const vm = require('node:vm');
test('gateway HTTP, disabled and ambiguous failures have stable safe causes',()=>{
  for (const [upstream,code] of [[401,'auth_failed'],[403,'auth_failed'],[404,'endpoint_not_found'],[413,'file_too_large'],[429,'rate_limited'],[400,'unreadable']]) {
    const result=memoryImportFeedback({ok:false,status:upstream,data:{error:'private-token-fixture'}});
    assert.equal(result.body.code,'memory_import_'+code); assert.equal(result.body.upstream_status,upstream);
    assert.doesNotMatch(JSON.stringify(result),/private-token-fixture/);
  }
  assert.equal(memoryImportFeedback({ok:true,data:{ok:false,error:'memory_disabled'}}).body.code,'memory_import_disabled');
  assert.match(memoryImportFeedback({ok:false,error:'timeout'}).body.message,/核对|查看/);
  assert.equal(memoryImportFeedback({ok:true,data:{ok:false}}).status,502);
});
test('successful gateway import reports actual coverage limits',()=>{
  const result=memoryImportFeedback({ok:true,data:{ok:true,mode:'ai',imported:2}});
  assert.equal(result.status,200); assert.equal(result.body.imported,2); assert.match(result.body.coverage_notice,/3 万字/);
});
test('new tenant receipts and HTTP-200 logical failures have actionable import feedback', () => {
  for (const [error, code, status] of [['kiwi_mem_tenant_required','memory_import_scope_missing',409], ['kiwi_mem_tenant_unverified','memory_import_scope_unverified',502], ['kiwi_mem_memory_disabled','memory_import_disabled',503], ['kiwi_mem_network_error','memory_import_network_error',502]]) {
    const result = memoryImportFeedback({ok:false,status:200,error});
    assert.equal(result.status,status); assert.equal(result.body.code,code); assert.equal(result.body.ok,false);
    assert.equal(result.body.error_source, error === 'kiwi_mem_tenant_required' ? 'dengta' : 'external_memory_gateway');
  }
});
test('JSON import route shares precise logged error handling and never treats logical failure as success', async () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const start = source.indexOf('app.post("/api/v2/memory/import",');
  const end = source.indexOf('app.post("/api/v2/memory/import-history",', start);
  for (const result of [{ok:false,status:200,error:'kiwi_mem_tenant_unverified'}, {ok:false,status:401,error:'kiwi_mem_http_401'}, {ok:true,status:200,data:{ok:true,imported:2}}]) {
    let handler, received, failure, response;
    vm.runInNewContext(source.slice(start,end), { app:{post(_path,fn){handler=fn;}},
      requireRequestScope: () => ({userId:'fixture-a',companionId:'fixture-b'}),
      importMemories: async input => {received=input; return result;},
      require: name => {assert.equal(name,'./services/memory-import-feedback'); return {memoryImportFeedback};} });
    await handler({body:{memories:[{content:'synthetic fixture'}]}}, {json:value=>{response=value;}}, error=>{failure=error;});
    assert.equal(received.tenant.userId,'fixture-a'); assert.equal(received.tenant.companionId,'fixture-b');
    if (result.ok) {assert.equal(response.imported,2); assert.equal(failure,undefined);}
    else {assert.equal(response,undefined); assert.equal(failure.status,502); assert.equal(failure.errorSource,'external_memory_gateway'); assert.ok(failure.code.startsWith('memory_import_'));}
  }
});

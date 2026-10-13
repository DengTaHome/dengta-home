const assert = require('node:assert/strict');
const { streamFailure } = require('../services/chat-stream-contract');
const { diagnosticRecord, publicDiagnosticLog } = require('../services/diagnostic-errors');
const { providerErrorReason } = require('../services/provider-error-reason');
const cases = [
 ['insufficient_balance',429,'', 'provider_balance_insufficient','余额不足'],
 ['insufficient_quota',429,'', 'provider_quota_exhausted','额度'],
 ['',400,'Your credit balance is too low', 'provider_balance_insufficient','余额不足'],
 ['',400,'账户余额不足', 'provider_balance_insufficient','余额不足'],
 ['rate_limit_exceeded',429,'', 'provider_rate_limited','频率'],
 ['resource_exhausted',429,'', 'provider_rate_limited','频率'],
 ['invalid_api_key',401,'', 'provider_authentication_failed','身份验证'],
 ['',403,'', 'provider_permission_denied','访问权限'],
 ['model_not_found',404,'', 'provider_model_unavailable','模型'],
 ['context_length_exceeded',400,'', 'provider_context_exceeded','上下文超限'],
 ['',422,'', 'provider_request_invalid','参数'],
 ['',522,'', 'provider_timeout','超时'],
 ['',503,'', 'provider_unavailable','暂时出错'],
];
for (const [providerCode,upstreamStatus,message,code,label] of cases) {
 const error=Object.assign(new Error(message+' private-fixture sk-provider-secret-123456789-fixture-3'),{providerCode,upstreamStatus,errorSource:'upstream_provider_or_gateway',providerPhase:'http'});
 const event=streamFailure(error,{userMessageCommitted:true,logId:42});
 assert.equal(event.code,code);assert.match(event.content,new RegExp(label));assert.ok(event.content.includes('重试')||event.content.includes('检查'));
 assert.ok(!JSON.stringify(event).includes('private-fixture'));assert.equal(event.error_log_id,42);assert.equal(event.user_message_committed,true);
 const record=diagnosticRecord({method:'POST',route:{path:'/chat/stream'}},error);
 assert.equal(record.error_code,code);assert.ok(!JSON.stringify(record).includes('private-fixture'));
 assert.equal(publicDiagnosticLog(record).error_code,code);
}
assert.equal(providerErrorReason({message:'余额不足',errorSource:'dengta'}),null);
assert.equal(providerErrorReason({message:'余额不足'}),null);
assert.equal(providerErrorReason({code:'provider_stream_incomplete',message:'余额不足',errorSource:'upstream_provider_or_gateway'}),null);
assert.equal(streamFailure({errorSource:'upstream_provider_or_gateway',upstreamStatus:522}).code,'provider_timeout');
assert.ok(!streamFailure({errorSource:'upstream_provider_or_gateway',upstreamStatus:522}).content.includes('内容检查'));
assert.equal(publicDiagnosticLog({error_code:'provider_error_document',error_source:'upstream_provider_or_gateway',provider_code:'insufficient_quota',upstream_status:429}).error_code,'provider_quota_exhausted');
console.log('Provider balance/quota/rate/auth/model/context/timeout reasons, retry guidance and redaction passed');

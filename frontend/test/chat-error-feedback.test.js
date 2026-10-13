import assert from 'node:assert/strict';
import { CHAT_ERROR_FEEDBACK } from '../src/chat-error-feedback.js';
import { publicChatErrorMessage } from '../src/chat-errors.js';
for(const [code,feedback] of Object.entries(CHAT_ERROR_FEEDBACK)) {
 const message=publicChatErrorMessage({code,message:'private-fixture sk-provider-secret-123456789-fixture-3',provider_code:'synthetic_provider_code',error_source:'upstream_provider_or_gateway',upstream_status:429});
 assert.ok(message.includes(feedback.reason));assert.ok(message.includes(feedback.action));assert.ok(message.includes(code));
 assert.ok(message.includes('synthetic_provider_code'));assert.ok(!message.includes('private-fixture'));
 assert.ok(!message.includes('日志已记录'));
 assert.ok(publicChatErrorMessage({code,error_log_id:42}).includes('日志已记录'));
}
assert.match(publicChatErrorMessage({code:'provider_balance_insufficient'}),/余额不足/);
assert.match(publicChatErrorMessage({code:'provider_quota_exhausted'}),/不一定是余额不足/);
console.log('Specific feedback, stable/provider codes and accurate log availability passed');

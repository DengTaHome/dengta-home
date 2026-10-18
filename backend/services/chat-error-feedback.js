"use strict";
module.exports = {
    "provider_empty_response": "模型接口有响应，但没有返回可显示的正文；具体原因尚未确认。 点同一条消息的“重试”；持续出现时检查模型输出预算和接口协议，或切换接口。 / The provider returned no visible reply text. Retry the same message or check output budget and API compatibility.",
    "provider_balance_insufficient": "API 账户余额不足。 到当前供应商控制台充值或切换有余额的接口，保存后点“重试”。 / The API account balance is insufficient. Add credits or switch providers, then retry.",
    "provider_quota_exhausted": "API 额度或账单上限已耗尽；不一定是余额不足。 检查供应商用量、余额和账单限额；恢复额度或切换接口后点“重试”。 / The API quota or billing limit is exhausted. Check usage and billing limits, then retry.",
    "provider_rate_limited": "模型接口限制了请求频率或并发数。 等待片刻再点“重试”，避免连续点击；持续出现时检查供应商限额或切换接口。 / The provider rate-limited the request. Wait briefly before retrying.",
    "provider_authentication_failed": "模型接口拒绝了 API 身份验证。 在模型接口设置中检查密钥和地址，保存后点“重试”；检查密钥是否过期或被撤销。 / API authentication failed. Check the key and endpoint, then retry.",
    "provider_permission_denied": "模型接口拒绝了访问权限；具体限制需查供应商。 检查账号是否有该模型权限、区域或 IP 限制，修正或切换接口后重试。 / API access was denied. Check provider permissions and restrictions.",
    "provider_model_unavailable": "请求的模型或接口地址不可用。 在模型设置中刷新列表并选择可用模型，检查接口地址，保存后点“重试”。 / The model or endpoint is unavailable. Check the model and endpoint, then retry.",
    "provider_context_exceeded": "上游接口明确报告上下文超限。 选择更大窗口模型、减少本轮附件，或降低输出预算后重试；若窗口标注与网关不符，请检查供应商限制。 / The provider reported a context limit. Use a larger context or fewer attachments.",
    "provider_request_invalid": "上游接口拒绝了请求格式、参数或大小；尚未确认具体字段。 检查模型与接口类型是否匹配，减少附件后重试；可通过错误码和日志定位参数问题。 / The provider rejected the request parameters or size. Check API compatibility.",
    "provider_timeout": "模型供应商或中转网关连接超时。 等待片刻后点“重试”；持续出现时检查供应商状态或切换接口。 / The provider or gateway timed out. Retry later or switch endpoints.",
    "provider_unavailable": "模型供应商或中转网关暂时出错。 等待服务恢复后点“重试”，或切换可用接口；查看日志中的上游 HTTP 状态。 / The provider or gateway is temporarily unavailable. Retry later.",
    "request_timeout": "请求等待超时。 检查网络后重试；聊天已保存时使用同一条消息重试。 / The request timed out. Check the network and retry.",
    "authentication_required": "灯塔登录状态失效或尚未登录。 重新登录后重试。 / Sign in again, then retry.",
    "permission_denied": "当前账号或伴侣无权访问这项数据。 确认登录账号及当前伴侣，再重试。 / Check the signed-in account and companion.",
    "chat_stream_interrupted": "回复连接提前结束，服务器没有确认本轮已保存。 检查网络后点“重试”；已收到的片段仍是临时内容。 / The reply connection ended early. Check the network and retry.",
    "MODEL_STREAM_CONNECT_TIMEOUT": "模型流式连接等待超时。 等待片刻后点“重试”；持续出现时更换模型或接口。 / The model stream connection timed out. Retry later.",
    "MODEL_STREAM_IDLE_TIMEOUT": "模型流式回复连续五分钟没有新数据。 等待片刻后点“重试”，或切换可用模型接口。 / The model stream was idle for five minutes. Retry later.",
    "provider_stream_incomplete": "上游模型流没有正常结束，本轮回复未保存。 点“重试”；持续出现时检查接口流协议兼容性或切换接口。 / The upstream stream did not complete; this reply was not saved.",
    "reply_body_missing": "本轮未收到可分离的正文，可能只生成了心声或格式未闭合；本轮回复未保存。 点“重试”；持续出现时查看日志并检查模型的正文与心声格式支持。 / No separable reply body was received; this reply was not saved.",
    "context_budget_exceeded": "本轮上下文超过模型的估算容量。 选择更大窗口模型、减少本轮附件或降低输出预算后重试；日志可查看输入、窗口和预留输出。 / This turn exceeds the estimated model context capacity. Use a larger context or fewer attachments.",
    "provider_error_document": "模型接口返回了错误文档，尚未确认更具体原因；本轮回复未保存。 查看错误码及上游 HTTP 日志，检查接口设置或稍后重试。 / The model API returned an error document; this reply was not saved."
};

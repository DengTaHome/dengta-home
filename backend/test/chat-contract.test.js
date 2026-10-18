const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeChatBody } = require("../services/chat-request");
const {
    publicChatErrorCode,
    publicChatErrorMessage,
    streamFailure,
    streamSuccess
} = require("../services/chat-stream-contract");

function assertStreamFailure(actual, expected) {
    const { error_location, ...rest } = actual || {};
    if (error_location) {
        assert.match(
            String(error_location),
            /^[A-Za-z0-9_./-]+:\d+:\d+$/,
            "error_location must be a file:line:column position",
        );
    }
    assert.deepEqual(rest, expected);
}

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const aiSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "ai-service.js"),
    "utf8"
);
const reasoningSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "reasoning-stream.js"),
    "utf8"
);
const contextResetSource = fs.readFileSync(
    path.join(__dirname, "..", "services", "context-reset.js"),
    "utf8"
);
const idempotencySource = fs.readFileSync(
    path.join(__dirname, "..", "services", "chat-idempotency.js"),
    "utf8"
);
const executeChatSource = source.slice(
    source.indexOf("async function executeChatTurnOnce"),
    source.indexOf('app.get("/")')
);
const companionInteractionContextSource = source.slice(
    source.indexOf("async function loadCompanionInteractionContext"),
    source.indexOf("async function touchConversation")
);

assert.match(source, /app\.get\("\/models"/);
assert.match(source, /app\.post\("\/chat",\s*acceptChatBody/);
assert.match(source, /app\.post\("\/chat\/stream",\s*acceptChatBody/);
assert.match(source, /safe_chat_error_boundary:\s*true/);
assert.match(source, /name:\s*"files"/);
assert.match(source, /name:\s*"attachments"/);
assert.match(source, /stage:\s*"processing_attachments"/);
assert.match(source, /stage:\s*"calling_model"/);
assert.match(source, /stage:\s*"saving"/);
assert.match(source, /stage:\s*"completed"/);
assert.match(source, /type:\s*"meta"/);
assert.match(source, /app\.get\("\/attachments\/:messageId\/:attachmentId"/);
assert.match(source, /isSafeMessageId\(req\.params\.messageId\)/);
assert.match(source, /const disposition = \["image", "text"\]\.includes/);
assert.match(source, /storedAttachmentPathsForConversation/);
assert.match(source, /resolveTurnModel\(/);
assert.match(
    executeChatSource,
    /const conversation = existingConversationId[\s\S]*?loadConversation\(existingConversationId, database\)/,
    "chat turns must load the persisted conversation before resolving the model"
);
assert.match(
    executeChatSource,
    /resolveConversationTurnModel\(\s*settings,\s*conversation,\s*input\.requestedModel,\s*database\s*\)/,
    "chat must reconcile a persisted session model against the active provider"
);
assert.match(
    source,
    /async function resolveConversationTurnModel[\s\S]*?resolveConversationModel\([\s\S]*?if \(!resolution\.rebound\)[\s\S]*?\.from\("conversations"\)[\s\S]*?model_id: resolution\.model/,
    "a stale persisted model must be replaced with the active provider default"
);
assert.match(
    executeChatSource,
    /ensureConversation\([\s\S]*?effectiveModel/,
    "implicit first sessions must persist the resolved model"
);
assert.match(source, /publicMessage\(savedUserMessage\)/);
assert.match(source, /requestScope:\s*req\.scope \|\| null/);
assert.match(
    executeChatSource,
    /const database = input\.requestScope\?\.db \|\| supabase/
);
assert.match(
    executeChatSource,
    /mcpDeviceCenter[\s\S]*?\.forDatabase\(database\)[\s\S]*?\.createRuntime\(\)/
);
assert.match(
    executeChatSource,
    /createChatToolExecutor\([\s\S]*?mcpRuntime,[\s\S]*?database/
);
assert.match(
    companionInteractionContextSource,
    /loadCompanionInteractionContextRows\(\{[\s\S]*?database,[\s\S]*?settings/
);
assert.match(contextResetSource, /database[\s\S]*?\.from\("memories"\)/);
assert.doesNotMatch(
    contextResetSource,
    /\bsupabase\s*\.\s*from\("memories"\)/
);
assert.match(executeChatSource, /findUserMessageByClientId\(/);
assert.match(executeChatSource, /client_message_id: input\.clientMessageId/);
assert.match(executeChatSource, /isClientMessageUniqueConflict\(error\)/);
assert.match(executeChatSource, /reply_to_client_message_id:/);
assert.match(executeChatSource, /chatGenerationLeaseStore\.claim\(/);
assert.match(executeChatSource, /chatGenerationLeaseStore\.renew\(/);
assert.match(executeChatSource, /chatGenerationLeaseStore\.commit\(/);
assert.match(executeChatSource, /chatGenerationLeaseStore\.fail\(/);
assert.match(
    executeChatSource,
    /chatGenerationLeaseStore\.claim\([\s\S]*?ownership\s*\)/
);
assert.match(
    executeChatSource,
    /chatGenerationLeaseStore\.commit\(\{[\s\S]*?\.\.\.ownership/
);
assert.match(
    executeChatSource,
    /saveMessage\([\s\S]*?client_message_id: input\.clientMessageId,[\s\S]*?database/
);
assert.match(executeChatSource, /createChatGenerationLeaseHeartbeat\(/);
assert.match(
    executeChatSource,
    /resolveMessageReference\(\{[\s\S]*?reference: input\.messageReference,[\s\S]*?conversationId,[\s\S]*?loadMessage:[\s\S]*?loadReferencedMessage\(\{\s*\.\.\.reference,\s*database\s*\}\)/
);
assert.match(
    executeChatSource,
    /reply_to_message_id:\s*resolvedMessageReference\?\.messageId,[\s\S]*?reply_snapshot:\s*resolvedMessageReference\?\.snapshot/
);
assert.match(
    executeChatSource,
    /messageReferenceRuntimeContext\(\s*resolvedMessageReference\?\.snapshot/
);
assert.match(
    executeChatSource,
    /processing_stages:\s*appendPublicProcessingStage\([\s\S]*?"completed"/
);
assert.ok(
    executeChatSource.indexOf('stage: "saving"') <
        executeChatSource.indexOf("processing_stages:"),
    "saving must be recorded before the persisted completed trace is built"
);
assert.ok(
    executeChatSource.indexOf("assistantCommitted = true") <
        executeChatSource.indexOf('stage: "completed"'),
    "completed must not be emitted before the assistant message is committed"
);
assert.ok(
    executeChatSource.indexOf(
        "emitCommittedUserReceipt(previousUserMessage, onStatus)"
    ) < executeChatSource.indexOf("chatGenerationLeaseStore.claim("),
    "已存在消息的提交回执必须早于可能失败的数据库租约领取"
);
assert.ok(
    executeChatSource.indexOf("findUserMessageByClientId(") <
        executeChatSource.indexOf("prepareAttachments("),
    "重试必须在读取、转写或保存附件之前完成查重"
);
assert.ok(
    source.indexOf("const effectiveModel = await resolveTurnModel") <
        source.indexOf("preparedAttachments = await prepareAttachments"),
    "普通聊天必须先拒绝无效模型，再处理可能消耗 ASR 额度的音频附件"
);
assert.match(
    source,
    /if \(preparedAttachments\.length > 0\) \{[\s\S]*?stage: "attachments_ready"/,
    "纯文字请求不得发送虚假的 attachments_ready 状态"
);
assert.match(
    source,
    /\["text", "reasoning", "monologue"\]\.includes\(event\?\.type\)/
);
assert.match(aiSource, /createReasoningEventEmitter/);
assert.match(
    aiSource,
    /if \(publicReasoningSummary === true\) \{\s*body\.reasoning = \{ \.\.\.body\.reasoning, summary: "auto" \}/,
    "Responses summaries require an explicit per-turn opt-in"
);
assert.doesNotMatch(aiSource, /reasoning_content|thinking_delta/);
assert.match(reasoningSource, /type:\s*"reasoning"/);
assert.doesNotMatch(
    source,
    /reasoning[^\n]*saveMessage|saveMessage[^\n]*reasoning/i,
    "reasoning 事件不得写入 messages"
);
assert.match(source, /public_reasoning_summary_stream:\s*true/);
assert.match(source, /public_reasoning_summary_opt_in:\s*true/);
assert.match(source, /provider_reasoning_summary_only:\s*true/);
assert.match(
    executeChatSource,
    /generateReplyStream\(\{\s*\.\.\.generationInput,\s*publicReasoningSummary:\s*input\.publicReasoningSummary === true/,
    "only the streamed chat path receives the per-turn public-summary option"
);
assert.match(source, /visible_inner_monologue_on_demand:\s*true/);
assert.match(source, /visible_monologue_stream:\s*true/);
assert.match(source, /visible_monologue_schema_version:\s*1/);
assert.match(source, /visible_monologue_storage:\s*"message_metadata"/);
assert.match(
    executeChatSource,
    /visible_monologue:\s*generated\.visible_monologue/
);

assert.deepEqual(streamSuccess({ reply: "完成" }), {
    type: "done",
    ok: true,
    reply: "完成"
});
assertStreamFailure(streamFailure(new Error("上游失败")), {
    type: "error",
    ok: false,
    content: "上游失败",
    user_message_committed: false,
    code: "request_failed"
});
assertStreamFailure(
    streamFailure(new Error("模型失败"), { userMessageCommitted: true }),
    {
        type: "error",
        ok: false,
        content: "模型失败",
        user_message_committed: true,
    code: "request_failed"
    }
);
const rawUpstreamError = new Error(
    "<!doctype html><html><body><pre>provider stack trace</pre></body></html>"
);
rawUpstreamError.status = 502;
assertStreamFailure(streamFailure(rawUpstreamError), {
    type: "error",
    ok: false,
    content: "模型服务暂时无法完成这次回复，请稍后重试。",
    user_message_committed: false,
    code: "request_failed"
});
assertStreamFailure(
    streamFailure(rawUpstreamError, { userMessageCommitted: true }),
    {
        type: "error",
        ok: false,
        content: "AI 回复没有完成，但你的消息已经保存，可以稍后重试。",
        user_message_committed: true,
    code: "request_failed"
    }
);
assert.equal(
    streamFailure(new Error("Upstream request failed")).content,
    streamFailure(rawUpstreamError).content
);
assert.equal(
    streamFailure(new Error("Upstream request failed"), {
        userMessageCommitted: true
    }).content,
    streamFailure(rawUpstreamError, { userMessageCommitted: true }).content
);
assert.equal(
    streamFailure(
        new Error("Upstream stream ended without a terminal response event")
    ).content,
    "上游模型流没有正常结束，请重试或检查接口兼容性 / The upstream model stream ended without a terminal response event. Retry or check API compatibility."
);
const unavailableModelError = new Error("request model unavailable");
unavailableModelError.code = "MODEL_NOT_AVAILABLE";
assert.equal(
    streamFailure(unavailableModelError).content,
    "请求的模型不在当前接口可用列表中 / The requested model is not available from the current API.（错误代码 / Code: MODEL_NOT_AVAILABLE；来源 / Source: dengta）"
);
const boundaryResidueError = new Error("模型供应商未返回可保存的对话内容。");
boundaryResidueError.code = "provider_boundary_residue";
boundaryResidueError.errorSource = "dengta_output_guard";
boundaryResidueError.providerPhase = "completed_output";
assertStreamFailure(
    streamFailure(boundaryResidueError, { userMessageCommitted: true }),
    {
        type: "error",
        ok: false,
        content:
            "模型回复被识别为拒答残留，拒答正文未保存 / The model response was identified as refusal residue; the refusal text was not saved.（错误代码 / Code: provider_boundary_residue；来源 / Source: dengta_output_guard）",
        user_message_committed: true,
        code: "provider_boundary_residue",
        error_source: "dengta_output_guard",
        provider_phase: "completed_output"
    }
);
const inspectionErrorWithMetadata = new Error(
    "Input text data may contain inappropriate content."
);
inspectionErrorWithMetadata.providerCode = "data_inspection_failed";
inspectionErrorWithMetadata.errorSource = "upstream_provider_or_gateway";
inspectionErrorWithMetadata.providerPhase = "event";
assert.equal(
    publicChatErrorCode(inspectionErrorWithMetadata),
    "data_inspection_failed"
);
assert.match(
    publicChatErrorMessage(inspectionErrorWithMetadata),
    /data_inspection_failed.*upstream_provider_or_gateway/
);
assertStreamFailure(
    streamFailure(inspectionErrorWithMetadata),
    {
        type: "error",
        ok: false,
        content:
            "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.（错误代码 / Code: data_inspection_failed；来源 / Source: upstream_provider_or_gateway）",
        user_message_committed: false,
        code: "data_inspection_failed",
        provider_code: "data_inspection_failed",
        error_source: "upstream_provider_or_gateway",
        provider_phase: "event"
    }
);
const providerErrorDocument = new Error("raw provider document");
providerErrorDocument.code = "provider_error_document";
assertStreamFailure(
    streamFailure(providerErrorDocument, { userMessageCommitted: true }),
    {
        type: "error",
        ok: false,
        content:
            "模型接口返回了错误文档，尚未确认更具体原因；本轮回复未保存。 查看错误码及上游 HTTP 日志，检查接口设置或稍后重试。 / The model API returned an error document; this reply was not saved.（错误代码 / Code: provider_error_document；来源 / Source: dengta）",
        user_message_committed: true,
        code: "provider_error_document"
    }
);
const inspectionError = new Error(
    "Input text data may contain inappropriate content."
);
inspectionError.code = "data_inspection_failed";
assert.equal(
    streamFailure(inspectionError).content,
    "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.（错误代码 / Code: data_inspection_failed；来源 / Source: dengta）"
);
const pendingError = new Error("AI 仍在处理中");
pendingError.code = "CHAT_GENERATION_IN_PROGRESS";
assert.equal(publicChatErrorCode(pendingError), "CHAT_GENERATION_IN_PROGRESS");
assertStreamFailure(
    streamFailure(pendingError, { userMessageCommitted: true }),
    {
        type: "error",
        ok: false,
        content: "AI 仍在处理中",
        user_message_committed: true,
        code: "CHAT_GENERATION_IN_PROGRESS"
    }
);
const privateError = new Error("内部租约错误");
privateError.code = "INTERNAL_LEASE_FAILURE";
assert.equal(publicChatErrorCode(privateError), null);
assert.equal(
    streamFailure(privateError).code,
    "request_failed"
);
assert.match(
    source,
    /if \(event\?\.type === "meta" && event\.user_message\) \{\s*userMessageCommitted = true;/
);
assert.match(
    source,
    /streamFailure\(error, \{\s*userMessageCommitted,\s*logId:/
);
assert.match(
    idempotencySource,
    /CHAT_GENERATION_IN_PROGRESS/
);
assert.match(
    source,
    /publicChatErrorCode\(error\)/,
    "非流式错误也必须使用同一安全错误码白名单"
);
assert.doesNotMatch(
    source,
    /response_pending:\s*!savedAssistantMessage/,
    "仍在生成的幂等请求不得伪装成 done ok=true"
);
assert.match(
    source,
    /writeSse\(\s*res,\s*streamFailure\(error, \{\s*userMessageCommitted,\s*logId:/
);
assert.doesNotMatch(
    source,
    /writeSse\(res, streamFailure\(error, \{ userMessageCommitted \}\)\);[\s\S]{0,120}streamSuccess/,
    "SSE 失败后不得继续发送成功结束事件"
);

const migration = fs.readFileSync(
    path.join(__dirname, "..", "supabase", "005_chat_attachments.sql"),
    "utf8"
);
assert.match(migration, /'chat-attachments'/);
assert.match(migration, /public,\s*file_size_limit/i);
assert.match(migration, /false,\s*12582912/);
assert.doesNotMatch(migration, /create\s+policy/i);

const idempotencyMigration = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "supabase",
        "006_chat_message_idempotency.sql"
    ),
    "utf8"
);
assert.match(idempotencyMigration, /add column if not exists client_message_id uuid/i);
assert.match(idempotencyMigration, /create unique index if not exists/i);
assert.match(idempotencyMigration, /where client_message_id is not null/i);
assert.match(idempotencyMigration, /chat_generation_lease_id uuid/i);
assert.match(idempotencyMigration, /chat_generation_lease_expires_at timestamptz/i);
assert.match(idempotencyMigration, /function public\.claim_chat_generation/i);
assert.match(idempotencyMigration, /function public\.renew_chat_generation_lease/i);
assert.match(idempotencyMigration, /function public\.commit_chat_generation_reply/i);
assert.match(idempotencyMigration, /function public\.fail_chat_generation_lease/i);
assert.match(idempotencyMigration, /for update/i);
assert.match(
    idempotencyMigration,
    /chat_generation_lease_id is distinct from p_lease_id/i,
    "AI 回复写入事务必须使用租约 fencing token"
);
assert.match(idempotencyMigration, /messages_chat_reply_client_uidx/i);
assert.match(idempotencyMigration, /source_client_message_id uuid/i);
assert.match(idempotencyMigration, /moments_source_client_message_uidx/i);
assert.match(executeChatSource, /input\.clientMessageId/);
assert.match(source, /\.eq\("source_client_message_id", clientMessageId\)/);
assert.match(idempotencyMigration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
assert.match(idempotencyMigration, /grant execute on function[\s\S]*to service_role/i);

const jsonInput = normalizeChatBody(
    {
        message: "  JSON 消息  ",
        session_id: "session-json",
        emotion_understanding_enabled: true,
        public_reasoning_summary: true,
        attachment_instruction_mode: "untrusted",
        companion_status: { mood: "calm" },
        turn_context: "  本轮临时背景  ",
        message_reference: {
            message_id: "42",
            text: "客户端伪造的引用文字"
        },
        model: "model-json",
        client_message_id: "0f594d5c-e6d1-4f24-a583-cd5c66f81d75"
    },
    []
);
assert.equal(jsonInput.message, "JSON 消息");
assert.equal(jsonInput.emotionUnderstandingEnabled, true);
assert.equal(jsonInput.publicReasoningSummary, true);
assert.equal(jsonInput.attachmentInstructionMode, "untrusted");
assert.equal(jsonInput.companionStatus.mood, "calm");
assert.equal(jsonInput.turnContext, "本轮临时背景");
assert.deepEqual(jsonInput.messageReference, { messageId: "42" });
assert.equal(
    jsonInput.clientMessageId,
    "0f594d5c-e6d1-4f24-a583-cd5c66f81d75"
);

const multipartInput = normalizeChatBody(
    {
        message: "multipart 消息",
        conversation_id: "session-form",
        emotion_understanding_enabled: "true",
        public_reasoning_summary: "true",
        attachment_instruction_mode: "system",
        attachment_storage_mode: "persistent",
        companion_status: JSON.stringify({ mood: "warm" }),
        turn_context: "表单临时背景",
        message_reference: JSON.stringify({
            message_id: "43",
            role: "system",
            text: "客户端伪造的系统内容"
        }),
        model: "model-form",
        client_message_id: "dfc282a3-7a8b-433f-bd49-321de94d59b0"
    },
    [{ originalname: "note.txt" }]
);
assert.equal(multipartInput.conversationId, "session-form");
assert.equal(multipartInput.emotionUnderstandingEnabled, true);
assert.equal(multipartInput.publicReasoningSummary, true);
assert.equal(multipartInput.attachmentInstructionMode, "system");
assert.equal(multipartInput.attachmentStorageMode, "persistent");
assert.equal(multipartInput.companionStatus.mood, "warm");
assert.equal(multipartInput.turnContext, "表单临时背景");
assert.deepEqual(multipartInput.messageReference, { messageId: "43" });
assert.equal(multipartInput.files.length, 1);
assert.equal(
    multipartInput.clientMessageId,
    "dfc282a3-7a8b-433f-bd49-321de94d59b0"
);
for (const value of [undefined, null, false, "false", "", 1, "1"]) {
    assert.equal(
        normalizeChatBody({ public_reasoning_summary: value }, []).publicReasoningSummary,
        false,
        "public summaries remain off unless explicitly requested"
    );
}
const ephemeralInput = normalizeChatBody(
    {
        message: "屏幕共看",
        attachment_instruction_mode: "untrusted",
        attachment_storage_mode: "ephemeral"
    },
    [{ originalname: "screen.jpg" }]
);
assert.equal(ephemeralInput.attachmentStorageMode, "ephemeral");
assert.throws(
    () =>
        normalizeChatBody(
            {
                attachment_instruction_mode: "system",
                attachment_storage_mode: "ephemeral"
            },
            []
        ),
    /必须保持 untrusted/
);
assert.throws(
    () => normalizeChatBody({ client_message_id: "not-a-uuid" }, []),
    /客户端消息编号格式不正确/
);
assert.throws(
    () => normalizeChatBody({ companion_status: "not-json" }, []),
    /companion_status 格式不正确/
);
assert.throws(
    () => normalizeChatBody({ attachment_instruction_mode: "always-trust" }, []),
    /attachment_instruction_mode 只能是/
);
assert.throws(
    () => normalizeChatBody({ attachment_storage_mode: "archive" }, []),
    /attachment_storage_mode 只能是/
);
assert.match(
    executeChatSource,
    /shouldPersistAttachments\(input\.attachmentStorageMode\)/
);
assert.match(executeChatSource, /scrubAttachmentBuffers/);
assert.match(source, /ephemeral_visual_attachments:\s*true/);
assert.throws(
    () => normalizeChatBody({ turn_context: "x".repeat(4001) }, []),
    /turn_context 不能超过 4000/
);

console.log("JSON, multipart, SSE and private attachment route contract tests passed");

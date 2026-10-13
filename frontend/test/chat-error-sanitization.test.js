import assert from "node:assert/strict";
import fs from "node:fs";
import { streamChat } from "../src/api.js";
import {
  CHAT_ERROR_FALLBACK,
  COMMITTED_CHAT_ERROR_FALLBACK,
  dismissChatErrorMessage,
  isProviderErrorDocument,
  publicChatErrorMessage,
  sanitizeChatErrorEvent,
} from "../src/chat-errors.js";
import { hydrateChatMessage } from "../src/chat-history.js";

assert.match(publicChatErrorMessage({ code: "context_budget_exceeded", message: "private diagnostic body" }), /上下文超过模型/);
assert.ok(!publicChatErrorMessage({ code: "context_budget_exceeded", message: "private diagnostic body" }).includes("private diagnostic"));

assert.equal(
  publicChatErrorMessage("<html><pre>provider stack</pre></html>"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage('{"error":{"message":"raw provider response"}}'),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage("Authorization: Bearer secret-provider-token"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage("Upstream request failed"),
  CHAT_ERROR_FALLBACK,
);
assert.equal(
  publicChatErrorMessage(
    "Upstream stream ended without a terminal response event",
  ),
  "上游模型流没有正常结束，请重试或检查接口兼容性 / The upstream model stream ended without a terminal response event. Retry or check API compatibility.",
);
assert.equal(
  publicChatErrorMessage({
    code: "MODEL_NOT_AVAILABLE",
    message: "request model unavailable",
  }),
  "请求的模型不在当前接口可用列表中 / The requested model is not available from the current API.（错误代码 / Code: MODEL_NOT_AVAILABLE；来源 / Source: dengta）",
);
assert.equal(
  publicChatErrorMessage({
    code: "provider_error_document",
    message: "raw upstream html",
  }),
  "模型接口返回了错误文档，尚未确认更具体原因；本轮回复未保存。 查看错误码及上游 HTTP 日志，检查接口设置或稍后重试。 / The model API returned an error document; this reply was not saved.（错误代码 / Code: provider_error_document；来源 / Source: dengta）",
);
assert.equal(
  publicChatErrorMessage(
    'data: {"error":{"code":"data_inspection_failed","message":"Input text data may contain inappropriate content."}}',
  ),
  "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.",
);
assert.equal(
  publicChatErrorMessage({
    code: "data_inspection_failed",
    provider_code: "data_inspection_failed",
    error_source: "upstream_provider_or_gateway",
    message: "raw upstream message must not be displayed",
  }),
  "输入内容未通过模型接口的内容检查 / The input did not pass the model provider's content inspection.（错误代码 / Code: data_inspection_failed；来源 / Source: upstream_provider_or_gateway）",
);
assert.equal(
  sanitizeChatErrorEvent({
    content: "Upstream request failed",
    user_message_committed: true,
  }).content,
  COMMITTED_CHAT_ERROR_FALLBACK,
);
assert.equal(publicChatErrorMessage("模型接口等待超时，请稍后重试。"), "模型接口等待超时，请稍后重试。");

assert.deepEqual(
  dismissChatErrorMessage(
    [
      { id: "user", role: "user", content: "原消息" },
      { id: "error", role: "assistant", content: "错误", chatError: true },
    ],
    "error",
  ),
  [{ id: "user", role: "user", content: "原消息" }],
);

assert.equal(
  isProviderErrorDocument(
    '<!doctype html><html><body><pre>gateway denied</pre></body></html>',
  ),
  false,
);
assert.equal(
  isProviderErrorDocument(
    'data: {"error":{"code":"data_inspection_failed","message":"Input text data may contain inappropriate content."},"id":"chatcmpl-test"}',
  ),
  false,
);
assert.equal(
  isProviderErrorDocument('{"error":{"message":"gateway denied"}}'),
  false,
);
assert.equal(isProviderErrorDocument('<div class="example">hello</div>'), false);
assert.equal(isProviderErrorDocument('{"answer":"ok","status":200}'), false);
assert.equal(
  isProviderErrorDocument("```html\n<!doctype html>\n<p>example</p>\n```"),
  false,
);

assert.equal(
  hydrateChatMessage({
    id: "stored-model-document",
    role: "assistant",
    content: "<!doctype html><html><body>gateway denied</body></html>",
  }).content,
  "<!doctype html><html><body>gateway denied</body></html>",
);

const chatMessageSource = fs.readFileSync(
  new URL("../src/ChatMessage.jsx", import.meta.url),
  "utf8",
);
assert.match(chatMessageSource, /aria-label="关闭这条错误提示"/);
assert.match(chatMessageSource, /onDismissError\(item\.id\)/);

async function streamWithEvents(events, onEvent = () => {}) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let readCount = 0;

  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/event-stream" },
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount > 1) return { done: true, value: undefined };
            return {
              done: false,
              value: new TextEncoder().encode(
                events
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(""),
              ),
            };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });

  try {
    return await streamChat({}, onEvent);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

await assert.rejects(
  streamWithEvents([
    {
      type: "error",
      code: "provider_error",
      content:
        "<!doctype html><html><body><pre>UPSTREAM_POLICY_DENIED stack=abc</pre></body></html>",
    },
  ]),
  (error) => {
    assert.equal(error.message, "模型服务暂时无法完成这次回复，请稍后重试。");
    assert.doesNotMatch(
      error.message,
      /<!doctype|<html|<pre>|UPSTREAM_POLICY_DENIED|stack=/i,
    );
    return true;
  },
);

await assert.rejects(
  streamWithEvents([
    {
      type: "error",
      code: "data_inspection_failed",
      provider_code: "data_inspection_failed",
      error_source: "upstream_provider_or_gateway",
      provider_phase: "event",
      content: "Input text data may contain inappropriate content.",
    },
  ]),
  (error) => {
    assert.equal(error.code, "data_inspection_failed");
    assert.equal(error.provider_code, "data_inspection_failed");
    assert.equal(error.error_source, "upstream_provider_or_gateway");
    assert.match(error.message, /data_inspection_failed.*upstream_provider_or_gateway/);
    return true;
  },
);

{
  const visibleEvents = [];
  const error = await streamWithEvents(
    [
      {
        type: "text",
        content:
          "<!doctype html><html><body><pre>403 UPSTREAM_POLICY_DENIED stack=abc</pre></body></html>",
      },
    ],
    (event) => visibleEvents.push(event),
  ).then(
    () => null,
    (reason) => reason,
  );
  assert.match(visibleEvents.map((event) => event.content || "").join(""), /<!doctype|<html|<pre>|stack=/i);
  assert.match(error?.message || "", /回复连接提前结束/);
}

{
  const visibleEvents = [];
  const error = await streamWithEvents(
    [
      { type: "meta", user_message: { id: "saved-user" } },
      { type: "text", content: "<!doc" },
      {
        type: "text",
        content: "type html><html><body><pre>gateway denied</pre></body></html>",
      },
      { type: "done", ok: true },
    ],
    (event) => visibleEvents.push(event),
  ).then(
    () => null,
    (reason) => reason,
  );
  assert.match(visibleEvents.map((event) => event.content || "").join(""), /<!doc|<html|<pre>|gateway/i);
  assert.equal(error, null);
}

for (const fragments of [
  ["<di", 'v class="example">hello</div>'],
  ['{"answer":', '"ok","status":200}'],
  ["```html\n<!doctype html>\n", "<p>example</p>\n```"],
]) {
  const visibleEvents = [];
  const expected = fragments.join("");
  await streamWithEvents(
    [
      ...fragments.map((content) => ({ type: "text", content })),
      { type: "done", ok: true },
    ],
    (event) => visibleEvents.push(event),
  );
  assert.equal(
    visibleEvents
      .filter((event) => event.type === "text")
      .map((event) => event.content)
      .join(""),
    expected,
  );
}

const diagnosticEvent = {
  type: "error", content: "模型没有返回可保存的文字。",
  code: "reply_body_missing", error_source: "dengta_stream_parser",
  provider_phase: "output_parse", error_location: "ai-service.js:4328:15",
  error_log_id: "synthetic-log-id", user_message_committed: true,
};
await assert.rejects(streamWithEvents([diagnosticEvent]), error => {
  assert.equal(error.error_location, diagnosticEvent.error_location);
  assert.equal(error.error_log_id, diagnosticEvent.error_log_id);
  assert.equal(error.userMessageCommitted, true);
  const displayed = publicChatErrorMessage(error);
  assert.equal((displayed.match(/错误代码/g) || []).length, 1);
  assert.match(displayed, /reply_body_missing.*dengta_stream_parser/);
  return true;
});
const legacyDuplicate = '模型没有返回可保存的文字。' +
  '（错误代码 / Code: unknown；来源 / Source: dengta；位置 / At: ai-service.js:4328:15；日志已记录 / Logged）'.repeat(2);
assert.equal((publicChatErrorMessage({ message: legacyDuplicate, error_location: diagnosticEvent.error_location }).match(/错误代码/g) || []).length, 1);
console.log("chat error sanitization tests passed");

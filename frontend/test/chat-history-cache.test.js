import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAT_CACHE_LIMIT,
  CHAT_CACHE_MAX_AGE_MS,
  CHAT_CACHE_VERSION,
  clearChatHistoryCache,
  readChatHistoryCache,
  writeChatHistoryCache,
} from "../src/chat-history-cache.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const COMPANION_A = "33333333-3333-4333-8333-333333333333";
const COMPANION_B = "44444444-4444-4444-8444-444444444444";
const SESSION_A = "55555555-5555-4555-8555-555555555555";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; },
    keys: () => Array.from(map.keys()),
  };
}

const message = (id, content = id, extra = {}) => ({
  id,
  role: "assistant",
  content,
  created_at: "2026-10-20T10:00:00Z",
  ...extra,
});

test("写入后能读回，并且保留会话 id", () => {
  const storage = memoryStorage();
  const wrote = writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A,
    sessionId: SESSION_A, messages: [message("m1"), message("m2")], storage,
  });
  assert.equal(wrote, true);
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  assert.equal(cached.sessionId, SESSION_A);
  assert.deepEqual(cached.messages.map((item) => item.id), ["m1", "m2"]);
});

test("账号之间、伴侣之间严格隔离", () => {
  const storage = memoryStorage();
  writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A,
    sessionId: SESSION_A, messages: [message("a-only")], storage,
  });
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_B, companionScope: COMPANION_A, storage }), null, "换账号不能读到别人的对话");
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_B, storage }), null, "换伴侣不能读到别人的对话");
  assert.equal(readChatHistoryCache({ accountScope: "", companionScope: COMPANION_A, storage }), null, "没有账号作用域就不读");
});

test("版本不符、过期、损坏的数据一律不读", () => {
  const storage = memoryStorage();
  const now = Date.now();
  const key = `dengta.chat-cache.v${CHAT_CACHE_VERSION}:${ACCOUNT_A}:${COMPANION_A}`;

  storage.setItem(key, JSON.stringify({ version: CHAT_CACHE_VERSION - 1, sessionId: SESSION_A, savedAt: now, messages: [message("old")] }));
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), null, "旧版本结构不可用");

  storage.setItem(key, JSON.stringify({ version: CHAT_CACHE_VERSION, sessionId: SESSION_A, savedAt: now - CHAT_CACHE_MAX_AGE_MS - 1, messages: [message("stale")] }));
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), null, "超过 7 天不展示");

  storage.setItem(key, "{不是 JSON");
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), null, "损坏数据不抛错");

  storage.setItem(key, JSON.stringify({ version: CHAT_CACHE_VERSION, sessionId: "", savedAt: now, messages: [message("x")] }));
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), null, "没有会话 id 不能用");
});

test("只缓存有限条数，且只保留轻量字段", () => {
  const storage = memoryStorage();
  const many = Array.from({ length: CHAT_CACHE_LIMIT + 25 }, (_, index) => message(`m${index}`, `内容 ${index}`));
  many.push({
    id: "heavy", role: "assistant", content: "带工具结果的回复",
    tool_calls: { partial_reply: true, huge_blob: "x".repeat(5000), message_kind: "art" },
  });
  writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A, messages: many, storage,
  });
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  assert.ok(cached.messages.length <= CHAT_CACHE_LIMIT, `条数应受限于 ${CHAT_CACHE_LIMIT}`);
  assert.equal(cached.messages.at(-1).id, "heavy", "保留的是最新的消息");
  assert.equal(cached.messages.at(-1).tool_calls.huge_blob, undefined, "大字段不进缓存");
  assert.equal(cached.messages.at(-1).tool_calls.partial_reply, true, "轻量标记要保留");
});

test("空消息与无效消息不会被写进去", () => {
  const storage = memoryStorage();
  const wrote = writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A,
    messages: [null, { role: "assistant" }, { id: "ok", role: "user", content: "在吗" }], storage,
  });
  assert.equal(wrote, true);
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  assert.equal(cached.messages.length, 1);
  assert.equal(cached.messages[0].id, "ok");
  assert.equal(writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A, messages: [], storage,
  }), false, "没有内容就不写");
});

test("超体积时会丢弃较早的消息，而不是整段失败", () => {
  const storage = memoryStorage();
  // 30 条 × 8000 字符 ≈ 240 KB，必然超过 160 KB 上限，强制触发丢弃。
  const big = Array.from({ length: 30 }, (_, index) => message(`big${index}`, "汉".repeat(8000)));
  const wrote = writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A, messages: big, storage,
  });
  assert.equal(wrote, true);
  const stored = storage.getItem(`dengta.chat-cache.v${CHAT_CACHE_VERSION}:${ACCOUNT_A}:${COMPANION_A}`);
  assert.ok(stored.length <= 160 * 1024 + 2048, "体积应被压到上限附近");
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  assert.ok(cached.messages.length > 0 && cached.messages.length < 30, "保留较新的部分");
});

test("清理只影响对应作用域", () => {
  const storage = memoryStorage();
  writeChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A, messages: [message("1")], storage });
  writeChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_B, sessionId: SESSION_A, messages: [message("2")], storage });
  assert.equal(clearChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), true);
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage }), null);
  assert.ok(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_B, storage }), "另一个伴侣的缓存不受影响");
});

test("存储不可用时不抛错", () => {
  const broken = {
    getItem() { throw new Error("quota"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("quota"); },
  };
  assert.equal(writeChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A, messages: [message("1")], storage: broken }), false);
  assert.equal(readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage: broken }), null);
  assert.equal(clearChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage: broken }), false);
});

test("数字 id 也要能缓存（真机上后端返回的就是数字）", () => {
  const storage = memoryStorage();
  const wrote = writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A,
    messages: [
      { id: 4571, role: "user", content: "你好", created_at: "2026-10-24T18:53:40.431Z" },
      { id: 4572, role: "assistant", content: "在呢", created_at: "2026-10-24T18:53:41.000Z" },
    ],
    storage,
  });
  assert.equal(wrote, true, "数字 id 不能被当成无效消息丢掉");
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  assert.deepEqual(cached.messages.map((item) => item.id), ["4571", "4572"], "读回时统一成字符串");
});
test("决定行高的字段必须保留（否则替换时列表会跳）", () => {
  const storage = memoryStorage();
  const wrote = writeChatHistoryCache({
    accountScope: ACCOUNT_A, companionScope: COMPANION_A, sessionId: SESSION_A,
    messages: [{
      id: 4586, role: "assistant", content: "在呢",
      visible_monologue: "这是可见心声，会渲染成一张卡片",
      tool_calls: {
        music_card: { title: "小幸运", artist: "田馥甄", duration_seconds: 264 },
        co_watch_session_id: "cw-1", is_co_watch: true,
        processing_stages: ["thinking", "writing"], resolved_model: "DeepSeek-V4-Flash",
        response_mode: "openai-compatible",
      },
    }],
    storage,
  });
  assert.equal(wrote, true);
  const cached = readChatHistoryCache({ accountScope: ACCOUNT_A, companionScope: COMPANION_A, storage });
  const message = cached.messages[0];
  assert.equal(message.visible_monologue, "这是可见心声，会渲染成一张卡片", "心声卡片会改变行高，必须保留");
  assert.deepEqual(message.tool_calls.music_card, { title: "小幸运", artist: "田馥甄", duration_seconds: 264 }, "歌曲卡片必须保留");
  assert.equal(message.tool_calls.co_watch_session_id, "cw-1");
  assert.equal(message.tool_calls.processing_stages, undefined, "内部阶段不影响行高，可以丢");
  assert.equal(message.tool_calls.resolved_model, undefined);
});
console.log("Chat history cache: isolation, versioning, expiry, trimming and quota handling passed");

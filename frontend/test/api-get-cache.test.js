import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CACHEABLE_GET_PREFIXES,
  COMPANION_SCOPED_PREFIXES,
  getCacheKey,
  isCacheableGetPath,
  isCompanionScopedPath,
} from "../src/api-get-cache.js";

test("合并白名单认得出启动期那些请求", () => {
  for (const path of [
    "/api/v2/bootstrap",
    "/api/v2/xinchao/state",
    "/api/v2/private-media/catalog",
    "/api/v2/special-dates",
    "/api/v2/fun-labs/interests",
    "/api/v2/fun-labs/recommend?limit=4",
    "/api/v2/chat-skin/preferences",
    "/api/v2/voice-output/status",
    "/api/v2/companion-state",
    "/models",
    "/health",
  ]) {
    assert.equal(isCacheableGetPath(path), true, `${path} 应该在白名单里`);
  }
  assert.ok(CACHEABLE_GET_PREFIXES.length >= 10);
});

test("聊天历史与流式接口绝不能被合并", () => {
  for (const path of [
    "/api/v2/sessions/abc/messages",
    "/api/v2/chat/stream",
    "/api/v2/push/messages?since=1",
    "/api/v2/settings",
    "/api/v2/memory/health",
    "/api/v2/co-watch/sessions",
  ]) {
    assert.equal(isCacheableGetPath(path), false, `${path} 不该被合并`);
  }
});

test("所有接口按账号、伴侣和会话修订隔离，匿名请求没有共享键", () => {
  const scope = { accountId: "account-a", companionId: "companion-a", revision: 1 };
  assert.equal(getCacheKey("/api/v2/bootstrap"), null);
  assert.equal(getCacheKey("/api/v2/bootstrap", {}), null);
  assert.equal(getCacheKey("/api/v2/bootstrap", scope), getCacheKey("/api/v2/bootstrap", { ...scope }));
  for (const patch of [{ accountId: "account-b" }, { companionId: "companion-b" }, { revision: 2 }]) {
    assert.notEqual(getCacheKey("/api/v2/bootstrap", scope), getCacheKey("/api/v2/bootstrap", { ...scope, ...patch }));
  }
});

test("随伴侣变化的接口必须按伴侣隔离", () => {
  assert.equal(isCompanionScopedPath("/api/v2/private-media/catalog"), true);
  assert.ok(COMPANION_SCOPED_PREFIXES.length >= 1);
  assert.notEqual(getCacheKey("/api/v2/private-media/catalog", { accountId: "a" }), getCacheKey("/api/v2/private-media/catalog", { accountId: "a", companionId: "companion-a" }));
  assert.notEqual(getCacheKey("/api/v2/private-media/catalog", { accountId: "a", companionId: "companion-a" }), getCacheKey("/api/v2/private-media/catalog", { accountId: "a", companionId: "companion-b" }));
});

console.log("API GET dedupe: whitelist, scope-aware keys and companion isolation passed");

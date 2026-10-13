import assert from "node:assert/strict";
import fs from "node:fs";
import { toggleMomentLikeOptimistically } from "../src/moment-like.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function updateEntries(entries, update) {
  return typeof update === "function" ? update(entries) : update;
}

const pendingRequest = deferred();
let entries = [
  { id: "assistant-1", user_liked: false },
  { id: "assistant-2", user_liked: false },
];
const success = toggleMomentLikeOptimistically({
  moment: entries[0],
  updateMoments(update) {
    entries = updateEntries(entries, update);
  },
  persist() {
    return pendingRequest.promise;
  },
});

assert.equal(
  entries[0].user_liked,
  true,
  "the like must become visible before the network request settles",
);
assert.equal(entries[1].user_liked, false);
pendingRequest.resolve();
await success;
assert.equal(entries[0].user_liked, true);

const failedRequest = deferred();
entries = [{ id: "assistant-1", user_liked: false }];
const failure = toggleMomentLikeOptimistically({
  moment: entries[0],
  updateMoments(update) {
    entries = updateEntries(entries, update);
  },
  persist() {
    return failedRequest.promise;
  },
});

assert.equal(entries[0].user_liked, true);
failedRequest.reject(new Error("network unavailable"));
await assert.rejects(failure, /network unavailable/);
assert.equal(
  entries[0].user_liked,
  false,
  "a failed request must restore the previous like state",
);

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const likeHandlerStart = app.indexOf("async function toggleMomentLike(moment)");
const likeHandlerEnd = app.indexOf(
  "async function postComment(momentId)",
  likeHandlerStart,
);
assert.ok(likeHandlerStart >= 0 && likeHandlerEnd > likeHandlerStart);
const likeHandler = app.slice(likeHandlerStart, likeHandlerEnd);

assert.match(
  likeHandler,
  /toggleMomentLikeOptimistically/,
  "the moments page must use the tested optimistic transaction",
);
assert.match(
  likeHandler,
  /pendingMomentLikesRef\.current/,
  "rapid repeated taps must share a synchronous pending guard",
);
assert.match(
  app,
  /aria-pressed=\{item\.user_liked === true\}/,
  "the like button must expose its optimistic pressed state",
);
assert.match(
  app,
  /aria-busy=\{Boolean\(pendingMomentLikes\[item\.id\]\)\}/,
  "the like button must expose persistence progress immediately",
);
assert.match(
  app,
  /disabled=\{Boolean\(pendingMomentLikes\[item\.id\]\)\}/,
  "the pending like must reject duplicate taps",
);
assert.doesNotMatch(
  app,
  /formatMomentReplyStatus|正在过来|正在看这条动态|reply_due_at/,
  "Moments must not expose internal scheduling or promise an AI reply",
);

const createHandlerStart = app.indexOf("async function createSession()");
const createHandlerEnd = app.indexOf(
  "function chooseSession(sessionId)",
  createHandlerStart,
);
assert.ok(createHandlerStart >= 0 && createHandlerEnd > createHandlerStart);
const createHandler = app.slice(createHandlerStart, createHandlerEnd);

assert.match(
  createHandler,
  /if \(createSessionPendingRef\.current\) return;/,
  "new-session requests must reject rapid duplicate taps synchronously",
);
assert.ok(
  createHandler.indexOf("setIsCreatingSession(true)") >= 0 &&
    createHandler.indexOf("setIsCreatingSession(true)") <
      createHandler.indexOf('apiRequest("/api/v2/sessions"'),
  "the new-session button must enter its pending state before the request",
);
assert.match(
  createHandler,
  /finally\s*\{[\s\S]*?createSessionPendingRef\.current = false;[\s\S]*?setIsCreatingSession\(false\);/,
  "new-session pending state must clear after success or failure",
);
assert.doesNotMatch(
  createHandler,
  /model_id\s*:/,
  "new-session creation must let the server bind the account default model",
);
assert.equal(
  (app.match(/aria-busy=\{isCreatingSession\}/g) || []).length,
  2,
  "both new-session entry points must expose progress to assistive technology",
);
assert.equal(
  (app.match(/disabled=\{isCreatingSession\}/g) || []).length,
  2,
  "both new-session entry points must reject duplicate taps while pending",
);
assert.match(
  app,
  /isCreatingSession \? "创建中" : "新对话"/,
  "the compact top button must replace its label immediately",
);

console.log("instant feedback tests passed");

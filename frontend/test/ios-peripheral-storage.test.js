import assert from "node:assert/strict";
import test from "node:test";
import { Capacitor } from "@capacitor/core";
import { stickerImportRequest } from "../src/sticker-import.js";
import { xhsStickerRequest } from "../src/xhs-sticker-import.js";
import { RECEIVER_TOKEN_KEY, readReceiverToken, storeReceiverToken } from "../src/cast-receiver-api.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const COMPANION = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

test("iOS import receipts never read or write a supplied plaintext fallback when the account vault is unavailable", () => {
  const originalPlatform = Capacitor.getPlatform;
  let reads = 0, writes = 0;
  const plaintext = { getItem() { reads++; return null; }, setItem() { writes++; }, removeItem() { writes++; } };
  try {
    Capacitor.getPlatform = () => "ios";
    const scope = JSON.stringify([ACCOUNT, COMPANION]);
    assert.equal(stickerImportRequest(scope, "BV1xx411c7mD", plaintext, () => REQUEST).client_request_id, REQUEST);
    assert.equal(xhsStickerRequest(scope, "a".repeat(24), plaintext, () => REQUEST).client_request_id, REQUEST);
    assert.deepEqual([reads, writes], [0, 0]);
  } finally { Capacitor.getPlatform = originalPlatform; }
});

test("an iOS receiver bearer token lives only in the current page and its legacy plaintext copy is erased", () => {
  const originalPlatform = Capacitor.getPlatform;
  const removed = [];
  const plaintext = {
    getItem() { assert.fail("iOS must not read a legacy bearer token"); },
    setItem() { assert.fail("iOS must not persist a receiver bearer token in Web Storage"); },
    removeItem(key) { removed.push(key); },
  };
  try {
    Capacitor.getPlatform = () => "ios";
    assert.equal(readReceiverToken(plaintext), "");
    assert.equal(storeReceiverToken(plaintext, "fictional-receiver-token"), "fictional-receiver-token");
    assert.deepEqual(removed, [RECEIVER_TOKEN_KEY, RECEIVER_TOKEN_KEY]);
  } finally { Capacitor.getPlatform = originalPlatform; }
});

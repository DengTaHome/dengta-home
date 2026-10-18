import test from "node:test";
import assert from "node:assert/strict";
import { validateXhsSearch, validateXhsImport, xhsStickerRequest, xhsStickerError } from "../src/xhs-sticker-import.js";
import { normalizeStickerSource } from "../src/sticker-import.js";
const note = "111111111111111111111111", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("XHS receipts validate notes and private UUIDs; source URLs never come from upstream text", () => {
  const result = validateXhsSearch({ ok: true, result: { items: [{ note_id: note, title: "开心~", author: "虚构作者", url: "javascript:fictional" }] } });
  assert.deepEqual(result, [{ note_id: note, title: "开心~", creator: "虚构作者" }]);
  const data = { ok: true, asset: { id, purpose: "custom_sticker", status: "active" }, source: { provider: "xiaohongshu", note_id: note, page_url: "https://untrusted.invalid/private" } };
  assert.equal(validateXhsImport(data).source.page_url, `https://www.xiaohongshu.com/explore/${note}`);
  assert.equal(normalizeStickerSource(data.source).page_url, `https://www.xiaohongshu.com/explore/${note}`);
  for (const input of [{}, { ...data, asset: { ...data.asset, id: "not-an-asset" } }, { ...data, source: { provider: "bilibili", note_id: note } }]) assert.throws(() => validateXhsImport(input), { code: "sticker_import_receipt_invalid" });
  assert.throws(() => validateXhsSearch({ ok: true, result: { items: [{ note_id: "../private", title: "x", author: "x" }] } }), { code: "sticker_import_receipt_invalid" });
});
test("XHS retry IDs survive reloads and stay separate for notes, providers and scope", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; let sequence = 0;
  const uuid = () => ++sequence === 1 ? id : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const a = xhsStickerRequest("account-a:companion-a", note, storage, uuid);
  assert.deepEqual(xhsStickerRequest("account-a:companion-a", note, storage, uuid), a);
  assert.notEqual(xhsStickerRequest("account-b:companion-a", note, storage, uuid).client_request_id, a.client_request_id);
  assert.notEqual(xhsStickerRequest("account-a:companion-a", "222222222222222222222222", storage, uuid).client_request_id, a.client_request_id);
  assert.ok([...values.keys()].every(key => key.startsWith("dengta-xhs-sticker-import:")));
});
test("XHS errors distinguish expired login, verification and missing provenance without private upstream text", () => {
  for (const code of ["cookie_expired", "verification_required", "xhs_note_lookup_required", "xhs_session_isolation_required", "sticker_import_source_invalid"]) { const text = xhsStickerError({ code, message: "fictional-private-cookie" }); assert.ok(text.includes(code)); assert.ok(!text.includes("fictional-private-cookie")); assert.ok(!text.includes("B站")); }
});

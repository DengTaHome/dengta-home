import test from "node:test";
import assert from "node:assert/strict";
import { filterStickerShelf, importStickerFiles } from "../src/sticker-shelf.js";

test("sticker search matches names, descriptions and mood together without altering library", () => {
  const assets = [{ id: "1", purpose: "custom_sticker", display_name: "小熊", alt_text: "抱着星星", mood_tags: ["HUG"] },
    { id: "2", purpose: "user_avatar", display_name: "小熊" }];
  const copy = structuredClone(assets);
  assert.deepEqual(filterStickerShelf(assets, "小熊 ｈｕｇ").map(item => item.id), ["1"]);
  assert.deepEqual(filterStickerShelf(assets, "晚安"), []);
  assert.deepEqual(assets, copy);
});
test("batch import keeps individual receipts and does not retry ambiguous failures", async () => {
  const calls = [];
  const files = [{ name: "小熊.png", type: "image/png" }, { name: "矢量.svg", type: "image/svg+xml" },
    { name: "海浪.webp", type: "image/webp" }, { name: "星星.jpg", type: "image/jpeg" }];
  const results = await importStickerFiles(files, { upload: async values => {
    calls.push(values); if (values.image.name === "海浪.webp") throw Object.assign(new Error("private body"), { code: "upload_timeout" });
    return { ok: true, asset: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "custom_sticker" } };
  } });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].displayName, "小熊");
  assert.deepEqual(results.map(item => item.ok), [true, false, false, true]);
  assert.equal(results[2].code, "upload_timeout");
  assert.doesNotMatch(JSON.stringify(results), /private body/);
});
test("GIF reaches the private upload while complexity errors get actionable feedback", async () => {
  let calls = 0;
  const results = await importStickerFiles([{ name: "wave.gif", type: "image/gif" }, { name: "large.gif", type: "image/gif" }], {
    upload: async ({ image }) => {
      calls++; if (image.name === "large.gif") throw { code: "private_media_animation_too_complex", message: "private upstream body" };
      return { asset: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "custom_sticker" } };
    },
  });
  assert.equal(calls, 2); assert.equal(results[0].ok, true);
  assert.match(results[1].message, /缩小尺寸.*240/); assert.doesNotMatch(results[1].message, /private upstream/);
});
test("switching scope during first upload prevents the remainder of a batch", async () => {
  let current = true, uploads = 0;
  await assert.rejects(importStickerFiles([{ type: "image/png" }, { type: "image/png" }], {
    isCurrent: () => current, upload: async () => { uploads++; current = false; },
  }), { name: "AbortError" });
  assert.equal(uploads, 1);
});
test("batch import confirms only valid sticker receipts without replaying ambiguous uploads", async () => {
  const receipts = [undefined, {}, { ok: true, asset: { id: "invalid", purpose: "custom_sticker" } },
    { ok: true, asset: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "user_avatar" } },
    { ok: false, asset: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", purpose: "custom_sticker" } },
    { ok: true, asset: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", purpose: "custom_sticker" } }];
  let calls = 0;
  const confirmed = [];
  const results = await importStickerFiles(receipts.map((_, index) => ({ name: `fictional-${index}.png`, type: "image/png" })), {
    upload: async () => receipts[calls++], onConfirmed: asset => confirmed.push(asset.id),
  });
  assert.equal(calls, receipts.length, "an invalid receipt must never cause an automatic re-upload");
  assert.deepEqual(results.map(item => item.ok), [false, false, false, false, false, true]);
  assert.ok(results.slice(0, -1).every(item => item.code === "private_media_receipt_invalid"));
  assert.deepEqual(confirmed, ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
});

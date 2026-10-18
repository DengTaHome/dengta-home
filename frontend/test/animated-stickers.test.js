import test from "node:test";
import assert from "node:assert/strict";
import { isAnimatedStickerBlob, stickerPosterPath } from "../src/animated-stickers.js";

test("WebP animation detection reads only its small container header", async () => {
  const header = new Uint8Array(30);
  for (const [offset, value] of [[0, "RIFF"], [8, "WEBP"], [12, "VP8X"]]) {
    for (let i = 0; i < value.length; i++) header[offset + i] = value.charCodeAt(i);
  }
  const calls = [];
  const blob = { size: 12 * 1024 * 1024, slice(start, end) {
    calls.push([start, end]); return new Blob([header.slice(start, end)]);
  } };
  header[20] = 2;
  assert.equal(await isAnimatedStickerBlob(blob), true);
  assert.deepEqual(calls, [[0, 21]], "do not copy the full 12MB sticker to detect animation");
  header[20] = 16; assert.equal(await isAnimatedStickerBlob(blob), false, "alpha alone does not mean animation");
  header[0] = 0; header[20] = 2; assert.equal(await isAnimatedStickerBlob(blob), false);
  assert.equal(await isAnimatedStickerBlob(new Blob(["small"])), false);
});

test("poster variants only use authenticated canonical private asset paths", () => {
  const path = "/api/v2/private-media/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content";
  assert.equal(stickerPosterPath(path), `${path}?poster=1`);
  for (const source of ["https://external.test/a.gif", path + "?external=1", path.replace("4aaa", "0aaa"), path.replace("content", "source"), "", null]) {
    assert.equal(stickerPosterPath(source), "");
  }
});

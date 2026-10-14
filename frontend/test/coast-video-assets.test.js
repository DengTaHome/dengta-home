import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { COAST_VIDEO_SCENES } from "../src/coast-video-lifecycle.js";

function atoms(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    assert.ok(offset + 8 <= end, "MP4 atom header must be complete");
    let size = buffer.readUInt32BE(offset), header = 8;
    if (size === 1) { size = Number(buffer.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    assert.ok(size >= header && offset + size <= end, "MP4 atom must stay within its parent");
    result.push({ type: buffer.toString("ascii", offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
function child(buffer, parent, type) {
  const value = atoms(buffer, parent.start, parent.end).find(atom => atom.type === type);
  assert.ok(value, `Required MP4 atom ${type} must exist`);
  return value;
}
const publicFile = url => fs.readFileSync(new URL(`../public${url}`, import.meta.url));

test("all three production coast clips have one silent H.264 track, 720×1280 frames, and fast-start metadata", () => {
  let total = 0;
  for (const scene of Object.values(COAST_VIDEO_SCENES)) {
    const buffer = publicFile(scene.video);
    total += buffer.length;
    const top = atoms(buffer), moov = top.find(atom => atom.type === "moov");
    assert.equal(top[0].type, "ftyp");
    assert.ok(moov && top.findIndex(atom => atom.type === "moov") < top.findIndex(atom => atom.type === "mdat"), "metadata must precede video payload for immediate playback");
    const tracks = atoms(buffer, moov.start, moov.end).filter(atom => atom.type === "trak");
    assert.equal(tracks.length, 1, "decorative loops must not include audio");
    const track = tracks[0], tkhd = child(buffer, track, "tkhd"), mdia = child(buffer, track, "mdia");
    assert.equal(buffer.readUInt32BE(tkhd.end - 8) / 65536, 720);
    assert.equal(buffer.readUInt32BE(tkhd.end - 4) / 65536, 1280);
    const hdlr = child(buffer, mdia, "hdlr");
    assert.equal(buffer.toString("ascii", hdlr.start + 8, hdlr.start + 12), "vide");
    const mdhd = child(buffer, mdia, "mdhd");
    assert.equal(buffer[mdhd.start], 0);
    assert.equal(buffer.readUInt32BE(mdhd.start + 16) / buffer.readUInt32BE(mdhd.start + 12), 8);
    const minf = child(buffer, mdia, "minf"), stbl = child(buffer, minf, "stbl"), stsd = child(buffer, stbl, "stsd"), stsz = child(buffer, stbl, "stsz");
    assert.equal(buffer.readUInt32BE(stsd.start + 4), 1);
    assert.equal(buffer.toString("ascii", stsd.start + 12, stsd.start + 16), "avc1");
    assert.equal(buffer.readUInt32BE(stsz.start + 8), 192);
    const poster = publicFile(scene.poster);
    assert.equal(poster.toString("ascii", 0, 4), "RIFF");
    assert.equal(poster.toString("ascii", 8, 12), "WEBP");
    assert.ok(poster.length < 100_000, "still fallback should remain lightweight");
  }
  assert.ok(total < 1_000_000, `all bundled videos together must remain below 1 MB: ${total}`);
});

test("the user-approved diary coast artwork stays byte-for-byte unchanged", () => {
  const bytes = publicFile("/assets/journal-coast.webp");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "d9cd018430e401b747fe75ccff65f2cb464e253ed631dad378e0f4cb8ff3d136");
});

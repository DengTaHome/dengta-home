import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { openAsBlob } from "node:fs";
import { open, mkdir, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { readTextFileBatches, sampleLargeTextFile } from "../src/large-text-file.js";
import { fingerprintImportFile } from "../src/import-file-fingerprint.js";
import { previewContentImportPage } from "../src/content-import-api.js";

const require = createRequire(import.meta.url);
const { previewInput } = require("../../backend/routes/v2/imports.js");
const { extractText } = require("../../backend/services/adaptive-file-parser.js");
const MiB = 1024 ** 2;
const output = path.resolve("../artifacts/dengta-design-polish-20261007/round13-product-flow");
const bytes = Number(process.env.DENGTA_CAPACITY_BYTES || 24 * MiB);

async function parsedPageClient(received) {
  return { apiFetch: async (requestPath, options) => {
    assert.equal(requestPath, "/api/v2/imports/preview");
    assert.equal(options.retry, false);
    const part = options.body.get("file");
    const parsed = await previewInput({ file: { originalname: part.name, mimetype: part.type, buffer: Buffer.from(await part.arrayBuffer()) }, body: { source_type: options.body.get("kind") } });
    received.push(parsed);
    return { ok: true, json: async () => ({ ok: true, result: { import: { id: "synthetic-preview", status: "preview" }, candidates: [] } }) };
  } };
}

test("paged TSV keeps quoted multiline rows intact for the actual server parser", async () => {
  const source = 'role\ttext\nassistant\t"' + "虚构星灯故事\n".repeat(6000) + '"\nuser\t结束\n';
  const file = new File([source], "synthetic.tsv");
  const expected = await extractText(file.name, Buffer.from(source));
  const received = [], client = await parsedPageClient(received);
  let startByte = 0;
  while (startByte < file.size) {
    const { page } = await previewContentImportPage({ file, kind: "chat_history", startByte }, client);
    assert.equal(page.startByte, startByte);
    assert.ok(page.endByte > startByte);
    startByte = page.endByte;
  }
  assert.equal(received.map(row => row.bytes.toString("utf8")).join("\n"), expected.text);
});

test("actual disk file is bounded, cancellable, resumable, fingerprintable and sampled without full-string reads", { timeout: 300000 }, async () => {
  assert.ok(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 1024 ** 3 && bytes % 64 === 0);
  await mkdir(output, { recursive: true });
  const filename = path.join(output, `import-synthetic-${bytes}.txt`);
  assert.equal(path.dirname(filename), output);
  const line = Buffer.from("user: 虚构容量测试。", "utf8");
  const record = Buffer.alloc(64, 32); line.copy(record); record[63] = 10;
  const chunk = Buffer.alloc(MiB); for (let offset = 0; offset < chunk.length; offset += record.length) record.copy(chunk, offset);
  const baseline = createHash("sha256"), generatedAt = performance.now();
  const handle = await open(filename, "wx");
  try {
    for (let offset = 0; offset < bytes; offset += chunk.length) {
      const part = chunk.subarray(0, Math.min(chunk.length, bytes - offset));
      await handle.write(part); baseline.update(part);
    }
  } finally { await handle.close(); }
  const expectedHash = baseline.digest("hex");
  const timings = { generationMs: performance.now() - generatedAt };
  const maxima = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  const rememberMemory = () => { const memory = process.memoryUsage(); for (const key of Object.keys(maxima)) maxima[key] = Math.max(maxima[key], memory[key]); };
  let maxRead = 0, readCalls = 0, coveredBytes = 0, batches = 0;
  const raw = await openAsBlob(filename), tracked = { name: "synthetic.txt", size: raw.size, slice(start, end) { readCalls++; maxRead = Math.max(maxRead, end - start); return raw.slice(start, end); } };
  assert.equal(tracked.size, bytes);
  const cancel = new AbortController(), observed = createHash("sha256"), scanAt = performance.now();
  try {
    await assert.rejects(async () => {
      for await (const batch of readTextFileBatches(tracked, { signal: cancel.signal })) {
        assert.equal(batch.startByte, coveredBytes); observed.update(batch.text, "utf8"); coveredBytes = batch.endByte; batches++; rememberMemory();
        if (batches === 3) cancel.abort();
      }
    }, { code: "import_cancelled" });
    assert.equal(coveredBytes, 3 * MiB);
    const resumedAt = coveredBytes;
    for await (const batch of readTextFileBatches(tracked, { startByte: resumedAt })) {
      assert.equal(batch.startByte, coveredBytes); observed.update(batch.text, "utf8"); coveredBytes = batch.endByte; batches++; rememberMemory();
    }
    timings.cancelAndResumeMs = performance.now() - scanAt;
    assert.equal(coveredBytes, bytes);
    assert.equal(observed.digest("hex"), expectedHash);
    const fingerprintAt = performance.now();
    assert.equal(await fingerprintImportFile(tracked, { onProgress: rememberMemory }), expectedHash);
    timings.fingerprintMs = performance.now() - fingerprintAt;
    const sampleAt = performance.now();
    const sample = await sampleLargeTextFile(tracked, { onProgress: rememberMemory });
    timings.sampleMs = performance.now() - sampleAt;
    assert.equal(sample.size, bytes); assert.ok(sample.included_characters <= 60000); assert.equal(sample.truncated, true);
    assert.ok(maxRead <= MiB);
    const received = [], client = await parsedPageClient(received);
    const pageAt = performance.now(), endStart = bytes - 128 * 1024;
    let next = endStart;
    while (next < bytes) { const { page } = await previewContentImportPage({ file: tracked, kind: "chat_history", startByte: next }, client); assert.equal(page.startByte, next); next = page.endByte; rememberMemory(); }
    timings.endPagesMs = performance.now() - pageAt;
    assert.equal(received.length, 2);
    const result = { timestamp: new Date().toISOString(), runtime: process.version, bytes, realDiskFile: true, filesystemBackedBlob: true, fullBytesDecoded: coveredBytes, cancellationByte: resumedAt, fullReadSha256Matches: true, fingerprintMatches: true, maxSliceBytes: maxRead, readCalls, decodeBatches: batches, sampleCharacters: sample.included_characters, sampleBatches: sample.batches, finalPageRequests: received.length, finalPageStartByte: endStart, finalPageEndByte: next, timings, maximaBytes: maxima, fixtureDeleted: false, networkRequests: 0, databaseWrites: 0, productionAccepted: false, androidAccepted: false };
    await unlink(filename); result.fixtureDeleted = true;
    await writeFile(path.join(output, `import-capacity-${bytes}.json`), JSON.stringify(result, null, 2));
    console.log("capacity evidence", JSON.stringify(result));
  } finally { await unlink(filename).catch(error => { if (error.code !== "ENOENT") throw error; }); }
});

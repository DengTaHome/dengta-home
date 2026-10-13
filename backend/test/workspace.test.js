"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { listWorkspace, readWorkspaceFile, writeWorkspaceFile } = require("../services/workspace");
const { collectStats } = require("../routes/v2/workspace");

const file = (name, size = 5) => ({ name, id: `fixture-${name}`, metadata: { mimetype: "application/octet-stream", size } });
const folder = name => ({ name, id: null, metadata: null });
function storageFixture(tree, text = "", failure = null) {
  const calls = []; let writes = 0;
  return {
    calls, get writes() { return writes; },
    from(bucket) {
      assert.equal(bucket, "user-workspace");
      return {
        async list(path, options) {
          calls.push({ path, ...options });
          if (failure) return { error: failure };
          return { data: (tree[path] || []).slice(options.offset || 0, (options.offset || 0) + options.limit) };
        },
        async download() { return { data: new Blob([text]) }; },
        async upload() { writes += 1; return {}; },
      };
    },
  };
}
test("real Storage folder records are navigable and binary MIME files remain files", async () => {
  const storage = storageFixture({ "fixture-user": [folder("docs"), file("empty.bin", 0)] });
  const result = await listWorkspace({ storage, userId: "fixture-user" });
  assert.deepEqual(result.entries.map(item => [item.name, item.type]), [["docs", "dir"], ["empty.bin", "file"]]);
  assert.equal(storage.calls[0].path, "fixture-user");
});
test("stats traverse nested folders, paginate, count empty files and remain tenant scoped", async () => {
  const storage = storageFixture({
    "fixture-user": [folder("docs"), ...Array.from({ length: 220 }, (_, n) => file(`root-${n}`, 2)), file("empty", 0)],
    "fixture-user/docs": [file("child", 3), folder("nested")],
    "fixture-user/docs/nested": [file("deep", 7)],
  });
  const counts = { files: 0, bytes: 0, items: 0, partial: false };
  await collectStats(storage, "user-workspace", "fixture-user/", 0, counts);
  assert.equal(counts.files, 223); assert.equal(counts.bytes, 450); assert.equal(counts.partial, false);
  assert.ok(storage.calls.some(call => call.offset === 200));
  assert.ok(storage.calls.every(call => call.path === "fixture-user" || call.path.startsWith("fixture-user/")));
});
test("stats report depth/item limits and never disguise Storage errors as empty success", async () => {
  const storage = storageFixture({ "a": Array.from({ length: 650 }, (_, n) => file(`f-${n}`)) });
  const counts = { files: 0, bytes: 0, items: 0, partial: false };
  await collectStats(storage, "user-workspace", "a", 0, counts);
  assert.equal(counts.items, 500); assert.equal(counts.partial, true);
  const deep = { files: 0, bytes: 0, items: 0, partial: false };
  await collectStats(storage, "user-workspace", "a", 3, deep);
  assert.equal(deep.partial, true);
  await assert.rejects(collectStats(storageFixture({}, "", new Error("fixture failure")), "user-workspace", "a", 0, { files: 0, bytes: 0, items: 0 }), /fixture failure/);
});
test("Unicode truncation uses characters, and append cannot overwrite the unseen tail", async () => {
  const text = "中".repeat(100000);
  const small = await readWorkspaceFile({ storage: storageFixture({}, text), userId: "a", path: "note.txt" });
  assert.equal(small.truncated, false); assert.equal(small.content, text);
  const storage = storageFixture({}, "x".repeat(200001));
  const preview = await readWorkspaceFile({ storage, userId: "a", path: "note.txt" });
  assert.equal(preview.truncated, true);
  const append = await writeWorkspaceFile({ storage, userId: "a", path: "note.txt", mode: "append", content: "new" });
  assert.equal(append.ok, false); assert.equal(append.code, "workspace_append_truncated"); assert.equal(storage.writes, 0);
});

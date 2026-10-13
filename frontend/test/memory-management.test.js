import assert from "node:assert/strict";
import fs from "node:fs";

const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);

const memorySource = fs.readFileSync(new URL("../src/LocalMemorySummaries.jsx", import.meta.url), "utf8");
assert.match(appSource, /<LocalMemorySummaries[\s\S]*?scopeKey=\{privateMediaScope\}[\s\S]*?items=\{memories\}[\s\S]*?drafts=\{memoryDrafts\}/);
assert.match(appSource, /onItemsChange=\{setMemories\}[\s\S]*?onDraftsChange=\{setMemoryDrafts\}/);
assert.match(memorySource, /const PATH = "\/api\/v2\/memories"/);
assert.match(memorySource, /\$\{PATH\}\/\$\{item\.id\}/);
assert.match(memorySource, /method:\s*"PATCH"/);
assert.match(memorySource, /method:\s*"DELETE"/);
assert.match(memorySource, /aria-label="修改长期记忆"/);
assert.match(memorySource, />\s*修改\s*</);
assert.match(memorySource, /:\s*"删除"/);

console.log("memory edit and delete UI checks passed");

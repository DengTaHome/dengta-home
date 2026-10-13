import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(
  new URL("../src/ExternalMemoryConnections.jsx", import.meta.url),
  "utf8"
);
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const ombre = fs.readFileSync(
  new URL("../src/OmbreMemories.jsx", import.meta.url),
  "utf8"
);
const css = fs.readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8"
);

assert.match(component, /\/api\/external-memory\/connections/);
assert.match(component, /supabase_memory/);
assert.match(component, /ombre_brain_mcp/);
assert.match(component, /Publishable \/ anon public key/);
assert.match(component, /不要填写 service_role/);
assert.match(component, /固定只读专用表/);
assert.match(component, /value="dengta_memories"[\s\S]{0,80}readOnly/);
assert.match(component, /\/supabase_memory\/preview\?limit=20/);
assert.match(component, /\/supabase_memory\/import/);
assert.match(component, /不会自动双向同步/);
assert.match(component, /count_mode === "synchronized"/);
assert.match(component, /新增与更新合并计数/);
assert.match(component, /重复导入会覆盖更新，不会重复新增/);
assert.match(component, /凭据不会回显/);
assert.match(component, /credential_reentry_required/);
assert.match(component, /method: "DELETE"/);
assert.match(component, /const \[expandedTypes, setExpandedTypes\]/);
assert.match(component, /aria-expanded=\{expanded\}/);
assert.match(component, /新建自己的 Supabase 记忆连接（可选）/);
assert.match(component, /连接自己的 Ombre Brain（可选）/);
assert.match(component, /公开密钥不等于私密授权/);
assert.match(component, /同项目的其他匿名客户端也可能读取/);
assert.match(component, /最小\s+SELECT/);
assert.match(component, /RLS policy/);
assert.match(component, /可撤销只读\s+Token/);
assert.match(component, /Edge Function/);
assert.match(component, /当前 MVP\s+暂不支持/);
assert.doesNotMatch(component, /Service role key/i);
assert.match(app, /ExternalMemoryConnections/);
assert.match(app, /dengta:memories-imported/);
assert.match(ombre, /onManageConnections/);
assert.match(ombre, /accountOmbreConnection/);
assert.match(ombre, /DengTa 主记忆库已启用/);
assert.match(ombre, /不需要填写任何外部数据库/);
assert.match(ombre, /连接自己的外部记忆库（可选）/);
assert.match(css, /\.external-memory-connections/);
assert.match(css, /\.ombre-optional-entry/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.external-memory-grid/);

console.log("External memory connection UI tests passed");

import assert from "node:assert/strict";
import { refusalDisplayFields } from "../src/refusal-diagnostic.js";

// --- 后端新格式：reason 已经带上原文 ---
{
  const fields = refusalDisplayFields({
    code: "provider_boundary_residue",
    source: "upstream",
    reason: "模型拒绝回答（错误码 provider_boundary_residue）：抱歉，我无法为这类内容提供回复选项。",
    excerpt: "抱歉，我无法为这类内容提供回复选项。",
    model: "fixture-model",
    provider: "custom"
  });

  assert.equal(fields.code, "provider_boundary_residue", "the code is surfaced");
  assert.match(
    fields.sourceLabel,
    /上游模型/,
    "an upstream refusal explains that DongTa's prompt allows adult content and the provider blocked it"
  );
  assert.match(fields.reason, /模型拒绝回答/, "the plain-language reason is shown");
  assert.equal(
    fields.excerpt,
    "",
    "when the reason already quotes the text, the excerpt is not printed twice"
  );
  assert.match(fields.provenance, /fixture-model/, "the model is shown");
  assert.match(fields.provenance, /custom/, "the provider is shown");
}

// --- 只有 excerpt 的老格式：仍然要能看到原文 ---
{
  const fields = refusalDisplayFields({
    code: "provider_boundary_residue",
    source: "local",
    excerpt: "抱歉，我无法继续。"
  });
  assert.equal(fields.sourceLabel, "DengTa 自身过滤", "a local block is labelled as DongTa's own filter");
  assert.equal(fields.reason, "", "there is no reason line without a reason");
  assert.equal(fields.excerpt, "抱歉，我无法继续。", "the excerpt is shown instead");
  assert.equal(fields.provenance, "", "no model or provider means no provenance line");
}

// --- 更老：只有 refusal_text ---
{
  const fields = refusalDisplayFields({ refusal_text: "cannot help with that" });
  assert.equal(fields.excerpt, "cannot help with that", "raw refusal_text is still rendered");
}

// --- 空对象：必须有可用默认值，不能渲染空白告警 ---
{
  const fields = refusalDisplayFields({});
  assert.equal(fields.code, "provider_boundary_residue", "the code falls back to the canonical one");
  assert.match(fields.sourceLabel, /上游模型/, "the source falls back to upstream");
  assert.equal(fields.reason, "", "no invented reason");
  assert.equal(fields.excerpt, "", "no invented excerpt");
}

// --- null / undefined ---
{
  for (const value of [null, undefined]) {
    const fields = refusalDisplayFields(value);
    assert.equal(fields.code, "provider_boundary_residue", "null still yields a usable code");
    assert.ok(fields.sourceLabel.length > 0, "null still yields a source label");
  }
}

// --- 值不是字符串时不能渲染出 "undefined" ---
{
  const fields = refusalDisplayFields({ code: 42, excerpt: { bad: true }, model: null });
  assert.equal(fields.code, "provider_boundary_residue", "a non-string code is ignored");
  assert.equal(fields.excerpt, "", "a non-string excerpt is ignored");
  assert.equal(fields.provenance, "", "a null model produces no provenance");
}

// --- 只给空白 ---
{
  const fields = refusalDisplayFields({ reason: "   ", excerpt: "  ", model: "  " });
  assert.equal(fields.reason, "", "whitespace-only reason is treated as empty");
  assert.equal(fields.excerpt, "", "whitespace-only excerpt is treated as empty");
  assert.equal(fields.provenance, "", "whitespace-only model is treated as empty");
}

console.log(
  "Refusal diagnostics UI: upstream and local labels, reason without duplicate excerpt, legacy refusal_text, empty and null inputs, non-string values and whitespace handling passed"
);

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
try {
  const { buildStreamChatFormData } = await vite.ssrLoadModule("/src/api.js");
  await test("actual chat multipart encoder and decoder preserve wave marks and other Unicode text", async () => {
    for (const message of ["~", "～", "〜", "\\~", "在呢乖乖~", "在呢乖乖～", "在呢乖乖\\~", "在呢乖乖", "🙂👩🏽‍💻 & < > \" ' \\", "一行\n第二行~"]) {
      const form = buildStreamChatFormData({ message, model: "fictional-model", client_message_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      assert.equal(form.get("message"), message);
      const parsed = await new Request("http://127.0.0.1/synthetic-no-fetch", { method: "POST", body: form }).formData();
      // Multipart form encoding canonicalizes line endings to CRLF.
      assert.equal(parsed.get("message"), message.replace(/\r\n|\r|\n/g, "\r\n")); assert.equal(parsed.get("model"), "fictional-model");
    }
  });
} finally { await vite.close(); }

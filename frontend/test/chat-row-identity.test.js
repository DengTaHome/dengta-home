import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { mergeStreamedAssistantMessage } from "../src/chat-thinking.js";

test("server acknowledgements keep real chat bubbles mounted while reference IDs and content update", async () => {
  const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT, priorFixture = globalThis.__rowIdentity;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const mounts = [], unmounts = [];
  globalThis.__rowIdentity = { mounts, unmounts };
  const vite = await createServer({ envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false },
    plugins: [{ name: "observe-real-bubble-mounts", enforce: "pre", transform(source, id) {
      if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/ChatMessage.jsx")) return source.replace("const rowRef = useRef(null);",
        'useEffect(() => { globalThis.__rowIdentity.mounts.push(item.id); return () => globalThis.__rowIdentity.unmounts.push(item.id); }, []);\n  const rowRef = useRef(null);');
    } }] });
  let tree;
  try {
    const { default: Transcript } = await vite.ssrLoadModule("/src/ChatTranscript.jsx");
    const preferences = { skin: "classic-glass", reduceMotion: true };
    let referenced;
    let messages = [{ id: "local-user-fixture", role: "user", content: "在呢乖乖~", created_at: "2026-10-16T00:00:00Z" },
      { id: "local-assistant-fixture", role: "assistant", content: "接住~", isStreaming: true, created_at: "2026-10-16T00:00:01Z" }];
    const element = () => React.createElement(Transcript, { messages, preferences, onReference: message => { referenced = message.id; } });
    await act(async () => { tree = TestRenderer.create(element()); });
    assert.deepEqual(mounts, ["local-user-fixture", "local-assistant-fixture"]);
    messages = [{ id: "1001", role: "user", content: "在呢乖乖~", renderKey: messages[0].id, created_at: messages[0].created_at }, messages[1]];
    await act(async () => tree.update(element()));
    messages = [messages[0], mergeStreamedAssistantMessage(messages[1], { id: "1002", role: "assistant", content: "接住~🙂", renderKey: "foreign-server-key", created_at: messages[1].created_at })];
    await act(async () => tree.update(element()));
    assert.equal(messages[1].renderKey, "local-assistant-fixture", "server data cannot replace the local presentation identity");
    assert.equal(mounts.length, 2); assert.equal(unmounts.length, 0);
    assert.ok(JSON.stringify(tree.toJSON()).includes("接住~🙂"));
    await act(async () => tree.root.findAllByType("button").find(button => button.props["aria-label"] === "引用你的这条消息").props.onClick());
    assert.equal(referenced, "1001", "stable presentation must still reference the real committed message");
    const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(app, /\.\.\.event\.user_message,\s*renderKey: item\.renderKey \?\? item\.id,/);
  } finally {
    if (tree) await act(async () => tree.unmount()); await vite.close();
    if (priorFixture === undefined) delete globalThis.__rowIdentity; else globalThis.__rowIdentity = priorFixture;
    if (priorAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct;
  }
});

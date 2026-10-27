import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { chatDraftKey, createChatDraft, createChatDrafts } from "../src/chat-draft.js";
import { CHAT_ACTIVITIES, appendActivityDraft } from "../src/chat-activities.js";
import { restoreChatRetryText } from "../src/chat-idempotency.js";

const values = new Map(), writes = [];
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push(key); }, removeItem: (key) => { values.delete(key); writes.push(key); } };
const originals = new Map();
function stub(name, value) { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
stub("window", new EventTarget());
stub("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
stub("localStorage", storage);
stub("IS_REACT_ACT_ENVIRONMENT", true);
const key = chatDraftKey("a", "c", "s");
assert.notEqual(key, chatDraftKey("b", "c", "s"));
assert.notEqual(key, chatDraftKey("a", "d", "s"));
assert.notEqual(chatDraftKey("a:b", "c", null), chatDraftKey("a", "b:c", null));
assert.equal(chatDraftKey("", "c", "s"), null);
values.set("dengta_chat_draft_s", "legacy fixture");
const draft = createChatDraft(key, storage);
assert.equal(draft.getSnapshot(), "");
const stop = draft.subscribe(() => {});
draft.set("a fresh draft");
assert.equal(values.has(key), false);
stop();
assert.equal(values.get(key), "a fresh draft", "unmount flushes before debounce fires");
draft.set("");
assert.equal(values.has(key), false, "send clears persisted text immediately");
assert.equal(values.get("dengta_chat_draft_s"), "legacy fixture", "unscoped legacy data is not guessed, imported or deleted");
const broken = createChatDraft(key, { getItem() { throw Error(); }, setItem() { throw Error(); } });
broken.set("in memory");
assert.equal(broken.getSnapshot(), "in memory");
const drafts = createChatDrafts("a", "c", storage);
drafts.get(null).set("typed while creating session");
drafts.move(null, "new");
assert.equal(drafts.get(null).getSnapshot(), "");
assert.equal(drafts.get("new").getSnapshot(), "typed while creating session");
drafts.setSession("new", current => restoreChatRetryText(current, "failed request"));
assert.ok(drafts.get("new").getSnapshot().includes("typed while creating session"));
const trailing = createChatDraft("debounce-fixture", storage);
const unsub = trailing.subscribe(() => {});
trailing.set("first"); trailing.set("last");
await new Promise(resolve => setTimeout(resolve, 900));
assert.equal(values.get("debounce-fixture"), "last");
assert.equal(writes.filter(x => x === "debounce-fixture").length, 1);
unsub();

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
let tree;
try {
  const { useChatDraft } = await vite.ssrLoadModule("/src/use-chat-draft.js");
  let state;
  function Composer({ account = "user-a", companion = "pet-a", session = "one" }) {
    state = useChatDraft(account, companion, session);
    return React.createElement("textarea", { value: state[0], onChange: e => state[1](e.target.value) });
  }
  await act(async () => { tree = TestRenderer.create(React.createElement(React.StrictMode, null, React.createElement(Composer))); });
  await act(async () => state[1]("session one draft"));
  await act(async () => tree.update(React.createElement(Composer, { session: "two" })));
  assert.equal(state[0], "", "empty session never displays previous text");
  await act(async () => state[1]("session two draft"));
  await act(async () => tree.update(React.createElement(Composer, { session: "one" })));
  assert.equal(state[0], "session one draft");
  const delayedRestore = state[2];
  await act(async () => tree.update(React.createElement(Composer, { account: "user-b" })));
  assert.equal(state[0], "", "account boundary");
  await act(async () => delayedRestore("one", current => current + " recovered"));
  assert.equal(state[0], "", "late work cannot target the new account");
  await act(async () => tree.update(React.createElement(Composer, { companion: "pet-b" })));
  assert.equal(state[0], "", "companion boundary");
  await act(async () => state[1]("pagehide draft"));
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(values.get(chatDraftKey("user-a", "pet-b", "one")), "pagehide draft");
  await act(async () => state[1]("background draft"));
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(values.get(chatDraftKey("user-a", "pet-b", "one")), "background draft");
  await act(async () => tree.unmount()); tree = null;

  const { default: Activities } = await vite.ssrLoadModule("/src/ChatActivities.jsx");
  const choices = [];
  await act(async () => { tree = TestRenderer.create(React.createElement(Activities, { onChoose: text => choices.push(text) })); });
  const button = title => tree.root.findAllByType("button").find(node => node.children.join("") === title || node.findAllByType("strong").some(strong => strong.children.join("") === title));
  await act(async () => button("雨夜的无人书店").props.onClick());
  assert.equal(choices.length, 0, "choosing a card does not send or insert");
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "  my edited opening\n" } }));
  await act(async () => button("放进输入框").props.onClick());
  assert.deepEqual(choices, ["  my edited opening\n"]);
  assert.equal(appendActivityDraft("existing draft", choices[0]), "existing draft\n\n  my edited opening\n");
  await act(async () => button("一起做件小事").props.onClick());
  await act(async () => button("只整理一个小角落").props.onClick());
  assert.equal(tree.root.findByType("textarea").props.value, CHAT_ACTIVITIES.find(x => x.id === "tiny-tidy").prompt);
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "  " } }));
  assert.equal(button("放进输入框").props.disabled, true);
  await act(async () => tree.update(React.createElement(Activities, { onChoose: text => choices.push(text), disabled: true })));
  assert.equal(button("放进输入框").props.disabled, true);
  console.log("Chat drafts: scoped restore, debounce/flush, late callbacks, retry preservation; activities: editable opt-in and append-only insertion passed");
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}

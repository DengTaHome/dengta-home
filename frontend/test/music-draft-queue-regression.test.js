import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {
  setTimeout, clearTimeout, setInterval, clearInterval,
  localStorage: { getItem: () => null },
};

const identity = { accountScope: "fictional-account", companionScope: "fictional-companion" };
const playlist = {
  id: "playlist-fixture", name: "Fixture playlist",
  items: [{ id: "track-fixture", title: "Fixture song", url: "https://media.example.test/song.mp3" }],
};
const active = {
  id: "session-fixture", status: "active", sessionMode: "listening",
  musicPlaylistId: playlist.id, musicPlaylistItemId: playlist.items[0].id,
};
const emptyQueue = { session_id: active.id, revision: 0, items: [] };
const seededQueue = {
  ...emptyQueue, revision: 1, current_queue_item_id: "queue-entry",
  items: [{ id: "queue-entry", item_id: playlist.items[0].id, playlist_id: playlist.id, title: "Fixture song" }],
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
let handler, tree;
const calls = [];

globalThis.__musicFlowRegression = {
  auth: {
    getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }),
    getRequestContext: async () => ({ accessToken: "fictional-token", companionId: identity.companionScope }),
  },
  async request(path, options = {}) {
    calls.push({ path, options });
    const result = handler?.(path, options);
    if (result !== undefined) return result;
    if (path === "/api/v2/music/playlists") return { playlists: [playlist] };
    if (path === `/api/v2/music/playlists/${playlist.id}`) return { playlist };
    if (path.endsWith("/favorites")) return { favorites: [] };
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path.endsWith("/cookie-session")) return { session: { connected: false } };
    throw new Error(`Unexpected fixture request: ${path}`);
  },
};

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
  plugins: [{
    name: "music-flow-regression-fixture", enforce: "pre",
    load(id) {
      const normalized = id.replaceAll("\\", "/");
      if (normalized.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__musicFlowRegression.request(...args);export const apiFetch=apiRequest;";
      if (normalized.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__musicFlowRegression.auth;";
    },
  }],
});
const { default: MusicSettings } = await vite.ssrLoadModule("/src/MusicSettings.jsx");
const { default: TogetherMusic } = await vite.ssrLoadModule("/src/TogetherMusic.jsx");
const button = text => tree.root.findAllByType("button").find(node => node.children.includes(text));
const content = () => tree.root.findByType("textarea");
const queueHeader = () => tree.root.findAllByType("section").find(node => node.props.className === "music-queue")
  .findByType("header").findByType("span").children.join("");

async function mount(Component, props = {}) {
  await act(async () => {
    tree = TestRenderer.create(React.createElement(Component, { ...identity, ...props }));
    await settle();
  });
}

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null; handler = null; calls.length = 0;
});
after(async () => { await vite.close(); delete globalThis.__musicFlowRegression; });

test("confirmed music import preserves a different draft entered while the request was pending", async () => {
  const importing = deferred();
  handler = path => path.endsWith("/playlists/import") ? importing.promise : undefined;
  await mount(MusicSettings, { compact: true });
  const submitted = "https://media.example.test/submitted.mp3";
  const nextDraft = "  下一份歌单🎵\r\nhttps://media.example.test/next.mp3\r\n ";
  await act(async () => content().props.onChange({ target: { value: submitted } }));
  await act(async () => { button("导入歌单").props.onClick(); await settle(); });
  assert.equal(JSON.parse(calls.find(call => call.path.endsWith("/playlists/import")).options.body).content, submitted);
  assert.notEqual(content().props.disabled, true);
  await act(async () => content().props.onChange({ target: { value: nextDraft } }));
  await act(async () => { importing.resolve({ playlist }); await settle(); });
  assert.equal(content().props.value, nextDraft, "a successful earlier import must not clear the latest exact text");
  assert.equal(button("导入歌单").props.disabled, false);
  assert.match(JSON.stringify(tree.toJSON()), /已导入/);
});

test("confirmed music import still clears its unchanged submitted draft", async () => {
  const importing = deferred();
  handler = path => path.endsWith("/playlists/import") ? importing.promise : undefined;
  await mount(MusicSettings, { compact: true });
  await act(async () => content().props.onChange({ target: { value: "https://media.example.test/submitted.mp3" } }));
  await act(async () => { button("导入歌单").props.onClick(); await settle(); });
  await act(async () => { importing.resolve({ playlist }); await settle(); });
  assert.equal(content().props.value, "");
  assert.equal(button("导入歌单").props.disabled, true);
});

test("late startup queue read cannot undo a confirmed seeded queue in the actual player", async () => {
  const starting = deferred(), reads = [];
  handler = path => {
    if (path.endsWith("/queue/operations")) return { queue: seededQueue };
    if (path.endsWith("/queue")) { const read = deferred(); reads.push(read); return read.promise; }
  };
  const props = { ...identity, onStart: () => starting.promise };
  await mount(TogetherMusic, props);
  await act(async () => {
    tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === playlist.id))
      .props.onChange({ target: { value: playlist.id } });
    await settle();
  });
  await act(async () => { button("开始一起听").props.onClick(); await settle(); });
  await act(async () => { tree.update(React.createElement(TogetherMusic, { ...props, session: active })); await settle(); });
  assert.equal(reads.length, 1, "the newly active session starts its initial queue read");
  await act(async () => { starting.resolve({ ...active, ok: true }); await settle(); });
  assert.equal(reads.length, 2, "seeding reads the queue before its mutation");
  await act(async () => { reads[1].resolve(emptyQueue); await settle(); });
  assert.equal(calls.filter(call => call.path.endsWith("/queue/operations")).length, 1);
  assert.equal(queueHeader(), "1 首 · revision 1");
  await act(async () => { reads[0].resolve(emptyQueue); await settle(); });
  assert.equal(queueHeader(), "1 首 · revision 1", "the late revision 0 response must not replace revision 1");
  assert.doesNotMatch(JSON.stringify(tree.toJSON()), /队列是空的/);
  assert.equal(tree.root.findAllByType("button").find(node => node.props["aria-label"] === "下一首").props.disabled, false);

  const nextSession = { ...active, id: "next-session-fixture" };
  handler = path => path.endsWith("/queue") ? { ...emptyQueue, session_id: nextSession.id } : undefined;
  await act(async () => { tree.update(React.createElement(TogetherMusic, { ...props, session: nextSession })); await settle(); });
  assert.equal(queueHeader(), "0 首 · revision 0", "a different session accepts its own lower starting revision");
});

test("a late mutation receipt preserves a newer queue already received by the actual player", async () => {
  const starting = deferred(), mutation = deferred(), reads = [];
  handler = path => {
    if (path.endsWith("/queue/operations")) return mutation.promise;
    if (path.endsWith("/queue")) { const read = deferred(); reads.push(read); return read.promise; }
  };
  const props = { ...identity, onStart: () => starting.promise };
  await mount(TogetherMusic, props);
  await act(async () => {
    tree.root.findAllByType("select").find(node => node.findAllByType("option").some(option => option.props.value === playlist.id))
      .props.onChange({ target: { value: playlist.id } });
    await settle();
  });
  await act(async () => { button("开始一起听").props.onClick(); await settle(); });
  await act(async () => { tree.update(React.createElement(TogetherMusic, { ...props, session: active })); await settle(); });
  await act(async () => { starting.resolve({ ...active, ok: true }); await settle(); });
  assert.equal(reads.length, 2);
  await act(async () => { reads[1].resolve(emptyQueue); await settle(); });
  const newer = { ...seededQueue, revision: 2, items: [...seededQueue.items, { ...seededQueue.items[0], id: "second-queue-entry" }] };
  await act(async () => { reads[0].resolve(newer); await settle(); });
  assert.equal(queueHeader(), "2 首 · revision 2");
  await act(async () => { mutation.resolve({ queue: seededQueue }); await settle(); });
  assert.equal(queueHeader(), "2 首 · revision 2", "an earlier successful receipt must not replace a later server revision");
  assert.equal(calls.filter(call => call.path.endsWith("/queue/operations")).length, 1, "discarding an older receipt does not repeat its mutation");
  assert.equal(button("重试载入队列"), undefined);
});

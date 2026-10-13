import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { setTimeout, clearTimeout, localStorage: { getItem: () => null } };
let identity = { accountScope: "fixture-a", companionScope: "fixture-companion-a" }, uploadCalls = 0, failSave = true, uploadWait = null;
const saves = [], notifications = [];
const saved = { id: "fixture-list", name: "Fictional playlist", item_count: 1, items: [{ id: "fixture-track", url: "https://media.example.test/song.aac", title: "Fictional song" }] };
globalThis.__importRecoveryFixture = {
  auth: { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }), getRequestContext: async () => ({ accessToken: "fixture", companionId: identity.companionScope }) },
  request: async (path, options) => {
    if (path.endsWith("/connections/manage")) return { connections: [] };
    if (path === "/api/v2/music/playlists") return { playlists: [] };
    assert.equal(path, "/api/v2/music/playlists/import");
    saves.push(JSON.parse(options.body)); assert.equal(options.retry, false);
    if (failSave) throw Object.assign(new Error("Fictional response lost"), { code: "music_import_items_incomplete", status: 503 });
    return { playlist: saved };
  },
  fetch: async () => { uploadCalls++; return uploadWait || new Response(JSON.stringify({ audio: { url: "https://media.example.test/song.aac", title: "Fictional song" } })); },
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "import-recovery-fixture", enforce: "pre", load(id) {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.endsWith("/src/api.js")) return "export const apiRequest=(...args)=>globalThis.__importRecoveryFixture.request(...args);export const apiFetch=(...args)=>globalThis.__importRecoveryFixture.fetch(...args);";
  if (normalized.endsWith("/src/auth-session.js")) return "export const authSession=globalThis.__importRecoveryFixture.auth;";
} }] });
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
let tree;
const button = text => tree.root.findAllByType("button").find(node => node.children.includes(text));
const output = () => JSON.stringify(tree.toJSON());
try {
  const { default: Settings } = await vite.ssrLoadModule("/src/MusicSettings.jsx");
  const adapter = await vite.ssrLoadModule("/src/music-listening.js");
  const mount = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(Settings, { ...identity, compact: true, onImported: data => notifications.push(data) })); await settle(); }); };
  // Select the actual async upload entry by its upload label, separate from local preview.
  const uploadNode = () => tree.root.findAllByType("label").find(node => node.children.some(child => typeof child === "string" && child.startsWith("上传本机音频"))).findByType("input");
  await mount(); assert.ok(uploadNode().props.accept.includes(".aac"));
  const file = new File(["fictional codec fixture"], "fixture.aac", { type: "audio/aac" });
  await act(async () => { const click = uploadNode().props.onChange; const input = { files: [file], value: "file" }; click({ currentTarget: input }); click({ currentTarget: input }); await settle(); });
  assert.equal(uploadCalls, 1); assert.equal(saves.length, 1); assert.equal(notifications.length, 0);
  assert.match(output(), /音频已上传/); assert.match(output(), /music_import_items_incomplete/); assert.ok(button("继续保存歌单")); assert.equal(uploadNode().props.disabled, true);
  const firstRequest = saves[0].request_id; assert.match(firstRequest, /^[0-9a-f-]{36}$/);
  await act(async () => { const click = button("继续保存歌单").props.onClick; click(); click(); await settle(); });
  assert.equal(uploadCalls, 1); assert.equal(saves.length, 2); assert.deepEqual(saves[1], saves[0]);
  failSave = false;
  await act(async () => { button("继续保存歌单").props.onClick(); await settle(); });
  assert.equal(uploadCalls, 1); assert.equal(saves.length, 3); assert.equal(saves[2].request_id, firstRequest); assert.equal(notifications.length, 1); assert.equal(button("继续保存歌单"), undefined);
  assert.match(output(), /音频能否播放以播放器实际结果为准/);

  failSave = true;
  const area = () => tree.root.findByType("textarea");
  await act(async () => area().props.onChange({ target: { value: "https://media.example.test/text.mp3" } }));
  await act(async () => { button("导入歌单").props.onClick(); await settle(); });
  const textRequest = saves.at(-1).request_id;
  await act(async () => { button("导入歌单").props.onClick(); await settle(); }); assert.equal(saves.at(-1).request_id, textRequest);
  await act(async () => area().props.onChange({ target: { value: "https://media.example.test/changed.mp3" } }));
  await act(async () => { button("导入歌单").props.onClick(); await settle(); }); assert.notEqual(saves.at(-1).request_id, textRequest);
  await act(async () => { uploadNode().props.onChange({ currentTarget: { files: [file], value: "" } }); await settle(); });
  assert.ok(button("继续保存歌单")); const count = saves.length;
  identity = { accountScope: "fixture-b", companionScope: "fixture-companion-b" };
  await act(async () => { tree.update(React.createElement(Settings, { ...identity, compact: true })); await settle(); });
  assert.equal(button("继续保存歌单"), undefined); assert.equal(saves.length, count);
  let resolve; uploadWait = new Promise(done => { resolve = done; });
  await act(async () => { uploadNode().props.onChange({ currentTarget: { files: [file], value: "" } }); await settle(); });
  await act(async () => tree.unmount()); tree = null;
  await act(async () => { resolve(new Response(JSON.stringify({ audio: { url: "https://media.example.test/song.aac" } }))); await settle(); });
  assert.equal(saves.length, count, "a closed upload cannot proceed to save");
  uploadWait = null;
  const before = uploadCalls;
  await assert.rejects(adapter.uploadLocalMusicFile(new File(["fixture"], "fixture.exe", { type: "audio/mpeg" })), error => error.code === "music_audio_type_invalid"); assert.equal(uploadCalls, before);
  const originalFetch = globalThis.__importRecoveryFixture.fetch;
  for (const url of ["http://media.example.test/a.mp3", "https://127.0.0.1/a.mp3", "https://name:secret@media.example.test/a.mp3", ""]) {
    globalThis.__importRecoveryFixture.fetch = async () => new Response(JSON.stringify({ audio: { url } }));
    await assert.rejects(adapter.uploadLocalMusicFile(file), error => error.code === "music_audio_receipt_invalid");
  }
  globalThis.__importRecoveryFixture.fetch = originalFetch;
  console.log("Music import UI and actual adapters: no reupload on resume, same-tick locking, stable text retry IDs, success feedback, account switch/unmount cancellation and invalid upload receipts passed");
} finally { if (tree) await act(async () => tree.unmount()); await vite.close(); delete globalThis.__importRecoveryFixture; }

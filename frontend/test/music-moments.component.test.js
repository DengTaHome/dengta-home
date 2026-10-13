import assert from "node:assert/strict";
import { after, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "moment-no-network", enforce: "pre", load(id) { if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return "export const apiRequest=()=>{throw Error('No network allowed in moment tests')};"; } }] });
after(() => vite.close());
const { default: MusicMoments } = await vite.ssrLoadModule("/src/MusicMoments.jsx");
const capture = { playlistId: "fictional-playlist", itemId: "fictional-track", title: "虚构歌曲", artist: "虚构作者", positionSeconds: 31, positionSource: "device" };
function fixture() {
  const entries = new Map(), storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  let calls = 0, seeks = 0;
  const props = { accountScope: "fictional-account", companionScope: "fictional-companion", available: true, currentPlaylistId: capture.playlistId, currentItemId: capture.itemId, internalPlayback: true, storage, getCapture: () => { calls++; return capture; }, onSeek: () => { seeks++; } };
  return { props, storage, entries, calls: () => calls, seeks: () => seeks };
}
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const button = (tree, label) => tree.root.findAllByType("button").find(node => text(node) === label);
const click = async (tree, label) => { await act(async () => button(tree, label).props.onClick()); };
const output = tree => JSON.stringify(tree.toJSON());
async function mount(props) { let tree; await act(async () => { tree = TestRenderer.create(React.createElement(MusicMoments, props)); }); return tree; }
async function save(tree, note = "虚构感受") { await click(tree, "记住这一刻"); await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: note } })); await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} })); }

test("opening makes a frozen draft, save persists it, reload reads it and no capture/seek occurs automatically", async () => {
  const f = fixture(), tree = await mount(f.props);
  assert.equal(f.calls(), 0); assert.equal(f.seeks(), 0); assert.equal(f.entries.size, 0);
  await save(tree); assert.equal(f.calls(), 1); assert.match(output(tree), /片段卡已保存到本机/); assert.equal(f.entries.size, 1);
  await act(async () => tree.unmount()); const second = await mount(f.props);
  assert.match(output(second), /虚构感受/); assert.equal(f.calls(), 1); assert.equal(f.seeks(), 0);
  await click(second, "跳回片段"); assert.equal(f.seeks(), 1); await act(async () => second.unmount());
});
test("storage failure preserves note and draft and does not pretend save succeeded", async () => {
  const f = fixture(), tree = await mount(f.props); await click(tree, "记住这一刻");
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "虚构未保存备注" } }));
  f.storage.setItem = () => { throw Error("fictional-private-raw-error"); };
  await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(tree.root.findByType("textarea").props.value, "虚构未保存备注"); assert.match(output(tree), /music_moment_storage_unavailable/); assert.doesNotMatch(output(tree), /fictional-private-raw-error|片段卡已保存到本机/);
  assert.equal(f.entries.size, 0); await act(async () => tree.unmount());
});
test("external cards require manual time and never offer or call a seek", async () => {
  const f = fixture(); f.props.getCapture = () => ({ ...capture, positionSource: "manual", positionSeconds: 0 }); f.props.internalPlayback = false;
  const tree = await mount(f.props); await click(tree, "记住这一刻");
  await act(async () => tree.root.findByType("input").props.onChange({ target: { value: "1:60" } }));
  await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} })); assert.equal(f.entries.size, 0); assert.match(output(tree), /music_moment_invalid/);
  await act(async () => tree.root.findByType("input").props.onChange({ target: { value: "1:02" } }));
  await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  const stored = JSON.parse([...f.entries.values()][0]); assert.equal(stored.moments[0].positionSeconds, 62); assert.equal(stored.moments[0].positionSource, "manual");
  assert.equal(button(tree, "跳回片段"), undefined); assert.equal(f.seeks(), 0); await act(async () => tree.unmount());
});
test("scope switch resets private cards and draft, and stale callbacks cannot write to either scope", async () => {
  const f = fixture(), tree = await mount(f.props); await save(tree); await click(tree, "记住这一刻");
  const stale = tree.root.findByType("form").props.onSubmit, before = [...f.entries.values()][0];
  await act(async () => tree.update(React.createElement(MusicMoments, { ...f.props, companionScope: "fictional-new-companion" })));
  assert.equal(tree.root.findAllByType("form").length, 0); assert.doesNotMatch(output(tree), /虚构感受/);
  await act(async () => stale({ preventDefault() {} })); assert.equal(f.entries.size, 1); assert.equal([...f.entries.values()][0], before); await act(async () => tree.unmount());
});
test("confirmed delete can be undone; deletion failure leaves the card and exposes only stable feedback", async () => {
  const f = fixture(), tree = await mount(f.props); await save(tree); const before = [...f.entries.values()][0];
  f.storage.setItem = () => { throw Error("private"); };
  await click(tree, "删除"); assert.match(output(tree), /虚构感受/); assert.match(output(tree), /music_moment_storage_unavailable/); assert.equal([...f.entries.values()][0], before);
  f.storage.setItem = (key, value) => f.entries.set(key, value); await click(tree, "删除"); assert.equal(JSON.parse([...f.entries.values()][0]).moments.length, 0);
  await click(tree, "撤销删除"); assert.match(output(tree), /虚构感受/); assert.equal(JSON.parse([...f.entries.values()][0]).moments.length, 1); await act(async () => tree.unmount());
});
test("changing selected track preserves saved cards and disables jumping to the wrong track", async () => {
  const f = fixture(), tree = await mount(f.props); await save(tree);
  await act(async () => tree.update(React.createElement(MusicMoments, { ...f.props, currentItemId: "fictional-other-track" })));
  assert.equal(button(tree, "跳回片段").props.disabled, true); assert.match(output(tree), /虚构感受/); assert.equal(f.seeks(), 0); await act(async () => tree.unmount());
});

test("cancelled draft submit cannot save or clear a newer draft", async () => {
  const f = fixture(), tree = await mount(f.props); await click(tree, "记住这一刻");
  const oldSubmit = tree.root.findByType("form").props.onSubmit;
  await click(tree, "取消"); await act(async () => oldSubmit({ preventDefault() {} })); assert.equal(f.entries.size, 0);
  await click(tree, "记住这一刻");
  await act(async () => tree.root.findByType("textarea").props.onChange({ target: { value: "虚构较新草稿" } }));
  await act(async () => oldSubmit({ preventDefault() {} })); assert.equal(f.entries.size, 0); assert.equal(tree.root.findByType("textarea").props.value, "虚构较新草稿");
  await act(async () => tree.unmount());
});
test("same-tick note changes are saved from the current draft rather than an earlier form closure", async () => {
  const f = fixture(), tree = await mount(f.props); await click(tree, "记住这一刻");
  const submit = tree.root.findByType("form").props.onSubmit, change = tree.root.findByType("textarea").props.onChange;
  await act(async () => { change({ target: { value: "虚构最后输入" } }); submit({ preventDefault() {} }); submit({ preventDefault() {} }); });
  assert.equal(JSON.parse([...f.entries.values()][0]).moments[0].note, "虚构最后输入"); assert.equal(JSON.parse([...f.entries.values()][0]).moments.length, 1);
  await act(async () => tree.unmount());
});

test("stale undo and deletion callbacks cannot replace a newer deletion recovery", async () => {
  for (const action of ["undo", "delete"]) {
    const f = fixture(), tree = await mount(f.props); await save(tree, "虚构片段甲"); await save(tree, "虚构片段乙");
    const firstDelete = tree.root.findAllByType("button").filter(node => text(node) === "删除")[0].props.onClick;
    await act(async () => firstDelete()); const oldUndo = button(tree, "撤销删除").props.onClick;
    await click(tree, "删除"); await act(async () => (action === "undo" ? oldUndo : firstDelete)());
    assert.equal(JSON.parse([...f.entries.values()][0]).moments.length, 0);
    await click(tree, "撤销删除"); assert.equal(JSON.parse([...f.entries.values()][0]).moments[0].note, "虚构片段甲");
    await act(async () => tree.unmount());
  }
});

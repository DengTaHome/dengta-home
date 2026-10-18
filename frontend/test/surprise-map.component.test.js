import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let tree;
try {
  const { SurpriseMapContent } = await vite.ssrLoadModule("/src/SurpriseMap.jsx");
  const button = label => tree.root.findAllByType("button").find(node => text(node) === label);
  const mount = async props => { await act(async () => { tree = TestRenderer.create(React.createElement(SurpriseMapContent, { aiName: "小灯", isCurrent: () => true, ...props })); }); };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  const letter = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "虚构信件", place_label: "虚构公园", area: { latitude: 0.001, longitude: 0.002, radius_m: 300 } };
  await test("opening the real map reads scoped lists without requesting location or drafting", async () => {
    const paths = []; let locations = 0;
    await mount({ request: async path => { paths.push(path); return { ok: true, letters: path.endsWith("/letters") ? [letter] : [] }; }, locatePosition: async () => { locations++; } });
    assert.equal(paths.length, 2); assert.equal(locations, 0); assert.ok(button("走近了，打开信"));
    assert.ok(button("我们的信").props["aria-pressed"]); assert.match(text(tree.toJSON()), /不会自动出现在这里|定位仅在你点击时/);
    await unmount();
  });
  await test("AI drafting is separate from location, saving and public publication", async () => {
    const calls = []; let locations = 0;
    await mount({ request: async (path, options) => { calls.push({ path, options }); return path.endsWith("/draft") ? { draft: { title: "虚构标题", body: "虚构正文" } } : { ok: true, letters: [] }; }, locatePosition: async () => { locations++; } });
    await act(async () => button("请小灯写一封").props.onClick());
    assert.equal(locations, 0); assert.equal(calls.filter(call => call.options?.method === "POST").length, 1);
    assert.equal(calls.at(-1).path, "/api/v2/surprise-map/draft");
    assert.equal(tree.root.findAllByType("textarea")[0].props.value, "虚构正文"); await unmount();
  });
  await test("claim keeps its own anchor and scope changes during location prevent sending", async () => {
    const wait = deferred(), calls = []; let active = true;
    await mount({ isCurrent: () => active, request: async (path, options) => { calls.push({ path, options }); return { ok: true, letters: [letter] }; }, locatePosition: () => wait.promise });
    await act(async () => button("走近了，打开信").props.onClick());
    active = false; await act(async () => wait.resolve({ latitude: 0, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() }));
    assert.equal(calls.filter(call => call.options?.method === "POST").length, 0); await unmount();
  });
  await test("publication form starts empty of private text and coordinates and requires its own confirmation", async () => {
    await mount({ request: async () => ({ ok: true, letters: [{ ...letter, body: "PRIVATE_FIXTURE_BODY", claimed: true }] }) });
    await act(async () => button("另写公开版本").props.onClick());
    const form = tree.root.findAllByType("form").find(node => node.props["aria-label"] === "公开信预览");
    const values = form.findAllByType("input").map(node => node.props.value).filter(value => value !== undefined);
    assert.ok(!values.includes("PRIVATE_FIXTURE_BODY")); assert.ok(values.filter(value => value === "").length >= 4);
    assert.equal(button("确认发布公开版本").props.disabled, true);
    await act(async () => form.findAllByType("input").find(node => node.props.type === "checkbox").props.onChange({ target: { checked: true } }));
    assert.equal(button("确认发布公开版本").props.disabled, false); await unmount();
  });
  await test("already claimed letters can be re-read without another location permission", async () => {
    let locations = 0;
    await mount({ request: async () => ({ ok: true, letters: [{ ...letter, body: "FICTIONAL_OPENED", claimed: true }] }), locatePosition: async () => { locations++; } });
    await act(async () => button("再读这封信").props.onClick());
    assert.equal(locations, 0); assert.match(text(tree.toJSON()), /FICTIONAL_OPENED/); await unmount();
  });
  await test("pending AI or create receipts cannot overwrite a newer handwritten draft", async () => {
    for (const kind of ["draft", "create"]) {
      const wait = deferred();
      await mount({ request: async (path, options) => {
        if (options?.method === "POST") return wait.promise;
        return { ok: true, letters: [] };
      }, locatePosition: async () => ({ latitude: 0, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() }) });
      if (kind === "draft") await act(async () => button("请小灯写一封").props.onClick());
      else await act(async () => tree.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }));
      const input = tree.root.findAllByType("textarea")[0]; assert.equal(input.props.disabled, true);
      await act(async () => input.props.onChange({ target: { value: "NEW_HANDWRITTEN_FIXTURE" } }));
      await act(async () => wait.resolve(kind === "draft" ? { draft: { title: "old", body: "old" } } : { ok: true }));
      assert.equal(tree.root.findAllByType("textarea")[0].props.value, "NEW_HANDWRITTEN_FIXTURE"); await unmount();
    }
  });
  await test("retry after an unconfirmed save reuses the full original location and request identity", async () => {
    const saves = []; let locations = 0;
    await mount({ request: async (path, options) => {
      if (path.endsWith("/letters") && options?.method === "POST") {
        saves.push(structuredClone(options.body));
        if (saves.length === 1) throw Object.assign(new Error("not confirmed"), { code: "request_timeout" });
        return { ok: true, replayed: true, published: false, letter: { ...letter, title: options.body.title } };
      }
      return { ok: true, letters: [] };
    }, locatePosition: async () => ({ latitude: locations++, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() }) });
    await act(async () => tree.root.findAllByType("input").find(node => node.props.required).props.onChange({ target: { value: "FICTIONAL_TITLE" } }));
    await act(async () => tree.root.findAllByType("textarea")[0].props.onChange({ target: { value: "FICTIONAL_BODY" } }));
    await act(async () => tree.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }));
    await act(async () => tree.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }));
    assert.equal(locations, 1); assert.equal(saves.length, 2); assert.deepEqual(saves[0], saves[1]);
    assert.match(text(tree.toJSON()), /没有重复留信或更换地点/); await unmount();
  });
  await test("an invalid save receipt keeps the handwritten text and retry identity", async () => {
    const requests = [];
    await mount({ request: async (_path, options) => {
      if (options?.method === "POST") { requests.push(options.body); return { ok: true }; }
      return { ok: true, letters: [] };
    }, locatePosition: async () => ({ latitude: 0, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() }) });
    await act(async () => tree.root.findAllByType("textarea")[0].props.onChange({ target: { value: "FICTIONAL_UNSAVED" } }));
    const submit = () => tree.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} });
    await act(async () => submit()); await act(async () => submit());
    assert.equal(tree.root.findAllByType("textarea")[0].props.value, "FICTIONAL_UNSAVED");
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.match(text(tree.toJSON()), /回执|确认/); await unmount();
  });
  await test("online maps require a separate click and do not ask for GPS or change a letter", async () => {
    const calls = []; let locations = 0;
    await mount({ request: async (path, options) => { calls.push({ path, options }); return { ok: true, letters: [letter] }; }, locatePosition: async () => { locations++; } });
    assert.equal(tree.root.findAllByProps({ "aria-label": "可拖动缩放的地理地图" }).length, 0);
    await act(async () => button("本次开启街道地图").props.onClick());
    assert.equal(tree.root.findAllByProps({ "aria-label": "可拖动缩放的地理地图" }).length, 1);
    assert.equal(locations, 0); assert.equal(calls.filter(call => call.options?.method).length, 0);
    await act(async () => button("切回方位图，关闭在线地图").props.onClick());
    assert.equal(tree.root.findAllByProps({ "aria-label": "可拖动缩放的地理地图" }).length, 0);
    await unmount();
  });
  await test("out of bounds coordinates and invalid radii fail as receipts, never as map renderer crashes", async () => {
    for (const area of [{ ...letter.area, latitude: 91 }, { ...letter.area, longitude: -181 }, { ...letter.area, radius_m: -10 }]) {
      await mount({ request: async () => ({ ok: true, letters: [{ ...letter, area }] }) });
      assert.match(text(tree.toJSON()), /surprise_map_receipt_invalid/); assert.equal(button("走近了，打开信"), undefined); await unmount();
    }
  });
} finally { if (tree) await act(async () => tree.unmount()); await vite.close(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; }

import test from "node:test";
import { setImmediate } from "node:timers";
import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readWhereaboutsConsent, setWhereaboutsConsent } from "../src/whereabouts-consent.js";
import { settingsSaveScope } from "../src/settings-save-scope.js";

const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
const originals = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { addEventListener() {}, removeEventListener() {} };
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
let tree;
try {
  const Settings = (await vite.ssrLoadModule("/src/WhereaboutsConsentSettings.jsx")).default;
  const consentModule = await vite.ssrLoadModule("/src/whereabouts-consent.js");
  const whereabouts = await vite.ssrLoadModule("/src/whereabouts.js");
  const initial = () => {
    const values = new Map(), listeners = new Set(); let snapshot = { user: { id: "fixture-account" }, activeCompanionId: "fixture-companion" };
    return {
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
      session: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
      scope: settingsSaveScope(snapshot),
      switchScope() { snapshot = { ...snapshot, activeCompanionId: "fixture-companion-other" }; for (const listener of listeners) listener(); },
    };
  };
  const mount = async props => { await act(async () => { tree = TestRenderer.create(React.createElement(Settings, props)); }); };
  const close = async () => { await act(async () => tree.unmount()); tree = null; };
  const toggle = () => tree.root.findByProps({ role: "switch" });

  await test("the real setting stays off after a system grant and requires its own explicit toggle", async () => {
    const fixture = initial(); let prompts = 0;
    await mount({ scopeKey: fixture.scope, ...fixture, supported: true, requestPermissions: async () => { prompts++; return { granted: true }; } });
    assert.equal(toggle().props["aria-checked"], false); assert.equal(prompts, 0);
    assert.match(text(tree.toJSON()), /藏宝信的一次定位、天气定位及系统定位授权都不会自动开启/);
    await act(async () => toggle().props.onClick());
    assert.equal(prompts, 1); assert.equal(toggle().props["aria-checked"], true);
    assert.equal(consentModule.readWhereaboutsConsent(fixture.scope, fixture.storage), true);
    await act(async () => toggle().props.onClick());
    assert.equal(toggle().props["aria-checked"], false); assert.match(text(tree.toJSON()), /已停止新增行踪记录/);
    assert.equal(prompts, 1); await close();
  });

  await test("blocked storage and denied permissions never show an enabled switch", async () => {
    for (const blocked of [true, false]) {
      const fixture = initial();
      if (blocked) fixture.storage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
      await mount({ scopeKey: fixture.scope, ...fixture, supported: true, requestPermissions: async () => ({ granted: blocked }) });
      await act(async () => toggle().props.onClick());
      assert.equal(toggle().props["aria-checked"], false);
      assert.match(text(tree.toJSON()), blocked ? /whereabouts_consent_unavailable/ : /location_permission_denied/);
      await close();
    }
  });

  await test("a late permission grant after a companion switch cannot save authorization", async () => {
    const fixture = initial(); let resolve;
    const waiting = new Promise(done => { resolve = done; });
    await mount({ scopeKey: fixture.scope, ...fixture, supported: true, requestPermissions: () => waiting });
    await act(async () => toggle().props.onClick());
    await act(async () => fixture.switchScope());
    await act(async () => resolve({ granted: true }));
    assert.equal(consentModule.readWhereaboutsConsent(fixture.scope, fixture.storage), false); await close();
  });

  await test("the scoped consent key never inherits another companion or a legacy global grant", () => {
    const fixture = initial();
    fixture.storage.setItem("dengta_whereabouts_recording_consent_v1", "enabled");
    assert.equal(readWhereaboutsConsent(fixture.scope, fixture.storage), false);
    setWhereaboutsConsent(fixture.scope, true, fixture.storage);
    assert.equal(readWhereaboutsConsent(fixture.scope, fixture.storage), true);
    fixture.switchScope(); assert.equal(readWhereaboutsConsent(settingsSaveScope(fixture.session.getSnapshot()), fixture.storage), false);
  });

  await test("the real UI switch starts the real scheduler and revocation discards its pending location", async () => {
    const fixture = initial(), timers = new Map(), visibility = new Set(), calls = [];
    let resolveLocation, captures = 0;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval(callback) { timers.set(1, callback); return 1; }, clearInterval(id) { timers.delete(id); } };
    globalThis.document = { visibilityState: "visible", addEventListener(_type, listener) { visibility.add(listener); }, removeEventListener(_type, listener) { visibility.delete(listener); } };
    const capacitor = { isPluginAvailable: () => true, Plugins: { Whereabouts: {
      checkPermissions: async () => ({ granted: true }),
      getLocation: () => { captures++; return new Promise(resolve => { resolveLocation = resolve; }); },
    } } };
    const stop = whereabouts.startWhereaboutsScheduler({ authSession: fixture.session, storage: fixture.storage, capacitor, apiRequest: async (...args) => { calls.push(args); return { ok: true }; } });
    try {
      await mount({ scopeKey: fixture.scope, ...fixture, supported: true, requestPermissions: async () => ({ granted: true }) });
      assert.equal(timers.size, 0);
      await act(async () => toggle().props.onClick()); assert.equal(timers.size, 1);
      for (const callback of visibility) callback(); await new Promise(resolve => setImmediate(resolve)); assert.equal(captures, 1);
      await act(async () => toggle().props.onClick()); assert.equal(timers.size, 0);
      resolveLocation({ latitude: 0, longitude: 0, accuracy: 5, timestamp: new Date().toISOString() });
      await new Promise(resolve => setImmediate(resolve)); assert.equal(calls.length, 0);
      await close();
    } finally { stop(); }
  });
} finally {
  if (tree) await act(async () => tree.unmount());
  await vite.close();
  for (const [key, value] of originals) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
}

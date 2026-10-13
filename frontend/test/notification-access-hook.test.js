import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import React, { StrictMode, act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
let granted = false, reads = 0, opens = 0, registrations = 0, removals = 0, supported = true, failListener = false, delayed;
const subscriptions = [], snapshots = [];
const before = Object.getOwnPropertyDescriptor(globalThis, "__notificationFixture"), actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__notificationFixture = {
  capacitor: { isNativePlatform: () => supported, isPluginAvailable: () => supported },
  plugin: { getNotificationAccessState: async () => { reads++; return { granted }; }, openNotificationAccessSettings: async () => { opens++; } },
  app: { addListener: async (event, callback) => {
    assert.equal(event, "appStateChange"); registrations++;
    if (failListener) throw Error("private listener error");
    const subscription = { callback, removed: false, remove() { assert.equal(this.removed, false, "handle removed once"); this.removed = true; removals++; } };
    subscriptions.push(subscription);
    return delayed ? delayed.promise.then(() => subscription) : subscription;
  } },
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{
  name: "notification-native-fixture", enforce: "pre",
  transform(code, id) {
    const name = id.replaceAll("\\", "/");
    if (name.endsWith("/src/use-notification-access.js")) return code.replace('"@capacitor/app"', '"virtual:notification-app"');
    if (name.endsWith("/src/device-activity.js")) return code.replace('"@capacitor/core"', '"virtual:notification-core"');
  },
  resolveId(id) { if (id.startsWith("virtual:notification-")) return "\0" + id; },
  load(id) {
    if (id === "\0virtual:notification-app") return "export const App=globalThis.__notificationFixture.app;";
    if (id === "\0virtual:notification-core") return "export const Capacitor=globalThis.__notificationFixture.capacitor;export const registerPlugin=()=>globalThis.__notificationFixture.plugin;";
  },
}] });
let tree, current;
try {
  const { useNotificationAccess } = await vite.ssrLoadModule("/src/use-notification-access.js");
  function Harness() { current = useNotificationAccess(); snapshots.push(current.state); return React.createElement("output", null, JSON.stringify(current.state)); }
  const mount = async strict => { await act(async () => { tree = TestRenderer.create(strict ? React.createElement(StrictMode, null, React.createElement(Harness)) : React.createElement(Harness)); }); };
  const unmount = async () => { await act(async () => tree.unmount()); tree = null; };
  await mount(true);
  assert.equal(current.state.checking, false); assert.equal(current.state.granted, false); assert.equal(subscriptions.filter(s => !s.removed).length, 1, "StrictMode leaves exactly one active subscription");
  const subscription = subscriptions.find(s => !s.removed), base = reads;
  granted = true; await act(async () => subscription.callback({ isActive: false })); assert.equal(reads, base);
  await act(async () => subscription.callback({ isActive: true })); assert.equal(current.state.granted, true);
  await act(async () => current.request()); assert.equal(opens, 1); assert.equal(subscriptions.filter(s => !s.removed).length, 1);
  granted = false; await act(async () => subscription.callback({ isActive: true })); assert.equal(current.state.granted, false);
  await unmount(); assert.equal(subscriptions.filter(s => !s.removed).length, 0);
  const count = snapshots.length; await act(async () => subscription.callback({ isActive: true })); assert.equal(snapshots.length, count, "unmounted callbacks cannot update React");

  failListener = true; await mount(false); assert.equal(current.state.errorCode, "music_notification_listener_failed");
  const failedRegistrations = registrations; failListener = false;
  await act(async () => current.refresh()); assert.equal(registrations, failedRegistrations + 1); assert.equal(current.state.errorCode, "");
  await act(async () => current.refresh()); assert.equal(registrations, failedRegistrations + 1, "rerender/refresh does not duplicate listeners"); await unmount();

  delayed = deferred(); await mount(false); const late = subscriptions.at(-1); await unmount();
  const removedBefore = removals, snapshotsBefore = snapshots.length;
  await act(async () => { delayed.resolve(); await Promise.resolve(); }); assert.equal(removals, removedBefore + 1); assert.equal(late.removed, true); assert.equal(snapshots.length, snapshotsBefore); delayed = undefined;
  supported = false; const calls = [reads, opens, registrations]; await mount(true); assert.equal(current.state.supported, false); assert.equal(current.state.checking, false);
  await act(async () => { await current.request(); await current.refresh(); }); assert.deepEqual([reads, opens, registrations], calls); await unmount();
  console.log("Actual notification hook + bridge + monitor React mount passed: StrictMode, foreground, revocation, retry subscription, late handle disposal and unsupported web; OS plugin mocked");
} finally {
  if (tree) await act(async () => tree.unmount()); await vite.close();
  if (before) Object.defineProperty(globalThis, "__notificationFixture", before); else delete globalThis.__notificationFixture;
  if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}

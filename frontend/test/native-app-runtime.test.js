import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNativeAppUrl,
  installNativeDeepLinks,
  markNativePlatform,
} from "../src/native-app-runtime.js";

const flush = async () => {
  // Listener registration, getLaunchUrl, serial dispatch and expiry scheduling.
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function fixture({ launchUrl, deferredRegistration } = {}) {
  let onOpen;
  let removals = 0;
  const calls = [];
  const timers = new Map();
  const app = {
    async addListener(event, callback) {
      assert.equal(event, "appUrlOpen");
      onOpen = callback;
      if (deferredRegistration) await deferredRegistration;
      return { remove: async () => { removals += 1; } };
    },
    async getLaunchUrl() { return launchUrl ? { url: launchUrl } : undefined; },
  };
  const options = {
    app,
    onAuthUrl: async url => { calls.push(["auth", url]); },
    onRoomUrl: async url => { calls.push(["room", url]); },
    scheduleExpiry: callback => { const key = Symbol(); timers.set(key, callback); return key; },
    cancelExpiry: key => timers.delete(key),
  };
  return {
    options, calls, timers,
    open: url => onOpen({ url }),
    removals: () => removals,
    expire: () => { for (const callback of timers.values()) callback(); timers.clear(); },
  };
}

test("native platform marker scopes iOS WebKit CSS to the packaged app", () => {
  const documentObject = { documentElement: { dataset: {} } };
  assert.equal(markNativePlatform({ isNativePlatform: () => true, getPlatform: () => "ios" }, documentObject), "ios");
  assert.equal(documentObject.documentElement.dataset.nativePlatform, "ios");
  assert.equal(markNativePlatform({ isNativePlatform: () => false }, documentObject), "web");
});

test("only registered auth and invite routes are accepted", () => {
  for (const url of ["dengta://auth#access_token=fake", "dengta://auth/?code=fake"]) {
    assert.equal(classifyNativeAppUrl(url), "auth");
  }
  for (const url of ["dengta://room/join?code=ABCDEF", "https://dengtahome.com/room/join?room_code=ABCDEF"]) {
    assert.equal(classifyNativeAppUrl(url), "room");
  }
  for (const url of [
    "dengta://auth.evil#access_token=fake", "dengta://auth/other", "dengta://auth:80",
    "dengta://user@auth", "https://evil.example/room/join?code=ABCDEF",
    "https://dengtahome.com.evil/room/join", "https://dengtahome.com/?room_code=ABCDEF",
    "https://dengtahome.com/unrelated?next=room/join", "javascript:room/join",
    "http://dengtahome.com/room/join", "not a URL",
  ]) assert.equal(classifyNativeAppUrl(url), null, url);
  assert.equal(classifyNativeAppUrl("https://selfhost.example/room/join", { publicAppUrl: "https://selfhost.example/" }), "room");
  assert.equal(classifyNativeAppUrl("https://evil.example/room/join", { publicAppUrl: "javascript:evil.example" }), null);
});

test("cold email launch and duplicate warm event exchange the session only once", async () => {
  const url = "dengta://auth#access_token=fake&refresh_token=fake";
  const f = fixture({ launchUrl: url });
  const dispose = installNativeDeepLinks(f.options);
  f.open(url);
  await flush();
  assert.deepEqual(f.calls, [["auth", url]]);
  assert.equal(f.timers.size, 1);
  dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.removals(), 1);
});

test("warm room invites remain available after normal icon launch and can be reopened", async () => {
  const f = fixture();
  const dispose = installNativeDeepLinks(f.options);
  await flush();
  const url = "dengta://room/join?code=ABCDEF";
  f.open("https://evil.example/room/join?code=ABCDEF");
  f.open(url); f.open(url);
  await flush();
  assert.deepEqual(f.calls, [["room", url]]);
  f.expire(); f.open(url);
  await flush();
  assert.equal(f.calls.length, 2);
  dispose(); f.open("dengta://room/join?code=GHIJKL");
  await flush();
  assert.equal(f.calls.length, 2);
});

test("disposal during async listener registration removes its late handle", async () => {
  let resolveRegistration;
  const deferredRegistration = new Promise(resolve => { resolveRegistration = resolve; });
  const f = fixture({ launchUrl: "dengta://auth?code=fake", deferredRegistration });
  const dispose = installNativeDeepLinks(f.options);
  dispose(); resolveRegistration();
  await flush();
  assert.equal(f.removals(), 1);
  assert.deepEqual(f.calls, []);
});

test("failed auth callbacks do not prevent subsequent invite delivery", async () => {
  const f = fixture();
  const dispose = installNativeDeepLinks({
    ...f.options,
    onAuthUrl: async () => { throw new Error("synthetic auth failure"); },
  });
  await flush();
  f.open("dengta://auth?code=fake");
  f.open("dengta://room/join?code=ABCDEF");
  await flush();
  assert.deepEqual(f.calls, [["room", "dengta://room/join?code=ABCDEF"]]);
  dispose();
});

test("a slow auth exchange completes before a different native callback is handled", async () => {
  const f = fixture();
  let finishAuth;
  const pendingAuth = new Promise(resolve => { finishAuth = resolve; });
  const dispose = installNativeDeepLinks({
    ...f.options,
    onAuthUrl: () => pendingAuth,
  });
  await flush();
  f.open("dengta://auth?code=fake");
  f.open("dengta://room/join?code=ABCDEF");
  await flush();
  assert.deepEqual(f.calls, []);
  finishAuth(); await flush();
  assert.deepEqual(f.calls, [["room", "dengta://room/join?code=ABCDEF"]]);
  dispose();
});

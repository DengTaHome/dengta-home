import assert from "node:assert/strict";
import { apiRequest } from "../src/api.js";
import {
  BACKEND_WAKE_TIMEOUT_MS,
  STARTUP_REQUEST_OPTIONS,
  createStartupReconnectController,
  mergeRecoveredStartupData,
} from "../src/startup-reconnect.js";

assert.equal(
  BACKEND_WAKE_TIMEOUT_MS,
  75_000,
  "the first request must outlive the measured Render cold start",
);
assert.deepEqual(STARTUP_REQUEST_OPTIONS, {
  retry: false,
  timeoutMs: BACKEND_WAKE_TIMEOUT_MS,
});

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFake(callback, delay = 0) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
    return id;
  }

  function clearTimeoutFake(id) {
    timers.delete(id);
  }

  async function advanceBy(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      for (let index = 0; index < 6; index += 1) await Promise.resolve();
    }
    now = target;
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  }

  return {
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    advanceBy,
    pendingDelays() {
      return [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b);
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) || new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      [...(listeners.get(type) || [])].forEach((listener) => listener({ type }));
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

{
  const timers = createFakeTimers();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requestContext = {
    getRequestContext: async () => ({}),
    captureCompanionFromResponse() {},
  };
  let fetchCalls = 0;

  globalThis.window = {
    ...originalWindow,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  globalThis.fetch = (_url, options = {}) => {
    fetchCalls += 1;
    return new Promise((resolve, reject) => {
      const responseTimer = timers.setTimeout(() => {
        resolve({
          status: 200,
          ok: true,
          json: async () =>
            _url.endsWith("/settings")
              ? { settings: {} }
              : { sessions: [] },
        });
      }, 26_000);
      options.signal?.addEventListener(
        "abort",
        () => {
          timers.clearTimeout(responseTimer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true },
      );
    });
  };

  const controller = createStartupReconnectController({
    attempt: () =>
      Promise.all(
        ["/api/v2/settings", "/api/v2/sessions"].map((path) =>
          apiRequest(path, {
            ...STARTUP_REQUEST_OPTIONS,
            authSession: requestContext,
          }),
        ),
      ),
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  try {
    const startup = controller.start();
    await flushPromises();
    assert.equal(controller.getState().status, "connecting");

    await timers.advanceBy(15_000);
    assert.equal(
      controller.getState().status,
      "connecting",
      "a measured 26-second cold start must not be reported as disconnected at 15 seconds",
    );

    await timers.advanceBy(11_000);
    await startup;
    assert.equal(controller.getState().status, "connected");
    assert.equal(fetchCalls, 2, "cold start must complete without a retry storm");
  } finally {
    controller.stop();
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

{
  const timers = createFakeTimers();
  const attempts = [];
  const controller = createStartupReconnectController({
    attempt: async () => {
      attempts.push(timers.pendingDelays());
      throw new Error("backend asleep");
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  assert.deepEqual(timers.pendingDelays(), [2_000]);
  await timers.advanceBy(2_000);
  assert.deepEqual(timers.pendingDelays(), [5_000]);
  await timers.advanceBy(5_000);
  assert.deepEqual(timers.pendingDelays(), [10_000]);
  await timers.advanceBy(10_000);
  assert.deepEqual(timers.pendingDelays(), [30_000]);
  await timers.advanceBy(30_000);
  assert.deepEqual(timers.pendingDelays(), [30_000]);
  assert.equal(attempts.length, 5);
  controller.stop();
}

{
  const timers = createFakeTimers();
  const windowTarget = createEventTarget();
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: true };
    },
    windowTarget,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  assert.deepEqual(timers.pendingDelays(), [2_000]);
  windowTarget.dispatch("online");
  await flushPromises();
  assert.equal(calls, 2, "online must retry immediately");
  assert.deepEqual(timers.pendingDelays(), []);
  controller.stop();
}

{
  const timers = createFakeTimers();
  const documentTarget = Object.assign(createEventTarget(), {
    visibilityState: "visible",
  });
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      throw new Error("still unavailable");
    },
    documentTarget,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  assert.deepEqual(
    timers.pendingDelays(),
    [30_000],
    "hidden pages must pause high-frequency retries",
  );
  await timers.advanceBy(10_000);
  assert.equal(calls, 1);
  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  await flushPromises();
  assert.equal(calls, 2, "returning visible must retry immediately");
  controller.stop();
}

{
  const timers = createFakeTimers();
  const pendingAttempt = deferred();
  let concurrent = 0;
  let peakConcurrent = 0;
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      concurrent += 1;
      peakConcurrent = Math.max(peakConcurrent, concurrent);
      try {
        return await pendingAttempt.promise;
      } finally {
        concurrent -= 1;
      }
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  const first = controller.start();
  const second = controller.retryNow("manual");
  const third = controller.retryNow("online");
  await flushPromises();
  assert.equal(calls, 1);
  assert.equal(peakConcurrent, 1);
  pendingAttempt.resolve({ ok: true });
  await Promise.all([first, second, third]);
  controller.stop();
}

{
  const timers = createFakeTimers();
  let current = {
    message: "还没发出的草稿",
    messageReference: { id: 42, text: "上一张照片" },
    chatAttachments: [{ id: "photo-1", name: "selfie.jpg" }],
    sessions: [{ id: 1, title: "旧会话" }],
    activeSessionId: 1,
    settings: { ai_name: "旧名字" },
  };
  let calls = 0;
  const controller = createStartupReconnectController({
    attempt: async () => {
      calls += 1;
      if (calls === 1) throw new Error("cold start timeout");
      current = mergeRecoveredStartupData(current, {
        sessions: [
          { id: 2, title: "另一会话" },
          { id: 1, title: "当前会话" },
        ],
        settings: { ai_name: "小灯" },
      });
    },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await controller.start();
  const latestReference = { id: 43, text: "等待重连时新引用的消息" };
  const latestAttachments = [{ id: "photo-2", name: "new-photo.jpg" }];
  current = {
    ...current,
    message: "等待重连时继续写的新草稿",
    messageReference: latestReference,
    chatAttachments: latestAttachments,
  };
  await timers.advanceBy(2_000);

  assert.equal(current.message, "等待重连时继续写的新草稿");
  assert.equal(current.messageReference, latestReference);
  assert.equal(current.chatAttachments, latestAttachments);
  assert.equal(current.activeSessionId, 1);
  assert.equal(current.settings.ai_name, "小灯");
  controller.stop();
}

{
  const timers = createFakeTimers();
  const stale = deferred();
  let secondSignal;
  const controller = createStartupReconnectController({
    attempt: ({ reason, signal }) => { if (reason === "startup") return stale.promise; secondSignal = signal; return { ok: true }; },
    setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
  });
  const first = controller.start(); await flushPromises();
  const fresh = controller.retryNow("manual", { replaceInFlight: true });
  await fresh; await first;
  stale.resolve({ old: true }); await flushPromises();
  assert.equal(secondSignal.aborted, false);
  assert.equal(controller.getState().status, "connected");
  assert.deepEqual(timers.pendingDelays(), []);
  controller.stop(); assert.equal(secondSignal.aborted, true);
}

{
  const timers = createFakeTimers();
  let signal;
  const controller = createStartupReconnectController({
    attempt: options => { signal = options.signal; return new Promise(() => {}); },
    setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
  });
  const running = controller.start(); await flushPromises();
  await timers.advanceBy(BACKEND_WAKE_TIMEOUT_MS); await running;
  assert.equal(signal.aborted, true);
  assert.equal(controller.getState().status, "waiting");
  assert.equal(controller.getState().lastError.code, "startup_connection_timeout");
  controller.stop();
}

console.log("startup reconnect tests passed");

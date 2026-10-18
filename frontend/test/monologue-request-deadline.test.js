import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers";
import { createMonologueRequestOperation } from "../src/monologue-request-lifecycle.js";
import { createScopedSettingsSession, settingsSaveScope } from "../src/settings-save-scope.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const oldFetch = globalThis.fetch, oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true, hmr: false } });
try {
  const { apiRequest } = await vite.ssrLoadModule("/src/api.js");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  for (const phase of ["auth", "fetch", "json", "late401"]) {
    await test(`whole monologue deadline covers actual API ${phase} and blocks late auth mutations`, async () => {
      const waiting = deferred(); let expire, captures = 0, invalidations = 0, fetches = 0, cleared = 0;
      const operation = createMonologueRequestOperation({ setTimer(fn) { expire = fn; return 1; }, clearTimer() { cleared++; } });
      const snapshot = { user: { id: "fictional-account-a" }, activeCompanionId: "fictional-companion-a" };
      const manager = { getSnapshot: () => snapshot,
        getRequestContext: () => phase === "auth" ? waiting.promise : Promise.resolve({ companionId: snapshot.activeCompanionId }),
        captureCompanionFromResponse() { captures++; }, invalidateSession() { invalidations++; } };
      const response = { status: phase === "late401" ? 401 : 200, ok: phase !== "late401",
        clone() { return { json: () => waiting.promise }; },
        json: () => phase === "json" ? waiting.promise : Promise.resolve({ code: "invalid_session", inner_monologue: "Fictional response" }) };
      globalThis.fetch = async () => { fetches++; return phase === "fetch" ? waiting.promise : response; };
      const session = createScopedSettingsSession(manager, settingsSaveScope(snapshot), operation.controller.signal);
      const task = operation.wait(() => apiRequest("/companion/inner-monologue", {
        method: "POST", retry: false, timeoutMs: 120_000, body: "{}", authSession: session, signal: operation.controller.signal,
      }));
      await tick(); const capturedBeforeDeadline = captures;
      expire(); await assert.rejects(task, error => error.code === "inner_monologue_timeout"); operation.finish();
      waiting.resolve(phase === "auth" ? { companionId: snapshot.activeCompanionId } : phase === "fetch" ? response : { code: "invalid_session", message: "Synthetic expired session" });
      await tick(); await tick();
      assert.equal(invalidations, 0); assert.equal(captures, capturedBeforeDeadline);
      assert.equal(fetches, phase === "auth" ? 0 : 1); assert.equal(cleared, 1);
    });
  }
  await test("older abort implementations retain the intended cancellation code", async () => {
    const NativeController = globalThis.AbortController;
    let expire;
    globalThis.AbortController = class extends NativeController { abort() { super.abort(); } };
    try {
      for (const action of ["cancel", "timeout"]) {
        const operation = createMonologueRequestOperation({ setTimer(fn) { expire = fn; return 1; }, clearTimer() {} });
        const task = operation.wait(() => new Promise(() => {}));
        if (action === "cancel") operation.cancel(); else expire();
        await assert.rejects(task, error => error.code === (action === "cancel" ? "inner_monologue_cancelled" : "inner_monologue_timeout"));
        operation.finish();
      }
    } finally { globalThis.AbortController = NativeController; }
  });
} finally {
  await vite.close(); globalThis.fetch = oldFetch;
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else delete globalThis.window;
}

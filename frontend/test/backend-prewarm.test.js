import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BACKEND_PREWARM_DEDUPE_MS,
  createBackendPrewarmer,
} from "../src/backend-prewarm.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

{
  const response = deferred();
  const calls = [];
  let now = 1_000;
  const prewarmBackend = createBackendPrewarmer({
    baseUrl: "https://backend.example",
    fetchImpl(url, options) {
      calls.push({ url, options });
      return response.promise;
    },
    now: () => now,
  });

  const first = prewarmBackend();
  const second = prewarmBackend();
  assert.equal(
    calls.length,
    1,
    "concurrent startup paths must share one wake request",
  );
  assert.equal(first, second, "the in-flight wake request must be reused");
  assert.equal(calls[0].url, "https://backend.example/");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.cache, "no-store");

  response.resolve({ ok: true, status: 200 });
  assert.equal((await first).ok, true);

  now += BACKEND_PREWARM_DEDUPE_MS - 1;
  await prewarmBackend();
  assert.equal(
    calls.length,
    1,
    "recent successful wakes must be deduplicated",
  );
}

{
  let calls = 0;
  let now = 10_000;
  const prewarmBackend = createBackendPrewarmer({
    baseUrl: "https://backend.example/",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: true, status: 200 };
    },
    now: () => now,
  });

  assert.equal((await prewarmBackend()).ok, false);
  now += BACKEND_PREWARM_DEDUPE_MS + 1;
  assert.equal((await prewarmBackend()).ok, true);
  assert.equal(
    calls,
    2,
    "a failed wake must be retryable after the dedupe window",
  );
}

const mainSource = fs.readFileSync(
  new URL("../src/main.jsx", import.meta.url),
  "utf8",
);
const wakeCall = mainSource.indexOf("prewarmBackend()");
const reactMount = mainSource.indexOf("createRoot(");
assert.ok(wakeCall >= 0, "the app entry must start the backend wake request");
assert.ok(
  wakeCall < reactMount,
  "backend wake-up must start before React waits for session restoration",
);

{
  let calls = 0, firstSignal;
  const prewarm = createBackendPrewarmer({
    baseUrl: "https://backend.example", timeoutMs: 10,
    fetchImpl(_url, options) {
      calls++;
      if (calls === 1) { firstSignal = options.signal; return new Promise(() => {}); }
      return Promise.resolve({ ok: true, status: 200 });
    },
  });
  assert.equal((await prewarm()).ok, false);
  assert.equal(firstSignal.aborted, true);
  assert.equal((await prewarm()).ok, true);
  assert.equal(calls, 2, "a failed or hung prewarm must not suppress a fresh attempt for 45 seconds");
}

console.log("backend prewarm tests passed");

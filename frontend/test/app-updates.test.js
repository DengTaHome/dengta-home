import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_UPDATE_FEED, fetchAppUpdate, readUpdateManifest, shouldRemindUpdate, snoozeUpdate, validUpdateDownload, UPDATE_REMIND_MS } from "../src/app-updates.js";

const release = { version_code: 122, version: "2.10.74", apk_url: "https://github.com/DengTaHome/dengta-home-frontend/releases/download/v2.10.74/DengTa-2.10.74-122.apk", sha256: "a".repeat(64), size_bytes: 42_000_000, published_at: "2026-10-16T00:00:00Z", notes: ["虚构测试更新，不代表已发布"] };
const feed = latest => ({ schema_version: 1, package_id: "home.dengta.app", channel: "stable", latest });

test("the public update feed permits APK origins without credentials and cannot serve a stale release", () => {
  const { headers } = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const route = headers.find(item => item.source === "/updates/android.json");
  assert.ok(route);
  const values = Object.fromEntries(route.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(values["access-control-allow-origin"], "*");
  assert.equal(values["access-control-allow-credentials"], undefined);
  assert.match(values["cache-control"], /\bno-store\b/);
  assert.equal(values["x-content-type-options"], "nosniff");
});

test("only a valid newer build is offered; current, older and unpublished feeds stay quiet", () => {
  assert.deepEqual(readUpdateManifest(feed(release), "121"), release);
  assert.equal(readUpdateManifest(feed(release), 122), null);
  assert.equal(readUpdateManifest(feed(release), 123), null);
  assert.equal(readUpdateManifest(feed(null), 121), null);
  for (const bad of [0, NaN, "", "121x", true, null, " 121 ", 2_147_483_648]) assert.throws(() => readUpdateManifest(feed(release), bad));
});

test("untrusted downloads, another package, incomplete release and HTML never become update prompts", () => {
  for (const url of ["http://github.com/DengTaHome/dengta-home/releases/download/v1/a.apk", "https://github.com.evil.test/DengTaHome/dengta-home/releases/download/v1/a.apk", "https://github.com/other/repo/releases/download/v1/a.apk", "https://user@example.test/DengTaHome/dengta-home/releases/download/v1/a.apk", release.apk_url + "?key=secret", release.apk_url + "#fragment", release.apk_url.replace("DengTa-", "%2f")]) assert.equal(validUpdateDownload(url), false);
  for (const patch of [{ sha256: "" }, { sha256: [release.sha256] }, { size_bytes: 0 }, { notes: [] }, { notes: ["x".repeat(501)] }, { published_at: "no" }, { published_at: "2026-10-16" }, { version_code: "122" }, { version_code: 122.1 }, { version_code: 2_147_483_648 }, { version: "" }, { version: [release.version] }, { apk_url: [release.apk_url] }]) assert.throws(() => readUpdateManifest(feed({ ...release, ...patch }), 121), { code: "app_update_manifest_invalid" });
  assert.throws(() => readUpdateManifest({ ...feed(release), package_id: "other.app" }, 121));
});

test("the actual HTTP reader omits credentials, prevents redirects, rejects oversized streams and cancels a hung transport", async () => {
  let options;
  const fetchImpl = async (url, value) => { assert.equal(url, APP_UPDATE_FEED); options = value; return new Response(JSON.stringify(feed(release)), { headers: { "Content-Type": "application/json" } }); };
  assert.deepEqual(await fetchAppUpdate(121, { fetchImpl }), release);
  assert.equal(options.credentials, "omit"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
  assert.deepEqual(options.headers, { Accept: "application/json" });
  for (const response of [new Response("<html>not JSON</html>"), new Response(" ".repeat(66_000), { headers: { "Content-Type": "application/json" } })]) await assert.rejects(fetchAppUpdate(121, { fetchImpl: async () => response }), { code: "app_update_manifest_invalid" });
  await assert.rejects(fetchAppUpdate(121, { fetchImpl: () => new Promise(() => {}), timeoutMs: 10 }), { name: "AbortError" });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(fetchAppUpdate(121, { fetchImpl, signal: abort.signal }), { name: "AbortError" });
});

test("remind later lasts one day only for the same release and survives restricted storage", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(shouldRemindUpdate(release, storage, 100), true);
  snoozeUpdate(release, storage, 100);
  assert.equal(shouldRemindUpdate(release, storage, 101), false);
  assert.equal(shouldRemindUpdate(release, storage, 100 + UPDATE_REMIND_MS), true);
  assert.equal(shouldRemindUpdate({ ...release, version_code: 123 }, storage, 101), true);
  assert.equal(shouldRemindUpdate(release, { getItem() { throw new Error("blocked"); } }, 101), true);
});

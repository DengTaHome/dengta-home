import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildScreenGlanceTurn,
  clearPendingScreenGlanceTurn,
  normalizeScreenGlanceConfig,
  normalizeScreenGlanceState,
  screenGlanceCaptureToFile,
  screenCaptureMatchesIdentity,
} from "../src/screen-glance.js";

assert.equal(screenCaptureMatchesIdentity({ scopeKey: "a:one" }, { accountScope: "a", companionScope: "one" }), true);
assert.equal(screenCaptureMatchesIdentity({ scopeKey: "a:one" }, { accountScope: "b", companionScope: "one" }), false);
assert.equal(screenCaptureMatchesIdentity({ scopeKey: "a:one" }, { accountScope: "a", companionScope: "two" }), false);
assert.equal(screenCaptureMatchesIdentity({}, { accountScope: "a", companionScope: "one" }), false);

{
  const attachment = { previewUrl: "blob:screen-glance" };
  const revoked = [];
  assert.equal(
    clearPendingScreenGlanceTurn({ attachment }, (value) => revoked.push(value)),
    null,
  );
  assert.deepEqual(revoked, [attachment]);
  assert.equal(clearPendingScreenGlanceTurn(null, () => revoked.push("unexpected")), null);
}

const state = normalizeScreenGlanceState({
  supported: true,
  active: true,
  paused: false,
  randomEnabled: true,
  pendingCapture: true,
  capturedAt: "2026-07-29T12:00:00.000Z",
  nextCaptureAt: "2026-07-29T13:00:00.000Z",
});
assert.equal(state.supported, true);
assert.equal(state.active, true);
assert.equal(state.randomEnabled, true);
assert.equal(state.pendingCapture, true);
assert.equal(state.capturedAt, "2026-07-29T12:00:00.000Z");

assert.deepEqual(
  normalizeScreenGlanceConfig({
    randomEnabled: true,
    minimumMinutes: -10,
    maximumMinutes: 9999,
    wifiOnly: false,
    chargingOnly: true,
    watchTogetherEnabled: true,
    watchIntervalSeconds: 12,
  }),
  {
    randomEnabled: true,
    minimumMinutes: 1,
    maximumMinutes: 180,
    wifiOnly: false,
    chargingOnly: true,
    watchTogetherEnabled: true,
    watchIntervalSeconds: 60,
    coWatchSessionId: "",
  },
);
assert.deepEqual(normalizeScreenGlanceConfig({}), {
  randomEnabled: false,
  minimumMinutes: 60,
  maximumMinutes: 180,
  wifiOnly: true,
  chargingOnly: false,
  watchTogetherEnabled: false,
  watchIntervalSeconds: 90,
  coWatchSessionId: "",
});

const captureBytes = new TextEncoder().encode("private-screen-frame");
const capture = {
  mimeType: "image/jpeg",
  base64: btoa(String.fromCharCode(...captureBytes)),
  capturedAt: "2026-07-29T12:00:00.000Z",
  width: 720,
  height: 1280,
};
const file = screenGlanceCaptureToFile(capture);
assert.equal(file.name, "dengta-screen-glance-20260729-120000.jpg");
assert.equal(file.type, "image/jpeg");
assert.equal(file.size, captureBytes.byteLength);

assert.throws(
  () =>
    screenGlanceCaptureToFile({
      ...capture,
      mimeType: "text/html",
    }),
  /无法读取|不支持/,
);

const turn = buildScreenGlanceTurn(capture);
assert.equal(turn.displayText, "（允许伴侣看了一眼刚才共享的屏幕）");
assert.match(turn.turnContext, /明确授权了这一张当前画面/);
assert.match(turn.turnContext, /自主决定要不要吐槽/);
assert.doesNotMatch(turn.displayText, /系统指令|提示词|不可信/);

const manifest = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
assert.match(manifest, /android:name="\.ScreenGlanceService"/);
assert.match(manifest, /android:foregroundServiceType="mediaProjection"/);
assert.match(manifest, /android:exported="false"/);

const plugin = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/ScreenGlancePlugin.java",
    import.meta.url,
  ),
  "utf8",
);
assert.match(plugin, /createScreenCaptureIntent\(\)/);
assert.match(plugin, /@ActivityCallback/);
assert.match(plugin, /ContextCompat\.startForegroundService/);
assert.match(plugin, /consumeLatestCapture/);
assert.match(
  plugin,
  /JSObject currentState = ScreenGlanceService\.buildState\(getContext\(\)\);[\s\S]*?if \(currentState\.optBoolean\("active", false\)\) \{[\s\S]*?call\.resolve\(currentState\)/,
  "an already authorized projection must upgrade to Together without another system prompt",
);

const service = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/ScreenGlanceService.java",
    import.meta.url,
  ),
  "utf8",
);
assert.match(service, /startForeground\(/);
assert.match(service, /MediaProjection\.Callback/);
assert.match(service, /registerCallback/);
assert.match(service, /createVirtualDisplay/);
assert.match(service, /ImageReader\.newInstance/);
assert.match(service, /deleteLatestCapture/);
assert.match(service, /ACTION_PAUSE/);
assert.match(service, /ACTION_STOP/);
assert.match(service, /WATCH_TOGETHER_ENABLED_KEY/);
assert.match(service, /uploadCoWatchFrame/);
assert.match(service, /perceptualHash/);
assert.match(service, /WATCH_INTERVAL_SECONDS_KEY/);
assert.match(service, /private HttpURLConnection activeUploadConnection;/);
assert.match(
  service,
  /pendingCaptureRequest != null \|\|\s*activeUploadConnection != null/,
  "random glance and Together must not upload frames concurrently",
);
assert.match(service, /registerActiveUploadConnection/);
assert.match(service, /clearActiveUploadConnection/);
assert.match(
  service,
  /invalidateCaptureRequests\([\s\S]*?activeUploadConnection = null;[\s\S]*?connection\.disconnect\(\)/,
  "pause, stop and scope changes must disconnect an in-flight frame upload",
);
assert.match(service, /FOREGROUND_EVENT_LOOKBACK_MS/);
assert.match(
  service,
  /queryEvents\(\s*end - FOREGROUND_EVENT_LOOKBACK_MS,\s*end\s*\)/,
);
assert.doesNotMatch(service, /queryEvents\(end - 30_000L, end\)/);

const activity = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);
assert.match(activity, /registerPlugin\(ScreenGlancePlugin\.class\)/);

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.match(app, /屏幕共看/);
assert.match(app, /只共享屏幕/);
assert.match(app, /暂停捕获/);
assert.match(app, /结束并清除/);
assert.match(app, /consumeLatestCapture/);
assert.match(
  app,
  /function releasePendingScreenGlanceTurn\([\s\S]*?clearPendingScreenGlanceTurn\(pending, revokeAttachmentDraft\)/,
  "pending screen-glance attachments must have one cleanup path",
);
assert.match(
  app,
  /componentMountedRef\.current = false;[\s\S]*?releasePendingScreenGlanceTurn\(pendingScreenGlanceTurnRef\)/,
  "unmounting after logout must revoke a pending screen-glance attachment",
);
assert.match(
  app,
  /const prepared = await prepareChatAttachmentFile\([\s\S]*?if \(!isCurrent\(\)\) return null;/,
  "an async screen-glance conversion must not create a draft after unmount or scope change",
);
assert.match(
  app,
  /const attachment = createAttachmentDraft\(prepared\.file\);[\s\S]*?releasePendingScreenGlanceTurn\(pendingScreenGlanceTurnRef\);[\s\S]*?pendingScreenGlanceTurnRef\.current = \{/,
  "a newer capture must release an older pending draft before replacing it",
);
assert.match(app, /邀请一起看/);
assert.match(app, /watchTogetherEnabled/);
assert.match(app, /持续共看，直到你主动暂停或结束/);
assert.match(app, /watchTogetherEnabled:\s*next\.watchTogetherEnabled/);
assert.match(app, /watchIntervalSeconds:\s*next\.watchIntervalSeconds/);
assert.doesNotMatch(app, /共看采样（秒）/);
assert.match(app, /attachmentInstructionMode:\s*"untrusted"/);
assert.match(app, /attachmentStorageMode:\s*"ephemeral"/);

console.log("screen glance consent, lifecycle and privacy tests passed");

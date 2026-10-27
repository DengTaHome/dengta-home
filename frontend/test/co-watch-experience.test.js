import assert from "node:assert/strict";
import fs from "node:fs";
import "./cast-activity-lifecycle.test.js";
import "./dlna-discovery-state.test.js";
import {
  normalizeScreenGlanceConfig,
  normalizeScreenGlanceState,
} from "../src/screen-glance.js";

const source = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

const config = normalizeScreenGlanceConfig({
  watchTogetherEnabled: true,
  watchIntervalSeconds: 90,
  coWatchSessionId: "watch-session-1",
});
assert.equal(config.coWatchSessionId, "watch-session-1");

const state = normalizeScreenGlanceState({
  supported: true,
  active: true,
  watchTogetherEnabled: true,
  coWatchSessionId: "watch-session-1",
  nextWatchCaptureAt: "2026-08-13T12:00:00.000Z",
  coWatchPreviewAvailable: true,
  coWatchPreviewCapturedAt: "2026-08-13T11:59:30.000Z",
});
assert.equal(state.coWatchSessionId, "watch-session-1");
assert.equal(state.coWatchPreviewAvailable, true);
assert.equal(state.nextWatchCaptureAt, "2026-08-13T12:00:00.000Z");

const service = source(
  "../android/app/src/main/java/home/dengta/app/ScreenGlanceService.java",
);
assert.match(service, /optJSONObject\("notification"\)/);
assert.match(service, /showImmediateCoWatchMessage/);
assert.match(service, /uploadGlanceFrame/);
assert.match(service, /mode=glance/);
assert.match(
  service,
  /else if \(request\.mode == CaptureMode\.GLANCE\) \{\s*uploadGlanceFrame\(request, encoded, frameHash\);/,
);
assert.match(service, /else \{\s*saveCapture\(encoded, width, height, request\.scope\);/);
assert.match(service, /nextRandomOverrideDelayMs/);
assert.match(
  service,
  /minimum_minutes=" \+ request\.minimumMinutes/,
  "a background glance must send the user-selected minimum interval",
);
assert.match(
  service,
  /maximum_minutes=" \+ request\.maximumMinutes/,
  "a background glance must send the user-selected maximum interval",
);
assert.match(service, /final int minimumMinutes;/);
assert.match(service, /final int maximumMinutes;/);
assert.match(
  service,
  /Math\.min\(\s*request\.maximumMinutes,\s*Math\.max\(request\.minimumMinutes, nextCheckMinutes\)\s*\)/,
  "the response must be clamped to the configuration captured with that frame",
);
const randomRunnable = service.match(
  /private final Runnable randomCaptureRunnable[\s\S]*?\n {4}};/,
)?.[0] || "";
assert.doesNotMatch(
  randomRunnable,
  /requestFrame\(true, false\);\s*scheduleNextRandomCapture\(\)/,
  "a random frame must schedule exactly once after its upload finishes",
);
const pauseBranch = service.match(
  /if \(ACTION_PAUSE\.equals\(action\)\)[\s\S]*?return START_NOT_STICKY;/,
)?.[0] || "";
assert.match(pauseBranch, /removeCallbacks\(randomCaptureRunnable\)/);
assert.match(pauseBranch, /removeCallbacks\(watchCaptureRunnable\)/);
assert.match(pauseBranch, /remove\(NEXT_CAPTURE_AT_KEY\)/);
assert.match(service, /class CaptureRequest/);
assert.match(service, /isRequestCurrent/);
assert.match(
  service,
  /if \(watchRequest\) return "";/,
  "Together must work with active screen sharing even without Usage Access",
);
assert.match(service, /showImmediateCompanionMessage/);
assert.match(service, /saveCoWatchPreview/);
assert.match(service, /deleteCoWatchPreview/);

const worker = source(
  "../android/app/src/main/java/home/dengta/app/PushNotificationWorker.java",
);
assert.match(worker, /showImmediateCoWatchMessage/);
assert.match(worker, /markImmediateMessageSeen/);
const companionNotification = worker.match(
  /public static void showImmediateCompanionMessage[\s\S]*?\n {4}}/m,
)?.[0] || "";
assert.match(
  companionNotification,
  /markImmediateMessageSeen/,
  "an immediate screen-glance alert must not be emitted again by polling",
);
assert.doesNotMatch(
  worker.match(/static boolean markImmediateMessageSeen[\s\S]*?\n {4}}/m)?.[0] || "",
  /putString\(CURSOR_KEY/,
  "an immediate co-watch alert must not advance past unrelated push messages",
);
assert.match(worker, /IMPORTANCE_HIGH/);
assert.match(worker, /setSound/);
assert.match(worker, /enableVibration\(true\)/);

const plugin = source(
  "../android/app/src/main/java/home/dengta/app/ScreenGlancePlugin.java",
);
assert.match(plugin, /readCoWatchPreview/);

const notificationsPlugin = source(
  "../android/app/src/main/java/home/dengta/app/BackgroundNotificationsPlugin.java",
);
assert.match(notificationsPlugin, /consumeLaunchTarget/);
assert.match(notificationsPlugin, /notificationTarget/);

const app = source("../src/App.jsx");
// 侧边栏条目已搬到 feature-navigation.js，导航项的断言改看那个文件。
const navSource = source("../src/feature-navigation.js");
assert.match(app, /lazy\(\(\) => import\("\.\/Together\.jsx"\)\)/);
assert.match(navSource, /id:\s*"together"/);
assert.match(app, /<Together/);
assert.match(app, /consumeLaunchTarget/);
const startScreenGlanceStart = app.indexOf(
  "async function startScreenGlanceSession",
);
const startScreenGlanceEnd = app.indexOf(
  "async function setScreenGlancePaused",
  startScreenGlanceStart,
);
const startScreenGlanceSource = app.slice(
  startScreenGlanceStart,
  startScreenGlanceEnd,
);
assert.match(startScreenGlanceSource, /screenGlanceLifecycleRef\.current\.start\(options\)/, "App must use the runtime-tested screen consent lifecycle");

const stopScreenGlanceStart = app.indexOf(
  "async function stopScreenGlanceSession",
);
const stopScreenGlanceEnd = app.indexOf(
  "function updateUnifiedPrompt",
  stopScreenGlanceStart,
);
const stopScreenGlanceSource = app.slice(
  stopScreenGlanceStart,
  stopScreenGlanceEnd,
);
assert.match(stopScreenGlanceSource, /screenGlanceLifecycleRef\.current\.stop\(options\)/, "App must use the runtime-tested scoped stop sequence");

const together = source("../src/Together.jsx");
assert.match(
  together,
  /const active =\s*screenState\.active\s*&&\s*screenState\.watchTogetherEnabled\s*&&\s*session\?\.status === "active"/,
  "ordinary screen sharing must not be presented as an active Together session",
);
assert.match(together, /90/);
assert.match(together, /8\s*分钟/);
assert.match(together, /上次回应/);
assert.match(together, /下次观察/);

console.log("co-watch session, preview and notification tests passed");

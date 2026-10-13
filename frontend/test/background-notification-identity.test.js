import assert from "node:assert/strict";
import fs from "node:fs";
import {
  openReminderNotificationSettings,
  readOrCreateNotificationDeviceId,
  reminderChannelSettingsAvailable,
  resolveBackgroundNotificationIdentity,
  startBackgroundNotificationIdentitySync,
} from "../src/background-notification-identity.js";
import { AUTH_STATUS } from "../src/auth-session.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMPANION_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2026-08-26T12:00:00.000Z";

const notificationIdentitySource = fs.readFileSync(
  new URL("../src/background-notification-identity.js", import.meta.url),
  "utf8",
);
assert.match(
  notificationIdentitySource,
  /timeoutMs:\s*BACKEND_WAKE_TIMEOUT_MS/,
  "notification registration must survive the same backend cold-start window",
);

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const deviceStorage = createStorage();
assert.equal(
  readOrCreateNotificationDeviceId(deviceStorage, () => DEVICE_ID),
  DEVICE_ID,
);
assert.equal(
  readOrCreateNotificationDeviceId(deviceStorage, () => {
    throw new Error("must reuse the stored installation id");
  }),
  DEVICE_ID,
);

const anonymousAction = await resolveBackgroundNotificationIdentity(
  { status: AUTH_STATUS.anonymous, user: null },
  { getRequestContext: async () => ({}) },
  {
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      throw new Error("anonymous users must not register installations");
    },
  },
);
assert.deepEqual(anonymousAction, { method: "clear", payload: {} });

{
  let pluginCalls = 0;
  const webCapacitor = {
    isNativePlatform: () => false,
    getPlatform: () => "web",
    isPluginAvailable: () => false,
  };
  assert.equal(reminderChannelSettingsAvailable(webCapacitor), false);
  assert.deepEqual(
    await openReminderNotificationSettings({
      capacitor: webCapacitor,
      plugin: {
        async openReminderChannelSettings() {
          pluginCalls += 1;
          throw new Error("web must never call the native settings plugin");
        },
      },
    }),
    { opened: false, reason: "unsupported" },
  );
  assert.equal(
    pluginCalls,
    0,
    "the web notification panel must not invoke Android settings",
  );
}

{
  let pluginCalls = 0;
  const androidCapacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    isPluginAvailable: (name) => name === "BackgroundNotifications",
  };
  assert.equal(reminderChannelSettingsAvailable(androidCapacitor), true);
  assert.deepEqual(
    await openReminderNotificationSettings({
      capacitor: androidCapacitor,
      plugin: {
        async openReminderChannelSettings() {
          pluginCalls += 1;
          return { opened: true };
        },
      },
    }),
    { opened: true },
  );
  assert.equal(pluginCalls, 1);
}

const authenticatedAction = await resolveBackgroundNotificationIdentity(
  {
    status: AUTH_STATUS.authenticated,
    user: { id: USER_ID },
  },
  {
    getRequestContext: async () => ({
      accessToken: "private-access-token",
      companionId: COMPANION_ID,
    }),
  },
  {
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async (deviceId) => {
      assert.equal(deviceId, DEVICE_ID);
      return {
        installation_token: "private-installation-token",
        companion_id: COMPANION_ID,
        expires_at: EXPIRES_AT,
      };
    },
  },
);
assert.deepEqual(authenticatedAction, {
  method: "configure",
  payload: {
    installationToken: "private-installation-token",
    expiresAt: Date.parse(EXPIRES_AT),
    deviceId: DEVICE_ID,
    companionId: COMPANION_ID,
    userId: USER_ID,
  },
});

assert.deepEqual(
  await resolveBackgroundNotificationIdentity(
    {
      status: AUTH_STATUS.authenticated,
      user: { id: USER_ID },
    },
    {
      getRequestContext: async () => ({
        accessToken: "private-access-token",
        companionId: "",
      }),
    },
    {
      storage: createStorage(),
      randomUUID: () => DEVICE_ID,
      register: async () => {
        throw new Error("missing companion must not register");
      },
    },
  ),
  { method: "clear", payload: {} },
  "a worker without a companion scope must not fall back to another tenant",
);

{
  let listener = null;
  let context = {
    accessToken: "access-a",
    companionId: COMPANION_ID,
  };
  const calls = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return context;
    },
  };
  const plugin = {
    async configure(payload) {
      calls.push({ method: "configure", payload });
    },
    async clear() {
      calls.push({ method: "clear" });
    },
  };
  const capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor,
    plugin,
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => ({
      installation_token: "install-a",
      companion_id: COMPANION_ID,
      expires_at: EXPIRES_AT,
    }),
    onError(error) {
      throw error;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].method, "configure");
  assert.equal(calls[0].payload.installationToken, "install-a");

  context = {};
  listener({
    status: AUTH_STATUS.anonymous,
    user: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.at(-1).method, "clear");
  stop();
  assert.equal(listener, null);
}

{
  let listener = null;
  let releaseRegistration;
  let registrationStarted;
  const registrationStartedPromise = new Promise((resolve) => {
    registrationStarted = resolve;
  });
  const registrationPromise = new Promise((resolve) => {
    releaseRegistration = resolve;
  });
  const calls = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return {
        accessToken: "access-before-logout",
        companionId: COMPANION_ID,
      };
    },
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    },
    plugin: {
      async configure(payload) {
        calls.push({ method: "configure", payload });
      },
      async clear() {
        calls.push({ method: "clear" });
      },
    },
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      registrationStarted();
      return registrationPromise;
    },
    onError(error) {
      throw error;
    },
  });

  await registrationStartedPromise;
  listener({
    status: AUTH_STATUS.anonymous,
    user: null,
  });
  releaseRegistration({
    installation_token: "stale-installation-token",
    companion_id: COMPANION_ID,
    expires_at: EXPIRES_AT,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    calls,
    [{ method: "clear" }],
    "a registration that finishes after logout must never re-enable native notifications",
  );
  stop();
}

{
  let listener = null;
  let registerCalls = 0;
  let nextTimerId = 1;
  const timers = new Map();
  const configured = [];
  const manager = {
    subscribe(next) {
      listener = next;
      next({
        status: AUTH_STATUS.authenticated,
        user: { id: USER_ID },
      });
      return () => {
        listener = null;
      };
    },
    async getRequestContext() {
      return {
        accessToken: "retry-access-token",
        companionId: COMPANION_ID,
      };
    },
  };
  const stop = startBackgroundNotificationIdentitySync(manager, {
    capacitor: {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    },
    plugin: {
      async configure(payload) {
        configured.push(payload);
      },
      async clear() {},
    },
    storage: createStorage(),
    randomUUID: () => DEVICE_ID,
    register: async () => {
      registerCalls += 1;
      if (registerCalls === 1) throw new Error("backend waking up");
      return {
        installation_token: "retry-installation-token",
        companion_id: COMPANION_ID,
        expires_at: EXPIRES_AT,
      };
    },
    retryDelays: [25],
    setTimeoutFn(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    onError() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registerCalls, 1);
  assert.deepEqual(
    [...timers.values()].map(({ delay }) => delay),
    [25],
    "a temporary installation registration failure must schedule a retry",
  );

  const retryTimer = [...timers.entries()][0];
  timers.delete(retryTimer[0]);
  retryTimer[1].callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(registerCalls, 2);
  assert.equal(configured.length, 1);
  assert.equal(
    configured[0].installationToken,
    "retry-installation-token",
  );
  assert.equal(timers.size, 0);
  stop();
  assert.equal(listener, null);
}

const workerSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/PushNotificationWorker.java",
    import.meta.url,
  ),
  "utf8",
);
const credentialsSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/BackgroundNotificationCredentials.java",
    import.meta.url,
  ),
  "utf8",
);
const pluginSource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/BackgroundNotificationsPlugin.java",
    import.meta.url,
  ),
  "utf8",
);
const activitySource = fs.readFileSync(
  new URL(
    "../android/app/src/main/java/home/dengta/app/MainActivity.java",
    import.meta.url,
  ),
  "utf8",
);
const appSource = fs.readFileSync(
  new URL("../src/App.jsx", import.meta.url),
  "utf8",
);
const androidManifestSource = fs.readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
assert.match(workerSource, /\/api\/v2\/settings/);
assert.match(workerSource, /\/api\/v2\/push\/messages/);
assert.doesNotMatch(
  workerSource,
  /!settings\.optBoolean\("push_enabled", false\)/,
  "manual and co-watch push messages must still be delivered when autonomous generation is disabled",
);
assert.doesNotMatch(
  workerSource,
  /settings == null[\s\S]{0,160}putString\(CURSOR_KEY, nowIso\(\)\)/,
  "a missing settings payload must not advance the cursor and discard pending push messages",
);
assert.match(workerSource, /X-DengTa-Companion-Id/);
assert.match(workerSource, /cancelUniqueWork/);
assert.match(workerSource, /X-DengTa-Installation-Token/);
assert.match(workerSource, /private static final int MAX_SEEN_IDS = 200/);
assert.match(
  workerSource,
  /seenIds\.add\(id\)/,
  "polling must claim an id exactly once before scheduling its notification",
);
assert.match(workerSource, /serializeSeenIds\(seenIds\)/);
assert.match(
  workerSource,
  /private static final Object SEEN_IDS_LOCK = new Object\(\)/,
  "immediate delivery and background polling must share one seen-id lock",
);
const fetchAndNotifySource =
  workerSource.match(
    /private Result fetchAndNotify\([\s\S]*?\n {4}}\n\n {4}private static void postNotification/,
  )?.[0] || "";
assert.match(
  fetchAndNotifySource,
  /String capturedScopeKey = identity\.userId \+ ":" \+ identity\.companionId/,
  "a polling run must capture the identity scope used for its requests",
);
assert.ok(
  (fetchAndNotifySource.match(/isDeliveryScopeCurrent\(/g) || []).length >= 3,
  "a polling run must re-check stop and identity state after network I/O and before delivery state changes",
);
assert.match(
  fetchAndNotifySource,
  /synchronized \(SEEN_IDS_LOCK\) \{[\s\S]*?readSeenIds\(preferences\)[\s\S]*?putString\(SEEN_IDS_KEY, serializeSeenIds\(seenIds\)\)[\s\S]*?commit\(\)/,
  "polling must atomically merge and persist seen ids under the shared lock",
);
const immediateSeenSource =
  workerSource.match(
    /static boolean markImmediateMessageSeen\([\s\S]*?\n {4}}/,
  )?.[0] || "";
assert.match(
  immediateSeenSource,
  /synchronized \(SEEN_IDS_LOCK\) \{[\s\S]*?readSeenIds\(prefs\)[\s\S]*?putString\(SEEN_IDS_KEY, serializeSeenIds\(seenIds\)\)[\s\S]*?commit\(\)/,
  "immediate delivery must atomically merge seen ids under the polling lock",
);
assert.match(workerSource, /if \(scopeChanged\)/);
assert.match(workerSource, /\.putString\(SEEN_IDS_KEY, "\[\]"\)/);
assert.match(
  workerSource,
  /CHANNEL_ID\s*=\s*"dengta-home-reminders-v2"/,
  "active companion alerts must migrate away from the immutable silent v1 channel",
);
assert.match(
  appSource,
  /LOCAL_NOTIFICATION_CHANNEL_ID\s*=\s*"dengta-home-reminders-v2"/,
  "Capacitor and the native worker must target the same migrated alert channel",
);
assert.match(
  workerSource,
  /RingtoneManager\.getDefaultUri\(\s*RingtoneManager\.TYPE_NOTIFICATION\s*\)/,
  "the active alert channel must use Android's default notification sound",
);
assert.match(
  workerSource,
  /\.setUsage\(AudioAttributes\.USAGE_NOTIFICATION\)/,
  "the channel sound must be classified as a notification so Android sound policy applies",
);
assert.match(
  workerSource,
  /channel\.setSound\(defaultSoundUri, audioAttributes\)/,
  "the active alert channel must request sound explicitly",
);
assert.match(
  workerSource,
  /channel\.enableVibration\(true\)/,
  "the active alert channel must request vibration explicitly",
);
assert.match(
  workerSource,
  /private static void postNotification\([\s\S]{0,500}ensureNotificationChannel\(context\)/,
  "a background delivery must create the migrated channel even before the app is reopened",
);
assert.match(
  workerSource,
  /if \(Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O\) \{\s*notification\.setDefaults\(\s*NotificationCompat\.DEFAULT_SOUND \|\s*NotificationCompat\.DEFAULT_VIBRATE\s*\);\s*}/,
  "Android 25 and older must receive explicit sound and vibration defaults without notification channels",
);
assert.match(
  appSource,
  /vibration:\s*true/,
  "the Capacitor channel request must preserve the active alert vibration default",
);
assert.match(
  androidManifestSource,
  /android\.permission\.VIBRATE/,
  "Android must be allowed to run the active alert channel's vibration",
);
assert.match(pluginSource, /BackgroundNotificationCredentials\.clear/);
assert.match(pluginSource, /PushNotificationWorker\.clear/);
assert.match(
  pluginSource,
  /if \(scopeChanged\) \{\s*stopScreenGlanceAndClearCache\(\);\s*\}[\s\S]*?BackgroundNotificationCredentials\.store/,
  "switching account scope must stop screen sharing and clear its cache before storing the new identity",
);
assert.match(
  pluginSource,
  /public void clear\(PluginCall call\) \{\s*stopScreenGlanceAndClearCache\(\);/,
  "clearing native notification identity must also stop local screen sharing",
);
assert.match(
  pluginSource,
  /private void stopScreenGlanceAndClearCache\(\) \{[\s\S]*?ScreenGlanceService\.sendAction\([\s\S]*?ScreenGlanceService\.ACTION_STOP[\s\S]*?ScreenGlanceService\.deleteLatestCapture\(getContext\(\)\)[\s\S]*?ScreenGlanceService\.deleteCoWatchPreview\(getContext\(\)\)/,
  "identity cleanup must stop MediaProjection and delete both random-glance and co-watch caches",
);
assert.match(
  pluginSource,
  /Settings\.ACTION_CHANNEL_NOTIFICATION_SETTINGS/,
  "the settings entry must open Android's notification-channel page",
);
assert.match(
  pluginSource,
  /Settings\.EXTRA_APP_PACKAGE[\s\S]{0,120}getContext\(\)\.getPackageName\(\)/,
  "the channel settings intent must identify the DengTa package",
);
assert.match(
  pluginSource,
  /Settings\.EXTRA_CHANNEL_ID[\s\S]{0,120}PushNotificationWorker\.CHANNEL_ID/,
  "the channel settings intent must target the active v2 reminder channel",
);
assert.match(
  appSource,
  /reminderChannelSettingsAvailable\(\)[\s\S]{0,600}打开手机通知设置/,
  "only a supported Android client should render the system settings entry",
);
assert.match(
  appSource,
  /网页暂无后台声音和震动提醒/,
  "the web panel must state that background sound and vibration are unavailable",
);
assert.match(activitySource, /public void onPause\(\)/);
assert.match(activitySource, /PushNotificationWorker\.markAppVisible/);
assert.match(credentialsSource, /AndroidKeyStore/);
assert.match(credentialsSource, /AES\/GCM\/NoPadding/);
assert.match(
  credentialsSource,
  /cipher\.init\(\s*Cipher\.ENCRYPT_MODE,\s*getOrCreateKey\(\)\s*\)/,
  "Android Keystore must generate the AES-GCM encryption IV",
);
assert.match(
  credentialsSource,
  /byte\[\]\s+iv\s*=\s*cipher\.getIV\(\)/,
  "the generated AES-GCM IV must be persisted with the ciphertext",
);
assert.doesNotMatch(
  credentialsSource,
  /putString\([^,]*installation_token[^,]*,\s*installationToken/,
);

console.log("Android 后台通知登录身份、伴侣隔离与本地凭据保护测试通过。");

package home.dengta.app;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.AudioManager;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.WindowMetrics;
import android.view.KeyEvent;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.text.ParseException;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import java.util.TimeZone;
import java.util.UUID;

public final class ScreenGlanceService extends Service {
    static final String ACTION_START = "home.dengta.app.screen_glance.START";
    static final String ACTION_CAPTURE = "home.dengta.app.screen_glance.CAPTURE";
    static final String ACTION_PAUSE = "home.dengta.app.screen_glance.PAUSE";
    static final String ACTION_RESUME = "home.dengta.app.screen_glance.RESUME";
    static final String ACTION_STOP = "home.dengta.app.screen_glance.STOP";
    static final String ACTION_CONFIGURE = "home.dengta.app.screen_glance.CONFIGURE";
    static final String ACTION_MEDIA_PLAY_PAUSE = "home.dengta.app.screen_glance.MEDIA_PLAY_PAUSE";

    private static final String EXTRA_RESULT_CODE = "projection_result_code";
    private static final String EXTRA_RESULT_DATA = "projection_result_data";
    private static final String CHANNEL_ID = "dengta-screen-glance-v1";
    private static final int NOTIFICATION_ID = 9427;
    private static final String PREFS_NAME = "dengta_screen_glance";
    private static final String RANDOM_ENABLED_KEY = "random_enabled";
    private static final String MINIMUM_MINUTES_KEY = "minimum_minutes";
    private static final String MAXIMUM_MINUTES_KEY = "maximum_minutes";
    private static final String WIFI_ONLY_KEY = "wifi_only";
    private static final String CHARGING_ONLY_KEY = "charging_only";
    private static final String WATCH_TOGETHER_ENABLED_KEY = "watch_together_enabled";
    private static final String WATCH_INTERVAL_SECONDS_KEY = "watch_interval_seconds";
    private static final String CO_WATCH_SESSION_ID_KEY = "co_watch_session_id";
    private static final String CO_WATCH_PREVIEW_CAPTURED_AT_KEY =
        "co_watch_preview_captured_at";
    private static final String CO_WATCH_PREVIEW_WIDTH_KEY =
        "co_watch_preview_width";
    private static final String CO_WATCH_PREVIEW_HEIGHT_KEY =
        "co_watch_preview_height";
    private static final String LAST_REACTION_AT_KEY = "last_reaction_at";
    private static final String LAST_REACTION_KEY = "last_reaction";
    private static final String LAST_WATCH_HASH_KEY = "last_watch_hash";
    private static final String LAST_WATCH_UPLOAD_AT_KEY = "last_watch_upload_at";
    private static final String LAST_GLANCE_HASH_KEY = "last_glance_hash";
    private static final String LAST_GLANCE_UPLOAD_AT_KEY = "last_glance_upload_at";
    private static final String LAST_USER_ACTIVE_AT_KEY = "last_user_active_at";
    private static final String CAPTURE_SCOPE_KEY = "capture_scope";
    private static final String REACTION_SCOPE_KEY = "reaction_scope";
    private static final String PREVIEW_SCOPE_KEY = "preview_scope";
    private static final String CAPTURED_AT_KEY = "captured_at";
    private static final String CAPTURE_WIDTH_KEY = "capture_width";
    private static final String CAPTURE_HEIGHT_KEY = "capture_height";
    private static final String NEXT_CAPTURE_AT_KEY = "next_capture_at";
    private static final String LAST_ERROR_KEY = "last_error";
    private static final long CAPTURE_TTL_MS = 6L * 60L * 60L * 1000L;
    private static final long RETRY_DELAY_MS = 5L * 60L * 1000L;
    private static final long FOREGROUND_EVENT_LOOKBACK_MS =
        24L * 60L * 60L * 1000L;
    private static final int MAX_CAPTURE_EDGE = 720;
    private static final int MAX_CAPTURE_BYTES = 1_000_000;
    private static final long WATCH_FORCE_UPLOAD_MS = 8L * 60L * 1000L;
    private static final int WATCH_HASH_DIFFERENCE = 5;
    private static final int GLANCE_HASH_DIFFERENCE = 5;
    private static final long GLANCE_FORCE_UPLOAD_MS = 30L * 60L * 1000L;
    private static final long ACTIVE_USER_THRESHOLD_MS = 10L * 60L * 1000L;
    private static final long INACTIVE_SKIP_MS = 60L * 60L * 1000L;
    private static final int WATCH_HTTP_TIMEOUT_MS = 70_000;
    private static final String[] PRIVATE_APP_MARKERS = {
        "bank", "banking", "pay", "payment", "wallet", "finance",
        "credit", "password", "passwd", "authenticator", "keychain",
        "vault", "token", "otp", "银行", "支付", "钱包", "密码",
        "验证器", "认证器", "令牌"
    };

    private static volatile ScreenGlanceService activeInstance;

    private final Handler mainHandler = new Handler(android.os.Looper.getMainLooper());
    private final Random random = new Random();
    private final Object captureLock = new Object();
    private volatile MediaProjection mediaProjection;
    private volatile VirtualDisplay virtualDisplay;
    private volatile ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private volatile boolean paused = false;
    private volatile boolean stopping = false;
    private CaptureRequest pendingCaptureRequest;
    private HttpURLConnection activeUploadConnection;
    private long captureGeneration = 1L;
    private volatile long nextCaptureAt = 0L;
    private volatile long nextWatchCaptureAt = 0L;
    private volatile long nextWatchOverrideDelayMs = 0L;
    private volatile long nextRandomOverrideDelayMs = 0L;
    private volatile String coWatchSessionId = "";
    private volatile long coWatchEpoch = System.currentTimeMillis();
    private long coWatchSequence = 0L;

    private final Runnable randomCaptureRunnable = new Runnable() {
        @Override
        public void run() {
            nextCaptureAt = 0L;
            preferences(ScreenGlanceService.this)
                .edit()
                .remove(NEXT_CAPTURE_AT_KEY)
                .apply();
            if (!isSessionActive() || !randomEnabled()) return;
            String blockedReason = captureBlockedReason(true, false);
            if (blockedReason.isEmpty()) {
                if (!requestFrame(true, false)) {
                    scheduleRandomCapture(60_000L);
                }
            } else {
                recordError(blockedReason);
                scheduleRandomCapture(RETRY_DELAY_MS);
            }
        }
    };

    private final Runnable watchCaptureRunnable = new Runnable() {
        @Override
        public void run() {
            nextWatchCaptureAt = 0L;
            if (!isSessionActive() || paused || !watchTogetherEnabled()) return;
            String blockedReason = captureBlockedReason(false, true);
            if (blockedReason.isEmpty()) {
                if (!requestFrame(false, true)) scheduleNextWatchCapture();
            } else {
                recordError(blockedReason);
                scheduleWatchCapture(60_000L);
            }
        }
    };

    private final MediaProjection.Callback projectionCallback =
        new MediaProjection.Callback() {
            @Override
            public void onStop() {
                mainHandler.post(() -> stopProjection(false));
            }
        };

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        refreshCoWatchSessionIdentity();
        ensureNotificationChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (ACTION_STOP.equals(action)) {
            stopProjection(true);
            return START_NOT_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            paused = true;
            invalidateCaptureRequests();
            mainHandler.removeCallbacks(randomCaptureRunnable);
            mainHandler.removeCallbacks(watchCaptureRunnable);
            nextCaptureAt = 0L;
            nextWatchCaptureAt = 0L;
            nextRandomOverrideDelayMs = 0L;
            nextWatchOverrideDelayMs = 0L;
            preferences(this).edit().remove(NEXT_CAPTURE_AT_KEY).apply();
            updateNotification("已暂停，不会读取新的画面");
            return START_NOT_STICKY;
        }
        if (ACTION_RESUME.equals(action)) {
            paused = false;
            updateNotification("共享进行中，只有获准时才会看一眼");
            scheduleNextRandomCapture();
            scheduleNextWatchCapture();
            return START_NOT_STICKY;
        }
        if (ACTION_MEDIA_PLAY_PAUSE.equals(action)) {
            dispatchMediaPlayPause();
            updateNotification("已经切换播放状态，继续一起看");
            return START_NOT_STICKY;
        }
        if (ACTION_CAPTURE.equals(action)) {
            updateNotification("正在确认当前画面是否适合查看…");
            mainHandler.postDelayed(() -> requestFrame(false, false), 1_200L);
            return START_NOT_STICKY;
        }
        if (ACTION_CONFIGURE.equals(action)) {
            refreshCoWatchSessionIdentity();
            scheduleNextRandomCapture();
            scheduleNextWatchCapture();
            updateNotification(notificationText());
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            startProjection(intent);
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopProjection(false);
        if (activeInstance == this) activeInstance = null;
        super.onDestroy();
    }

    static Intent startIntent(Context context, int resultCode, Intent resultData) {
        return new Intent(context, ScreenGlanceService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_RESULT_CODE, resultCode)
            .putExtra(EXTRA_RESULT_DATA, resultData);
    }

    static void sendAction(Context context, String action) {
        Intent intent = new Intent(context, ScreenGlanceService.class).setAction(action);
        if (activeInstance == null) {
            if (ACTION_STOP.equals(action)) {
                deleteLatestCapture(context);
                deleteCoWatchPreview(context);
            }
            return;
        }
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            if (ACTION_STOP.equals(action)) {
                deleteLatestCapture(context);
                deleteCoWatchPreview(context);
            }
        }
    }

    static boolean requestCapture(boolean randomRequest) {
        ScreenGlanceService service = activeInstance;
        if (service == null || !service.isSessionActive() || service.paused) return false;
        return service.requestFrame(randomRequest, false);
    }

    static void storeConfig(
        Context context,
        boolean randomEnabled,
        int minimumMinutes,
        int maximumMinutes,
        boolean wifiOnly,
        boolean chargingOnly,
        boolean watchTogetherEnabled,
        int watchIntervalSeconds,
        String coWatchSessionId
    ) {
        SharedPreferences.Editor editor = preferences(context)
            .edit()
            .putBoolean(RANDOM_ENABLED_KEY, randomEnabled)
            .putInt(MINIMUM_MINUTES_KEY, boundedMinutes(minimumMinutes))
            .putInt(
                MAXIMUM_MINUTES_KEY,
                Math.max(boundedMinutes(minimumMinutes), boundedMinutes(maximumMinutes))
            )
            .putBoolean(WIFI_ONLY_KEY, wifiOnly)
            .putBoolean(CHARGING_ONLY_KEY, chargingOnly)
            .putBoolean(WATCH_TOGETHER_ENABLED_KEY, watchTogetherEnabled)
            .putInt(
                WATCH_INTERVAL_SECONDS_KEY,
                boundedSeconds(watchIntervalSeconds)
            );
        String normalizedSessionId = cleanText(coWatchSessionId, 100);
        if (!normalizedSessionId.isEmpty()) {
            editor.putString(CO_WATCH_SESSION_ID_KEY, normalizedSessionId);
        } else if (!watchTogetherEnabled) {
            editor.remove(CO_WATCH_SESSION_ID_KEY);
        }
        editor.apply();
        if (!watchTogetherEnabled) deleteCoWatchPreview(context);
    }

    static JSObject buildState(Context context) {
        cleanupExpiredCapture(context);
        cleanupExpiredCoWatchPreview(context);
        SharedPreferences prefs = preferences(context);
        ScreenGlanceService service = activeInstance;
        boolean active = service != null && service.isSessionActive();
        JSObject state = new JSObject();
        state.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        state.put("active", active);
        state.put("paused", active && service.paused);
        state.put("randomEnabled", prefs.getBoolean(RANDOM_ENABLED_KEY, false));
        state.put("minimumMinutes", prefs.getInt(MINIMUM_MINUTES_KEY, 60));
        state.put("maximumMinutes", prefs.getInt(MAXIMUM_MINUTES_KEY, 180));
        state.put("wifiOnly", prefs.getBoolean(WIFI_ONLY_KEY, true));
        state.put("chargingOnly", prefs.getBoolean(CHARGING_ONLY_KEY, false));
        state.put(
            "watchTogetherEnabled",
            prefs.getBoolean(WATCH_TOGETHER_ENABLED_KEY, false)
        );
        state.put(
            "watchIntervalSeconds",
            prefs.getInt(WATCH_INTERVAL_SECONDS_KEY, 30)
        );
        state.put(
            "coWatchSessionId",
            active && service.coWatchSessionId != null
                ? service.coWatchSessionId
                : prefs.getString(CO_WATCH_SESSION_ID_KEY, "")
        );
        state.put("coWatchPreviewAvailable", coWatchPreviewFile(context).isFile());
        state.put(
            "coWatchPreviewCapturedAt",
            prefs.getString(CO_WATCH_PREVIEW_CAPTURED_AT_KEY, "")
        );
        state.put("pendingCapture", latestCaptureFile(context).isFile());
        state.put("capturedAt", prefs.getString(CAPTURED_AT_KEY, ""));
        long next = active && service.nextCaptureAt > 0L
            ? service.nextCaptureAt
            : prefs.getLong(NEXT_CAPTURE_AT_KEY, 0L);
        state.put("nextCaptureAt", next > 0L ? isoTimestamp(next) : "");
        state.put("nextWatchCaptureAt", active && service.nextWatchCaptureAt > 0L
            ? isoTimestamp(service.nextWatchCaptureAt)
            : "");
        state.put("lastReactionAt", prefs.getString(LAST_REACTION_AT_KEY, ""));
        state.put("lastReaction", ScreenCaptureScope.matches(prefs.getString(REACTION_SCOPE_KEY, ""), BackgroundNotificationCredentials.currentScopeKey(context)) ? prefs.getString(LAST_REACTION_KEY, "") : "");
        state.put("lastError", prefs.getString(LAST_ERROR_KEY, ""));
        return state;
    }

    static JSObject consumeLatestCapture(Context context) throws Exception {
        cleanupExpiredCapture(context);
        File file = latestCaptureFile(context);
        if (!file.isFile()) return null;
        if (!ScreenCaptureScope.matches(preferences(context).getString(CAPTURE_SCOPE_KEY, ""), BackgroundNotificationCredentials.currentScopeKey(context))) {
            deleteLatestCapture(context);
            return null;
        }
        byte[] bytes = java.nio.file.Files.readAllBytes(file.toPath());
        SharedPreferences prefs = preferences(context);
        String capturedAt = prefs.getString(CAPTURED_AT_KEY, "");
        String scopeKey = prefs.getString(CAPTURE_SCOPE_KEY, "");
        int width = prefs.getInt(CAPTURE_WIDTH_KEY, 0);
        int height = prefs.getInt(CAPTURE_HEIGHT_KEY, 0);
        deleteLatestCapture(context);
        if (bytes.length == 0 || bytes.length > MAX_CAPTURE_BYTES) {
            throw new IllegalStateException("capture_size_invalid");
        }
        JSObject result = new JSObject();
        result.put("mimeType", "image/jpeg");
        result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        result.put("capturedAt", capturedAt);
        result.put("scopeKey", scopeKey);
        result.put("width", width);
        result.put("height", height);
        return result;
    }

    static void deleteLatestCapture(Context context) {
        File capture = latestCaptureFile(context);
        File temporary = temporaryCaptureFile(context);
        if (capture.exists()) capture.delete();
        if (temporary.exists()) temporary.delete();
        preferences(context)
            .edit()
            .remove(CAPTURE_SCOPE_KEY)
            .remove(CAPTURED_AT_KEY)
            .remove(CAPTURE_WIDTH_KEY)
            .remove(CAPTURE_HEIGHT_KEY)
            .apply();
    }

    static JSObject readCoWatchPreview(Context context) throws Exception {
        cleanupExpiredCoWatchPreview(context);
        File file = coWatchPreviewFile(context);
        if (!file.isFile()) return null;
        if (!ScreenCaptureScope.matches(preferences(context).getString(PREVIEW_SCOPE_KEY, ""), BackgroundNotificationCredentials.currentScopeKey(context))) {
            deleteCoWatchPreview(context);
            return null;
        }
        byte[] bytes = java.nio.file.Files.readAllBytes(file.toPath());
        if (bytes.length == 0 || bytes.length > MAX_CAPTURE_BYTES) {
            deleteCoWatchPreview(context);
            throw new IllegalStateException("co_watch_preview_size_invalid");
        }
        SharedPreferences prefs = preferences(context);
        JSObject result = new JSObject();
        result.put("mimeType", "image/jpeg");
        result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        result.put(
            "capturedAt",
            prefs.getString(CO_WATCH_PREVIEW_CAPTURED_AT_KEY, "")
        );
        result.put("width", prefs.getInt(CO_WATCH_PREVIEW_WIDTH_KEY, 0));
        result.put("scopeKey", prefs.getString(PREVIEW_SCOPE_KEY, ""));
        result.put("height", prefs.getInt(CO_WATCH_PREVIEW_HEIGHT_KEY, 0));
        return result;
    }

    static void deleteCoWatchPreview(Context context) {
        File preview = coWatchPreviewFile(context);
        File temporary = temporaryCoWatchPreviewFile(context);
        if (preview.exists()) preview.delete();
        if (temporary.exists()) temporary.delete();
        preferences(context)
            .edit()
            .remove(PREVIEW_SCOPE_KEY)
            .remove(CO_WATCH_PREVIEW_CAPTURED_AT_KEY)
            .remove(CO_WATCH_PREVIEW_WIDTH_KEY)
            .remove(CO_WATCH_PREVIEW_HEIGHT_KEY)
            .apply();
    }

    private void startProjection(Intent intent) {
        if (isSessionActive()) {
            updateNotification(notificationText());
            return;
        }
        startForegroundCompat(buildNotification("正在建立系统屏幕共享…"));
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = readResultData(intent);
        if (resultCode == 0 || resultData == null) {
            recordError("系统授权结果已经失效，请重新开始共享。");
            stopProjection(true);
            return;
        }
        try {
            MediaProjectionManager manager = (MediaProjectionManager)
                getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (manager == null) throw new IllegalStateException("projection_manager_missing");
            mediaProjection = manager.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) throw new IllegalStateException("projection_missing");
            mediaProjection.registerCallback(projectionCallback, mainHandler);
            createVirtualDisplay();
            paused = false;
            stopping = false;
            recordError("");
            updateNotification(notificationText());
            scheduleNextRandomCapture();
            scheduleNextWatchCapture();
        } catch (Exception error) {
            recordError("屏幕共享没有成功建立，请重新授权。");
            stopProjection(true);
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent readResultData(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        }
        return intent.getParcelableExtra(EXTRA_RESULT_DATA);
    }

    private void createVirtualDisplay() {
        CaptureSize size = captureSize();
        captureThread = new HandlerThread("DengTaScreenGlance");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        imageReader = ImageReader.newInstance(
            size.width,
            size.height,
            PixelFormat.RGBA_8888,
            2
        );
        imageReader.setOnImageAvailableListener(this::onImageAvailable, captureHandler);
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "DengTaScreenGlance",
            size.width,
            size.height,
            size.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    private boolean requestFrame(boolean randomRequest, boolean watchRequest) {
        CaptureMode mode = watchRequest
            ? CaptureMode.WATCH
            : randomRequest
            ? CaptureMode.GLANCE
            : CaptureMode.MANUAL;
        String blockedReason = captureBlockedReason(randomRequest, watchRequest);
        if (!blockedReason.isEmpty()) {
            recordError(blockedReason);
            updateNotification(blockedReason);
            return false;
        }
        BackgroundNotificationCredentials.Identity identity = mode == CaptureMode.MANUAL
            ? null
            : BackgroundNotificationCredentials.read(this);
        if (
            mode != CaptureMode.MANUAL &&
            (identity == null || identity.isExpired(System.currentTimeMillis()))
        ) {
            recordError("请先打开 DengTa 完成后台通知身份同步，再开启屏幕查看。");
            return false;
        }
        synchronized (captureLock) {
            if (
                !isSessionActive() ||
                paused ||
                stopping ||
                pendingCaptureRequest != null ||
                activeUploadConnection != null
            ) return false;
            long sequence = mode == CaptureMode.MANUAL
                ? 0L
                : ++coWatchSequence;
            SharedPreferences prefs = preferences(this);
            int minimumMinutes = boundedMinutes(
                prefs.getInt(MINIMUM_MINUTES_KEY, 60)
            );
            int maximumMinutes = Math.max(
                minimumMinutes,
                boundedMinutes(prefs.getInt(MAXIMUM_MINUTES_KEY, 180))
            );
            pendingCaptureRequest = new CaptureRequest(
                mode,
                BackgroundNotificationCredentials.currentScopeKey(this),
                captureGeneration,
                coWatchSessionId,
                coWatchEpoch,
                sequence,
                identity,
                minimumMinutes,
                maximumMinutes
            );
        }
        updateNotification(
            watchRequest
                ? "正在一起看这一幕…"
                : "正在读取一帧，原图只保留在本机…"
        );
        return true;
    }

    private void onImageAvailable(ImageReader reader) {
        Image image = null;
        CaptureRequest request = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null) return;
            request = takeCaptureRequest();
            if (request == null || !isRequestCurrent(request)) return;
            Bitmap bitmap = bitmapFromImage(image);
            if (bitmap == null) throw new IllegalStateException("bitmap_missing");
            long frameHash = perceptualHash(bitmap);
            byte[] encoded = encodeCapture(bitmap);
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            bitmap.recycle();
            if (!isRequestCurrent(request)) return;
            if (request.mode == CaptureMode.WATCH) {
                if (shouldUploadWatchFrame(frameHash)) {
                    uploadCoWatchFrame(request, encoded, width, height, frameHash);
                }
            } else if (request.mode == CaptureMode.GLANCE) {
                uploadGlanceFrame(request, encoded, frameHash);
            } else {
                saveCapture(encoded, width, height, request.scope);
            }
            if (!isRequestCurrent(request)) return;
            recordError("");
            CaptureRequest completed = request;
            mainHandler.post(() -> {
                if (!isRequestCurrent(completed)) return;
                updateNotification(
                    completed.mode == CaptureMode.WATCH
                        ? notificationText()
                        : completed.mode == CaptureMode.GLANCE
                        ? "伴侣刚刚看了一眼，并给你发来了一条消息"
                        : "画面已准备好，回到 DengTa 让伴侣回应"
                );
            });
            scheduleAfterCapture(request, true);
        } catch (Exception error) {
            if (request != null && isRequestCurrent(request)) {
                recordError("这次没有取得清晰画面，稍后可以再试。");
                scheduleAfterCapture(request, false);
            }
        } finally {
            if (image != null) image.close();
        }
    }

    private CaptureRequest takeCaptureRequest() {
        synchronized (captureLock) {
            CaptureRequest request = pendingCaptureRequest;
            pendingCaptureRequest = null;
            return request;
        }
    }

    private void invalidateCaptureRequests() {
        HttpURLConnection connection;
        synchronized (captureLock) {
            captureGeneration += 1L;
            pendingCaptureRequest = null;
            connection = activeUploadConnection;
            activeUploadConnection = null;
        }
        if (connection != null) connection.disconnect();
    }

    private boolean registerActiveUploadConnection(
        CaptureRequest request,
        HttpURLConnection connection
    ) {
        synchronized (captureLock) {
            if (
                request == null ||
                request.generation != captureGeneration ||
                paused ||
                stopping ||
                activeUploadConnection != null
            ) return false;
            activeUploadConnection = connection;
            return true;
        }
    }

    private void clearActiveUploadConnection(HttpURLConnection connection) {
        synchronized (captureLock) {
            if (activeUploadConnection == connection) {
                activeUploadConnection = null;
            }
        }
    }

    private boolean isRequestCurrent(CaptureRequest request) {
        if (
            request == null ||
            paused ||
            stopping ||
            !isSessionActive()
        ) return false;
        synchronized (captureLock) {
            if (request.generation != captureGeneration) return false;
        }
        if (!ScreenCaptureScope.matches(request.scope, BackgroundNotificationCredentials.currentScopeKey(this))) return false;
        if (request.mode == CaptureMode.MANUAL) return true;
        BackgroundNotificationCredentials.Identity identity = request.identity;
        if (identity == null) return false;
        String currentScope = BackgroundNotificationCredentials.currentScopeKey(this);
        if (!(identity.userId + ":" + identity.companionId).equals(currentScope)) {
            return false;
        }
        return request.mode != CaptureMode.WATCH ||
            request.sessionId.equals(coWatchSessionId);
    }

    private void scheduleAfterCapture(CaptureRequest request, boolean succeeded) {
        // 记录用户活动：每次成功截图说明屏幕正被使用，刷新活跃时间
        if (succeeded) {
            preferences(this)
                .edit()
                .putLong(LAST_USER_ACTIVE_AT_KEY, System.currentTimeMillis())
                .apply();
        }
        mainHandler.post(() -> {
            if (!isRequestCurrent(request)) return;
            if (request.mode == CaptureMode.WATCH) {
                if (succeeded) scheduleNextWatchCapture();
                else scheduleWatchCapture(60_000L);
            } else if (request.mode == CaptureMode.GLANCE) {
                if (succeeded) scheduleNextRandomCapture();
                else scheduleRandomCapture(RETRY_DELAY_MS);
            }
            if (!succeeded) updateNotification(notificationText());
        });
    }

    private static Bitmap bitmapFromImage(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        int width = image.getWidth();
        int height = image.getHeight();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = Math.max(0, rowStride - pixelStride * width);
        int paddedWidth = width + rowPadding / Math.max(1, pixelStride);
        Bitmap padded = Bitmap.createBitmap(
            paddedWidth,
            height,
            Bitmap.Config.ARGB_8888
        );
        buffer.rewind();
        padded.copyPixelsFromBuffer(buffer);
        if (paddedWidth == width) return padded;
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
        padded.recycle();
        return cropped;
    }

    private static byte[] encodeCapture(Bitmap bitmap) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 68, output)) {
            throw new IllegalStateException("jpeg_encode_failed");
        }
        byte[] result = output.toByteArray();
        if (result.length <= MAX_CAPTURE_BYTES) return result;
        output.reset();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 48, output)) {
            throw new IllegalStateException("jpeg_encode_failed");
        }
        result = output.toByteArray();
        if (result.length == 0 || result.length > MAX_CAPTURE_BYTES) {
            throw new IllegalStateException("capture_too_large");
        }
        return result;
    }

    private void saveCapture(byte[] value, int width, int height, String scope) throws Exception {
        File directory = captureDirectory(this);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("capture_directory_failed");
        }
        File temporary = temporaryCaptureFile(this);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(value);
            output.flush();
        }
        File destination = latestCaptureFile(this);
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("old_capture_delete_failed");
        }
        if (!temporary.renameTo(destination)) {
            throw new IllegalStateException("capture_commit_failed");
        }
        preferences(this)
            .edit()
            .putString(CAPTURE_SCOPE_KEY, scope)
            .putString(CAPTURED_AT_KEY, isoTimestamp(System.currentTimeMillis()))
            .putInt(CAPTURE_WIDTH_KEY, width)
            .putInt(CAPTURE_HEIGHT_KEY, height)
            .apply();
    }

    private void saveCoWatchPreview(
        byte[] value,
        int width,
        int height,
        String capturedAt,
        String scope
    ) throws Exception {
        File directory = captureDirectory(this);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("capture_directory_failed");
        }
        File temporary = temporaryCoWatchPreviewFile(this);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(value);
            output.flush();
        }
        File destination = coWatchPreviewFile(this);
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("old_co_watch_preview_delete_failed");
        }
        if (!temporary.renameTo(destination)) {
            throw new IllegalStateException("co_watch_preview_commit_failed");
        }
        preferences(this)
            .edit()
            .putString(PREVIEW_SCOPE_KEY, scope)
            .putString(CO_WATCH_PREVIEW_CAPTURED_AT_KEY, capturedAt)
            .putInt(CO_WATCH_PREVIEW_WIDTH_KEY, width)
            .putInt(CO_WATCH_PREVIEW_HEIGHT_KEY, height)
            .apply();
    }

    private static long perceptualHash(Bitmap source) {
        Bitmap sample = Bitmap.createScaledBitmap(source, 8, 8, true);
        int[] pixels = new int[64];
        sample.getPixels(pixels, 0, 8, 0, 0, 8, 8);
        if (sample != source) sample.recycle();
        long total = 0L;
        int[] luminance = new int[64];
        for (int index = 0; index < pixels.length; index += 1) {
            int color = pixels[index];
            int value = (
                299 * ((color >> 16) & 0xff) +
                587 * ((color >> 8) & 0xff) +
                114 * (color & 0xff)
            ) / 1000;
            luminance[index] = value;
            total += value;
        }
        long average = total / luminance.length;
        long hash = 0L;
        for (int index = 0; index < luminance.length; index += 1) {
            if (luminance[index] >= average) hash |= (1L << index);
        }
        return hash;
    }

    private boolean shouldUploadWatchFrame(long frameHash) {
        SharedPreferences prefs = preferences(this);
        long previousHash = prefs.getLong(LAST_WATCH_HASH_KEY, 0L);
        long previousAt = prefs.getLong(LAST_WATCH_UPLOAD_AT_KEY, 0L);
        long now = System.currentTimeMillis();
        return previousAt <= 0L ||
            now - previousAt >= WATCH_FORCE_UPLOAD_MS ||
            Long.bitCount(previousHash ^ frameHash) >= WATCH_HASH_DIFFERENCE;
    }

    private void uploadCoWatchFrame(
        CaptureRequest request,
        byte[] image,
        int width,
        int height,
        long frameHash
    ) throws Exception {
        JSONObject response = uploadFrame(request, image, "");
        if (!isRequestCurrent(request)) return;
        String capturedAt = cleanText(
            response.optString("captured_at", isoTimestamp(System.currentTimeMillis())),
            40
        );
        applyFrameResponse(request, response, image, width, height, capturedAt);
        if (!isRequestCurrent(request)) return;
        long now = System.currentTimeMillis();
        preferences(this)
            .edit()
            .putLong(LAST_WATCH_HASH_KEY, frameHash)
            .putLong(LAST_WATCH_UPLOAD_AT_KEY, now)
            .apply();
    }

    private void uploadGlanceFrame(
        CaptureRequest request,
        byte[] image,
        long frameHash
    ) throws Exception {
        // Glance 哈希跳过：画面没变就不上传
        SharedPreferences prefs = preferences(this);
        long previousHash = prefs.getLong(LAST_GLANCE_HASH_KEY, 0L);
        long previousAt = prefs.getLong(LAST_GLANCE_UPLOAD_AT_KEY, 0L);
        long now = System.currentTimeMillis();
        if (previousAt > 0L &&
            now - previousAt < GLANCE_FORCE_UPLOAD_MS &&
            Long.bitCount(previousHash ^ frameHash) < GLANCE_HASH_DIFFERENCE) {
            return;
        }
        // 记录当前前台应用名，通过 query 参数传给后端
        String appName = "";
        String pkg = foregroundPackage();
        if (!pkg.isEmpty()) {
            String label = applicationName(pkg);
            appName = urlEncode(!label.isEmpty() ? label : pkg);
        }
        JSONObject response = uploadFrame(request, image, appName);
        if (!isRequestCurrent(request)) return;
        applyFrameResponse(request, response, null, 0, 0, "");
        prefs.edit()
            .putLong(LAST_GLANCE_HASH_KEY, frameHash)
            .putLong(LAST_GLANCE_UPLOAD_AT_KEY, System.currentTimeMillis())
            .apply();
    }

    private JSONObject uploadFrame(
        CaptureRequest request,
        byte[] image,
        String appName
    ) throws Exception {
        BackgroundNotificationCredentials.Identity identity = request.identity;
        if (identity == null || identity.isExpired(System.currentTimeMillis())) {
            throw new IllegalStateException("后台通知身份已经失效，请重新打开 DengTa 同步。");
        }
        String capturedAt = isoTimestamp(System.currentTimeMillis());
        String baseUrl = getString(R.string.backend_api_url).replaceAll("/+$", "");
        String modeQuery = request.mode == CaptureMode.GLANCE
            ? "&mode=glance"
            : "&mode=together";
        String intervalQuery = request.mode == CaptureMode.GLANCE
            ? "&minimum_minutes=" + request.minimumMinutes +
                "&maximum_minutes=" + request.maximumMinutes
            : "";
        String query =
            "?session_id=" + urlEncode(request.sessionId) +
            modeQuery +
            intervalQuery +
            "&epoch=" + request.epoch +
            "&sequence=" + request.sequence +
            "&captured_at=" + urlEncode(capturedAt) +
            (appName == null || appName.isEmpty() ? "" : "&app_name=" + appName);
        URI uri = URI.create(baseUrl + "/api/v2/co-watch/frame" + query);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalStateException("共看服务必须使用 HTTPS。");
        }
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        if (!registerActiveUploadConnection(request, connection)) {
            connection.disconnect();
            return new JSONObject();
        }
        try {
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(WATCH_HTTP_TIMEOUT_MS);
        connection.setReadTimeout(WATCH_HTTP_TIMEOUT_MS);
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(image.length);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "image/jpeg");
        connection.setRequestProperty(
            "X-DengTa-Installation-Token",
            identity.installationToken
        );
        connection.setRequestProperty(
            "X-DengTa-Companion-Id",
            identity.companionId
        );
        try (OutputStream output = connection.getOutputStream()) {
            output.write(image);
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
            ? connection.getInputStream()
            : connection.getErrorStream();
        String body = readStream(stream);
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("共看后端暂时没有回应（" + status + "）。");
        }
        if (!isRequestCurrent(request)) return new JSONObject();
        JSONObject response = new JSONObject(body);
        response.put("captured_at", capturedAt);
        return response;
        } finally {
            clearActiveUploadConnection(connection);
            connection.disconnect();
        }
    }

    private void applyFrameResponse(
        CaptureRequest request,
        JSONObject response,
        byte[] previewImage,
        int previewWidth,
        int previewHeight,
        String capturedAt
    ) throws Exception {
        if (!isRequestCurrent(request)) return;
        String reaction = cleanText(response.optString("reaction", ""), 420);
        if (reaction.isEmpty()) {
            throw new IllegalStateException("这次没有收到可显示的共看回应。");
        }
        if (request.mode == CaptureMode.WATCH && previewImage != null) {
            saveCoWatchPreview(
                previewImage,
                previewWidth,
                previewHeight,
                capturedAt,
                request.scope
            );
        }
        String messageId = cleanText(response.optString("message_id", ""), 100);
        String conversationId = cleanText(
            response.optString("conversation_id", ""),
            100
        );
        String aiName = cleanText(response.optString("ai_name", "伴侣"), 50);
        JSONObject notification = response.optJSONObject("notification");
        String notificationTitle = notification == null
            ? aiName
            : cleanText(notification.optString("title", aiName), 50);
        String notificationBody = notification == null
            ? reaction
            : cleanText(notification.optString("body", reaction), 420);
        String notificationMessageId = notification == null
            ? messageId
            : cleanText(notification.optString("message_id", messageId), 100);
        double nextCheckMinutes = response.optDouble("next_check_minutes", 0D);
        if (nextCheckMinutes >= 1D && nextCheckMinutes <= 180D) {
            if (request.mode == CaptureMode.GLANCE) {
                double bounded = Math.min(
                    request.maximumMinutes,
                    Math.max(request.minimumMinutes, nextCheckMinutes)
                );
                nextRandomOverrideDelayMs = Math.round(bounded * 60_000D);
            } else {
                nextWatchOverrideDelayMs = Math.round(nextCheckMinutes * 60_000D);
            }
        }
        long now = System.currentTimeMillis();
        preferences(this)
            .edit()
            .putString(LAST_REACTION_AT_KEY, isoTimestamp(now))
            .putString(REACTION_SCOPE_KEY, request.scope)
            .putString(LAST_REACTION_KEY, cleanText(reaction, 160))
            .apply();
        if (!isRequestCurrent(request)) return;
        if (request.mode == CaptureMode.GLANCE) {
            PushNotificationWorker.showImmediateCompanionMessage(
                this,
                notificationTitle,
                notificationMessageId,
                conversationId,
                notificationBody
            );
        } else {
            PushNotificationWorker.showImmediateCoWatchMessage(
                this,
                notificationTitle,
                notificationMessageId,
                conversationId,
                request.sessionId,
                notificationBody,
                0
            );
        }
    }

    private static String urlEncode(String value) throws Exception {
        return URLEncoder.encode(value, StandardCharsets.UTF_8.name());
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void scheduleNextWatchCapture() {
        mainHandler.removeCallbacks(watchCaptureRunnable);
        nextWatchCaptureAt = 0L;
        if (!isSessionActive() || paused || !watchTogetherEnabled()) return;
        long overrideDelayMs = nextWatchOverrideDelayMs;
        nextWatchOverrideDelayMs = 0L;
        scheduleWatchCapture(overrideDelayMs > 0L
            ? overrideDelayMs
            : boundedSeconds(
                preferences(this).getInt(WATCH_INTERVAL_SECONDS_KEY, 90)
            ) * 1000L);
    }

    private void scheduleWatchCapture(long delayMs) {
        mainHandler.removeCallbacks(watchCaptureRunnable);
        long boundedDelay = Math.max(15_000L, delayMs);
        nextWatchCaptureAt = System.currentTimeMillis() + boundedDelay;
        mainHandler.postDelayed(watchCaptureRunnable, boundedDelay);
    }

    private void scheduleNextRandomCapture() {
        mainHandler.removeCallbacks(randomCaptureRunnable);
        nextCaptureAt = 0L;
        preferences(this).edit().remove(NEXT_CAPTURE_AT_KEY).apply();
        if (!isSessionActive() || paused || !randomEnabled()) return;
        long overrideDelayMs = nextRandomOverrideDelayMs;
        nextRandomOverrideDelayMs = 0L;
        if (overrideDelayMs > 0L) {
            scheduleRandomCapture(overrideDelayMs);
            return;
        }
        SharedPreferences prefs = preferences(this);
        int minimum = boundedMinutes(prefs.getInt(MINIMUM_MINUTES_KEY, 60));
        int maximum = Math.max(
            minimum,
            boundedMinutes(prefs.getInt(MAXIMUM_MINUTES_KEY, 180))
        );
        long spread = maximum - minimum;
        long minutes = minimum + (spread == 0 ? 0 : nextLong(spread + 1));
        // 频率自适应：检测用户活跃度决定间隔伸缩
        long delayMs = adjustForActivity(minutes * 60_000L);
        scheduleRandomCapture(delayMs);
    }

    // 频率自适应：用户最近有前台 App 活动 → 缩短间隔（更容易被捕捉到）；
    // 用户长时间没动手机（如锁屏/夜间未使用）→ 延长间隔甚至倍增，避免无效上传。
    private long adjustForActivity(long requestedMs) {
        SharedPreferences prefs = preferences(this);
        long lastActive = prefs.getLong(LAST_USER_ACTIVE_AT_KEY, 0L);
        long now = System.currentTimeMillis();
        long idleMs = now - lastActive;
        if (prefs.getBoolean(WIFI_ONLY_KEY, true) && !isOnWifi()) {
            return requestedMs;
        }
        if (idleMs > INACTIVE_SKIP_MS && lastActive > 0L) {
            // 长时间无活动：延长 1.5 倍，最多翻倍，避免徒劳抓屏
            long extended = Math.round(requestedMs * 1.5D);
            return Math.min(requestedMs * 2L, extended);
        }
        if (idleMs < ACTIVE_USER_THRESHOLD_MS && lastActive > 0L) {
            // 活跃：缩短到 ~70%，让 AI 更快看到你在干什么
            long shortened = Math.round(requestedMs * 0.7D);
            return Math.max(60_000L, shortened);
        }
        return requestedMs;
    }

    private void scheduleRandomCapture(long delayMs) {
        mainHandler.removeCallbacks(randomCaptureRunnable);
        long boundedDelay = Math.max(60_000L, delayMs);
        nextCaptureAt = System.currentTimeMillis() + boundedDelay;
        preferences(this)
            .edit()
            .putLong(NEXT_CAPTURE_AT_KEY, nextCaptureAt)
            .apply();
        mainHandler.postDelayed(randomCaptureRunnable, boundedDelay);
    }

    private long nextLong(long bound) {
        if (bound <= 1L) return 0L;
        long value = random.nextLong();
        if (value == Long.MIN_VALUE) value = 0L;
        return Math.abs(value) % bound;
    }

    private String captureBlockedReason(boolean randomRequest, boolean watchRequest) {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power == null || !power.isInteractive()) {
            return "屏幕熄灭时不会随机查看。";
        }
        KeyguardManager keyguard = (KeyguardManager) getSystemService(
            Context.KEYGUARD_SERVICE
        );
        if (keyguard != null && keyguard.isKeyguardLocked()) {
            return "锁屏时不会随机查看。";
        }
        if (watchRequest) return "";
        String packageName = foregroundPackage();
        if (packageName.isEmpty()) {
            return "无法确认当前前台 App 是否安全，已跳过这次查看。";
        }
        String normalizedPackage = packageName.toLowerCase(Locale.ROOT);
        if (
            packageName.equals(getPackageName()) ||
            normalizedPackage.equals("com.android.systemui") ||
            normalizedPackage.contains("launcher")
        ) {
            return "当前画面不需要查看，已跳过这次捕获。";
        }
        if (isPrivateApp(packageName, applicationName(packageName))) {
            return "当前可能是账号、支付或密码类 App，已跳过这次查看。";
        }
        if (randomRequest) {
            SharedPreferences prefs = preferences(this);
            if (prefs.getBoolean(WIFI_ONLY_KEY, true) && !isOnWifi()) {
                return "当前不是 Wi-Fi，已跳过随机查看。";
            }
            if (prefs.getBoolean(CHARGING_ONLY_KEY, false) && !isCharging()) {
                return "当前没有充电，已跳过随机查看。";
            }
        }
        return "";
    }

    private boolean isOnWifi() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(
            Context.CONNECTIVITY_SERVICE
        );
        if (manager == null) return false;
        Network active = manager.getActiveNetwork();
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(active);
        return capabilities != null && capabilities.hasTransport(
            NetworkCapabilities.TRANSPORT_WIFI
        );
    }

    private boolean isCharging() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) return false;
        int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL;
    }

    private String foregroundPackage() {
        UsageStatsManager manager = (UsageStatsManager) getSystemService(
            Context.USAGE_STATS_SERVICE
        );
        if (manager == null) return "";
        long end = System.currentTimeMillis();
        UsageEvents events = manager.queryEvents(
            end - FOREGROUND_EVENT_LOOKBACK_MS,
            end
        );
        UsageEvents.Event event = new UsageEvents.Event();
        String foreground = "";
        while (events != null && events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) {
                foreground = String.valueOf(event.getPackageName());
            }
        }
        return foreground.trim();
    }

    private String applicationName(String packageName) {
        try {
            PackageManager manager = getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            return String.valueOf(manager.getApplicationLabel(info));
        } catch (Exception ignored) {
            return "";
        }
    }

    private static boolean isPrivateApp(String packageName, String label) {
        String value = (packageName + " " + label).toLowerCase(Locale.ROOT);
        if (
            value.contains("permissioncontroller") ||
            value.contains("packageinstaller") ||
            value.contains("settings")
        ) {
            return true;
        }
        for (String marker : PRIVATE_APP_MARKERS) {
            if (value.contains(marker)) return true;
        }
        return false;
    }

    private CaptureSize captureSize() {
        WindowManager manager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        int width = 720;
        int height = 1280;
        if (manager != null) {
            WindowMetrics metrics = manager.getMaximumWindowMetrics();
            Rect bounds = metrics.getBounds();
            width = Math.max(1, bounds.width());
            height = Math.max(1, bounds.height());
        }
        double scale = Math.min(1.0, MAX_CAPTURE_EDGE / (double) Math.max(width, height));
        width = Math.max(2, (int) Math.round(width * scale));
        height = Math.max(2, (int) Math.round(height * scale));
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int density = Math.max(DisplayMetrics.DENSITY_LOW, metrics.densityDpi);
        return new CaptureSize(width, height, density);
    }

    private boolean randomEnabled() {
        return preferences(this).getBoolean(RANDOM_ENABLED_KEY, false);
    }

    private boolean watchTogetherEnabled() {
        return preferences(this).getBoolean(WATCH_TOGETHER_ENABLED_KEY, false);
    }

    private void refreshCoWatchSessionIdentity() {
        SharedPreferences prefs = preferences(this);
        String configured = cleanText(
            prefs.getString(CO_WATCH_SESSION_ID_KEY, ""),
            100
        );
        if (configured.isEmpty()) configured = UUID.randomUUID().toString();
        if (!configured.equals(coWatchSessionId)) {
            synchronized (captureLock) {
                captureGeneration += 1L;
                pendingCaptureRequest = null;
                coWatchSessionId = configured;
                coWatchEpoch = System.currentTimeMillis();
                coWatchSequence = 0L;
            }
            nextWatchOverrideDelayMs = 0L;
            nextRandomOverrideDelayMs = 0L;
            prefs.edit()
                .remove(LAST_WATCH_HASH_KEY)
                .remove(LAST_WATCH_UPLOAD_AT_KEY)
                .remove(LAST_GLANCE_HASH_KEY)
                .remove(LAST_GLANCE_UPLOAD_AT_KEY)
                .remove(LAST_USER_ACTIVE_AT_KEY)
                .remove(LAST_REACTION_AT_KEY)
                .remove(LAST_REACTION_KEY)
                .apply();
        }
        prefs.edit().putString(CO_WATCH_SESSION_ID_KEY, configured).apply();
    }

    private boolean isSessionActive() {
        return mediaProjection != null && virtualDisplay != null && imageReader != null;
    }

    private void stopProjection(boolean clearCapture) {
        if (stopping) return;
        stopping = true;
        mainHandler.removeCallbacks(randomCaptureRunnable);
        mainHandler.removeCallbacks(watchCaptureRunnable);
        nextCaptureAt = 0L;
        nextWatchCaptureAt = 0L;
        nextWatchOverrideDelayMs = 0L;
        nextRandomOverrideDelayMs = 0L;
        invalidateCaptureRequests();
        preferences(this).edit().remove(NEXT_CAPTURE_AT_KEY).apply();
        VirtualDisplay display = virtualDisplay;
        virtualDisplay = null;
        if (display != null) display.release();
        ImageReader reader = imageReader;
        imageReader = null;
        if (reader != null) reader.close();
        MediaProjection projection = mediaProjection;
        mediaProjection = null;
        if (projection != null) {
            try {
                projection.unregisterCallback(projectionCallback);
                projection.stop();
            } catch (Exception ignored) {
                // The system can stop a projection before the app releases it.
            }
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
        paused = false;
        if (clearCapture) deleteLatestCapture(this);
        deleteCoWatchPreview(this);
        if (activeInstance == this) activeInstance = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private Notification buildNotification(String text) {
        Intent openApp = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            610,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("DengTa 屏幕共看")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(contentIntent);
        if (watchTogetherEnabled()) {
            builder.addAction(
                0,
                "播放/暂停",
                serviceAction(ACTION_MEDIA_PLAY_PAUSE, 614)
            );
        } else {
            builder.addAction(
                0,
                "看一眼",
                serviceAction(ACTION_CAPTURE, 611)
            );
        }
        builder
            .addAction(
                0,
                paused ? "继续" : "暂停",
                serviceAction(paused ? ACTION_RESUME : ACTION_PAUSE, 612)
            )
            .addAction(0, "结束", serviceAction(ACTION_STOP, 613));
        return builder.build();
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent intent = new Intent(this, ScreenGlanceService.class).setAction(action);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private String notificationText() {
        if (paused) return "已暂停，不会读取新的画面";
        if (watchTogetherEnabled()) {
            String reaction = preferences(this).getString(LAST_REACTION_KEY, "");
            return reaction == null || reaction.isEmpty()
                ? "正在一起看；画面变化时伴侣会主动回应"
                : cleanText(reaction, 72);
        }
        if (randomEnabled()) return "随机查看已获准；可随时暂停或结束";
        return "共享进行中；点“看一眼”才读取单帧";
    }

    private void dispatchMediaPlayPause() {
        AudioManager manager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (manager == null) return;
        long now = android.os.SystemClock.uptimeMillis();
        manager.dispatchMediaKeyEvent(
            new KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0)
        );
        manager.dispatchMediaKeyEvent(
            new KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, 0)
        );
    }

    private void recordError(String message) {
        preferences(this)
            .edit()
            .putString(LAST_ERROR_KEY, cleanText(message, 160))
            .apply();
    }

    private static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "DengTa 屏幕共看",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("显示正在进行的系统屏幕共享，并提供暂停和结束入口");
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private static void cleanupExpiredCapture(Context context) {
        String value = preferences(context).getString(CAPTURED_AT_KEY, "");
        long capturedAt = parseIsoTimestamp(value);
        if (
            capturedAt <= 0L ||
            System.currentTimeMillis() - capturedAt > CAPTURE_TTL_MS
        ) {
            deleteLatestCapture(context);
        }
    }

    private static void cleanupExpiredCoWatchPreview(Context context) {
        String value = preferences(context).getString(
            CO_WATCH_PREVIEW_CAPTURED_AT_KEY,
            ""
        );
        long capturedAt = parseIsoTimestamp(value);
        if (
            capturedAt <= 0L ||
            System.currentTimeMillis() - capturedAt > CAPTURE_TTL_MS
        ) {
            deleteCoWatchPreview(context);
        }
    }

    private static File captureDirectory(Context context) {
        return new File(context.getCacheDir(), "screen-glance");
    }

    private static File latestCaptureFile(Context context) {
        return new File(captureDirectory(context), "latest.jpg");
    }

    private static File temporaryCaptureFile(Context context) {
        return new File(captureDirectory(context), "latest.tmp");
    }

    private static File coWatchPreviewFile(Context context) {
        return new File(captureDirectory(context), "co-watch-preview.jpg");
    }

    private static File temporaryCoWatchPreviewFile(Context context) {
        return new File(captureDirectory(context), "co-watch-preview.tmp");
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(
            PREFS_NAME,
            Context.MODE_PRIVATE
        );
    }

    private static int boundedMinutes(int value) {
        return Math.min(180, Math.max(1, value));
    }

    private static int boundedSeconds(int value) {
        return Math.min(10_800, Math.max(60, value));
    }

    private static String cleanText(String value, int limit) {
        String normalized = String.valueOf(value == null ? "" : value)
            .replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "")
            .replaceAll("\\s+", " ")
            .trim();
        int end = normalized.offsetByCodePoints(
            0,
            Math.min(limit, normalized.codePointCount(0, normalized.length()))
        );
        return normalized.substring(0, end);
    }

    private static String isoTimestamp(long value) {
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(value));
    }

    private static long parseIsoTimestamp(String value) {
        if (value == null || value.isEmpty()) return 0L;
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setLenient(false);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date parsed = formatter.parse(value);
            return parsed == null ? 0L : parsed.getTime();
        } catch (ParseException ignored) {
            return 0L;
        }
    }

    private enum CaptureMode {
        MANUAL,
        GLANCE,
        WATCH
    }

    private static final class CaptureRequest {
        final CaptureMode mode;
        final String scope;
        final long generation;
        final String sessionId;
        final long epoch;
        final long sequence;
        final BackgroundNotificationCredentials.Identity identity;
        final int minimumMinutes;
        final int maximumMinutes;

        CaptureRequest(
            CaptureMode mode,
            String scope,
            long generation,
            String sessionId,
            long epoch,
            long sequence,
            BackgroundNotificationCredentials.Identity identity,
            int minimumMinutes,
            int maximumMinutes
        ) {
            this.mode = mode;
            this.scope = scope;
            this.generation = generation;
            this.sessionId = sessionId;
            this.epoch = epoch;
            this.sequence = sequence;
            this.identity = identity;
            this.minimumMinutes = minimumMinutes;
            this.maximumMinutes = maximumMinutes;
        }
    }

    private static final class CaptureSize {
        final int width;
        final int height;
        final int densityDpi;

        CaptureSize(int width, int height, int densityDpi) {
            this.width = width;
            this.height = height;
            this.densityDpi = densityDpi;
        }
    }
}

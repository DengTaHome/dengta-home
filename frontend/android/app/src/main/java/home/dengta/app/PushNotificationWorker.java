package home.dengta.app;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * 在 WebView 被系统挂起时继续检查已经由 DengTa 后端生成的主动消息。
 *
 * 后端仍负责决定“什么时候想联系用户”和生成内容；本 Worker 只负责在联网时
 * 拉取尚未见过的主动消息，并交给 Android 通知栏。它不持有模型或数据库密钥。
 */
public final class PushNotificationWorker extends Worker {
    public static final String CHANNEL_ID = "dengta-home-reminders-v2";
    private static final String UNIQUE_WORK_NAME = "dengta-home-background-push";
    private static final String PREFS_NAME = "dengta_home_background_push";
    private static final String CURSOR_KEY = "push_cursor";
    private static final String SEEN_IDS_KEY = "seen_push_ids";
    private static final Object SEEN_IDS_LOCK = new Object();
    private static final int MAX_SEEN_IDS = 200;
    private static final int HTTP_TIMEOUT_MS = 15000;

    public PushNotificationWorker(
        @NonNull Context context,
        @NonNull WorkerParameters params
    ) {
        super(context, params);
    }

    public static void schedule(Context context) {
        Context appContext = context.getApplicationContext();
        SharedPreferences preferences = preferences(appContext);
        if (!preferences.contains(CURSOR_KEY)) {
            preferences.edit().putString(CURSOR_KEY, nowIso()).apply();
        }

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            PushNotificationWorker.class,
            15,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
            .build();

        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
    }

    public static void configure(
        Context context,
        boolean scopeChanged
    ) {
        Context appContext = context.getApplicationContext();
        if (scopeChanged) {
            preferences(appContext)
                .edit()
                .putString(CURSOR_KEY, nowIso())
                .putString(SEEN_IDS_KEY, "[]")
                .apply();
        }
        schedule(appContext);
    }

    public static void clear(Context context) {
        Context appContext = context.getApplicationContext();
        preferences(appContext).edit().clear().apply();
        WorkManager.getInstance(appContext).cancelUniqueWork(
            UNIQUE_WORK_NAME
        );
    }

    public static void markAppVisible(Context context) {
        preferences(context.getApplicationContext())
            .edit()
            .putString(CURSOR_KEY, nowIso())
            .apply();
    }

    public static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "DengTa home 主动消息",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("AI 伙伴在合适时间主动想说的话");
        Uri defaultSoundUri = RingtoneManager.getDefaultUri(
            RingtoneManager.TYPE_NOTIFICATION
        );
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build();
        channel.setSound(defaultSoundUri, audioAttributes);
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (!notificationsAllowed(context)) return Result.success();

        SharedPreferences preferences = preferences(context);
        BackgroundNotificationCredentials.Identity identity =
            BackgroundNotificationCredentials.read(context);
        if (identity == null) return Result.success();
        if (identity.isExpired(System.currentTimeMillis())) {
            BackgroundNotificationCredentials.clear(context);
            clear(context);
            return Result.success();
        }
        try {
            return fetchAndNotify(context, preferences, identity);
        } catch (HttpStatusException error) {
            if (error.status == 401 || error.status == 403) {
                BackgroundNotificationCredentials.clear(context);
                clear(context);
                return Result.success();
            }
            return getRunAttemptCount() < 3
                ? Result.retry()
                : Result.success();
        } catch (Exception error) {
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        }
    }

    private Result fetchAndNotify(
        Context context,
        SharedPreferences preferences,
        BackgroundNotificationCredentials.Identity identity
    ) throws Exception {
        String capturedScopeKey = identity.userId + ":" + identity.companionId;
        JSONObject settingsResponse = getJson(
            context,
            identity,
            "/api/v2/settings"
        );
        if (!isDeliveryScopeCurrent(context, capturedScopeKey)) {
            return Result.success();
        }
        JSONObject settings = settingsResponse.optJSONObject("settings");

        String cursor = preferences.getString(CURSOR_KEY, "");
        if (cursor == null || cursor.isEmpty()) {
            if (!isDeliveryScopeCurrent(context, capturedScopeKey)) {
                return Result.success();
            }
            preferences.edit().putString(CURSOR_KEY, nowIso()).commit();
            return Result.success();
        }

        String encodedCursor = URLEncoder.encode(
            cursor,
            StandardCharsets.UTF_8.name()
        );
        JSONObject response = getJson(
            context,
            identity,
            "/api/v2/push/messages?since=" +
                encodedCursor +
                "&limit=50"
        );
        if (!isDeliveryScopeCurrent(context, capturedScopeKey)) {
            return Result.success();
        }
        JSONArray messages = response.optJSONArray("messages");
        if (messages == null || messages.length() == 0) return Result.success();

        List<JSONObject> unseen = new ArrayList<>();
        String latestCreatedAt = cursor;
        synchronized (SEEN_IDS_LOCK) {
            if (!isDeliveryScopeCurrent(context, capturedScopeKey)) {
                return Result.success();
            }
            Set<String> seenIds = readSeenIds(preferences);
            for (int index = 0; index < messages.length(); index += 1) {
                JSONObject message = messages.optJSONObject(index);
                if (message == null) continue;
                String id = message.optString("id", "").trim();
                String createdAt = message.optString("created_at", "").trim();
                if (!createdAt.isEmpty()) latestCreatedAt = createdAt;
                if (!id.isEmpty() && seenIds.add(id)) unseen.add(message);
            }
            preferences.edit()
                .putString(CURSOR_KEY, latestCreatedAt)
                .putString(SEEN_IDS_KEY, serializeSeenIds(seenIds))
                .commit();
        }

        boolean appVisible = isAppVisible(context);
        String aiName = cleanText(
            settings == null
                ? "DengTa home"
                : settings.optString("ai_name", "DengTa home"),
            50
        );
        if (aiName.isEmpty()) aiName = "DengTa home";

        for (JSONObject message : unseen) {
            if (!isDeliveryScopeCurrent(context, capturedScopeKey)) {
                return Result.success();
            }
            String id = message.optString("id", "").trim();
            if (id.isEmpty()) continue;
            if (!appVisible) postNotification(context, aiName, message);
        }
        return Result.success();
    }

    private boolean isDeliveryScopeCurrent(
        Context context,
        String capturedScopeKey
    ) {
        return !isStopped() && capturedScopeKey.equals(
            BackgroundNotificationCredentials.currentScopeKey(context)
        );
    }

    private static void postNotification(
        Context context,
        String aiName,
        JSONObject message
    ) {
        String id = message.optString("id", "");
        String content = cleanText(message.optString("content", ""), 240);
        if (content.isEmpty()) return;
        ensureNotificationChannel(context);

        Intent openApp = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("dengta_session_id", message.optString("conversation_id", ""));
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId(id),
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder notification = new NotificationCompat.Builder(
            context,
            CHANNEL_ID
        )
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(aiName)
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            notification.setDefaults(
                NotificationCompat.DEFAULT_SOUND |
                    NotificationCompat.DEFAULT_VIBRATE
            );
        }

        NotificationManagerCompat.from(context).notify(notificationId(id), notification.build());
    }

    static boolean markImmediateMessageSeen(Context context, String messageId) {
        String normalizedId = cleanText(messageId, 100);
        if (normalizedId.isEmpty()) return false;
        SharedPreferences prefs = preferences(context.getApplicationContext());
        synchronized (SEEN_IDS_LOCK) {
            Set<String> seenIds = readSeenIds(prefs);
            if (!seenIds.add(normalizedId)) return false;
            prefs.edit()
                .putString(SEEN_IDS_KEY, serializeSeenIds(seenIds))
                .commit();
            return true;
        }
    }

    public static void showImmediateCoWatchMessage(
        Context context,
        String title,
        String messageId,
        String conversationId,
        String coWatchSessionId,
        String content,
        int mediaPositionSeconds
    ) {
        String normalizedContent = cleanText(content, 420);
        String normalizedMessageId = cleanText(messageId, 100);
        String normalizedSessionId = cleanText(coWatchSessionId, 100);
        if (
            normalizedContent.isEmpty() ||
            normalizedMessageId.isEmpty() ||
            normalizedSessionId.isEmpty()
        ) return;

        if (!markImmediateMessageSeen(context, normalizedMessageId)) return;
        if (!notificationsAllowed(context)) return;
        ensureNotificationChannel(context);

        Intent openApp = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("dengta_view", "together")
            .putExtra("dengta_session_id", conversationId)
            .putExtra("dengta_co_watch_session_id", normalizedSessionId);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId(normalizedMessageId),
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent replyIntent = new Intent(context, CoWatchReplyReceiver.class)
            .setAction(CoWatchReplyReceiver.ACTION_REPLY)
            .putExtra(CoWatchReplyReceiver.EXTRA_SESSION_ID, normalizedSessionId)
            .putExtra(CoWatchReplyReceiver.EXTRA_CONVERSATION_ID, conversationId)
            .putExtra(CoWatchReplyReceiver.EXTRA_TITLE, cleanText(title, 50))
            .putExtra(CoWatchReplyReceiver.EXTRA_MEDIA_POSITION_SECONDS, mediaPositionSeconds);
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
            context,
            notificationId(normalizedMessageId + ":reply"),
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        RemoteInput remoteInput = new RemoteInput.Builder(
            CoWatchReplyReceiver.REMOTE_INPUT_TEXT
        )
            .setLabel("回复一起看")
            .build();
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
            0,
            "回复",
            replyPendingIntent
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(true)
            .build();
        Uri sound = RingtoneManager.getDefaultUri(
            RingtoneManager.TYPE_NOTIFICATION
        );
        long[] vibration = {0L, 180L, 90L, 180L};
        String normalizedTitle = cleanText(title, 50);
        if (normalizedTitle.isEmpty()) normalizedTitle = "一起看";
        NotificationCompat.Builder notification = new NotificationCompat.Builder(
            context,
            CHANNEL_ID
        )
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(normalizedTitle)
            .setContentText(normalizedContent)
            .setStyle(
                new NotificationCompat.BigTextStyle().bigText(normalizedContent)
            )
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSound(sound)
            .setVibrate(vibration)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .addAction(replyAction);

        NotificationManagerCompat.from(context).notify(
            notificationId(normalizedMessageId),
            notification.build()
        );
    }

    public static void showImmediateCompanionMessage(
        Context context,
        String aiName,
        String messageId,
        String conversationId,
        String content
    ) {
        String normalizedMessageId = cleanText(messageId, 100);
        String normalizedContent = cleanText(content, 420);
        if (normalizedMessageId.isEmpty() || normalizedContent.isEmpty()) return;
        if (!markImmediateMessageSeen(context, normalizedMessageId)) return;
        if (!notificationsAllowed(context)) return;
        ensureNotificationChannel(context);
        JSONObject message = new JSONObject();
        try {
            message.put("id", normalizedMessageId);
            message.put("conversation_id", conversationId);
            message.put("content", normalizedContent);
        } catch (Exception ignored) {
            return;
        }
        postNotification(
            context,
            cleanText(aiName, 50).isEmpty() ? "DengTa home" : cleanText(aiName, 50),
            message
        );
    }

    private static JSONObject getJson(
        Context context,
        BackgroundNotificationCredentials.Identity identity,
        String path
    ) throws Exception {
        String baseUrl = context.getString(R.string.backend_api_url).replaceAll("/+$", "");
        URI uri = URI.create(baseUrl + path);
        if (!"https".equalsIgnoreCase(uri.getScheme())) {
            throw new IllegalStateException("Background notification API must use HTTPS");
        }

        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(HTTP_TIMEOUT_MS);
        connection.setReadTimeout(HTTP_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty(
            "X-DengTa-Installation-Token",
            identity.installationToken
        );
        connection.setRequestProperty(
            "X-DengTa-Companion-Id",
            identity.companionId
        );

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
            ? connection.getInputStream()
            : connection.getErrorStream();
        String body = readStream(stream);
        connection.disconnect();

        if (status < 200 || status >= 300) {
            throw new HttpStatusException(status);
        }
        return new JSONObject(body);
    }

    private static final class HttpStatusException extends Exception {
        final int status;

        HttpStatusException(int status) {
            super("Background notification API returned " + status);
            this.status = status;
        }
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

    private static boolean notificationsAllowed(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean isAppVisible(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(
            Context.ACTIVITY_SERVICE
        );
        if (manager == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
        if (processes == null) return false;
        String packageName = context.getPackageName();
        for (ActivityManager.RunningAppProcessInfo process : processes) {
            if (!packageName.equals(process.processName)) continue;
            return process.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
        }
        return false;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static Set<String> readSeenIds(SharedPreferences preferences) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        try {
            JSONArray values = new JSONArray(preferences.getString(SEEN_IDS_KEY, "[]"));
            for (int index = 0; index < values.length(); index += 1) {
                String value = values.optString(index, "").trim();
                if (!value.isEmpty()) result.add(value);
            }
        } catch (Exception ignored) {
            // 损坏的本地去重缓存可以安全地从空集合重新开始。
        }
        return result;
    }

    private static String serializeSeenIds(Set<String> source) {
        List<String> values = new ArrayList<>(source);
        int fromIndex = Math.max(0, values.size() - MAX_SEEN_IDS);
        JSONArray result = new JSONArray();
        for (int index = fromIndex; index < values.size(); index += 1) {
            result.put(values.get(index));
        }
        return result.toString();
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

    private static int notificationId(String value) {
        int hash = value == null ? 0 : value.hashCode();
        return hash == Integer.MIN_VALUE ? 1 : Math.max(1, Math.abs(hash));
    }

    private static String nowIso() {
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }
}

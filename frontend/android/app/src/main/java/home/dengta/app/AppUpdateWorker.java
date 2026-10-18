package home.dengta.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class AppUpdateWorker extends Worker {
    private static final String WORK_NAME = "dengta-app-updates";
    private static final String CHANNEL = "dengta-app-updates";
    static final String OPEN_UPDATE = "dengta_open_update";
    public AppUpdateWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    static SharedPreferences preferences(Context context) { return context.getSharedPreferences("dengta_app_updates", Context.MODE_PRIVATE); }
    static void schedule(Context context) {
        if (!preferences(context).getBoolean("enabled", true)) return;
        PeriodicWorkRequest work = new PeriodicWorkRequest.Builder(AppUpdateWorker.class, 30, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, work);
    }
    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean("enabled", enabled).apply();
        if (enabled) schedule(context); else WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
    }
    private boolean canNotify(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled() ||
            Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager == null) return false;
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }
    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        if (!preferences(context).getBoolean("enabled", true) || !canNotify(context) || isStopped()) return Result.success();
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(AppUpdatePolicy.FEED_URL).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12_000);
            connection.setReadTimeout(12_000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > 65_536 ||
                connection.getContentType() == null || !connection.getContentType().contains("application/json")) return Result.success();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            long started = android.os.SystemClock.elapsedRealtime();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (isStopped() || bytes.size() + count > 65_536 || android.os.SystemClock.elapsedRealtime() - started > 15_000) return Result.success();
                    bytes.write(buffer, 0, count);
                }
            }
            JSONObject feed = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            if (AppUpdatePolicy.positiveInteger(feed.opt("schema_version"), 1) != 1 || !context.getPackageName().equals(feed.opt("package_id")) || !"stable".equals(feed.opt("channel"))) return Result.success();
            JSONObject release = feed.optJSONObject("latest");
            if (release == null) return Result.success();
            long versionCode = AppUpdatePolicy.positiveInteger(release.opt("version_code"), Integer.MAX_VALUE);
            long installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
            JSONArray notes = release.optJSONArray("notes");
            if (!AppUpdatePolicy.newer(installed, versionCode) || !AppUpdatePolicy.validDownload(release.optString("apk_url")) ||
                !AppUpdatePolicy.validReleaseFields(release.opt("version"), release.opt("sha256"), release.opt("size_bytes"), release.opt("published_at")) ||
                notes == null || notes.length() < 1 || notes.length() > 20) return Result.success();
            for (int index = 0; index < notes.length(); index++) {
                Object note = notes.get(index);
                if (!(note instanceof String) || ((String) note).trim().isEmpty() || ((String) note).length() > 500) return Result.success();
            }
            if (preferences(context).getLong("notified_build", 0) >= versionCode || !canNotify(context) || isStopped() || !preferences(context).getBoolean("enabled", true)) return Result.success();
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationManager manager = context.getSystemService(NotificationManager.class);
                if (manager == null) return Result.success();
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "灯塔版本更新", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(OPEN_UPDATE, true);
            PendingIntent target = PendingIntent.getActivity(context, 8201, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            String text = notes.getString(0);
            NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle("灯塔 " + release.getString("version") + " 已发布").setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text + "\n打开灯塔查看完整更新说明"))
                .setContentIntent(target).setAutoCancel(true).setOnlyAlertOnce(true);
            NotificationManagerCompat.from(context).notify(8201, notification.build());
            preferences(context).edit().putLong("notified_build", versionCode).apply();
            return Result.success();
        } catch (Exception error) { return Result.success(); }
        finally { if (connection != null) connection.disconnect(); }
    }
}

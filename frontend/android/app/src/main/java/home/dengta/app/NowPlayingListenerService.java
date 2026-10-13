package home.dengta.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.session.MediaSessionManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 现在播放识别（活动感知-音乐）：监听系统媒体通知（网易云/QQ音乐/系统播放器等
 * 播放时都会发通知），从中提取歌曲标题/歌手/专辑/封面。
 * 相比 MediaSessionManager.getActiveSessions，通知监听在 Android 13+ 不需要
 * 特殊权限（仅需用户在系统设置中授权"通知使用权"）。
 */
public final class NowPlayingListenerService extends NotificationListenerService {
    private static final String TAG = "NowPlaying";
    // 缓存的最近一条媒体通知
    private static volatile StatusBarNotification cachedMediaNotification = null;
    private static volatile long cachedAt = 0L;

    // 视频类 App：即使发媒体通知也是视频不是音乐，排除掉。
    private static final String[] VIDEO_PACKAGE_MARKERS = {
        "bilibili", "youku", "iqiyi", "qiyi", "tencent.video", "qqvideo",
        "douyin", "kuaishou", "huya", "douyu", "mgtv", "sohu.video",
        "video", "vod", "zuiyou", "weishi", "quanmin", "kuaishou",
        "soul", "youtube", "twitch"
    };

    public static StatusBarNotification getCachedMediaNotification() {
        return cachedMediaNotification;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification notification = sbn.getNotification();
            if (notification == null) return;
            if (!isMediaNotification(sbn, notification)) return;
            cachedMediaNotification = sbn;
            cachedAt = System.currentTimeMillis();
        } catch (Exception ignored) {
            // 解析失败不影响
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        try {
            if (cachedMediaNotification != null &&
                cachedMediaNotification.getKey().equals(sbn.getKey())) {
                cachedMediaNotification = null;
                cachedAt = 0L;
            }
        } catch (Exception ignored) {
        }
    }

    private boolean isMediaNotification(StatusBarNotification sbn, Notification notification) {
        // 硬性条件：必须是系统"媒体播放"通知——广告、外卖、工具类推送
        // 即使带标题和文本也一律不收。
        boolean mediaStyle = false;
        if (notification.extras != null) {
            String template = String.valueOf(notification.extras.getString(Notification.EXTRA_TEMPLATE));
            if (template != null && template.contains("MediaStyle")) mediaStyle = true;
            if (notification.extras.containsKey(Notification.EXTRA_MEDIA_SESSION)
                || notification.extras.containsKey("android.mediaSession")) {
                mediaStyle = true;
            }
        }
        // 兜底：包名像知名音乐 App 且带媒体按钮动作的也算（个别播放器不用 MediaStyle）
        if (!mediaStyle) {
            String pkg = sbn.getPackageName() == null ? "" : sbn.getPackageName().toLowerCase();
            boolean musicApp = pkg.contains("netease") || pkg.contains("cloudmusic")
                || pkg.contains("qqmusic") || pkg.contains("kugou") || pkg.contains("kuwo")
                || pkg.contains("xiami") || pkg.contains("spotify") || pkg.contains("pandora")
                || pkg.contains("imusic") || pkg.contains("music");
            if (musicApp) {
                if (notification.extras != null) {
                    CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
                    if (title != null && title.length() > 0) mediaStyle = true;
                }
            }
        }
        if (!mediaStyle) return false;
        // 排除视频类 App（B站/腾讯视频/抖音等即使发媒体通知也不是音乐）。
        String pkg = sbn.getPackageName() == null ? "" : sbn.getPackageName().toLowerCase();
        for (String marker : VIDEO_PACKAGE_MARKERS) {
            if (pkg.contains(marker)) return false;
        }
        return true;
    }
}

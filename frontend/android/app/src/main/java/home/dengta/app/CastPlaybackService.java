package home.dengta.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import android.view.Surface;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.drm.DefaultDrmSessionManagerProvider;
import androidx.media3.exoplayer.drm.DrmSessionManagerProvider;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import java.util.Locale;
import java.util.Map;
import java.lang.ref.WeakReference;

/**
 * 投屏播放前台服务（PlayBridge ExoRendererService 模式 + Castor 本地代理）。
 *
 * ExoPlayer 常驻前台服务：B站 投屏后用户切后台、锁屏，播放不中断。
 * 遇到 CDN 防盗链 403 时自动启动本地代理（Castor inspire），通过代理拉流。
 */
@UnstableApi
public final class CastPlaybackService extends Service {

    private static final String ACTION_PLAY = "home.dengta.app.action.PLAY";
    private static final String ACTION_STOP = "home.dengta.app.action.STOP";
    private static final String EXTRA_URI = "extra_uri";
    private static final String EXTRA_TITLE = "extra_title";
    private static final String EXTRA_EXPECTED_URI = "extra_expected_uri";
    private static final String CHANNEL_ID = "cast_playback";
    private static final int NOTIFICATION_ID = 42;

    private static final String TAG = "CastPlaybackService";
    private static WeakReference<CastPlaybackService> activeService = new WeakReference<>(null);

    /** Main-thread access only; commands must never start a new playback service. */
    static CastPlaybackService getActiveService() {
        return activeService.get();
    }

    void executePlaybackCommand(String action, Double value) {
        if (originalUri.isEmpty()) throw new IllegalStateException("playback_not_active");
        final ExoPlayer current = player;
        CastPlaybackCommands.execute(action, value, current == null ? null : new CastPlaybackCommands.Target() {
            @Override public void play() {
                audioFocusHelper.requestFocus();
                current.play();
            }
            @Override public void pause() { current.pause(); }
            @Override public void setSpeed(float speed) { current.setPlaybackSpeed(speed); }
        });
    }

    public interface Listener {
        void onPlaybackStateChanged(int state);
        void onPlaybackError(String message);
        void onVideoSizeChanged(int videoWidth, int videoHeight);
    }

    private final LocalBinder binder = new LocalBinder();
    ExoPlayer player;
    private AudioFocusHelper audioFocusHelper;
    private String currentTitle = "";
    private String originalUri = ""; // 原始 B站 URL（proxy 模式下保存）

    /** 供播放器 Activity 安全读取原始媒体地址（用于截帧回退）。 */
    public String getOriginalUri() {
        return originalUri;
    }
    private volatile Listener listener; // 跨线程可见
    private volatile int cachedPlaybackState = Player.STATE_IDLE; // 供迟绑定的 Activity 恢复 UI
    private LocalMediaProxy localProxy;
    private DefaultDrmSessionManagerProvider drmProvider;
    private volatile int proxyRetryCount = 0;
    private static final int MAX_PROXY_RETRIES = 1;

    public final class LocalBinder extends Binder {
        public CastPlaybackService getService() {
            return CastPlaybackService.this;
        }
    }

    /** 前端插件调用：播放指定媒体（幂等，同一 URI 不重播）。 */
    public static void play(Context context, String uri, String title) {
        Intent intent = new Intent(context, CastPlaybackService.class)
            .setAction(ACTION_PLAY)
            .putExtra(EXTRA_URI, uri)
            .putExtra(EXTRA_TITLE, title);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    /** 前端插件调用：停止播放并让服务退出。 */
    public static void stop(Context context) {
        stop(context, "");
    }

    public static void stop(Context context, String expectedUri) {
        Intent intent = new Intent(context, CastPlaybackService.class).setAction(ACTION_STOP)
            .putExtra(EXTRA_EXPECTED_URI, expectedUri);
        context.startService(intent);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeService = new WeakReference<>(this);
        createNotificationChannel();
        audioFocusHelper = new AudioFocusHelper(this);
        // 无 Surface 时不设置视频输出，播放器自动降级为音频+进度（后台播放场景）
        // 当 Activity 绑定后通过 setSurface() 提供真实 Surface 恢复画面
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            if (!CastMediaScope.matches(intent.getStringExtra(EXTRA_EXPECTED_URI), originalUri)) {
                if (originalUri.isEmpty()) stopSelf(startId);
                return START_NOT_STICKY;
            }
            stopForegroundCompat();
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
            originalUri = "";
            currentTitle = "";
            closeLocalProxy();
            if (listener != null) listener.onPlaybackError("投屏已停止，请重新打开视频。");
            stopSelf();
            return START_NOT_STICKY;
        }
        String uri = intent.getStringExtra(EXTRA_URI);
        String title = intent.getStringExtra(EXTRA_TITLE);
        if (action == null || uri == null || uri.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            startForegroundPlayback(title == null ? "" : title);
            ensurePlayer();
            audioFocusHelper.requestFocus();
            playUri(uri, title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start playback", e);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    private void ensurePlayer() {
        if (player != null) {
            return;
        }
        // 创建 DRM 会话管理器提供者（Media3 1.5.1 使用 Provider 模式发现 Widevine 等加密内容）
        drmProvider = createDrmProvider();
        ExoPlayer.Builder builder = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(defaultDataSourceFactory()));
        player = builder.build();
        player.setVideoSurface(null); // 无 Surface 先音频播放，绑定后由 Activity 提供真实 Surface
        player.addListener(new Player.Listener() {
            @Override
            public void onVideoSizeChanged(androidx.media3.common.VideoSize videoSize) {
                int vw = videoSize != null ? videoSize.width : 0;
                int vh = videoSize != null ? videoSize.height : 0;
                if (listener != null && vw > 0 && vh > 0) {
                    listener.onVideoSizeChanged(vw, vh);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (error == null) return;
                int errCode = error.errorCode;
                String msg = CastError.formatMediaError(errCode);

                // DRM 错误码（6001-6009）已有精确提示，不覆盖
                boolean isDrmError = errCode >= 6001 && errCode <= 6009;
                // 防盗链 403（IO_BAD_HTTP_STATUS=2004）且还有重试次数：通过本地代理重试
                boolean isAuthError = (errCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
                    || errCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                    || errCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT);

                if (!isDrmError && CastError.isLikelyDrm(originalUri)) {
                    msg = CastError.drmErrorMessage();
                } else if (!isDrmError && CastError.isLikelyHlsEncrypted(originalUri)) {
                    msg = CastError.hlsEncryptedHint();
                }
                if (isAuthError && proxyRetryCount < MAX_PROXY_RETRIES && !originalUri.isEmpty()) {
                    proxyRetryCount++;
                    Log.i(TAG, "CDN block (" + errCode + "), retrying via local proxy");
                    startProxyForUri(originalUri);
                    return;
                }

                if (listener != null) {
                    listener.onPlaybackError(msg);
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                cachedPlaybackState = state;
                if (listener != null) {
                    listener.onPlaybackStateChanged(state);
                }
                if (state == Player.STATE_ENDED) {
                    // 不立即停服务：保留前台服务让 UI 显示"播放结束"，由用户主动返回或停止
                    // （旧：stopForegroundCompat + stopSelf → Activity 失去播放器变黑屏）
                }
            }
        });
    }

    private void playUri(String uri, String title) {
        boolean sameMedia = uri.equals(originalUri) && player != null && player.getCurrentMediaItem() != null;
        originalUri = uri;
        currentTitle = title == null ? "" : title;
        if (sameMedia) {
            // 同一地址不重播，直接续播
            if (player != null) {
                // 如果播放器已结束，需要 seekTo(0)+prepare 才能重新播放
                if (player.getPlaybackState() == Player.STATE_ENDED) {
                    player.seekTo(0);
                    player.prepare();
                } else if (player.getPlaybackState() == Player.STATE_IDLE) {
                    player.prepare();
                }
                player.setPlayWhenReady(true);
            }
            return;
        }
        if (player == null) {
            ensurePlayer();
        }
        if (player == null) return;
        // 清理旧代理
        closeLocalProxy();
        proxyRetryCount = 0;
        try {
            MediaSource mediaSource = buildMediaSource(uri);
            player.setMediaSource(mediaSource);
            player.prepare();
            player.setPlayWhenReady(true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to prepare media");
            if (listener != null) {
                listener.onPlaybackError("播放失败，请重新打开视频。");
            }
        }
    }

    /** 创建 DRM 会话管理器提供者（Media3 1.5.1 DrmSessionManagerProvider 模式）。 */
    private DefaultDrmSessionManagerProvider createDrmProvider() {
        try {
            DefaultDrmSessionManagerProvider provider = new DefaultDrmSessionManagerProvider();
            provider.setDrmHttpDataSourceFactory(new DefaultHttpDataSource.Factory());
            return provider;
        } catch (Exception e) {
            Log.w(TAG, "DRM provider init failed (non-fatal)", e);
            return null;
        }
    }

    /** 根据 URL 后缀选择合适的数据源工厂（HLS vs 直链），并设置域名特定 headers + DRM。 */
    private MediaSource buildMediaSource(String uri) {
        String lower = uri.toLowerCase(Locale.ROOT);
        boolean isHls = lower.contains(".m3u8") || lower.contains("m3u8") || lower.contains("hls");
        DefaultHttpDataSource.Factory factory = domainDataSourceFactory(uri);
        if (isHls) {
            HlsMediaSource.Factory hlsFactory = new HlsMediaSource.Factory(factory);
            if (drmProvider != null) {
                hlsFactory.setDrmSessionManagerProvider(drmProvider);
            }
            return hlsFactory.createMediaSource(MediaItem.fromUri(Uri.parse(uri)));
        }
        // 直链（MP4 等）不支持 DRM
        return new ProgressiveMediaSource.Factory(factory)
            .createMediaSource(MediaItem.fromUri(Uri.parse(uri)));
    }

    /** 启动本地代理重新播放（CDN 防盗链 403 回退策略，Castor 启发）。 */
    private void startProxyForUri(String uri) {
        if (player == null) return;
        long resumePosition = Math.max(0, player.getCurrentPosition());
        boolean resumePlaying = player.getPlayWhenReady();
        closeLocalProxy();
        localProxy = LocalMediaProxy.startRandom(uri);
        if (localProxy == null) {
            Log.e(TAG, "Failed to start local media proxy");
            if (listener != null) {
                listener.onPlaybackError("启动本地代理失败，请检查网络后重试。");
            }
            return;
        }
        String proxyUrl = localProxy.getProxyUrl();
        Log.i(TAG, "Using local media proxy (target hidden for privacy)");

        try {
            MediaSource mediaSource = buildMediaSource(proxyUrl);
            player.setMediaSource(mediaSource, resumePosition);
            player.prepare();
            player.setPlayWhenReady(resumePlaying);
        } catch (Exception e) {
            closeLocalProxy();
            Log.e(TAG, "Proxy playback failed", e);
            if (listener != null) {
                listener.onPlaybackError("代理播放失败，请重新投屏。");
            }
        }
    }

    private void closeLocalProxy() {
        if (localProxy != null) {
            localProxy.stop();
            localProxy = null;
        }
    }

    /** 根据 URL 域名返回合适的 data source factory。 */
    private static DefaultHttpDataSource.Factory domainDataSourceFactory(String url) {
        String domain = "";
        try {
            domain = new java.net.URL(url).getHost().toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {}

        String ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
        String referer = "";

        if (domain.contains("bilibili") || domain.contains("b23")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 BiliApp/7.28.0 tvproj";
            referer = "https://www.bilibili.com/";
        } else if (domain.contains("iqiyi") || domain.contains("qiyi")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QYPlayer/14.0";
            referer = "https://www.iqiyi.com/";
        } else if (domain.contains("qq") || domain.contains("tencent")) {
            ua = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QQLive/9.0";
            referer = "https://v.qq.com/";
        }

        DefaultHttpDataSource.Factory factory = new DefaultHttpDataSource.Factory()
            .setUserAgent(ua)
            .setAllowCrossProtocolRedirects(true);
        if (!referer.isEmpty()) {
            factory.setDefaultRequestProperties(Map.of("Referer", referer));
        }
        return factory;
    }

    /** 默认工厂（域名未知时用通用浏览器 UA）。 */
    private static DefaultHttpDataSource.Factory defaultDataSourceFactory() {
        return new DefaultHttpDataSource.Factory()
            .setUserAgent("Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")
            .setAllowCrossProtocolRedirects(true);
    }

    /** Activity 绑定后提供真实 Surface（画面渲染）。 */
    public void setSurface(@Nullable Surface surface) {
        try {
            ensurePlayer();
            if (player == null) return;
            if (surface != null && surface.isValid()) {
                player.setVideoSurface(surface);
            } else {
                player.setVideoSurface(null); // 无 Surface 先音频播放，绑定后由 Activity 提供真实 Surface
            }
        } catch (Exception ignored) {
        }
    }

    public void setListener(@Nullable Listener l) {
        this.listener = l;
        // 立即回放缓存状态，解决迟绑定的 Activity 丢失播放器状态（如"加载中"卡住）
        if (l != null && cachedPlaybackState != Player.STATE_IDLE) {
            l.onPlaybackStateChanged(cachedPlaybackState);
        }
    }

    public boolean isPlaying() {
        return player != null && player.isPlaying();
    }

    public long getCurrentPosition() {
        return player == null ? 0 : player.getCurrentPosition();
    }

    public long getDuration() {
        return player == null ? 0 : player.getDuration();
    }

    public String getCurrentTitle() {
        return currentTitle;
    }

    private int startForegroundPlayback(String title) {
        Notification notification = buildNotification(title);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return NOTIFICATION_ID;
    }

    private Notification buildNotification(String title) {
        Intent tapIntent = new Intent(this, CastPlayerActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1, tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, CastPlaybackService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("灯塔 · 投屏播放中")
            .setContentText(title.isEmpty() ? "正在播放投屏内容" : title)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止投屏", stopPending);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "投屏播放",
                NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("投屏播放进行中的常驻通知");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        if (player != null) {
            player.setPlayWhenReady(false);
        }
        if (audioFocusHelper != null) {
            audioFocusHelper.abandonFocus();
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        if (activeService.get() == this) activeService.clear();
        setListener(null);
        closeLocalProxy();
        if (player != null) {
            player.release();
            player = null;
        }
        // 移除前台通知，避免服务停止后通知残留
        try {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}

package home.dengta.app;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.PixelCopy;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 投屏「一起看」放映厅模式。
 *
 * 分屏布局：顶部标题栏 · 视频区 · 控制栏 · 对话区 · 输入栏
 * 全屏：自动横屏，视频铺满，隐藏所有面板
 * 实际播放由 {@link CastPlaybackService} 前台服务持有，退出不中断。
 */
public final class CastPlayerActivity extends AppCompatActivity
        implements SurfaceHolder.Callback, CastPlaybackService.Listener {

    public static final String EXTRA_URI = "extra_uri";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_USER_NAME = "extra_user_name";
    public static final String EXTRA_AI_NAME = "extra_ai_name";
    public static final String EXTRA_WINDOW_ACTION = "extra_window_action";
    public static final String EXTRA_WINDOW_REQUEST = "extra_window_request";
    private static final String STATE_FULLSCREEN = "cast_fullscreen";

    private String windowRequestId = "";
    private String windowAction = "";
    private String windowExpectedUri = "";
    private boolean windowResumed;
    private boolean captureInFlight;
    private final Handler windowActionHandler = new Handler(Looper.getMainLooper());
    private final Runnable applyWindowAction = this::tryWindowAction;
    private final ExecutorService screenshotWriter = Executors.newSingleThreadExecutor();

    private static final String TAG = "CastPlayerActivity";
    private static final int VIDEO_WEIGHT = 55;
    private static final int CHAT_WEIGHT = 45;

    private SurfaceView surfaceView;
    private FrameLayout videoContainer;
    private View loadingOverlay;
    private View playbackEndedOverlay;
    private TextView errorText;
    private ImageView fullscreenBtn;
    private ImageView backOverlayBtn;
    private ImageView exitFullscreenBtn;
    private ImageView playPauseBtn;
    private ImageView speedBtn;
    private ImageView screenshotBtn;
    private SeekBar progressBar;
    private TextView timeText;
    private LinearLayout chatContainer;
    private ScrollView chatScroll;
    private EditText chatInput;
    private TextView titleText;
    private View controlBar;
    private View chatPanel;
    private View inputBar;
    private View titleBar;
    private TextView statusLabel;

    /** 弹幕层。 */
    private FrameLayout danmakuLayer;
    private boolean danmakuEnabled = true;

    private CastPlaybackService playbackService;
    private boolean bound = false;
    private boolean surfaceReady = false;
    private String pendingUri = "";
    private String pendingTitle = "";
    private String userName = "你";
    private String aiName = "伴侣";
    private int videoWidth = 0;
    private int videoHeight = 0;
    private boolean isFullscreen = false;
    private boolean isPlaying = true;
    private boolean hasEnded = false;
    private float playbackSpeed = 1.0f;
    private final float[] SPEED_OPTIONS = {0.5f, 1.0f, 1.5f, 2.0f};
    private int speedIndex = 1;
    private LinearLayout mainLayout;
    /** B站式控制层：点击视频区域切换显示/隐藏 */
    private FrameLayout videoOverlay;
    private ImageView settingsBtn;
    private boolean controlsVisible = true;
    private final Handler controlHandler = new Handler(Looper.getMainLooper());
    private final Runnable autoHideControls = () -> {
        if (isFullscreen) {
            setControlsVisibility(false);
        }
    };

    /** AI 主动互动：帧采集间隔（每 2 分钟采集一帧发给后端 AI 理解）。 */
    private static final long FRAME_CAPTURE_INTERVAL_MS = 30_000;
    private static final long BURST_INTERVAL_MS = 10_000;
    private static final long BURST_DURATION_MS = 60_000;
    private long burstStartedAt = 0;
    private long nextFrameCaptureAt = System.currentTimeMillis() + 30_000; // 首次：30秒后开始
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (!windowResumed || isDestroyed() || isFinishing()) return;
            updateProgress();
            progressHandler.removeCallbacks(this);
            progressHandler.postDelayed(this, 500);
        }
    };

    /** 接收 Web 层（已鉴权）返回的 AI 回复 / 主动互动 / 弹幕。 */
    private final BroadcastReceiver castReplyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String action = intent.getAction();
            String time = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
            if (DlnaReceiverPlugin.ACTION_CAST_REPLY.equals(action)) {
                String reply = intent.getStringExtra("replyText");
                String fromAi = intent.getStringExtra("aiName");
                if (reply == null || reply.isEmpty()) return;
                replacePendingBubble((fromAi != null && !fromAi.isEmpty()) ? fromAi : aiName,
                    reply, time, true);
            } else if (DlnaReceiverPlugin.ACTION_CAST_REACTION.equals(action)) {
                String reaction = intent.getStringExtra("reactionText");
                String fromAi = intent.getStringExtra("aiName");
                if (reaction == null || reaction.isEmpty()) return;
                addChatBubble((fromAi != null && !fromAi.isEmpty()) ? fromAi : aiName,
                    "🎬 " + reaction, time, true);
                // 同时以弹幕形式飘过画面
                // 只显示文字，不显示来源
                showDanmaku(reaction, Color.parseColor("#FFD9A8"));
                chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
            } else if (DlnaReceiverPlugin.ACTION_CAST_DANMAKU.equals(action)) {
                String danmaku = intent.getStringExtra("danmakuText");
                String fromName = intent.getStringExtra("senderName");
                String colorHex = intent.getStringExtra("colorHex");
                if (danmaku == null || danmaku.isEmpty()) return;
                int color = 0xFFFFFFFF;
                try {
                    if (colorHex != null && !colorHex.isEmpty()) color = Color.parseColor(colorHex);
                } catch (Exception ignored) {}
                // 只显示文字，不显示来源
                showDanmaku(danmaku, color);
            }
        }
    };

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            playbackService = ((CastPlaybackService.LocalBinder) service).getService();
            playbackService.setListener(CastPlayerActivity.this);
            refreshPlaybackUi();
            try {
                if (surfaceReady && playbackService != null) {
                    SurfaceHolder holder = surfaceView.getHolder();
                    if (holder != null && holder.getSurface() != null && holder.getSurface().isValid()) {
                        playbackService.setSurface(holder.getSurface());
                    }
                }
            } catch (Exception ignored) {}
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            playbackService = null;
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean restoreFullscreen = savedInstanceState != null && savedInstanceState.getBoolean(STATE_FULLSCREEN);
        setRequestedOrientation(restoreFullscreen ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

        // 隐藏系统默认标题栏（ActionBar）
        if (getSupportActionBar() != null) {
            getSupportActionBar().hide();
        }

        Intent intent = getIntent();
        if (intent != null) {
            pendingUri = intent.getStringExtra(EXTRA_URI);
            pendingTitle = intent.getStringExtra(EXTRA_TITLE);
            String u = intent.getStringExtra(EXTRA_USER_NAME);
            String a = intent.getStringExtra(EXTRA_AI_NAME);
            if (u != null && !u.isEmpty()) userName = u;
            if (a != null && !a.isEmpty()) aiName = a;
        }
        if (pendingUri == null) pendingUri = "";
        if (pendingTitle == null) pendingTitle = "";
        if (savedInstanceState != null) {
            pendingUri = savedInstanceState.getString(EXTRA_URI, pendingUri);
            pendingTitle = savedInstanceState.getString(EXTRA_TITLE, pendingTitle);
            userName = savedInstanceState.getString(EXTRA_USER_NAME, userName);
            aiName = savedInstanceState.getString(EXTRA_AI_NAME, aiName);
        }

        mainLayout = new LinearLayout(this);
        mainLayout.setOrientation(LinearLayout.VERTICAL);
        mainLayout.setBackgroundColor(0xFF1A1515); // 暖深色背景，非纯黑
        mainLayout.setClipToPadding(false);
        // 状态栏/灵动岛安全区
        mainLayout.setOnApplyWindowInsetsListener((v, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 20) {
                int topInset = insets.getSystemWindowInsetTop();
                int bottomInset = insets.getSystemWindowInsetBottom();
                v.setPadding(0, topInset > 0 ? topInset : dp(24), 0, bottomInset > 0 ? bottomInset : 0);
            }
            return insets;
        });

        // 1) 标题栏
        titleBar = createTitleBar();
        mainLayout.addView(titleBar);

        // 2) 视频容器
        videoContainer = new FrameLayout(this);
        videoContainer.setBackgroundColor(0xFF0A0A0A);

        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);
        surfaceView.setOnClickListener(v -> {
            if (!hasEnded) toggleVideoControls();
        });
        videoContainer.addView(surfaceView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            Gravity.CENTER));

        // 加载覆盖层
        loadingOverlay = createLoadingOverlay();
        videoContainer.addView(loadingOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 播放结束覆盖层
        playbackEndedOverlay = createPlaybackEndedOverlay();
        playbackEndedOverlay.setVisibility(View.GONE);
        videoContainer.addView(playbackEndedOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 弹幕层（透明覆盖层，用于显示弹幕飘过画面）
        danmakuLayer = new FrameLayout(this);
        danmakuLayer.setClickable(false);
        danmakuLayer.setFocusable(false);
        videoContainer.addView(danmakuLayer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // ===== B站式控制层：点击视频区域切换显示/隐藏 =====
        // ⚠️ 必须先于播放结束覆盖层与各按钮添加（后添加的 View 在上层），
        //    否则它会拦截 fullscreenBtn/exitFullscreenBtn/settingsBtn/replayBtn 的所有点击。
        videoOverlay = new FrameLayout(this);
        videoOverlay.setBackgroundColor(Color.TRANSPARENT);
        videoOverlay.setOnClickListener(v -> toggleVideoControls());
        videoContainer.addView(videoOverlay, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 控制层已添加，但我们要让现有的 controlBar/fullscreenBtn/exitFullscreenBtn 共用一个定时器
        // 显示时同时显示 controlBar + fullscreenBtn + exitFullscreenBtn；隐藏时全部隐藏
        // 控制层的显示/隐藏由 videoOverlay 的点击事件和定时器管理
        // 初始状态：非全屏时控制层可见，全屏时隐藏

        // 全屏按钮（右下角，视频覆盖层）——始终可见，点击全屏/横屏
        fullscreenBtn = new ImageView(this);
        fullscreenBtn.setImageResource(android.R.drawable.ic_menu_zoom);
        fullscreenBtn.setColorFilter(Color.WHITE);
        fullscreenBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        fullscreenBtn.setBackgroundColor(0x44000000);
        fullscreenBtn.setOnClickListener(v -> toggleFullscreen());
        FrameLayout.LayoutParams fsLp = new FrameLayout.LayoutParams(dp(44), dp(44));
        fsLp.gravity = Gravity.BOTTOM | Gravity.END;
        fsLp.setMarginEnd(dp(10));
        fsLp.bottomMargin = dp(10);
        videoContainer.addView(fullscreenBtn, fsLp);

        // B站风格：左上角返回按钮覆盖层（控制圈显示时可见）
        backOverlayBtn = new ImageView(this);
        backOverlayBtn.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        backOverlayBtn.setColorFilter(Color.WHITE);
        backOverlayBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        backOverlayBtn.setBackgroundColor(0x44000000);
        backOverlayBtn.setOnClickListener(v -> finish());
        FrameLayout.LayoutParams backLp = new FrameLayout.LayoutParams(dp(44), dp(44));
        backLp.gravity = Gravity.TOP | Gravity.START;
        backLp.setMarginStart(dp(10));
        backLp.topMargin = dp(10);
        videoContainer.addView(backOverlayBtn, backLp);

        // 退出全屏按钮（全屏时左上角，替代 backOverlayBtn）
        exitFullscreenBtn = new ImageView(this);
        exitFullscreenBtn.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        exitFullscreenBtn.setColorFilter(Color.WHITE);
        exitFullscreenBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        exitFullscreenBtn.setBackgroundColor(0x44000000);
        exitFullscreenBtn.setVisibility(View.GONE);
        exitFullscreenBtn.setOnClickListener(v -> toggleFullscreen());
        FrameLayout.LayoutParams exLp = new FrameLayout.LayoutParams(dp(44), dp(44));
        exLp.gravity = Gravity.TOP | Gravity.START;
        exLp.setMarginStart(dp(10));
        exLp.topMargin = dp(10);
        videoContainer.addView(exitFullscreenBtn, exLp);

        // 右上角三点设置按钮（全屏+控制圈时显示）
        settingsBtn = new ImageView(this);
        settingsBtn.setImageResource(android.R.drawable.ic_menu_manage);
        settingsBtn.setColorFilter(Color.WHITE);
        settingsBtn.setPadding(dp(8), dp(8), dp(8), dp(8));
        settingsBtn.setBackgroundColor(0x44000000);
        settingsBtn.setOnClickListener(v -> showSettingsPanel());
        FrameLayout.LayoutParams stLp = new FrameLayout.LayoutParams(dp(44), dp(44));
        stLp.gravity = Gravity.TOP | Gravity.END;
        stLp.setMarginEnd(dp(10));
        stLp.topMargin = dp(10);
        videoContainer.addView(settingsBtn, stLp);

        // 错误文字（最上层，仅错误时可见，不拦截点击）
        errorText = new TextView(this);
        errorText.setTextColor(Color.parseColor("#FFD9A8"));
        errorText.setTextSize(14);
        errorText.setGravity(Gravity.CENTER);
        errorText.setVisibility(View.GONE);
        videoContainer.addView(errorText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        mainLayout.addView(videoContainer, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, VIDEO_WEIGHT));

        // 控制栏覆盖在视频底部（B站风格：半透明，不占独立行）
        controlBar = createControlBar();
        controlBar.setBackgroundColor(0x88000000);
        videoContainer.addView(controlBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM));

        // 4) 对话区域（默认收起，用户通过控制栏按钮展开）
        chatPanel = createChatPanel();
        chatPanel.setVisibility(View.GONE);
        mainLayout.addView(chatPanel, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, CHAT_WEIGHT));

        // 5) 输入栏（默认收起）
        inputBar = createInputBar();
        inputBar.setVisibility(View.GONE);
        mainLayout.addView(inputBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(mainLayout);

        // 初始状态：B站风格，控制圈默认隐藏，点视频显示
        controlsVisible = false;
        backOverlayBtn.setVisibility(View.GONE);
        settingsBtn.setVisibility(View.GONE);
        controlBar.setVisibility(View.GONE);
        fullscreenBtn.setVisibility(View.GONE);
        exitFullscreenBtn.setVisibility(View.GONE);

        showLoading();
        if (pendingTitle != null && !pendingTitle.isEmpty()) {
            titleText.setText(pendingTitle);
        }
        if (restoreFullscreen) toggleFullscreen();
        bindPlaybackService();
        // A recreated window must never replay an old command or save another image.
        if (savedInstanceState == null && intent != null && intent.hasExtra(EXTRA_WINDOW_ACTION)) queueWindowAction(intent);
    }

    private void queueWindowAction(Intent intent) {
        String id = intent.getStringExtra(EXTRA_WINDOW_REQUEST);
        String action = intent.getStringExtra(EXTRA_WINDOW_ACTION);
        String uri = intent.getStringExtra(EXTRA_URI);
        intent.removeExtra(EXTRA_WINDOW_ACTION);
        intent.removeExtra(EXTRA_WINDOW_REQUEST);
        if (!DlnaReceiverPlugin.hasWindowRequest(id)) return;
        windowRequestId = id;
        windowAction = action == null ? "" : action;
        windowExpectedUri = uri == null ? "" : uri;
        tryWindowAction();
    }

    private void finishWindowAction(String error, String fileName) {
        finishWindowAction(windowRequestId, error, fileName);
    }

    private void finishWindowAction(String expectedId, String error, String fileName) {
        if (!expectedId.equals(windowRequestId)) return;
        windowActionHandler.removeCallbacks(applyWindowAction);
        String id = windowRequestId;
        windowRequestId = "";
        windowAction = "";
        DlnaReceiverPlugin.finishWindowRequest(id, error, fileName);
    }

    private void tryWindowAction() {
        windowActionHandler.removeCallbacks(applyWindowAction);
        if (windowAction.isEmpty() || !windowResumed) return;
        if (!DlnaReceiverPlugin.hasWindowRequest(windowRequestId)) { finishWindowAction("player_window_timeout", ""); return; }
        if (playbackService == null || playbackService.player == null) {
            windowActionHandler.postDelayed(applyWindowAction, 100);
            return;
        }
        if (!windowExpectedUri.equals(playbackService.getOriginalUri())) { finishWindowAction("player_media_changed", ""); return; }
        if ("fullscreen".equals(windowAction)) {
            if (hasEnded) { finishWindowAction("playback_ended", ""); return; }
            if (!isFullscreen) toggleFullscreen();
            finishWindowAction(isFullscreen ? "" : "player_window_failed", "");
        } else if ("capture".equals(windowAction)) {
            if (!surfaceReady || surfaceView.getWidth() <= 0 || surfaceView.getHeight() <= 0
                    || playbackService.player.getPlaybackState() != Player.STATE_READY) {
                windowActionHandler.postDelayed(applyWindowAction, 100);
                return;
            }
            windowAction = "";
            final String requestId = windowRequestId;
            captureFrame((error, fileName) -> finishWindowAction(requestId, error, fileName));
        } else finishWindowAction("invalid_playback_command", "");
    }

    // ================================================================ 标题栏

    private View createTitleBar() {
        FrameLayout bar = new FrameLayout(this);
        bar.setBackgroundColor(0xFF1A1515);
        bar.setPadding(dp(12), dp(12), dp(12), dp(12));

        TextView backBtn = new TextView(this);
        backBtn.setText("\u2190 \u8FD4\u56DE");
        backBtn.setTextColor(Color.WHITE);
        backBtn.setTextSize(15);
        backBtn.setGravity(Gravity.CENTER);
        backBtn.setOnClickListener(v -> finish());
        bar.addView(backBtn, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        titleText = new TextView(this);
        titleText.setText("\u6295\u5C4F\u64AD\u653E");
        titleText.setTextColor(Color.WHITE);
        titleText.setTextSize(15);
        titleText.setMaxLines(1);
        titleText.setEllipsize(TextUtils.TruncateAt.END);
        titleText.setPadding(dp(8), 0, dp(8), 0);
        FrameLayout.LayoutParams tlp = new FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT);
        tlp.gravity = Gravity.CENTER_VERTICAL;
        tlp.setMarginStart(dp(70));
        tlp.setMarginEnd(dp(80));
        bar.addView(titleText, tlp);

        // 状态标签
        statusLabel = new TextView(this);
        statusLabel.setText("\u6B63\u5728\u64AD\u653E");
        statusLabel.setTextColor(Color.parseColor("#FFD9A8"));
        statusLabel.setTextSize(12);
        statusLabel.setPadding(dp(8), dp(3), dp(8), dp(3));
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setCornerRadius(dp(10));
        badgeBg.setColor(0x33FFD9A8);
        statusLabel.setBackground(badgeBg);
        FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.gravity = Gravity.CENTER_VERTICAL;
        slp.setMarginEnd(dp(52));
        bar.addView(statusLabel, slp);

        return bar;
    }

    // ================================================================ 控制栏

    private View createControlBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(16), dp(8));
        bar.setBackgroundColor(0xFF1A1515);

        // 第一行：播放/暂停 + 进度条 + 时间
        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);
        row1.setGravity(Gravity.CENTER_VERTICAL);

        playPauseBtn = new ImageView(this);
        playPauseBtn.setImageResource(android.R.drawable.ic_media_play);
        playPauseBtn.setColorFilter(Color.WHITE);
        playPauseBtn.setPadding(dp(4), dp(4), dp(4), dp(4));
        playPauseBtn.setOnClickListener(v -> togglePlayPause());
        row1.addView(playPauseBtn, dp(36), dp(36));

        progressBar = new SeekBar(this);
        progressBar.setMax(1000);
        progressBar.setProgress(0);
        progressBar.setPadding(dp(8), 0, dp(8), 0);
        progressBar.getThumb().mutate().setAlpha(0);
        progressBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {}
            @Override public void onStartTrackingTouch(SeekBar seekBar) {}
            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
                if (playbackService != null && playbackService.player != null) {
                    long dur = playbackService.player.getDuration();
                    if (dur > 0) {
                        playbackService.player.seekTo(dur * seekBar.getProgress() / 1000);
                    }
                }
            }
        });
        row1.addView(progressBar, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        timeText = new TextView(this);
        timeText.setText("00:00 / 00:00");
        timeText.setTextColor(0x99FFFFFF);
        timeText.setTextSize(12);
        row1.addView(timeText);
        bar.addView(row1);

        // 第二行：截帧 · 倍速 · 全屏
        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        row2.setPadding(0, dp(6), 0, 0);

        // 截帧按钮
        screenshotBtn = new ImageView(this);
        screenshotBtn.setImageResource(android.R.drawable.ic_menu_camera);
        screenshotBtn.setColorFilter(0xCCFFFFFF);
        screenshotBtn.setPadding(dp(6), dp(4), dp(6), dp(4));
        screenshotBtn.setOnClickListener(v -> captureFrame());
        row2.addView(screenshotBtn, dp(36), dp(32));

        // 分隔
        TextView sep1 = new TextView(this);
        sep1.setText(" \u00B7 ");
        sep1.setTextColor(0x44FFFFFF);
        sep1.setTextSize(16);
        row2.addView(sep1);

        // 倍速按钮
        speedBtn = new ImageView(this);
        speedBtn.setImageResource(android.R.drawable.ic_media_ff);
        speedBtn.setColorFilter(0xCCFFFFFF);
        speedBtn.setPadding(dp(6), dp(4), dp(6), dp(4));
        speedBtn.setOnClickListener(v -> cycleSpeed());
        row2.addView(speedBtn, dp(36), dp(32));

        // 倍速文字
        TextView speedLabel = new TextView(this);
        speedLabel.setText("1.0x");
        speedLabel.setTextColor(0xCCFFFFFF);
        speedLabel.setTextSize(12);
        speedLabel.setTag("speedLabel");
        speedLabel.setOnClickListener(v -> cycleSpeed());
        row2.addView(speedLabel);

        // 占位
        TextView spacer = new TextView(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 0, 1));
        row2.addView(spacer);

        // 对话展开/收起按钮
        TextView chatToggleBtn = new TextView(this);
        chatToggleBtn.setText("\uD83D\uDCAC");
        chatToggleBtn.setTextColor(0xCCFFFFFF);
        chatToggleBtn.setTextSize(15);
        chatToggleBtn.setPadding(dp(4), 0, dp(8), 0);
        chatToggleBtn.setOnClickListener(v -> toggleChatPanel());
        row2.addView(chatToggleBtn);

        // 全屏按钮
        TextView fullscreenText = new TextView(this);
        fullscreenText.setText("\u26F6 \u5168\u5C4F");
        fullscreenText.setTextColor(0xCCFFFFFF);
        fullscreenText.setTextSize(13);
        fullscreenText.setOnClickListener(v -> toggleFullscreen());
        row2.addView(fullscreenText);

        bar.addView(row2);
        return bar;
    }

    // ================================================================ 对话区域

    private View createChatPanel() {
        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(0xFF1A1515);

        // 对话标题行
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setPadding(dp(16), dp(12), dp(16), dp(8));
        header.setBackgroundColor(0xFF1A1515);

        TextView chatTitle = new TextView(this);
        chatTitle.setText("\u5173\u4E8E\u5F53\u524D\u64AD\u653E");
        chatTitle.setTextColor(Color.WHITE);
        chatTitle.setTextSize(14);
        chatTitle.setTypeface(null, Typeface.BOLD);
        header.addView(chatTitle);

        TextView spacer2 = new TextView(this);
        spacer2.setLayoutParams(new LinearLayout.LayoutParams(0, 0, 1));
        header.addView(spacer2);

        // 显示用户/AI名称
        TextView nameInfo = new TextView(this);
        nameInfo.setText(userName + " \u00B7 " + aiName);
        nameInfo.setTextColor(0x66FFFFFF);
        nameInfo.setTextSize(11);
        header.addView(nameInfo);

        panel.addView(header, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // 聊天消息区域（可滚动，初始为空 — 不再显示假历史）
        chatScroll = new ScrollView(this);
        chatScroll.setPadding(dp(16), dp(40), dp(16), 0);

        chatContainer = new LinearLayout(this);
        chatContainer.setOrientation(LinearLayout.VERTICAL);

        chatScroll.addView(chatContainer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        panel.addView(chatScroll, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        return panel;
    }

    /** 弹幕飘过画面（B站风格：从右到左）。 */
    private void showDanmaku(String text, int color) {
        if (!danmakuEnabled || danmakuLayer == null || text == null || text.isEmpty()) return;
        try {
            // 弹幕文本可能很长，按码点截断到 40 字符（避免截断 Unicode 代理对/emoji）
            String display = text.codePointCount(0, text.length()) > 40
                ? text.substring(0, text.offsetByCodePoints(0, 40))
                : text;
            TextView danmaku = new TextView(this);
            danmaku.setText(display);
            danmaku.setTextColor(color);
            danmaku.setTextSize(isFullscreen ? 18 : 14);
            danmaku.setTypeface(null, Typeface.BOLD);
            danmaku.setShadowLayer(dp(3), 1, 1, Color.BLACK);
            danmaku.setIncludeFontPadding(false);
            danmaku.setMaxWidth((int) (danmakuLayer.getWidth() * 0.8f));
            danmaku.setSingleLine(false);
            danmaku.setMaxLines(2);

            // 随机一条跑道（避免重叠）
            int trackCount = isFullscreen ? 8 : 4;
            int track = (int) (Math.random() * trackCount);
            int y = dp(8) + track * dp(isFullscreen ? 34 : 30);

            danmaku.measure(
                View.MeasureSpec.makeMeasureSpec(danmakuLayer.getWidth(), View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            );
            int textWidth = danmaku.getMeasuredWidth();
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = y;
            lp.leftMargin = danmakuLayer.getWidth();
            danmakuLayer.addView(danmaku, lp);

            // 从右到左动画，结束后移除
            final TextView finalDanmaku = danmaku;
            danmaku.post(() -> {
                int startX = danmakuLayer.getWidth();
                int endX = -textWidth - dp(20);
                int duration = isFullscreen ? 8000 : 6000; // 全屏时更长，便于阅读
                try {
                    finalDanmaku.animate()
                        .translationX(endX - startX)
                        .setDuration(duration)
                        .setInterpolator(new android.view.animation.LinearInterpolator())
                        .withEndAction(() -> {
                            danmakuLayer.removeView(finalDanmaku);
                            finalDanmaku.clearAnimation();
                        })
                        .start();
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    /** 添加气泡到聊天区，返回气泡 view 用于后续标记。 */
    private LinearLayout addChatBubble(String sender, String message, String time, boolean isAi) {
        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
        bubble.setAlpha(0f);
        bubble.animate().alpha(1f).setDuration(200).start();

        // 气泡背景
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(12));
        bg.setColor(isAi ? 0x221A1A1A : 0x332A2A2A);
        bubble.setBackground(bg);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        TextView nameView = new TextView(this);
        nameView.setText(sender);
        nameView.setTextColor(isAi ? Color.parseColor("#FFD9A8") : Color.WHITE);
        nameView.setTextSize(13);
        nameView.setTypeface(null, Typeface.BOLD);
        header.addView(nameView);

        TextView timeView = new TextView(this);
        timeView.setText(time);
        timeView.setTextColor(0x66FFFFFF);
        timeView.setTextSize(11);
        timeView.setPadding(dp(8), 0, 0, 0);
        header.addView(timeView);
        bubble.addView(header);

        TextView msgView = new TextView(this);
        msgView.setText(message);
        msgView.setTextColor(Color.WHITE);
        msgView.setTextSize(14);
        msgView.setLineSpacing(0, 1.2f);
        msgView.setPadding(0, dp(4), 0, 0);
        msgView.setTag("msg_text");
        bubble.addView(msgView);

        chatContainer.addView(bubble);
        return bubble;
    }

    // ================================================================ 输入栏

    private View createInputBar() {
        FrameLayout bar = new FrameLayout(this);
        bar.setBackgroundColor(0xFF1A1515);
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));

        chatInput = new EditText(this);
        chatInput.setHint("\u5BF9\u5F53\u524D\u64AD\u653E\u5185\u5BB9\u8BF4\u70B9\u4EC0\u4E48\u2026");
        chatInput.setHintTextColor(0x66FFFFFF);
        chatInput.setTextColor(Color.WHITE);
        chatInput.setTextSize(14);
        chatInput.setBackgroundColor(0x00000000);
        chatInput.setPadding(dp(12), dp(10), dp(72), dp(10));
        bar.addView(chatInput, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView sendBtn = new TextView(this);
        sendBtn.setText("\u53D1\u9001");
        sendBtn.setTextColor(Color.parseColor("#FFD9A8"));
        sendBtn.setTextSize(14);
        sendBtn.setGravity(Gravity.CENTER);
        sendBtn.setPadding(dp(16), dp(10), dp(16), dp(10));
        sendBtn.setOnClickListener(v -> {
            String text = chatInput.getText().toString().trim();
            if (!text.isEmpty()) {
                addChatBubble(userName, text, "\u521A\u521A", false);
                chatInput.setText("");
                chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
                // 通过后端 AI 回复（不再使用假模拟）
                requestAiReply(text);
            }
        });
        FrameLayout.LayoutParams sendLp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        sendLp.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
        bar.addView(sendBtn, sendLp);

        return bar;
    }

    /** 通过 DlnaReceiverPlugin 桥接把聊天消息转发到 Web 层（已鉴权），不再使用本地假模拟。 */
    private int pendingBubbleId = 0;

    private void requestAiReply(String userText) {
        // 显示"正在回复..."等待气泡，分配唯一 ID 防止多消息超时交叉覆盖
        final int bubbleId = ++pendingBubbleId;
        LinearLayout pendingBubble = addChatBubble(aiName, "\u6B63\u5728\u56DE\u590D\u2026", "", true);
        pendingBubble.setTag(Integer.valueOf(bubbleId));
        chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));

        // 30 秒超时守护：Web 层未响应（监听器未挂载/后端超时）时替换为诚实提示，不再使用固定回复
        final Runnable timeoutGuard = () -> {
            String time = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
            replacePendingBubbleIfId(bubbleId, aiName, "回复超时，请稍后重试。", time, true);
        };
        chatHandler.postDelayed(timeoutGuard, 30000);

        // 通过 DlnaReceiverPlugin 静态桥接转发到 Web 层（Web 层持鉴权调用真实 AI 回复 API）
        double positionMs = playbackService != null ? playbackService.getCurrentPosition() : 0;
        DlnaReceiverPlugin.notifyCastChatFromNative(userText, positionMs, userName, aiName);
        if (DlnaReceiverPlugin.getInstance() == null) {
            // 插件未就绪：1.2 秒后替换气泡（不造假回复）
            chatHandler.postDelayed(() -> {
                String time = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
                replacePendingBubbleIfId(bubbleId, aiName, "聊天连接未就绪，请稍后重试。", time, true);
            }, 1200);
        }
    }

    /** 仅当对应消息仍处于待回复状态时替换气泡（防止多消息交叉覆盖）。 */
    private void replacePendingBubbleIfId(int expectedId, String sender, String message, String time, boolean isAi) {
        // 从后往前找匹配 tag 的气泡
        for (int i = chatContainer.getChildCount() - 1; i >= 0; i--) {
            View child = chatContainer.getChildAt(i);
            if (child instanceof LinearLayout) {
                Object tag = child.getTag();
                if (tag instanceof Integer && ((Integer) tag).intValue() == expectedId) {
                    // 找到匹配的气泡，检查是否仍处于待回复状态
                    if (isPendingMessage((LinearLayout) child)) {
                        chatContainer.removeView(child);
                        addChatBubble(sender, message, time, isAi);
                        chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
                    }
                    // 如已替换为真实回复则跳过
                    return;
                }
            }
        }
        // 未找到匹配 tag 的气泡 → 已被真实回复替换，不做任何事
    }

    /** 检查气泡是否仍显示"正在回复…"（待回复状态）。 */
    private boolean isPendingMessage(LinearLayout bubble) {
        for (int i = 0; i < bubble.getChildCount(); i++) {
            View child = bubble.getChildAt(i);
            if (child instanceof TextView && "msg_text".equals(child.getTag())) {
                String text = ((TextView) child).getText().toString();
                return text.contains("\u6B63\u5728\u56DE\u590D"); // "正在回复"
            }
        }
        return false;
    }

    /** 替换 AI 聊天气泡（从 Web 层收到真实回复时调用）：
     * 按 FIFO 顺序找到第一个"正在回复…"气泡替换，确保多消息时顺序正确。 */
    private void replacePendingBubble(String sender, String message, String time, boolean isAi) {
        // 从前往后（FIFO）找第一个待回复气泡
        for (int i = 0; i < chatContainer.getChildCount(); i++) {
            View child = chatContainer.getChildAt(i);
            if (child instanceof LinearLayout) {
                LinearLayout bubble = (LinearLayout) child;
                if (isPendingMessage(bubble)) {
                    chatContainer.removeView(child);
                    addChatBubble(sender, message, time, isAi);
                    chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
                    return;
                }
            }
        }
        // 没有待回复气泡 → 直接追加
        addChatBubble(sender, message, time, isAi);
        chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
    }

    private final Handler chatHandler = new Handler(Looper.getMainLooper());

    // ================================================================ 加载覆盖层

    private View createLoadingOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xCC000000);
        overlay.setClickable(false);
        overlay.setFocusable(false);

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);
        center.setPadding(0, dp(40), 0, 0);

        // 加载动画（旋转图标）
        TextView spinner = new TextView(this);
        spinner.setText("\u25E0 \u52A0\u8F7D\u4E2D\u2026");
        spinner.setTextColor(0xCCFFFFFF);
        spinner.setTextSize(16);
        spinner.setGravity(Gravity.CENTER);
        center.addView(spinner);

        TextView hint = new TextView(this);
        hint.setText("\u89C6\u9891\u5373\u5C06\u5F00\u59CB\u64AD\u653E");
        hint.setTextColor(0x66FFFFFF);
        hint.setTextSize(12);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, dp(8), 0, 0);
        center.addView(hint);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        overlay.addView(center, lp);
        return overlay;
    }

    /** 播放结束覆盖层。 */
    private View createPlaybackEndedOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xCC000000);
        overlay.setClickable(true);
        overlay.setFocusable(true);

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);

        TextView icon = new TextView(this);
        icon.setText("\u25A0");
        icon.setTextColor(0x88FFFFFF);
        icon.setTextSize(48);
        icon.setGravity(Gravity.CENTER);
        center.addView(icon);

        TextView tv = new TextView(this);
        tv.setText("\u64AD\u653E\u5DF2\u5B8C\u6210");
        tv.setTextColor(0x99FFFFFF);
        tv.setTextSize(18);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(0, dp(16), 0, dp(24));
        center.addView(tv);

        // 重新播放按钮
        TextView replayBtn = new TextView(this);
        replayBtn.setText("\u25B6 \u91CD\u65B0\u64AD\u653E");
        replayBtn.setTextColor(Color.parseColor("#FFD9A8"));
        replayBtn.setTextSize(15);
        replayBtn.setGravity(Gravity.CENTER);
        replayBtn.setPadding(dp(24), dp(12), dp(24), dp(12));
        GradientDrawable btnBg = new GradientDrawable();
        btnBg.setCornerRadius(dp(20));
        btnBg.setColor(0x33FFD9A8);
        replayBtn.setBackground(btnBg);
        replayBtn.setOnClickListener(v -> replayVideo());
        center.addView(replayBtn);

        // 返回按钮
        TextView exitBtn = new TextView(this);
        exitBtn.setText("\u25C0 \u8FD4\u56DE\u6295\u5C4F\u754C\u9762");
        exitBtn.setTextColor(0x88FFFFFF);
        exitBtn.setTextSize(14);
        exitBtn.setGravity(Gravity.CENTER);
        exitBtn.setPadding(dp(24), dp(12), dp(24), dp(12));
        exitBtn.setOnClickListener(v -> finish());
        center.addView(exitBtn);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        overlay.addView(center, lp);
        return overlay;
    }

    /** 重新播放当前视频。 */
    private void replayVideo() {
        hasEnded = false;
        playbackEndedOverlay.setVisibility(View.GONE);
        showLoading();
        // 直接操作播放器 seek 到 0 重新准备，绕开 playUri 的"同一地址不重播"逻辑
        if (playbackService != null && playbackService.player != null) {
            ExoPlayer player = playbackService.player;
            try {
                player.seekTo(0);
                player.prepare();
                player.setPlayWhenReady(true);
                return;
            } catch (Exception ignored) {
                // 回退到重新走整条播放链路
            }
        }
        if (!pendingUri.isEmpty()) {
            CastPlaybackService.play(this, pendingUri, pendingTitle);
        }
    }

    // ================================================================ 播放控制

    private void togglePlayPause() {
        if (playbackService == null || playbackService.player == null) return;
        ExoPlayer player = playbackService.player;
        if (player.getPlayWhenReady()) {
            player.pause();
            playPauseBtn.setImageResource(android.R.drawable.ic_media_play);
        } else {
            player.play();
            playPauseBtn.setImageResource(android.R.drawable.ic_media_pause);
        }
        isPlaying = player.getPlayWhenReady();
    }

    /** 循环切换播放速度。 */
    private void cycleSpeed() {
        if (playbackService != null && playbackService.player != null) {
            float actualSpeed = playbackService.player.getPlaybackParameters().speed;
            for (int i = 0; i < SPEED_OPTIONS.length; i++) {
                if (Math.abs(SPEED_OPTIONS[i] - actualSpeed) < 0.01f) { speedIndex = i; break; }
            }
        }
        speedIndex = (speedIndex + 1) % SPEED_OPTIONS.length;
        playbackSpeed = SPEED_OPTIONS[speedIndex];
        if (playbackService != null && playbackService.player != null) {
            playbackService.player.setPlaybackSpeed(playbackSpeed);
        }
        // 更新倍速按钮显示
        String speedText = String.format(Locale.US, "%.1fx", playbackSpeed);
        // 找到速度标签
        if (controlBar != null) {
            ViewGroup controlGroup = (ViewGroup) controlBar;
            ViewGroup row2 = (ViewGroup) controlGroup.getChildAt(1);
            if (row2 != null) {
                for (int i = 0; i < row2.getChildCount(); i++) {
                    View child = row2.getChildAt(i);
                    if (child instanceof TextView && "speedLabel".equals(child.getTag())) {
                        ((TextView) child).setText(speedText);
                        break;
                    }
                }
            }
        }
        Toast.makeText(this, "\u500D\u901F: " + speedText, Toast.LENGTH_SHORT).show();
    }

    private interface ScreenshotCallback { void finish(String errorCode, String fileName); }

    /** Save only the visible surface; never refetch the media URL on the UI thread. */
    private void captureFrame() {
        captureFrame((error, fileName) -> {
            if (!isDestroyed() && !isFinishing()) Toast.makeText(this,
                error.isEmpty() ? "截帧已保存到应用图片目录: " + fileName : "截帧未完成，请在画面就绪后重试。",
                Toast.LENGTH_SHORT).show();
        });
    }

    private void captureFrame(ScreenshotCallback callback) {
        if (captureInFlight) { callback.finish("capture_busy", ""); return; }
        if (!windowResumed || surfaceView == null || !surfaceReady || playbackService == null
                || !surfaceView.getHolder().getSurface().isValid()) {
            callback.finish("capture_not_ready", ""); return;
        }
        final String sourceUri = playbackService.getOriginalUri();
        final String requestId = windowRequestId;
        final Bitmap bitmap;
        try {
            int[] size = CastFrameSize.fit(surfaceView.getWidth(), surfaceView.getHeight());
            bitmap = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
        } catch (IllegalArgumentException | OutOfMemoryError error) {
            callback.finish("capture_not_ready", ""); return;
        }
        captureInFlight = true;
        try {
            PixelCopy.request(surfaceView, bitmap, result -> {
                if (result != PixelCopy.SUCCESS || !captureStillCurrent(sourceUri, requestId)) {
                    bitmap.recycle(); captureInFlight = false;
                    callback.finish("capture_unavailable", ""); return;
                }
                try {
                    screenshotWriter.execute(() -> {
                        File file = null;
                        String errorCode = "";
                        try {
                            File directory = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                            if (directory == null) directory = new File(getFilesDir(), "screenshots");
                            if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("directory_unavailable");
                            file = File.createTempFile("DengTa_Cast_", ".png", directory);
                            try (FileOutputStream output = new FileOutputStream(file)) {
                                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw new java.io.IOException("encode_failed");
                            }
                        } catch (Exception error) { errorCode = "capture_save_failed"; }
                        finally { bitmap.recycle(); }
                        final File saved = file;
                        final String failure = errorCode;
                        windowActionHandler.post(() -> {
                            captureInFlight = false;
                            if (!failure.isEmpty() || !captureStillCurrent(sourceUri, requestId)) {
                                if (saved != null && !saved.delete()) Log.w(TAG, "capture_cleanup_failed");
                                callback.finish(failure.isEmpty() ? "capture_cancelled" : failure, "");
                            } else callback.finish("", saved.getName());
                        });
                    });
                } catch (java.util.concurrent.RejectedExecutionException error) {
                    bitmap.recycle(); captureInFlight = false;
                    callback.finish("capture_cancelled", "");
                }
            }, windowActionHandler);
        } catch (IllegalArgumentException error) {
            bitmap.recycle(); captureInFlight = false;
            callback.finish("capture_unavailable", "");
        }
    }

    private boolean captureStillCurrent(String sourceUri, String requestId) {
        return !isDestroyed() && !isFinishing() && windowResumed && playbackService != null
            && sourceUri.equals(playbackService.getOriginalUri())
            && (requestId.isEmpty() || DlnaReceiverPlugin.hasWindowRequest(requestId));
    }

    /** 采集当前视频帧 → 压缩为 JPEG(base64) → 交给 Web 层（鉴权）调后端 AI 理解并主动评论。 */
    private void captureAndSendFrameForAi(ExoPlayer player, long posMs, long durMs) {
        if (surfaceView == null || surfaceView.getWidth() <= 0 || surfaceView.getHeight() <= 0) return;
        Bitmap bitmap = Bitmap.createBitmap(
            surfaceView.getWidth(), surfaceView.getHeight(), Bitmap.Config.ARGB_8888
        );
        try {
            // PixelCopy 截取 SurfaceView 当前帧
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                final Bitmap target = bitmap;
                PixelCopy.request(surfaceView, bitmap, copyResult -> {
                    if (copyResult == PixelCopy.SUCCESS) {
                        sendAiFrame(target, posMs, durMs); // sendAiFrame 负责 recycle
                    } else {
                        if (!target.isRecycled()) target.recycle();
                        sendAiFrameFallback(posMs, durMs);
                    }
                }, new Handler(Looper.getMainLooper()));
            } else {
                if (!bitmap.isRecycled()) bitmap.recycle();
                sendAiFrameFallback(posMs, durMs);
            }
        } catch (Exception e) {
            if (!bitmap.isRecycled()) bitmap.recycle();
            Log.w(TAG, "ai frame capture failed: " + e.getMessage());
        }
    }

    /** PixelCopy 成功路径：压缩并上传帧。帧 bitmap 使用后必须回收，防止内存泄漏。 */
    private void sendAiFrame(Bitmap bitmap, long posMs, long durMs) {
        Bitmap scaled = null;
        try {
            // 降采样到宽 640，控制体积；JPEG 60% 质量
            int srcW = bitmap.getWidth();
            int srcH = bitmap.getHeight();
            int targetW = Math.min(640, srcW);
            int targetH = Math.max(1, (int) ((long) srcH * targetW / Math.max(1, srcW)));
            scaled = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true);
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, 60, out);
            byte[] jpeg = out.toByteArray();
            String base64 = android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP);
            DlnaReceiverPlugin.notifyCastFrameFromNative(base64, posMs, durMs, pendingTitle);
        } catch (Exception e) {
            Log.w(TAG, "ai frame encode failed: " + e.getMessage());
        } finally {
            if (scaled != null && !scaled.isRecycled()) scaled.recycle();
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }

    /** PixelCopy 不可用时的降级：用 MediaMetadataRetriever 从源 URI 截帧。 */
    private void sendAiFrameFallback(long posMs, long durMs) {
        MediaMetadataRetriever retriever = null;
        try {
            if (playbackService == null || playbackService.player == null) return;
            String uri = playbackService.getOriginalUri();
            if (uri == null || uri.isEmpty()) return;
            retriever = new MediaMetadataRetriever();
            retriever.setDataSource(uri, new java.util.HashMap<>());
            Bitmap frame = retriever.getFrameAtTime(posMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST);
            if (frame != null) {
                sendAiFrame(frame, posMs, durMs); // sendAiFrame 负责 recycle
            }
        } catch (Exception e) {
            Log.w(TAG, "ai frame fallback failed: " + e.getMessage());
        } finally {
            if (retriever != null) {
                try { retriever.release(); } catch (Exception ignored) {}
            }
        }
    }

    private void updateProgress() {
        if (playbackService == null || playbackService.player == null) return;
        ExoPlayer player = playbackService.player;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        if (dur > 0) {
            progressBar.setProgress((int) (pos * 1000 / dur));
            timeText.setText(formatTime(pos) + " / " + formatTime(dur));
        }

        // 安全性：如果播放器已就绪但加载覆盖层还在，强制隐藏
        if (loadingOverlay != null && loadingOverlay.getVisibility() == View.VISIBLE) {
            int state = player.getPlaybackState();
            if (state == Player.STATE_READY && player.getPlayWhenReady()) {
                showPlaying();
            }
        }

        // AI 主动互动：周期帧采集（仅播放中且未结束）
        if (player.getPlayWhenReady() && !hasEnded && dur > 0) {
            long now = System.currentTimeMillis();
            if (now >= nextFrameCaptureAt) {
                // 前 60 秒为爆发期（每 6 秒截帧），让 AI 快速建立视频初步理解
                if (burstStartedAt == 0 && pos < 60_000) {
                    burstStartedAt = now;
                    nextFrameCaptureAt = now + BURST_INTERVAL_MS;
                } else if (burstStartedAt > 0 && now - burstStartedAt < BURST_DURATION_MS) {
                    nextFrameCaptureAt = now + BURST_INTERVAL_MS;
                } else {
                    burstStartedAt = 0;
                    nextFrameCaptureAt = now + FRAME_CAPTURE_INTERVAL_MS;
                }
                captureAndSendFrameForAi(player, pos, dur);
            }
        }
    }

    private static String formatTime(long ms) {
        long totalSec = ms / 1000;
        return String.format("%02d:%02d", totalSec / 60, totalSec % 60);
    }

    // ================================================================ 全屏切换

    private void toggleFullscreen() {
        if (hasEnded) return;
        isFullscreen = !isFullscreen;
        if (isFullscreen) {
            // 全屏：隐藏所有非视频面板，视频铺满，强制横屏
            titleBar.setVisibility(View.GONE);
            chatPanel.setVisibility(View.GONE);
            inputBar.setVisibility(View.GONE);
            fullscreenBtn.setVisibility(View.GONE);

            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) videoContainer.getLayoutParams();
            lp.weight = 0;
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
            videoContainer.setLayoutParams(lp);

            // 强制横屏（用户无需手动旋转）
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);

            // 沉浸模式
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

            // 允许布局延伸到屏幕边缘
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

            // 全屏初始显示控制层（退出按钮 + 设置 + 控制栏），4 秒后自动隐藏
            setControlsVisibility(true);
        } else {
            // 分屏：恢复视频和面板
            titleBar.setVisibility(View.VISIBLE);
            controlBar.setVisibility(View.VISIBLE);
            // 聊天面板默认收起，用户通过按钮展开
            chatPanel.setVisibility(View.GONE);
            inputBar.setVisibility(View.GONE);
            fullscreenBtn.setVisibility(View.VISIBLE);
            backOverlayBtn.setVisibility(View.GONE);
            exitFullscreenBtn.setVisibility(View.GONE);
            settingsBtn.setVisibility(View.GONE);
            controlsVisible = false; // 重新进入时控制圈隐藏，等待点击视频召唤

            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) videoContainer.getLayoutParams();
            lp.weight = VIDEO_WEIGHT;
            lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            lp.height = 0;
            videoContainer.setLayoutParams(lp);

            // 退出全屏 → 恢复竖屏
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);

            // 恢复正常状态栏
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);

            // 退出全屏取消自动隐藏，控制栏始终可见
            controlHandler.removeCallbacks(autoHideControls);
            controlsVisible = true;
        }
        updateSurfaceLayout();
    }

    /** 展开/收起对话面板（分屏模式下）。 */
    private void toggleChatPanel() {
        if (isFullscreen) return;
        boolean showing = chatPanel.getVisibility() == View.VISIBLE;
        chatPanel.setVisibility(showing ? View.GONE : View.VISIBLE);
        inputBar.setVisibility(showing ? View.GONE : View.VISIBLE);
        if (!showing) {
            chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
        }
    }

    // ================================================================ B站式控制层

    private void toggleVideoControls() {
        setControlsVisibility(!controlsVisible);
    }

    private void setControlsVisibility(boolean show) {
        controlsVisible = show;
        int vis = show ? View.VISIBLE : View.GONE;
        if (isFullscreen) {
            // 全屏：显示退出全屏/设置/控制栏，不显示进全屏按钮
            fullscreenBtn.setVisibility(View.GONE);
            backOverlayBtn.setVisibility(View.GONE);
            exitFullscreenBtn.setVisibility(vis);
            settingsBtn.setVisibility(vis);
            controlBar.setVisibility(vis);
        } else {
            // 非全屏：B站风格控制圈——点击视频时显示控制层
            backOverlayBtn.setVisibility(vis);
            settingsBtn.setVisibility(vis);
            controlBar.setVisibility(vis);
            fullscreenBtn.setVisibility(vis);
            exitFullscreenBtn.setVisibility(View.GONE);
        }
        // 自动隐藏（仅全屏模式下 4 秒后隐藏）
        controlHandler.removeCallbacks(autoHideControls);
        if (show && isFullscreen) {
            controlHandler.postDelayed(autoHideControls, 4000);
        } else if (!show && !isFullscreen) {
            // 非全屏不自动隐藏
        }
    }

    // ================================================================ 设置面板

    private void showSettingsPanel() {
        final String[] items = {"倍速: " + playbackSpeed + "x", "取消"};
        new android.app.AlertDialog.Builder(this)
            .setTitle("播放设置")
            .setItems(items, (dialog, which) -> {
                if (which == 0) {
                    showSpeedSelector();
                }
            })
            .show();
    }

    private void showSpeedSelector() {
        final String[] labels = new String[SPEED_OPTIONS.length];
        for (int i = 0; i < SPEED_OPTIONS.length; i++) {
            labels[i] = SPEED_OPTIONS[i] + "x" + (i == speedIndex ? " ✓" : "");
        }
        new android.app.AlertDialog.Builder(this)
            .setTitle("播放速度")
            .setItems(labels, (dialog, which) -> {
                speedIndex = which;
                playbackSpeed = SPEED_OPTIONS[which];
                if (playbackService != null && playbackService.player != null) {
                    playbackService.player.setPlaybackSpeed(playbackSpeed);
                }
            })
            .show();
    }

    // ================================================================ 状态切换

    private void showLoading() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.VISIBLE);
        if (playbackEndedOverlay != null) playbackEndedOverlay.setVisibility(View.GONE);
        if (errorText != null) errorText.setVisibility(View.GONE);
        if (statusLabel != null) statusLabel.setText("\u52A0\u8F7D\u4E2D\u2026");
    }

    private void showPlaying() {
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
        if (playbackEndedOverlay != null) playbackEndedOverlay.setVisibility(View.GONE);
        if (errorText != null) errorText.setVisibility(View.GONE);
        if (statusLabel != null) statusLabel.setText("\u6B63\u5728\u64AD\u653E");
        // 防重复链：已有 progressRunnable 在运行时不再重复添加
        if (windowResumed && !progressHandler.hasCallbacks(progressRunnable)) {
            progressHandler.post(progressRunnable);
        }
    }

    private void showEnded() {
        hasEnded = true;
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
        if (playbackEndedOverlay != null) playbackEndedOverlay.setVisibility(View.VISIBLE);
        if (errorText != null) errorText.setVisibility(View.GONE);
        if (statusLabel != null) statusLabel.setText("\u64AD\u653E\u5B8C\u6210");
        progressHandler.removeCallbacks(progressRunnable);
    }

    private void showError(String message) {
        if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
        if (playbackEndedOverlay != null) playbackEndedOverlay.setVisibility(View.GONE);
        if (errorText != null) {
            errorText.setText(message == null ? "\u64AD\u653E\u5931\u8D25" : message);
            errorText.setVisibility(View.VISIBLE);
        }
        if (statusLabel != null) statusLabel.setText("\u64AD\u653E\u5931\u8D25");
        progressHandler.removeCallbacks(progressRunnable);
    }

    // ================================================================ 生命周期

    @Override
    public void onBackPressed() {
        if (isFullscreen) {
            toggleFullscreen();
            return;
        }
        finish();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateSurfaceLayout();
    }

    @Override
    public void onVideoSizeChanged(final int vw, final int vh) {
        videoWidth = vw;
        videoHeight = vh;
        runOnUiThread(() -> {
            updateSurfaceLayout();
            // 视频尺寸就绪时也隐藏加载覆盖层（确保覆盖层消失）
            if (loadingOverlay != null && loadingOverlay.getVisibility() == View.VISIBLE) {
                showPlaying();
            }
        });
    }

    private void updateSurfaceLayout() {
        if (surfaceView == null || videoWidth <= 0 || videoHeight <= 0) return;
        int cw = videoContainer.getWidth();
        int ch = videoContainer.getHeight();
        if (cw <= 0 || ch <= 0) return;
        float ratio = (float) videoWidth / videoHeight;
        float screenRatio = (float) cw / ch;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) surfaceView.getLayoutParams();
        if (ratio > screenRatio) {
            lp.width = cw;
            lp.height = (int) (cw / ratio);
        } else {
            lp.height = ch;
            lp.width = (int) (ch * ratio);
        }
        lp.gravity = Gravity.CENTER;
        surfaceView.setLayoutParams(lp);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.hasExtra(EXTRA_WINDOW_ACTION)) {
            queueWindowAction(intent);
            return;
        }
        if (intent == null || !intent.hasExtra(EXTRA_URI)) {
            refreshPlaybackUi();
            return;
        }
        finishWindowAction("player_media_changed", "");
        if (intent != null) {
            pendingUri = intent.getStringExtra(EXTRA_URI);
            pendingTitle = intent.getStringExtra(EXTRA_TITLE);
            String u = intent.getStringExtra(EXTRA_USER_NAME);
            String a = intent.getStringExtra(EXTRA_AI_NAME);
            if (u != null && !u.isEmpty()) userName = u;
            if (a != null && !a.isEmpty()) aiName = a;
        }
        if (pendingUri == null) pendingUri = "";
        if (pendingTitle == null) pendingTitle = "";
        refreshPlaybackUi();
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {}

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        surfaceReady = true;
        if (playbackService == null || holder == null) return;
        try {
            if (holder.getSurface() == null || !holder.getSurface().isValid()) return;
            playbackService.setSurface(holder.getSurface());
        } catch (Exception ignored) {}
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        if (playbackService != null) {
            try {
                playbackService.setSurface(null);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onPlaybackStateChanged(int state) {
        runOnUiThread(() -> {
            switch (state) {
                case Player.STATE_BUFFERING:
                    showLoading();
                    break;
                case Player.STATE_READY:
                    showPlaying();
                    if (playbackService != null && playbackService.player != null) {
                        boolean actuallyPlaying = playbackService.player.getPlayWhenReady();
                        isPlaying = actuallyPlaying;
                        hasEnded = false;
                        if (playPauseBtn != null) {
                            playPauseBtn.setImageResource(actuallyPlaying
                                ? android.R.drawable.ic_media_pause
                                : android.R.drawable.ic_media_play);
                        }
                    } else {
                        isPlaying = true;
                        hasEnded = false;
                        if (playPauseBtn != null) {
                            playPauseBtn.setImageResource(android.R.drawable.ic_media_pause);
                        }
                    }
                    break;
                case Player.STATE_ENDED:
                    showEnded();
                    break;
            }
        });
    }

    @Override
    public void onPlaybackError(String message) {
        runOnUiThread(() -> showError(message));
    }

    private void bindPlaybackService() {
        Intent serviceIntent = new Intent(this, CastPlaybackService.class);
        bound = bindService(serviceIntent, connection, BIND_AUTO_CREATE);
    }

    private void refreshPlaybackUi() {
        if (playbackService == null) return;
        if (playbackService.getOriginalUri().isEmpty()) {
            showError("播放会话已结束，请返回重新打开视频。");
            return;
        }
        pendingUri = playbackService.getOriginalUri();
        pendingTitle = playbackService.getCurrentTitle();
        titleText.setText(pendingTitle);
        ExoPlayer player = playbackService.player;
        if (player == null) return;
        videoWidth = player.getVideoSize().width;
        videoHeight = player.getVideoSize().height;
        updateSurfaceLayout();
        isPlaying = player.getPlayWhenReady();
        playbackSpeed = player.getPlaybackParameters().speed;
        playPauseBtn.setImageResource(isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        onPlaybackStateChanged(player.getPlaybackState());
        if (player.getPlayerError() != null) showError(CastError.formatMediaError(player.getPlayerError().errorCode));
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putBoolean(STATE_FULLSCREEN, isFullscreen);
        state.putString(EXTRA_URI, pendingUri);
        state.putString(EXTRA_TITLE, pendingTitle);
        state.putString(EXTRA_USER_NAME, userName);
        state.putString(EXTRA_AI_NAME, aiName);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onStart() {
        super.onStart();
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(DlnaReceiverPlugin.ACTION_CAST_REPLY);
            filter.addAction(DlnaReceiverPlugin.ACTION_CAST_REACTION);
            filter.addAction(DlnaReceiverPlugin.ACTION_CAST_DANMAKU);
            registerReceiver(castReplyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) {}
    }

    @Override
    protected void onResume() {
        super.onResume();
        windowResumed = true;
        tryWindowAction();
        refreshPlaybackUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        windowResumed = false;
        windowActionHandler.removeCallbacks(applyWindowAction);
        controlHandler.removeCallbacks(autoHideControls);
        // 进入后台时停止进度轮询和帧采集，省电省带宽
        progressHandler.removeCallbacks(progressRunnable);
    }

    @Override
    protected void onStop() {
        finishWindowAction("player_window_closed", "");
        try {
            unregisterReceiver(castReplyReceiver);
        } catch (Exception ignored) {}
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        finishWindowAction("player_window_closed", "");
        screenshotWriter.shutdown();
        progressHandler.removeCallbacks(progressRunnable);
        controlHandler.removeCallbacks(autoHideControls);
        chatHandler.removeCallbacksAndMessages(null);
        if (playbackService != null) {
            playbackService.setListener(null);
            playbackService.setSurface(null);
        }
        if (bound) {
            try {
                unbindService(connection);
            } catch (Exception ignored) {}
            bound = false;
        }
        playbackService = null;
        super.onDestroy();
    }

    private int dp(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density + 0.5f);
    }
}

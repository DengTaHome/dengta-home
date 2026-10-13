package home.dengta.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;

/**
 * DLNA 接收端 Capacitor 插件。
 *
 * 方法：
 *   start()          — 启动 DLNA 接收服务（前台服务，在局域网注册为 MediaRenderer）
 *   stop()           — 停止接收
 *   getState()       — 查询状态（active/port/transportState/currentUri/pendingUri/pendingTitle）
 *   clearPending()   — 清空待处理媒体信息
 *   launchPlayer()   — 启动投屏播放器（原生 ExoPlayer + 播放器 UI）
 *   sendCastChat()   — 把放映厅聊天消息从原生播放器转发到 Web 层（带鉴权呼叫真实 AI）
 *   showCastReply()  — 把 Web 层拿到的 AI 回复/主动互动广播回原生播放器
 *
 * 事件：
 *   mediaReceived    — 视频 App 投屏到了一个媒体 URL → { uri, title, metaJson }
 *   stateChanged     — 服务启停状态变化 → { state: "running"|"stopped" }
 *   castChat         — 原生播放器发来的聊天消息 → { text, positionMs, userName, aiName }
 */
@CapacitorPlugin(name = "DlnaReceiver")
public final class DlnaReceiverPlugin extends Plugin {

    private static final String EVENT_MEDIA_RECEIVED = "mediaReceived";
    private static final String EVENT_STATE_CHANGED = "stateChanged";
    private static final String EVENT_CAST_CHAT = "castChat";
    private static final String EVENT_CAST_POSITION = "castPosition";
    private static final String EVENT_CAST_FRAME = "castFrame";

    /** Web 层回复/主动消息送回原生播放器的广播 action。 */
    public static final String ACTION_CAST_REPLY = "home.dengta.app.action.CAST_REPLY";
    public static final String ACTION_CAST_REACTION = "home.dengta.app.action.CAST_REACTION";
    public static final String ACTION_CAST_DANMAKU = "home.dengta.app.action.CAST_DANMAKU";

    /** 供原生 Activity 向 Web 层转发消息的静态引用（Capacitor 插件为单例常驻）。 */
    private static volatile DlnaReceiverPlugin instance;
    private final CastWindowRequests windowRequests = new CastWindowRequests();
    private final Handler windowHandler = new Handler(Looper.getMainLooper());

    static boolean hasWindowRequest(String id) {
        return instance != null && instance.windowRequests.contains(id);
    }

    static void finishWindowRequest(String id, String errorCode, String fileName) {
        DlnaReceiverPlugin plugin = instance;
        if (plugin != null) plugin.windowRequests.finish(id, errorCode, fileName);
    }

    public static DlnaReceiverPlugin getInstance() {
        return instance;
    }

    /** 原生播放器 → Web 层：把用户消息推送到监听中的前端（DlnaCastPlayer）。 */
    public static void notifyCastChatFromNative(String text, double positionMs,
                                                String userName, String aiName) {
        DlnaReceiverPlugin plugin = instance;
        if (plugin == null) return;
        try {
            JSObject payload = new JSObject();
            payload.put("text", text);
            payload.put("positionMs", positionMs);
            payload.put("userName", userName);
            payload.put("aiName", aiName);
            plugin.notifyListeners(EVENT_CAST_CHAT, payload);
        } catch (Exception ignored) {
        }
    }

    /** 原生播放器 → Web 层：通知前端当前播放位置（AI 主动互动用）。 */
    public static void notifyCastPositionFromNative(double positionMs, double durationMs) {
        DlnaReceiverPlugin plugin = instance;
        if (plugin == null) return;
        try {
            JSObject payload = new JSObject();
            payload.put("positionMs", positionMs);
            payload.put("durationMs", durationMs);
            plugin.notifyListeners(EVENT_CAST_POSITION, payload);
        } catch (Exception ignored) {
        }
    }

    /** 原生播放器 → Web 层：上传当前视频帧（base64 JPEG）供后端 AI 理解并主动评论。 */
    public static void notifyCastFrameFromNative(String base64Jpeg, double positionMs,
                                                 double durationMs, String title) {
        DlnaReceiverPlugin plugin = instance;
        if (plugin == null) return;
        try {
            // 限制体积：约 96~128KB 的 JPEG，避免桥接过重
            if (base64Jpeg.length() > 260_000) return;
            JSObject payload = new JSObject();
            payload.put("frameBase64", base64Jpeg);
            payload.put("positionMs", positionMs);
            payload.put("durationMs", durationMs);
            payload.put("title", title);
            plugin.notifyListeners(EVENT_CAST_FRAME, payload);
        } catch (Exception ignored) {
        }
    }

    private DlnaStateReceiver stateReceiver;
    private boolean broadcastRegistered = false;

    @Override
    public void load() {
        super.load();
        instance = this;
        registerBroadcastReceivers();
        // 默认开启 DLNA 投屏接收，自动启动前台服务
        // 用户可以在设置中手动关闭（ENABLED_KEY 会记录关闭状态）
        try {
            DlnaReceiverService.ensureEnabledByDefault(getContext());
            ContextCompat.startForegroundService(
                getContext(),
                DlnaReceiverService.startIntent(getContext())
            );
            Log.i("DlnaReceiverPlugin", "auto-start: default enabled, foreground service started");
        } catch (Exception e) {
            Log.w("DlnaReceiverPlugin", "auto-start failed: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        windowRequests.cancel("player_window_closed");
        windowHandler.removeCallbacksAndMessages(null);
        if (instance == this) instance = null;
        unregisterBroadcastReceivers();
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- 插件方法

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject state = DlnaReceiverService.buildState(getContext());
        call.resolve(state);
    }

    @PluginMethod
    public void start(PluginCall call) {
        ContextCompat.startForegroundService(
            getContext(),
            DlnaReceiverService.startIntent(getContext())
        );
        call.resolve(DlnaReceiverService.buildState(getContext()));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!DlnaReceiverService.isRunning()) {
            call.resolve(DlnaReceiverService.buildState(getContext()));
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            DlnaReceiverService.stopIntent(getContext())
        );
        call.resolve(DlnaReceiverService.buildState(getContext()));
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        DlnaReceiverService.clearPending(getContext());
        call.resolve();
    }

    /**
     * 启动投屏播放：前台服务持续播放（后台不中断），并打开播放器页面。
     * 绕过 WebView 对 http 直链（混合内容）的限制，并携带自定义 UA 以通过 CDN 校验。
     */
    @PluginMethod
    public void launchPlayer(PluginCall call) {
        String uri = call.getString("uri");
        String title = call.getString("title", "");
        if (uri == null || uri.isEmpty()) {
            call.reject("missing_uri", "缺少播放地址。");
            return;
        }
        // 读取用户/AI名称（来自前端DengTa设置）
        String userName = call.getString("userName", "");
        String aiName = call.getString("aiName", "");
        try {
            // 1) 前台服务开始播放（即使 Activity 未打开、之后退出也不中断）
            CastPlaybackService.play(getContext(), uri, title);
            // 2) 打开播放器 UI 壳（绑定服务拿 Surface 渲染）
            Intent intent = new Intent(getContext(), CastPlayerActivity.class)
                .putExtra(CastPlayerActivity.EXTRA_URI, uri)
                .putExtra(CastPlayerActivity.EXTRA_TITLE, title)
                .putExtra(CastPlayerActivity.EXTRA_USER_NAME, userName)
                .putExtra(CastPlayerActivity.EXTRA_AI_NAME, aiName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("player_launch_failed", "启动播放器失败: " + e.getMessage());
        }
    }

    /** 停止投屏播放（前端"结束投屏"按钮）。 */
    @PluginMethod
    public void stopPlayback(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            CastPlaybackService service = CastPlaybackService.getActiveService();
            if (service == null) { call.resolve(); return; }
            if (!matchesMedia(call, service)) return;
            CastPlaybackService.stop(getContext(), call.getString("expectedUri", ""));
            call.resolve();
        });
    }

    private boolean matchesMedia(PluginCall call, CastPlaybackService service) {
        if (CastMediaScope.matches(call.getString("expectedUri", ""), service.getOriginalUri())) return true;
        call.reject("媒体已切换，请在当前播放器重新操作。", "playback_media_changed");
        return false;
    }

    /** Controls the already-running ExoPlayer; resolve only after the command is applied. */
    @PluginMethod
    public void sendPlaybackCommand(PluginCall call) {
        final String action = call.getString("action", "");
        final Double value = call.getDouble("value");
        getBridge().executeOnMainThread(() -> {
            if ("fullscreen".equals(action)) {
                openPlayerWindow(call, "fullscreen");
                return;
            }
            CastPlaybackService service = CastPlaybackService.getActiveService();
            if (service == null) {
                call.reject("播放服务尚未就绪。", "playback_not_active");
                return;
            }
            if (!matchesMedia(call, service)) return;
            try {
                service.executePlaybackCommand(action, value);
                call.resolve(playbackState(service));
            } catch (IllegalArgumentException error) {
                call.reject("不支持的播放操作或倍速参数。", "invalid_playback_command");
            } catch (IllegalStateException error) {
                call.reject("播放器尚未就绪。", "playback_not_active");
            } catch (Exception error) {
                call.reject("播放操作未完成，请稍后重试。", "playback_command_failed");
            }
        });
    }

    @PluginMethod
    public void captureFrame(PluginCall call) {
        getBridge().executeOnMainThread(() -> openPlayerWindow(call, "capture"));
    }

    private void openPlayerWindow(PluginCall call, String action) {
        CastPlaybackService service = CastPlaybackService.getActiveService();
        if (service == null || service.player == null || service.getOriginalUri().isEmpty()) {
            call.reject("播放器尚未就绪，请先打开视频。", "playback_not_active");
            return;
        }
        if (!matchesMedia(call, service)) return;
        String id = UUID.randomUUID().toString();
        if (!windowRequests.begin(id, (errorCode, fileName) -> {
            windowHandler.removeCallbacksAndMessages(null);
            if (errorCode != null && !errorCode.isEmpty()) {
                call.reject("播放器窗口操作未完成，请稍后重试。", errorCode);
            } else {
                JSObject result = new JSObject();
                result.put("completed", true);
                result.put("action", action);
                if ("capture".equals(action)) {
                    result.put("saved", true);
                    result.put("fileName", fileName);
                } else result.put("fullscreen", true);
                call.resolve(result);
            }
        })) {
            call.reject("已有播放器窗口操作正在进行。", "player_window_busy");
            return;
        }
        windowHandler.postDelayed(() -> windowRequests.finish(id, "player_window_timeout", ""), 30_000);
        try {
            Intent intent = new Intent(getContext(), CastPlayerActivity.class)
                .putExtra(CastPlayerActivity.EXTRA_URI, service.getOriginalUri())
                .putExtra(CastPlayerActivity.EXTRA_TITLE, service.getCurrentTitle())
                .putExtra(CastPlayerActivity.EXTRA_WINDOW_ACTION, action)
                .putExtra(CastPlayerActivity.EXTRA_WINDOW_REQUEST, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            getContext().startActivity(intent);
        } catch (Exception error) { windowRequests.finish(id, "player_window_failed", ""); }
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            CastPlaybackService service = CastPlaybackService.getActiveService();
            if (service == null || service.player == null) {
                call.reject("播放器尚未就绪。", "playback_not_active");
                return;
            }
            if (!matchesMedia(call, service)) return;
            try { call.resolve(playbackState(service)); }
            catch (Exception error) { call.reject("播放状态读取失败。", "playback_state_failed"); }
        });
    }

    private static JSObject playbackState(CastPlaybackService service) {
        JSObject result = new JSObject();
        result.put("mediaUri", service.getOriginalUri());
        result.put("playWhenReady", service.player.getPlayWhenReady());
        result.put("isPlaying", service.player.isPlaying());
        result.put("speed", service.player.getPlaybackParameters().speed);
        result.put("positionMs", Math.max(0, service.getCurrentPosition()));
        result.put("durationMs", Math.max(0, service.getDuration()));
        return result;
    }

    /** 获取投屏诊断信息（前端调试用）。 */
    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        try {
            JSObject diag = new JSObject();
            JSObject dlna = DlnaReceiverService.buildState(getContext());
            diag.put("dlna", dlna);

            // 生成详细诊断信息
            String currentUri = DlnaReceiverService.currentUri;
            String domain = "";
            try {
                domain = new java.net.URL(currentUri).getHost();
            } catch (Exception ignored) {}
            String diagnostic = CastError.buildDiagnosticInfo(
                currentUri,
                domain,
                0, // proxyPort 在服务端并非持久字段，前端可从日志获取
                DlnaReceiverService.isReady(),
                DlnaReceiverService.transportState
            );
            diag.put("diagnosticInfo", diagnostic);
            call.resolve(diag);
        } catch (Exception e) {
            call.reject("diagnostic_error", "诊断失败: " + safeMsg(e));
        }
    }

    /** 原生播放器 → Web 层：转发聊天消息（带鉴权的 Web 层调用真实 AI 回复 API）。 */
    @PluginMethod
    public void sendCastChat(PluginCall call) {
        String text = call.getString("text", "");
        double positionMs = call.getDouble("positionMs", 0.0);
        String userName = call.getString("userName", "");
        String aiName = call.getString("aiName", "");
        if (text.isEmpty()) {
            call.reject("empty_text", "消息不能为空。");
            return;
        }
        try {
            JSObject payload = new JSObject();
            payload.put("text", text);
            payload.put("positionMs", positionMs);
            payload.put("userName", userName);
            payload.put("aiName", aiName);
            notifyListeners(EVENT_CAST_CHAT, payload);
            call.resolve();
        } catch (Exception e) {
            call.reject("cast_chat_error", "转发聊天消息失败: " + safeMsg(e));
        }
    }

    /** Web 层 → 原生播放器：显示 AI 回复文本（从 Web 鉴权后的 AI 回复 API 返回）。 */
    @PluginMethod
    public void showCastReply(PluginCall call) {
        String text = call.getString("text", "");
        String aiName = call.getString("aiName", "");
        if (text.isEmpty()) {
            call.reject("empty_reply", "回复内容不能为空。");
            return;
        }
        try {
            Intent intent = new Intent(ACTION_CAST_REPLY)
                .setPackage(getContext().getPackageName())
                .putExtra("replyText", text)
                .putExtra("aiName", aiName);
            getContext().sendBroadcast(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("cast_reply_error", "发送回复失败: " + safeMsg(e));
        }
    }

    /** Web 层 → 原生播放器：展示一条弹幕（从房间消息/AI 互动定时生成）。 */
    @PluginMethod
    public void showCastDanmaku(PluginCall call) {
        String text = call.getString("text", "");
        String senderName = call.getString("senderName", "");
        String colorHex = call.getString("colorHex", "");
        if (text.isEmpty()) {
            call.reject("empty_danmaku", "弹幕内容不能为空。");
            return;
        }
        try {
            Intent intent = new Intent(ACTION_CAST_DANMAKU)
                .setPackage(getContext().getPackageName())
                .putExtra("danmakuText", text)
                .putExtra("senderName", senderName)
                .putExtra("colorHex", colorHex);
            getContext().sendBroadcast(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("cast_danmaku_error", "发送弹幕失败: " + safeMsg(e));
        }
    }

    /** Web 层 → 原生播放器：AI 主动互动（基于视频帧/内容生成的观察/评论）。 */
    @PluginMethod
    public void showCastReaction(PluginCall call) {
        String text = call.getString("text", "");
        String aiName = call.getString("aiName", "");
        if (text.isEmpty()) {
            call.reject("empty_reaction", "互动内容不能为空。");
            return;
        }
        try {
            Intent intent = new Intent(ACTION_CAST_REACTION)
                .setPackage(getContext().getPackageName())
                .putExtra("reactionText", text)
                .putExtra("aiName", aiName);
            getContext().sendBroadcast(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("cast_reaction_error", "发送互动失败: " + safeMsg(e));
        }
    }

    private String safeMsg(Exception e) {
        if (e == null) return "unknown";
        String m = e.getMessage();
        return m == null ? "unknown (" + e.getClass().getSimpleName() + ")" : m;
    }

    // ---------------------------------------------------------------- 广播接收器

    private void registerBroadcastReceivers() {
        if (broadcastRegistered) return;
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(DlnaReceiverService.MEDIA_RECEIVED_ACTION);
            filter.addAction(DlnaReceiverService.ACTION_STATE);
            stateReceiver = new DlnaStateReceiver();
            // NOT_EXPORTED：只允许本应用广播触达，防止同设备恶意应用伪造投屏事件
            getContext().registerReceiver(stateReceiver, filter,
                Context.RECEIVER_NOT_EXPORTED);
            broadcastRegistered = true;
        } catch (Exception ignored) {
        }
    }

    private void unregisterBroadcastReceivers() {
        if (!broadcastRegistered || stateReceiver == null) return;
        try {
            getContext().unregisterReceiver(stateReceiver);
        } catch (Exception ignored) {
        }
        broadcastRegistered = false;
        stateReceiver = null;
    }

    private class DlnaStateReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String action = intent.getAction();
            if (DlnaReceiverService.MEDIA_RECEIVED_ACTION.equals(action)) {
                JSObject payload = new JSObject();
                payload.put("uri", intent.getStringExtra(DlnaReceiverService.EXTRA_URI));
                payload.put("title", intent.getStringExtra(DlnaReceiverService.EXTRA_TITLE));
                payload.put("metaJson",
                    intent.getStringExtra(DlnaReceiverService.EXTRA_META_JSON));
                notifyListeners(EVENT_MEDIA_RECEIVED, payload);
            } else if (DlnaReceiverService.ACTION_STATE.equals(action)) {
                JSObject payload = new JSObject();
                payload.put("state",
                    intent.getStringExtra(DlnaReceiverService.EXTRA_STATE));
                notifyListeners(EVENT_STATE_CHANGED, payload);
            }
        }
    }
}

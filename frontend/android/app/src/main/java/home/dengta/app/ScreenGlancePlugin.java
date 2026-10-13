package home.dengta.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenGlance")
public final class ScreenGlancePlugin extends Plugin {
    private final ProjectionConsentGate consentGate = new ProjectionConsentGate();
    private String pendingConsentId;
    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(ScreenGlanceService.buildState(getContext()));
    }

    @PluginMethod
    public void startSession(PluginCall call) {
        if (!scopeMatches(call)) return;
        JSObject currentState = ScreenGlanceService.buildState(getContext());
        if (currentState.optBoolean("active", false)) {
            call.resolve(currentState);
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("当前 Android 版本不支持系统屏幕共享。");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getContext()
            .getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            call.reject("系统没有提供屏幕共享服务。");
            return;
        }
        String id = call.getCallbackId();
        if (!consentGate.begin(id, BackgroundNotificationCredentials.currentScopeKey(getContext()))) {
            call.reject("系统共享授权仍在等待，请先处理原来的授权窗口。", "screen_glance_consent_busy");
            return;
        }
        pendingConsentId = id;
        try {
            startActivityForResult(call, manager.createScreenCaptureIntent(), "handleProjectionResult");
        } catch (Exception error) {
            consentGate.finish(id, BackgroundNotificationCredentials.currentScopeKey(getContext()));
            call.reject("无法打开系统共享授权，请重试。", "screen_glance_consent_failed");
        }
    }

    @ActivityCallback
    private void handleProjectionResult(PluginCall call, ActivityResult result) {
        String id = call == null ? pendingConsentId : call.getCallbackId();
        boolean accepted = consentGate.finish(id, BackgroundNotificationCredentials.currentScopeKey(getContext()));
        if (call == null) return;
        if (!accepted) {
            JSObject state = ScreenGlanceService.buildState(getContext());
            state.put("consentCancelled", true);
            call.resolve(state);
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            JSObject state = ScreenGlanceService.buildState(getContext());
            state.put("consentDenied", true);
            call.resolve(state);
            return;
        }

        try {
            Intent service = ScreenGlanceService.startIntent(
                getContext(),
                result.getResultCode(),
                data
            );
            ContextCompat.startForegroundService(getContext(), service);
            JSObject state = ScreenGlanceService.buildState(getContext());
            state.put("starting", true);
            call.resolve(state);
        } catch (Exception error) {
            call.reject("无法启动屏幕共看，请重新取得系统授权。");
        }
    }

    @PluginMethod
    public void configure(PluginCall call) {
        if (!scopeMatches(call)) return;
        boolean randomEnabled = Boolean.TRUE.equals(
            call.getBoolean("randomEnabled", false)
        );
        int minimumMinutes = boundedMinutes(
            call.getInt("minimumMinutes", 60)
        );
        int maximumMinutes = Math.max(
            minimumMinutes,
            boundedMinutes(call.getInt("maximumMinutes", 180))
        );
        boolean wifiOnly = Boolean.TRUE.equals(call.getBoolean("wifiOnly", true));
        boolean chargingOnly = Boolean.TRUE.equals(
            call.getBoolean("chargingOnly", false)
        );
        boolean watchTogetherEnabled = Boolean.TRUE.equals(
            call.getBoolean("watchTogetherEnabled", false)
        );
        int watchIntervalSeconds = boundedSeconds(
            call.getInt("watchIntervalSeconds", 90)
        );
        String coWatchSessionId = String.valueOf(
            call.getString("coWatchSessionId", "")
        ).trim();
        ScreenGlanceService.storeConfig(
            getContext(),
            randomEnabled,
            minimumMinutes,
            maximumMinutes,
            wifiOnly,
            chargingOnly,
            watchTogetherEnabled,
            watchIntervalSeconds,
            coWatchSessionId
        );
        ScreenGlanceService.sendAction(
            getContext(),
            ScreenGlanceService.ACTION_CONFIGURE
        );
        call.resolve(ScreenGlanceService.buildState(getContext()));
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        Boolean paused = call.getBoolean("paused");
        if (paused == null) {
            call.reject("缺少暂停状态。");
            return;
        }
        ScreenGlanceService.sendAction(
            getContext(),
            paused
                ? ScreenGlanceService.ACTION_PAUSE
                : ScreenGlanceService.ACTION_RESUME
        );
        call.resolve(ScreenGlanceService.buildState(getContext()));
    }

    @PluginMethod
    public void captureNow(PluginCall call) {
        if (!ScreenGlanceService.requestCapture(false)) {
            call.reject("屏幕共看尚未开始或当前处于暂停状态。");
            return;
        }
        JSObject state = ScreenGlanceService.buildState(getContext());
        state.put("captureRequested", true);
        call.resolve(state);
    }

    @PluginMethod
    public void consumeLatestCapture(PluginCall call) {
        try {
            JSObject capture = ScreenGlanceService.consumeLatestCapture(
                getContext()
            );
            if (capture == null) {
                JSObject empty = new JSObject();
                empty.put("available", false);
                call.resolve(empty);
                return;
            }
            capture.put("available", true);
            call.resolve(capture);
        } catch (Exception error) {
            call.reject("暂时无法读取刚才的屏幕画面，原图已清除。");
        }
    }

    @PluginMethod
    public void readCoWatchPreview(PluginCall call) {
        try {
            JSObject preview = ScreenGlanceService.readCoWatchPreview(
                getContext()
            );
            if (preview == null) {
                JSObject empty = new JSObject();
                empty.put("available", false);
                call.resolve(empty);
                return;
            }
            preview.put("available", true);
            call.resolve(preview);
        } catch (Exception error) {
            call.reject("The latest co-watch preview is unavailable.");
        }
    }

    @PluginMethod
    public void stopSession(PluginCall call) {
        consentGate.cancel(call.getString("scopeKey", ""));
        if (!scopeMatches(call)) return;
        ScreenGlanceService.sendAction(
            getContext(),
            ScreenGlanceService.ACTION_STOP
        );
        ScreenGlanceService.deleteLatestCapture(getContext());
        ScreenGlanceService.deleteCoWatchPreview(getContext());
        call.resolve(ScreenGlanceService.buildState(getContext()));
    }

    private static int boundedMinutes(Integer value) {
        int requested = value == null ? 60 : value;
        return Math.min(180, Math.max(1, requested));
    }

    private boolean scopeMatches(PluginCall call) {
        String expected = call.getString("scopeKey", "");
        if (expected != null && !expected.isEmpty() && !ScreenCaptureScope.matches(expected, BackgroundNotificationCredentials.currentScopeKey(getContext()))) {
            call.reject("后台身份尚未同步，请稍候重试屏幕共享。", "screen_glance_identity_pending");
            return false;
        }
        return true;
    }

    private static int boundedSeconds(Integer value) {
        int requested = value == null ? 90 : value;
        return Math.min(10_800, Math.max(60, requested));
    }
}

package home.dengta.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 设备信号（活动感知增强 · 安卓化"iOS 白给信号"）：
 * 电量、充电状态、前后台状态。全部来自系统通知，无后台常驻循环。
 * 前端按场景轮询上报 /api/v2/device/state。
 */
@CapacitorPlugin(name = "DeviceSignals")
public final class DeviceSignalsPlugin extends Plugin {

    private final AtomicBoolean foreground = new AtomicBoolean(false);
    private volatile String lastPowerEvent = "";
    private long lastPowerEventAt = 0L;

    @Override
    public void load() {
        Context context = getContext();
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_POWER_CONNECTED);
        filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
        filter.addAction(Intent.ACTION_BATTERY_LOW);
        filter.addAction(Intent.ACTION_BATTERY_OKAY);
        try {
            context.registerReceiver(powerReceiver, filter);
        } catch (Exception ignored) {
            // 已注册或系统限制时忽略；快照仍会读当前状态。
        }
        getActivity().getApplication().registerActivityLifecycleCallbacks(
            new android.app.Application.ActivityLifecycleCallbacks() {
                private int started = 0;
                @Override
                public void onActivityStarted(android.app.Activity activity) {
                    started += 1;
                    if (started == 1) foreground.set(true);
                }
                @Override
                public void onActivityStopped(android.app.Activity activity) {
                    started -= 1;
                    if (started <= 0) {
                        started = 0;
                        foreground.set(false);
                    }
                }
                @Override public void onActivityCreated(android.app.Activity activity, android.os.Bundle state) {}
                @Override public void onActivityResumed(android.app.Activity activity) {}
                @Override public void onActivityPaused(android.app.Activity activity) {}
                @Override public void onActivitySaveInstanceState(android.app.Activity activity, android.os.Bundle state) {}
                @Override public void onActivityDestroyed(android.app.Activity activity) {}
            }
        );
    }

    private final BroadcastReceiver powerReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            lastPowerEvent = intent.getAction() == null ? "" : intent.getAction();
            lastPowerEventAt = System.currentTimeMillis();
        }
    };

    // 真实设备标识:用于扫码登录风控(网易云等平台要求真实设备号)。
    // 只上报 Android ID、机型与制造商,不采集 IMEI/序列号等敏感标识。
    @PluginMethod
    public void getDeviceIdentity(PluginCall call) {
        JSObject identity = new JSObject();
        try {
            String androidId = android.provider.Settings.Secure.getString(
                getContext().getContentResolver(),
                android.provider.Settings.Secure.ANDROID_ID
            );
            identity.put("android_id", androidId == null ? "" : androidId);
        } catch (Exception ignored) {
            identity.put("android_id", "");
        }
        identity.put("model", android.os.Build.MODEL == null ? "" : android.os.Build.MODEL);
        identity.put("manufacturer", android.os.Build.MANUFACTURER == null ? "" : android.os.Build.MANUFACTURER);
        identity.put("brand", android.os.Build.BRAND == null ? "" : android.os.Build.BRAND);
        call.resolve(identity);
    }

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        JSObject snapshot = new JSObject();
        Context context = getContext();
        try {
            Intent sticky = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (sticky != null) {
                int level = sticky.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = sticky.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                if (level >= 0 && scale > 0) {
                    snapshot.put("battery_pct", Math.round(level * 100f / scale));
                }
                int status = sticky.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                snapshot.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL);
            }
        } catch (Exception ignored) {
            // 系统不提供电量时留空。
        }
        snapshot.put("app_state", foreground.get() ? "foreground" : "background");
        snapshot.put("emulator", isEmulator());
        if (lastPowerEventAt > 0 && System.currentTimeMillis() - lastPowerEventAt < 10 * 60_000L) {
            JSObject power = new JSObject();
            power.put("event", lastPowerEvent);
            power.put("at", lastPowerEventAt);
            snapshot.put("last_power_event", power);
        }
        call.resolve(snapshot);
    }

    private static boolean isEmulator() {
        String fingerprint = android.os.Build.FINGERPRINT == null ? "" : android.os.Build.FINGERPRINT.toLowerCase();
        String model = android.os.Build.MODEL == null ? "" : android.os.Build.MODEL.toLowerCase();
        return fingerprint.contains("generic")
            || fingerprint.contains("emulator")
            || model.contains("emulator")
            || model.contains("android sdk built for");
    }
}

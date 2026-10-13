package home.dengta.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 行踪采集（whereabouts-mcp 安卓适配）：
 * - 一次定位（GPS + 网络，缓存 2 分钟内直接复用，省电）
 * - 电量快照
 * - 前端负责把结果上报 POST /api/v2/whereabouts/ingest。
 */
@CapacitorPlugin(
    name = "Whereabouts",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        })
    }
)
public final class WhereaboutsPlugin extends Plugin {

    private static final long LOCATION_TIMEOUT_MS = 15_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean locating = new AtomicBoolean(false);

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasLocationPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasLocationPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("location", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasLocationPermission());
        call.resolve(result);
    }

    private boolean hasLocationPermission() {
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void getBatterySnapshot(PluginCall call) {
        call.resolve(batterySnapshot());
    }

    /**
     * 获取当前位置 + 电量。缓存新鲜（<2 分钟）直接复用。
     */
    @PluginMethod
    public void getLocation(PluginCall call) {
        if (!hasLocationPermission()) {
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("error", "location_permission_required");
            call.resolve(result);
            return;
        }
        if (!locating.compareAndSet(false, true)) {
            JSObject busy = new JSObject();
            busy.put("error", "locating_in_progress");
            call.resolve(busy);
            return;
        }

        final LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            locating.set(false);
            JSObject result = new JSObject();
            result.put("error", "location_service_unavailable");
            call.resolve(result);
            return;
        }

        // 先看缓存
        Location cached = null;
        try {
            cached = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (cached == null) {
                cached = manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            }
        } catch (Exception ignored) {
            cached = null;
        }
        if (cached != null && System.currentTimeMillis() - cached.getTime() < 2 * 60_000L) {
            locating.set(false);
            call.resolve(serializeLocation(cached));
            return;
        }

        final LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                cleanup();
                locating.set(false);
                if (location != null) {
                    call.resolve(serializeLocation(location));
                } else {
                    JSObject result = new JSObject();
                    result.put("error", "location_unavailable");
                    call.resolve(result);
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {
                cleanup();
                locating.set(false);
                JSObject result = new JSObject();
                result.put("error", "location_disabled");
                call.resolve(result);
            }

            private void cleanup() {
                handler.removeCallbacksAndMessages(null);
                try {
                    manager.removeUpdates(this);
                } catch (Exception ignored) {}
            }
        };

        boolean requested = false;
        try {
            manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
            requested = true;
        } catch (Exception ignored) {
            try {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener, Looper.getMainLooper());
                requested = true;
            } catch (Exception ignored2) {
                requested = false;
            }
        }

        if (!requested) {
            locating.set(false);
            JSObject result = new JSObject();
            result.put("error", "location_provider_failed");
            call.resolve(result);
            return;
        }

        handler.postDelayed(() -> {
            if (!locating.compareAndSet(true, false)) return;
            try {
                manager.removeUpdates(listener);
            } catch (Exception ignored) {}
            Location fallback = null;
            try {
                fallback = manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (fallback == null) {
                    fallback = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                }
            } catch (Exception ignored) {}
            if (fallback != null) {
                call.resolve(serializeLocation(fallback));
            } else {
                JSObject result = new JSObject();
                result.put("error", "location_timeout");
                call.resolve(result);
            }
        }, LOCATION_TIMEOUT_MS);
    }

    private JSObject serializeLocation(Location location) {
        JSObject result = new JSObject();
        result.put("granted", true);
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        result.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : null);
        result.put("provider", location.getProvider());
        result.put("timestamp", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US)
                .format(new java.util.Date(location.getTime())));
        JSObject battery = batterySnapshot();
        result.put("batteryLevel", battery.optInt("batteryLevel", 0));
        result.put("charging", battery.optBoolean("charging", false));
        return result;
    }

    private JSObject batterySnapshot() {
        JSObject result = new JSObject();
        try {
            Intent sticky = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = sticky == null ? -1 : sticky.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = sticky == null ? 100 : sticky.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = sticky == null ? -1 : sticky.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            result.put("batteryLevel", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : null);
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL);
        } catch (Exception ignored) {
            result.put("batteryLevel", null);
            result.put("charging", false);
        }
        return result;
    }
}
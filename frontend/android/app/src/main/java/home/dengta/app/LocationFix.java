package home.dengta.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;

/**
 * 外卖/登录页定位修复（对应 ai-order-takeout 坑十五：无 GMS 手机 WebView 定位必然失败，
 * 页面拿不到位置会走异常路径）。方案：document-start 注入 JS mock geolocation，
 * 坐标从系统 LocationManager 取真实位置（权限已授权），页面正常按账号附近展示店铺。
 */
public final class LocationFix {
    private static final String MOCK_SCRIPT =
        "(function(){"
        + "try{"
        + "var b=window.DengTaLocation;if(!b){return;}"
        + "function fix(){"
        + "var v=b.getLocation();"
        + "if(!v||v.indexOf(',')<0){return null;}"
        + "var p=v.split(',');"
        + "return {coords:{latitude:parseFloat(p[0]),longitude:parseFloat(p[1]),"
        + "accuracy:parseFloat(p[2])||30,altitude:0,altitudeAccuracy:null,heading:null,speed:null},"
        + "timestamp:Date.now()};"
        + "}"
        + "var g=navigator.geolocation;"
        + "if(!g){return;}"
        + "var mockSuccess=function(cb){var pos=fix();if(pos){cb(pos);}else if(cb){cb({coords:{latitude:0,longitude:0,accuracy:0},timestamp:Date.now()});}};"
        + "g.getCurrentPosition=function(success){mockSuccess(success);};"
        + "g.watchPosition=function(success){mockSuccess(success);return 1;};"
        + "g.clearWatch=function(){};"
        + "}catch(e){}"
        + "})();";

    @SuppressLint("WebViewApiAvailability")
    public static void apply(WebView webView) {
        if (webView == null) return;
        try {
            webView.addJavascriptInterface(new DengTaLocation(webView.getContext()), "DengTaLocation");
        } catch (Exception ignored) {
        }
        // document-start 注入（部分 WebView/厂商不支持，失败时由 onPageStarted 兜底注入）。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(
                    webView, MOCK_SCRIPT, Collections.emptySet()
                );
            } catch (Exception ignored) {
            }
        }
    }

    /** 兜底：在 onPageStarted 时尽早注入 mock（在页面业务脚本执行前覆盖 geolocation）。 */
    public static void injectMock(WebView webView) {
        if (webView == null) return;
        try {
            webView.evaluateJavascript(MOCK_SCRIPT, null);
        } catch (Exception ignored) {
        }
    }

    /** 原生定位桥：返回 "lat,lng,accuracy"（无权限/无位置时返回空串）。 */
    public static final class DengTaLocation {
        private final Context context;

        DengTaLocation(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public String getLocation() {
            try {
                if (Build.VERSION.SDK_INT >= 23) {
                    int fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION);
                    int coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
                    if (fine != PackageManager.PERMISSION_GRANTED
                        && coarse != PackageManager.PERMISSION_GRANTED) {
                        return "";
                    }
                }
                LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
                if (manager == null) return "";
                Location best = null;
                for (String provider : new String[]{
                    LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER
                }) {
                    try {
                        Location candidate = manager.getLastKnownLocation(provider);
                        if (candidate != null && (best == null || candidate.getTime() > best.getTime())) {
                            best = candidate;
                        }
                    } catch (Exception ignored) {
                    }
                }
                if (best == null) return "";
                double lat = best.getLatitude();
                double lng = best.getLongitude();
                float acc = best.hasAccuracy() ? best.getAccuracy() : 30f;
                if (lat == 0.0 && lng == 0.0) return "";
                return String.valueOf(lat) + "," + String.valueOf(lng) + "," + String.valueOf(acc);
            } catch (Exception e) {
                return "";
            }
        }
    }
}

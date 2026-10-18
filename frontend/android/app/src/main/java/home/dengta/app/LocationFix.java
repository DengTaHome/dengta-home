package home.dengta.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;
import java.util.function.BooleanSupplier;

/**
 * 外卖/登录页定位修复（对应 ai-order-takeout 坑十五：无 GMS 手机 WebView 定位必然失败，
 * 页面拿不到位置会走异常路径）。方案：document-start 注入 JS mock geolocation，
 * 坐标从系统 LocationManager 取真实位置（权限已授权），页面正常按账号附近展示店铺。
 */
public final class LocationFix {
    private static final String MOCK_SCRIPT =
        "(function(){"
        + "try{"
        + "if(window.top!==window){return;}var b=window.DengTaLocation;if(!b||typeof b.postMessage!=='function'){return;}"
        + "function fix(v){"
        + "if(!v||v.indexOf(',')<0){return null;}"
        + "var p=v.split(',');"
        + "if(p.length<3||!p[0].trim()||!p[1].trim()){return null;}"
        + "var lat=Number(p[0]),lng=Number(p[1]),accuracy=Number(p[2]);"
        + "if(!isFinite(lat)||!isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){return null;}"
        + "return {coords:{latitude:lat,longitude:lng,"
        + "accuracy:isFinite(accuracy)&&accuracy>0?accuracy:30,altitude:null,altitudeAccuracy:null,heading:null,speed:null},"
        + "timestamp:Date.now()};"
        + "}"
        + "var g=navigator.geolocation;"
        + "if(!g){return;}"
        + "if(g.__dengtaLocationInstalled){return;}g.__dengtaLocationInstalled=true;"
        + "var pending={},nextId=0;"
        + "function unavailable(error){if(typeof error==='function')setTimeout(function(){error({code:2,message:'当前位置暂不可用，请开启定位后重试。'});},0);}"
        + "b.onmessage=function(event){try{var reply=JSON.parse(event.data),item=pending[reply.id];if(!item)return;delete pending[reply.id];clearTimeout(item.timer);"
        + "var pos=fix(reply.location);if(pos){if(typeof item.success==='function')item.success(pos);}else unavailable(item.error);}catch(e){}};"
        + "function request(success,error,options){if(Object.keys(pending).length>=32){unavailable(error);return -1;}var id=++nextId;"
        + "var timeout=options&&Number(options.timeout);timeout=isFinite(timeout)&&timeout>0?Math.min(timeout,10000):10000;"
        + "var item={success:success,error:error};pending[id]=item;item.timer=setTimeout(function(){if(pending[id]){delete pending[id];unavailable(error);}},timeout);"
        + "try{b.postMessage(String(id));}catch(e){clearTimeout(item.timer);delete pending[id];unavailable(error);}return id;}"
        + "g.getCurrentPosition=function(success,error,options){request(success,error,options);};"
        + "g.watchPosition=function(success,error,options){return request(success,error,options);};"
        + "g.clearWatch=function(id){var item=pending[id];if(item){clearTimeout(item.timer);delete pending[id];}};"
        + "}catch(e){}"
        + "})();";

    @SuppressLint("WebViewApiAvailability")
    public static boolean apply(WebView webView, BooleanSupplier accountCurrent) {
        if (webView == null || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false;
        try {
            WebViewCompat.addWebMessageListener(webView, "DengTaLocation", BrowserLocationPolicy.ORIGIN_RULES,
                (view, message, sourceOrigin, isMainFrame, reply) -> {
                    if (message.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING) return;
                    String id = message.getData();
                    if (id == null || !id.matches("[1-9][0-9]{0,9}") || !accountCurrent.getAsBoolean() ||
                        !BrowserLocationPolicy.mayReadBridge(view.getUrl(), sourceOrigin.toString(), isMainFrame, hasPermission(view.getContext()))) return;
                    try { reply.postMessage(new JSONObject().put("id", Long.parseLong(id)).put("location", readLocation(view.getContext())).toString()); }
                    catch (Exception ignored) {}
                });
        } catch (Exception ignored) { return false; }
        // document-start 注入（部分 WebView/厂商不支持，失败时由 onPageStarted 兜底注入）。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(
                    webView, MOCK_SCRIPT, BrowserLocationPolicy.ORIGIN_RULES
                );
            } catch (Exception ignored) {
            }
        }
        return true;
    }

    /** 兜底：在 onPageStarted 时尽早注入 mock（在页面业务脚本执行前覆盖 geolocation）。 */
    public static void injectMock(WebView webView) {
        if (webView == null || !BrowserLocationPolicy.isTrustedPage(webView.getUrl())) return;
        try {
            webView.evaluateJavascript(MOCK_SCRIPT, null);
        } catch (Exception ignored) {
        }
    }

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }
    /** Read only after the authenticated, same-origin main-frame message passed the policy. */
    private static String readLocation(Context context) {
            try {
                if (!hasPermission(context)) return "";
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

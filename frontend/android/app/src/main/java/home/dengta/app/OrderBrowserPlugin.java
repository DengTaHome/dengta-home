package home.dengta.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.location.Location;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONArray;
import java.util.UUID;

/**
 * 外卖执行器（多用户手机版）：
 * - openLogin：打开外卖 H5 让用户扫码登录（Cookie 存本机 WebView，二次免扫码）；
 * - searchShops：搜索店铺并提取结构化列表；
 * - orderProduct：按店名+商品名加购并进入购物车/结算页，用户在页面上人工确认付款。
 */
@CapacitorPlugin(name = "OrderBrowser")
public final class OrderBrowserPlugin extends Plugin {
    static final String SEARCH_RESULT_ACTION = "home.dengta.app.ORDER_SEARCH_RESULT";
    private final OrderSearchRequests searchRequests = new OrderSearchRequests();
    private final Handler searchHandler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver searchReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!SEARCH_RESULT_ACTION.equals(intent.getAction())) return;
            searchRequests.finish(intent.getStringExtra("request_id"), intent.getStringExtra("result"), intent.getStringExtra("error"));
        }
    };

    @Override public void load() {
        ContextCompat.registerReceiver(getContext(), searchReceiver, new IntentFilter(SEARCH_RESULT_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    static void publishSearchResult(Context context, String id, String result, String error) {
        Intent receipt = new Intent(SEARCH_RESULT_ACTION).setPackage(context.getPackageName());
        receipt.putExtra("request_id", id);
        receipt.putExtra("result", result);
        receipt.putExtra("error", error);
        context.sendBroadcast(receipt);
    }

    @PluginMethod public void cancelSearch(PluginCall call) {
        searchRequests.cancelScope(call.getString("scope", ""));
        call.resolve();
    }

    static String technicalErrorMessage(String code) {
        if (code != null && code.startsWith("browser_account_")) return BrowserSessionSupport.accountErrorMessage(code);
        if ("takeout_page_init_failed".equals(code)) return "外卖页面初始化失败，自动操作已停止。请手动返回后重试。";
        if ("takeout_page_renderer_failed".equals(code)) return "外卖页面渲染进程已退出，自动操作已停止。请手动返回后重试。";
        if ("takeout_page_load_failed".equals(code)) return "当前外卖网页未能加载，自动操作已停止。可以恢复网页并手动核对网络、登录和购物车。";
        if ("takeout_page_interrupted".equals(code)) return "外卖页面已重新打开，自动操作已停止。请先手动核对，再返回重试。";
        return null;
    }

    private void withAccount(PluginCall call, java.util.function.Consumer<BrowserAccountScope.Binding> action) {
        getActivity().runOnUiThread(() -> {
            try {
                BrowserAccountScope.Binding binding = BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", ""));
                BrowserSessionSupport.requireAccountProfiles();
                action.accept(binding);
            } catch (RuntimeException error) {
                String code = BrowserSessionSupport.accountErrorCode(error);
                call.reject(BrowserSessionSupport.accountErrorMessage(code), code);
            }
        });
    }

    private JSObject searchReceipt(String raw) throws Exception {
        JSONObject parsed = new JSONObject(raw);
        String status = parsed.optString("status", "done");
        if (!java.util.Arrays.asList("done", "verification", "logged_out", "error", "shop_not_found").contains(status)) status = "error";
        JSObject result = new JSObject().put("status", status).put("loading", parsed.optBoolean("loading", false));
        String code = BrowserSessionSupport.publicTakeoutSearchErrorCode(status, parsed.optString("code", ""));
        if (!code.isEmpty()) result.put("code", code);
        JSONArray shops = new JSONArray();
        JSONArray incoming = parsed.optJSONArray("shops");
        if (incoming != null) for (int index = 0; index < Math.min(20, incoming.length()); index++) {
            JSONObject shop = incoming.optJSONObject(index);
            if (shop == null) continue;
            String name = shop.optString("name", ""), meta = shop.optString("meta", "");
            shops.put(new JSONObject().put("name", name.substring(0, Math.min(40, name.length()))).put("meta", meta.substring(0, Math.min(240, meta.length()))));
        }
        result.put("shops", shops);
        return result;
    }

    @Override protected void handleOnDestroy() {
        searchRequests.cancelAll();
        searchHandler.removeCallbacksAndMessages(null);
        try { getContext().unregisterReceiver(searchReceiver); } catch (Exception ignored) {}
    }

    // 外卖平台登录状态：读 WebView CookieStore 里的饿了么登录 Cookie。
    @PluginMethod
    public void getLoginState(PluginCall call) {
        withAccount(call, binding -> {
            CookieManager cookies = BrowserSessionSupport.accountCookies(binding);
            String cookie = cookies.getCookie("https://h5.ele.me");
            boolean hasCookie = cookie != null && !cookie.isEmpty();
            // Presence is only a local credential hint, never proof the platform still accepts the session.
            boolean loggedIn = BrowserSessionSupport.hasAuthenticationCookie(cookie);
            BrowserSessionSupport.persistCookies(cookies);
            JSObject out = new JSObject();
            out.put("loggedIn", loggedIn);
            out.put("hasCookie", hasCookie);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void openLogin(PluginCall call) {
        String url = call.getString("url", "https://h5.ele.me/msite/");
        // 改用登录态长住的内置浏览器：扫码登录一次后 Cookie 持久化，
        // 之后的搜索/点单页自动带登录态（同一个 WebView CookieStore）。
        // 注意：必须同任务内启动（startActivityForResult），
        // NEW_TASK + context.startActivity 在新任务中会被 vivo 秒杀（"跳转1秒被取消"）。
        withAccount(call, binding -> { try {
            Intent browser = new Intent(getContext(), PersistentBrowserActivity.class);
            browser.putExtra("url", url);
            browser.putExtra("title", "外卖平台登录");
            browser.putExtra("site", "eleme");
            browser.putExtra("desktop", false);
            browser.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
            startActivityForResult(call, browser, "browserLoginResult");
        } catch (Exception error) {
            call.reject("无法打开外卖登录页。");
        } });
    }

    @ActivityCallback
    private void browserLoginResult(PluginCall call, ActivityResult result) {
        try { BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", "")); }
        catch (RuntimeException error) { String code = BrowserSessionSupport.accountErrorCode(error); call.reject(BrowserSessionSupport.accountErrorMessage(code), code); return; }
        if (result.getData() != null && result.getData().hasExtra("code")) {
            String code = result.getData().getStringExtra("code");
            String message = code != null && code.startsWith("browser_account_")
                ? BrowserSessionSupport.accountErrorMessage(code) : BrowserSessionSupport.browserErrorMessage(code);
            call.reject(message, code); return;
        }
        JSObject out = new JSObject();
        out.put("opened", true);
        call.resolve(out);
    }

    @PluginMethod
    public void searchShops(PluginCall call) {
        String keyword = call.getString("keyword", "");
        if (keyword.trim().isEmpty()) {
            call.reject("缺少搜索关键词。");
            return;
        }
        withAccount(call, binding -> {
        String url = "https://h5.ele.me/minisearch/result?keyword="
            + android.net.Uri.encode(keyword.trim()) + "&from=mobile.default";
        String id = UUID.randomUUID().toString();
        Runnable timeout = () -> searchRequests.finish(id, null, "timeout");
        getBridge().saveCall(call);
        searchRequests.begin(id, call.getString("scope", ""), (result, error) -> {
            searchHandler.removeCallbacks(timeout);
            if ("timeout".equals(error)) call.resolve(new JSObject().put("status", "error").put("loading", true).put("shops", new JSONArray()));
            else if ("launch_failed".equals(error)) call.reject("外卖页面暂时无法打开。", "takeout_search_open_failed");
            else if (technicalErrorMessage(error) != null) call.reject(technicalErrorMessage(error), error);
            else if (error != null) call.reject("外卖搜索等待已取消，页面可由你手动返回。", "takeout_search_cancelled");
            else {
                try { call.resolve(searchReceipt(result)); }
                catch (Exception invalid) { call.reject("外卖搜索返回了无效结果，请在页面中核对。", "takeout_search_result_invalid"); }
            }
            getBridge().releaseCall(call);
        });
        try {
            Intent intent = new Intent(getActivity(), OrderWebActivity.class);
            intent.putExtra("url", url);
            intent.putExtra("mode", "search");
            intent.putExtra("config", "{}");
            intent.putExtra("title", "搜索：" + keyword.trim());
            intent.putExtra("request_id", id);
            intent.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
            getActivity().startActivity(intent);
            searchHandler.postDelayed(timeout, 45_000);
        } catch (Exception error) {
            searchRequests.finish(id, null, "launch_failed");
        }
        });
    }

    @PluginMethod
    public void orderProduct(PluginCall call) {
        String shopName = call.getString("shopName", "");
        String product = call.getString("product", "");
        if (shopName.trim().isEmpty() || product.trim().isEmpty()) {
            call.reject("缺少店名或商品名。");
            return;
        }
        JSONObject config = new JSONObject();
        try {
            config.put("shop_name", shopName.trim());
            config.put("product", product.trim());
            config.put("quantity", Math.max(1, Math.min(20, call.getInt("quantity", 1))));
        } catch (Exception ignored) {}
        String url = "https://h5.ele.me/minisearch/result?keyword="
            + android.net.Uri.encode(shopName.trim()) + "&from=mobile.default";
        startOrderActivity(call, url, "order", config.toString(), "点单：" + product.trim());
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        JSObject out = new JSObject();
        try {
            LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            Location last = null;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    Location candidate = manager.getLastKnownLocation(provider);
                    if (candidate != null) { last = candidate; break; }
                } catch (Exception ignored) {}
            }
            if (last != null) {
                out.put("latitude", last.getLatitude());
                out.put("longitude", last.getLongitude());
                out.put("accuracy", last.hasAccuracy() ? last.getAccuracy() : 60);
            } else {
                out.put("latitude", JSONObject.NULL);
                out.put("longitude", JSONObject.NULL);
            }
        } catch (Exception ignored) {
            out.put("latitude", JSONObject.NULL);
            out.put("longitude", JSONObject.NULL);
        }
        call.resolve(out);
    }

    private void startOrderActivity(PluginCall call, String url, String mode, String config, String title) {
        if (call == null) return;
        withAccount(call, binding -> { try {
            Intent intent = new Intent(getContext(), OrderWebActivity.class);
            intent.putExtra("url", url);
            intent.putExtra("mode", mode);
            intent.putExtra("config", config);
            intent.putExtra("title", title);
            intent.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
            if (call != null) {
                // 必须同任务内启动：带 FLAG_ACTIVITY_NEW_TASK 时
                // startActivityForResult 会立即返回 RESULT_CANCELED，
                // 导致"外卖搜索被取消"的假失败（页面其实还开着）。
                startActivityForResult(call, intent, "orderResult");
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        } catch (Exception error) {
            // 页面打不开时不要崩掉整个 App,直接按失败回给调用方。
            if (call != null) {
                call.reject("外卖页面暂时无法打开。");
            }
        } });
    }

    @ActivityCallback
    private void orderResult(PluginCall call, ActivityResult result) {
        try { BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", "")); }
        catch (RuntimeException error) { String code = BrowserSessionSupport.accountErrorCode(error); call.reject(BrowserSessionSupport.accountErrorMessage(code), code); return; }
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String resultJson = result.getData().getStringExtra("result");
            try {
                call.resolve(new JSObject(resultJson));
            } catch (Exception error) {
                call.reject("执行结果格式不正确。");
            }
        } else if (result.getResultCode() == Activity.RESULT_CANCELED) {
            String message = result.getData() != null ? result.getData().getStringExtra("message") : null;
            call.reject(message != null ? message : "用户取消了操作。");
        } else {
            call.reject("执行失败。");
        }
    }
}

package home.dengta.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.activity.result.ActivityResult;

/**
 * 内置浏览器（登录态长住）：打开独立 WebView 浏览器，登录后提取登录态 Cookie
 * 供 AI 侧复用（网易云 / B站 / 小红书 / 外卖等）。
 */
@CapacitorPlugin(name = "BrowserLauncher")
public final class BrowserLauncherPlugin extends Plugin {

    @PluginMethod
    public void setAccount(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                BrowserSessionSupport.ACCOUNTS.bind(call.getString("accountScope", ""));
                call.resolve(new JSObject().put("supported", BrowserSessionSupport.supportsAccountProfiles()));
            } catch (RuntimeException error) { rejectAccount(call, error); }
        });
    }

    private void rejectAccount(PluginCall call, Throwable error) {
        String code = BrowserSessionSupport.accountErrorCode(error);
        call.reject(BrowserSessionSupport.accountErrorMessage(code), code);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "");
        String title = call.getString("title", "");
        String site = call.getString("site", "");
        String mode = call.getString("mode", "");
        boolean desktop = call.getBoolean("desktop", false);
        if (url.isEmpty()) {
            call.reject("缺少打开地址。");
            return;
        }
        getActivity().runOnUiThread(() -> { try {
            BrowserAccountScope.Binding binding = BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", ""));
            BrowserSessionSupport.requireAccountProfiles();
            BrowserAccountScope.storageKey(binding, site);
            Intent intent = new Intent(getContext(), PersistentBrowserActivity.class);
            intent.putExtra("url", url);
            intent.putExtra("title", title);
            intent.putExtra("site", site);
            intent.putExtra("mode", mode);
            intent.putExtra("desktop", desktop);
            intent.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
            startActivityForResult(call, intent, "browserResult");
        } catch (IllegalArgumentException | IllegalStateException error) {
            rejectAccount(call, error);
        } catch (Exception error) {
            call.reject("无法打开内置浏览器。");
        } });
    }

    // 读取某个站点已提取的登录态 Cookie（base64 解码）。
    @PluginMethod
    public void getCookie(PluginCall call) {
        String site = call.getString("site", "");
        if (site.isEmpty()) {
            call.reject("缺少站点标识。");
            return;
        }
        getActivity().runOnUiThread(() -> { try {
        BrowserAccountScope.Binding binding = BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", ""));
        BrowserSessionSupport.requireAccountProfiles();
        String key = BrowserAccountScope.storageKey(binding, site);
        SharedPreferences prefs = PersistentBrowserActivity.prefs(getContext());
        String encoded = prefs.getString(key, "");
        if (encoded.isEmpty()) {
            JSObject out = new JSObject();
            out.put("cookie", "");
            out.put("url", "");
            call.resolve(out);
            return;
        }
        try {
            String cookie = new String(Base64.decode(encoded, Base64.NO_WRAP), "UTF-8");
            JSObject out = new JSObject();
            out.put("cookie", cookie);
            out.put("url", prefs.getString(key + "_url", ""));
            call.resolve(out);
        } catch (Exception error) {
            call.reject("登录态解码失败。");
        }
        } catch (RuntimeException error) { rejectAccount(call, error); } });
    }

    @ActivityCallback
    private void browserResult(PluginCall call, ActivityResult result) {
        try { BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", "")); }
        catch (RuntimeException error) { rejectAccount(call, error); return; }
        if (result.getResultCode() == android.app.Activity.RESULT_OK && result.getData() != null) {
            String resultJson = result.getData().getStringExtra("result");
            JSObject out = new JSObject();
            if (resultJson != null) {
                try {
                    out.put("result", new org.json.JSONObject(resultJson));
                } catch (Exception ignored) {
                    out.put("result", resultJson);
                }
            }
            out.put("opened", true);
            call.resolve(out);
        } else if (result.getResultCode() == android.app.Activity.RESULT_CANCELED) {
            String message = result.getData() != null ? result.getData().getStringExtra("message") : null;
            String code = result.getData() != null ? result.getData().getStringExtra("code") : null;
            call.reject(message != null ? message : "用户关闭了内置浏览器。", code);
        } else {
            call.reject("内置浏览器已关闭。");
        }
    }
}

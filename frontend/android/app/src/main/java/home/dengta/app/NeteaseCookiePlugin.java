package home.dengta.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NeteaseCookie")
public final class NeteaseCookiePlugin extends Plugin {
    private static final String PREFS = "dengta_netease_cookie";
    private static final long WAIT_DEADLINE_MS = 6L * 60L * 1000L;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void openLogin(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), NeteaseCookieActivity.class);
            intent.putExtra("desktop", call.getBoolean("desktop", false));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception error) {
            call.reject("无法打开网易云登录页。");
            return;
        }
        // 原生后台线程等待登录页写入 Cookie（不依赖 Activity 结果通道，更稳定）
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + WAIT_DEADLINE_MS;
            String cookie = "";
            boolean cancelled = false;
            while (System.currentTimeMillis() < deadline) {
                SharedPreferences prefs = prefs(getContext());
                String state = prefs.getString("state", "");
                if ("cancelled".equals(state)) {
                    cancelled = true;
                    break;
                }
                String value = prefs.getString("cookie", "");
                if (value != null && !value.isEmpty()) {
                    cookie = value;
                    break;
                }
                try {
                    Thread.sleep(800);
                } catch (InterruptedException error) {
                    cancelled = true;
                    break;
                }
            }
            final String resultCookie = cookie;
            final boolean resultCancelled = cancelled;
            getActivity().runOnUiThread(() -> {
                SharedPreferences prefs = prefs(getContext());
                prefs.edit().remove("cookie").remove("state").apply();
                if (!resultCookie.isEmpty()) {
                    JSObject out = new JSObject();
                    out.put("cookie", resultCookie);
                    out.put("hasSession", resultCookie.contains("MUSIC_U"));
                    call.resolve(out);
                } else if (resultCancelled) {
                    call.reject("用户取消了登录。");
                } else {
                    call.reject("等待登录超时，请重新尝试。");
                }
            });
        }).start();
    }
}

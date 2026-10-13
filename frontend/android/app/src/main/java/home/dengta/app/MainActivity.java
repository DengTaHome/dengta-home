package home.dengta.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DengTaMainActivity";
    private boolean rendererRecoveryScheduled = false;
    private long lastBackPressAt = 0L;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundNotificationsPlugin.class);
        registerPlugin(DeviceActivityPlugin.class);
        registerPlugin(DeviceSignalsPlugin.class);
        registerPlugin(WhereaboutsPlugin.class);
        registerPlugin(NeteaseCookiePlugin.class);
        registerPlugin(ScreenGlancePlugin.class);
        registerPlugin(NeteasePlaybackPlugin.class);
        registerPlugin(OrderBrowserPlugin.class);
        registerPlugin(BrowserLauncherPlugin.class);
        registerPlugin(DlnaReceiverPlugin.class);
        registerPlugin(VideoExtractorPlugin.class);
        super.onCreate(savedInstanceState);
        configureStableWebView();
        PushNotificationWorker.ensureNotificationChannel(this);
        PushNotificationWorker.schedule(this);
        PushNotificationWorker.markAppVisible(this);
        // 返回键体验：第一次按返回只是退到后台（进程保留，再打开秒回、不重新加载）；
        // 2 秒内再按一次才真正退出 App。避免误触返回导致冷启动。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                long now = System.currentTimeMillis();
                if (now - lastBackPressAt > 2000L) {
                    lastBackPressAt = now;
                    Toast.makeText(MainActivity.this, "再按一次返回键退出", Toast.LENGTH_SHORT).show();
                    moveTaskToBack(true);
                    return;
                }
                setEnabled(false);
                MainActivity.super.onBackPressed();
            }
        });
    }

    private void configureStableWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
        // 启动随机播放等场景允许无手势自动播放（内置播放器/后台音乐）。
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new DengTaFileBridge(this), "DengTaFileBridge");
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView crashedView, RenderProcessGoneDetail detail) {
                Log.e(
                    TAG,
                    "WebView renderer exited; scheduling a safe activity restart. didCrash="
                        + detail.didCrash()
                );
                if (!rendererRecoveryScheduled) {
                    rendererRecoveryScheduled = true;
                    crashedView.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            recreate();
                        }
                    });
                }
                return true;
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        PushNotificationWorker.markAppVisible(this);
        // 启动随机播放等场景需要无手势自动播放；Capacitor 可能在初始化时重设设置，这里再强调一次。
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onPause() {
        PushNotificationWorker.markAppVisible(this);
        super.onPause();
    }
}

package home.dengta.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public class NeteaseCookieActivity extends Activity {
    private WebView webView;
    private static final String NETEASE_PACKAGE = "com.netease.cloudmusic";
    private static final String H5_HOME = "https://y.music.163.com/m/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            onCreateGuarded(savedInstanceState);
        } catch (Throwable error) {
            markCancelled();
            finish();
        }
    }

    private void onCreateGuarded(Bundle savedInstanceState) {
        boolean desktopMode = getIntent().getBooleanExtra("desktop", false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        TextView header = new TextView(this);
        header.setText(desktopMode ? "网易云电脑版登录（双指可放大扫码，登录后点下方保存）" : "网易云登录（登录后点下方保存）");
        header.setPadding(24, 20, 24, 10);
        root.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        if (desktopMode) {
            // 电脑桌面版：桌面 UA 加载 music.163.com，页面带扫码登录；
            // 二维码区域支持双指缩放放大后方便用另一台手机扫。
            settings.setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
            settings.setSupportZoom(true);
            settings.setBuiltInZoomControls(true);
            settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
        } else {
            settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36");
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeExternalUrl(view, url);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                return true;
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);

        Button openApp = new Button(this);
        openApp.setText("打开App");
        openApp.setOnClickListener(v -> openInNeteaseApp(webView != null ? webView.getUrl() : ""));
        actions.addView(openApp, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button done = new Button(this);
        done.setText("保存登录");
        done.setOnClickListener(v -> {
            String cookie = "";
            try {
                cookie = CookieManager.getInstance().getCookie("https://music.163.com");
            } catch (Exception ignored) {
                cookie = "";
            }
            if (cookie == null || !cookie.contains("MUSIC_U")) {
                Toast.makeText(this, "还没有登录成功（缺少 MUSIC_U），请先在页面登录", Toast.LENGTH_LONG).show();
                return;
            }
            NeteaseCookiePlugin.prefs(this)
                .edit()
                .putString("cookie", cookie)
                .putString("state", "saved")
                .apply();
            Intent data = new Intent();
            data.putExtra("cookie", cookie);
            setResult(Activity.RESULT_OK, data);
            finish();
        });
        actions.addView(done, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(actions, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button cancel = new Button(this);
        cancel.setText("取消");
        cancel.setOnClickListener(v -> {
            markCancelled();
            finish();
        });
        root.addView(cancel, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        SafeWindow.apply(this, root);
        webView.loadUrl(desktopMode ? "https://music.163.com/" : H5_HOME);
    }

    private void markCancelled() {
        try {
            NeteaseCookiePlugin.prefs(this).edit().putString("state", "cancelled").apply();
        } catch (Exception ignored) {}
    }

    private boolean routeExternalUrl(WebView view, String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        if (lower.startsWith("http://")) {
            view.loadUrl("https://" + url.substring(7));
            return true;
        }

        if (lower.startsWith("intent://")) {
            return launchIntentUri(url);
        }
        if (lower.startsWith("orpheus://") ||
            lower.startsWith("music163://") ||
            lower.startsWith("cn.netease.music://") ||
            lower.startsWith("netease-cloudmusic://") ||
            lower.startsWith("market://") ||
            lower.contains("/m/app") ||
            lower.contains("/web/app")) {
            return launchExternal(url, NETEASE_PACKAGE);
        }
        return false;
    }

    private boolean launchIntentUri(String url) {
        try {
            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            String pkg = intent.getPackage();
            if (pkg == null || pkg.isEmpty()) intent.setPackage(NETEASE_PACKAGE);
            startActivity(intent);
            return true;
        } catch (Exception error) {
            return launchExternal(url, NETEASE_PACKAGE);
        }
    }

    private boolean launchExternal(String url, String pkg) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (pkg != null && !pkg.isEmpty()) intent.setPackage(pkg);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException ignored) {
            try {
                Intent market = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("market://search?q=pname:" + NETEASE_PACKAGE));
                market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(market);
            } catch (ActivityNotFoundException ignored2) {
                Toast.makeText(this, "没有找到网易云App，请先在应用商店安装。", Toast.LENGTH_LONG).show();
            }
            return true;
        }
    }

    private void openInNeteaseApp(String currentUrl) {
        String target = currentUrl;
        if (currentUrl != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("[?&]id=(\\d{1,20})")
                .matcher(currentUrl);
            if (m.find()) {
                target = "orpheus://song/?id=" + m.group(1);
            }
        }
        if (target == null || target.isEmpty() || !target.startsWith("orpheus://")) {
            target = "orpheus://";
        }
        launchExternal(target, NETEASE_PACKAGE);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        markCancelled();
        super.onBackPressed();
    }
}

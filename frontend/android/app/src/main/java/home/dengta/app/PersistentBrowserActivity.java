package home.dengta.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * 登录态长住的内置浏览器（参考桌面端"独立 Chrome 配置目录 + CDP"思路的 Android 版）：
 * - 独立的 WebView 浏览器，Cookie 持久化在 App 私有存储；会话有效期由站点决定；
 * - 不碰用户日常浏览器；
 * - 双指缩放 + 移动/桌面 UA 切换；
 * - 按站点一键"提取登录态"，交给 AI 侧（网易云/B站/小红书等）复用；
 * - 外卖搜索模式：加载搜索页后可注入 JS 提取店铺列表回传。
 */
public final class PersistentBrowserActivity extends Activity {
    private static final String PREFS = "dengta_browser_sessions";

    private WebView webView;
    private CookieManager accountCookies;
    private BrowserAccountScope.Binding accountBinding;
    private final Runnable accountChanged = () -> {
        if (!BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding) && !isFinishing() && !isDestroyed()) showPageError("browser_account_changed");
    };
    private String site = "";
    private String currentUrl = "";
    private boolean desktopUa = false;
    private boolean resultReady = false;
    private String pageErrorCode = "";

    static SharedPreferences prefs(android.content.Context context) {
        return context.getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent intent = getIntent();
            Uri link = intent == null ? null : intent.getData();
            currentUrl = link != null ? String.valueOf(link.getQueryParameter("url")) : intent.getStringExtra("url");
            // Only an unguessable, one-use ticket issued inside the bridge can select a profile.
            accountBinding = link == null ? savedInstanceState == null
                ? BrowserSessionSupport.ACCOUNTS.consume(intent.getStringExtra(BrowserSessionSupport.REQUEST_TICKET))
                : BrowserSessionSupport.ACCOUNTS.restore(savedInstanceState.getString(BrowserSessionSupport.RESTORE_TICKET)) : null;
            if (accountBinding == null) { showPageError(savedInstanceState == null ? "browser_account_required" : "browser_account_restore_required"); return; }
            BrowserSessionSupport.ACCOUNTS.addListener(accountChanged);
            onCreateGuarded(savedInstanceState, null);
        } catch (IllegalArgumentException | IllegalStateException error) {
            showPageError(BrowserSessionSupport.accountErrorCode(error));
        } catch (Throwable error) {
            showPageError("browser_page_init_failed");
        }
    }

    private void onCreateGuarded(Bundle savedInstanceState, String retryUrl) {
        BrowserSessionSupport.ACCOUNTS.requireCurrent(accountBinding);
        BrowserSessionSupport.requireAccountProfiles();
        Intent intent = getIntent();
        String url = String.valueOf(intent.getStringExtra("url") == null ? "" : intent.getStringExtra("url"));
        site = String.valueOf(intent.getStringExtra("site") == null ? "" : intent.getStringExtra("site"));
        // 支持 dengta://browser?url=...&site=... 外部 scheme 启动。
        Uri dataUri = intent.getData();
        if (dataUri != null && "dengta".equalsIgnoreCase(dataUri.getScheme()) && "browser".equalsIgnoreCase(dataUri.getHost())) {
            String queryUrl = dataUri.getQueryParameter("url");
            if (queryUrl != null && !queryUrl.isEmpty()) url = queryUrl;
            String querySite = dataUri.getQueryParameter("site");
            if (querySite != null && !querySite.isEmpty()) site = querySite;
        }
        if (url.isEmpty()) url = "https://www.bilibili.com/";
        if (savedInstanceState != null) url = savedInstanceState.getString("dengta_browser_url", url);
        if (retryUrl != null && !retryUrl.isEmpty()) url = retryUrl;
        String title = String.valueOf(intent.getStringExtra("title") == null ? "" : intent.getStringExtra("title"));
        String mode = String.valueOf(intent.getStringExtra("mode") == null ? "" : intent.getStringExtra("mode"));
        desktopUa = intent.getBooleanExtra("desktop", false);
        if (savedInstanceState != null) desktopUa = savedInstanceState.getBoolean("dengta_browser_desktop", desktopUa);
        currentUrl = url;
        pageErrorCode = "";
        resultReady = false;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(12, 10, 12, 10);

        TextView titleText = new TextView(this);
        titleText.setText((title.isEmpty() ? "内置浏览器" : title) + "（当前灯塔账号独立登录）");
        titleText.setTextSize(14);
        titleText.setMaxLines(1);
        bar.addView(titleText, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button back = new Button(this);
        back.setText("返回");
        back.setOnClickListener(v -> onBackPressed());
        bar.addView(back, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button uaToggle = new Button(this);
        uaToggle.setText(desktopUa ? "桌面版" : "移动版");
        uaToggle.setOnClickListener(v -> {
            desktopUa = !desktopUa;
            uaToggle.setText(desktopUa ? "桌面版" : "移动版");
            applyUa(desktopUa);
            if (!currentUrl.isEmpty()) webView.loadUrl(currentUrl);
        });
        bar.addView(uaToggle, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button extract = new Button(this);
        extract.setText("提取登录态");
        extract.setOnClickListener(v -> extractCookie());
        bar.addView(extract, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        accountCookies = BrowserSessionSupport.attachAccount(webView, accountBinding);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        applyUa(desktopUa);
        accountCookies.setAcceptCookie(true);
        accountCookies.setAcceptThirdPartyCookies(webView, true);
        // 无 GMS 手机 WebView 定位必失败：注入 mock geolocation（真实坐标），外卖等页面才能正常按附近展示。
        if (!LocationFix.apply(webView, () -> BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) && BrowserLocationPolicy.isTrustedPage(url))
            Toast.makeText(this, "当前系统 WebView 不支持安全定位，请更新 WebView，或在外卖 App 中手动选择地址。", Toast.LENGTH_LONG).show();
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                android.webkit.GeolocationPermissions.Callback callback
            ) {
                // The native prompt does not identify subframes; use the origin-aware main-frame bridge instead.
                callback.invoke(origin, false, false);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (view != webView || isFinishing() || isDestroyed()) return;
                currentUrl = url;
                // document-start 注入不可靠时的兜底：页面加载早期覆盖 geolocation。
                LocationFix.injectMock(view);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(view, url, false);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(view, request.getUrl().toString(),
                    BrowserSessionSupport.mayOpenExternalNavigation(request.hasGesture(), request.isForMainFrame()));
            }

            private boolean handleNavigation(WebView view, String url, boolean userRequestedExternal) {
                if (view != webView || isFinishing() || isDestroyed()) return true;
                if (url == null) return false;
                String lower = url.toLowerCase();
                if (lower.startsWith("http://")) {
                    view.loadUrl("https://" + url.substring(7));
                    return true;
                }
                if (lower.startsWith("https://") || lower.startsWith("about:")) {
                    currentUrl = url;
                    return false;
                }
                // Timed app-promotion redirects must not pull the user out of the login window.
                if (!userRequestedExternal) return true;
                try {
                    Intent external = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(external);
                    return true;
                } catch (Exception ignored) {
                    return true;
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view != webView || isFinishing() || isDestroyed()) {
                    disposeWebView(view);
                    return true;
                }
                showPageError("browser_page_renderer_failed");
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (view == webView && BrowserSessionSupport.isCurrentNavigationFailure(request.getUrl().toString(), currentUrl, request.isForMainFrame()) && !isFinishing() && !isDestroyed()) {
                    showPageError("browser_page_load_failed");
                }
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                super.onPageFinished(view, finishedUrl);
                if (view != webView || isFinishing() || isDestroyed()) return;
                currentUrl = finishedUrl;
                LocationFix.injectMock(view);
                BrowserSessionSupport.persistCookies(accountCookies);
                if ("search".equals(mode) && !resultReady) {
                    // 外卖搜索模式：等真实店铺数据出现后自动提取（对应"等真货，别等秒数"）。
                    view.postDelayed(() -> runSearchExtract(view), 3500);
                }
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        if ("search".equals(mode)) {
            Button done = new Button(this);
            done.setText("返回店铺结果（手动完成后再点）");
            done.setOnClickListener(v -> finishWithShops());
            root.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }

        setContentView(root);
        SafeWindow.apply(this, root);
        webView.loadUrl(url);
    }

    private void applyUa(boolean desktop) {
        if (webView == null) return;
        if (desktop) {
            webView.getSettings().setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        } else {
            BrowserSessionSupport.useDeviceUserAgent(webView);
        }
    }

    private void disposeWebView(WebView view) {
        if (view == null) return;
        try {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        } catch (RuntimeException ignored) {}
        try { view.destroy(); } catch (RuntimeException ignored) {}
    }

    private void showPageError(String code) {
        pageErrorCode = code;
        WebView failed = webView;
        webView = null;
        disposeWebView(failed);
        BrowserSessionSupport.persistCookies(accountCookies);
        try {
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setPadding(24, 24, 24, 24);
            TextView message = new TextView(this);
            message.setText(BrowserSessionSupport.browserErrorMessage(code) + "\n错误代码：" + code);
            root.addView(message);
            Button retry = new Button(this);
            retry.setText("重新打开网页");
            retry.setOnClickListener(v -> {
                String retryUrl = currentUrl;
                try { onCreateGuarded(null, retryUrl); }
                catch (IllegalArgumentException | IllegalStateException error) { showPageError(BrowserSessionSupport.accountErrorCode(error)); }
                catch (Throwable ignored) { showPageError("browser_page_init_failed"); }
            });
            if (accountBinding != null && BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) root.addView(retry);
            if (code.startsWith("browser_account_")) {
                Button external = new Button(this);
                external.setText("在系统浏览器手动打开");
                external.setOnClickListener(v -> {
                    try {
                        Uri uri = Uri.parse(currentUrl == null ? "" : currentUrl);
                        if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) throw new IllegalArgumentException();
                        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (RuntimeException ignored) { Toast.makeText(this, "请在系统浏览器或平台 App 手动打开对应站点。", Toast.LENGTH_LONG).show(); }
                });
                root.addView(external);
            }
            Button close = new Button(this);
            close.setText("返回灯塔");
            close.setOnClickListener(v -> onBackPressed());
            root.addView(close);
            setContentView(root);
            SafeWindow.apply(this, root);
        } catch (Throwable ignored) {
            android.util.Log.e("PersistentBrowser", "browser_error_ui_failed");
        }
    }

    // 提取当前站点登录态 Cookie（按站点/域名过滤，base64 存入 prefs 供前端取用）。
    private void extractCookie() {
        try {
            BrowserSessionSupport.ACCOUNTS.requireCurrent(accountBinding);
            String domain = domainFor(site);
            BrowserSessionSupport.persistCookies(accountCookies);
            String cookie = accountCookies == null ? null : accountCookies.getCookie(domain);
            if (cookie == null || cookie.isEmpty()) {
                Toast.makeText(this, "这个页面还没有登录态（无 Cookie）。请先在页面里登录。", Toast.LENGTH_LONG).show();
                return;
            }
            String encoded = Base64.encodeToString(cookie.getBytes("UTF-8"), Base64.NO_WRAP);
            String key = BrowserAccountScope.storageKey(accountBinding, site);
            prefs(this).edit().putString(key, encoded).putString(key + "_url", currentUrl).apply();
            Toast.makeText(this, "当前灯塔账号的登录态已提取。回到 App 后会保存给当前账号使用。", Toast.LENGTH_LONG).show();
        } catch (IllegalArgumentException | IllegalStateException error) {
            showPageError(BrowserSessionSupport.accountErrorCode(error));
        } catch (Exception error) {
            Toast.makeText(this, "登录态提取失败，请返回后重新打开。", Toast.LENGTH_LONG).show();
        }
    }

    private String domainFor(String site) {
        if ("netease".equals(site)) return "https://music.163.com";
        if ("bilibili".equals(site)) return "https://www.bilibili.com";
        if ("xhs".equals(site) || "xiaohongshu".equals(site)) return "https://www.xiaohongshu.com";
        if ("eleme".equals(site)) return "https://h5.ele.me";
        if ("meituan".equals(site)) return "https://i.meituan.com";
        if ("twitter".equals(site) || "x".equals(site)) return "https://x.com";
        String url = currentUrl;
        try {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (host != null) return "https://" + host;
        } catch (Exception ignored) {}
        return url;
    }

    private void runSearchExtract(WebView view) {
        if (view != webView || isFinishing() || isDestroyed() || !BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) return;
        String js = "(function(){"
            + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' | ').replace(/\\s+/g,' ').trim();}"
            + "var cards=[].slice.call(document.querySelectorAll('[class*=\"card\" i],[class*=\"item\" i]'))"
            + ".map(function(e){return {t:txt(e),e:e};})"
            + ".filter(function(x){return /起送¥/.test(x.t)&&x.t.length<300;});"
            + "if(!cards.length){return {shops:[],loading:true};}"
            + "function shopName(t){"
            + "var parts=t.split('|').map(function(s){return s.trim();}).filter(Boolean);"
            + "var bad=/(起送|月售|配送|分钟|km|\\d+分|¥|\\+|商家自配送|本店|近期|人好评|好评|支持预订|预订|营业|休息|免配送费|到店|距离|评分|满\\d)/;"
            + "for(var i=0;i<parts.length;i++){if(parts[i].length>=2&&parts[i].length<=40&&!bad.test(parts[i])){return parts[i];}}"
            + "var m=t.match(/([^|]{2,40})\\s*\\|\\s*[\\d.]+\\s*\\|\\s*分/);"
            + "return m?m[1].trim():t.slice(0,40);}"
            + "return {shops:cards.slice(0,20).map(function(x){"
            + "return {name:shopName(x.t),meta:x.t.slice(0,240)};}),loading:false};"
            + "})();";
        view.evaluateJavascript(js, value -> {
            if (view != webView || isFinishing() || isDestroyed()) return;
            if (value == null || value.equals("null")) return;
            try {
                JSONObject parsed = new JSONObject(value);
                if (parsed.optBoolean("loading", false)) {
                    view.postDelayed(() -> runSearchExtract(view), 2500);
                    return;
                }
                if (!BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) return;
                prefs(this).edit().putString(BrowserAccountScope.storageKey(accountBinding, "last_shops"), parsed.toString()).apply();
            } catch (Exception ignored) {}
        });
    }

    private void finishWithShops() {
        if (!BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) { showPageError("browser_account_changed"); return; }
        SharedPreferences prefs = prefs(this);
        String shops = prefs.getString(BrowserAccountScope.storageKey(accountBinding, "last_shops"), "{\"shops\":[],\"loading\":false}");
        Intent data = new Intent();
        data.putExtra("result", shops);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        BrowserSessionSupport.persistCookies(accountCookies);
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        Intent data = new Intent();
        // 已提取过登录态：按正常结果返回，避免误报"用户关闭了内置浏览器"，
        // 前端拿到后继续读取已保存的登录态。
        boolean extracted = BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)
            && !prefs(this).getString(BrowserAccountScope.storageKey(accountBinding, site), "").isEmpty();
        if (extracted) {
            data.putExtra("result", "{\"opened\":true,\"extracted\":true}");
            setResult(Activity.RESULT_OK, data);
        } else {
            data.putExtra("message", pageErrorCode.startsWith("browser_account_") ? BrowserSessionSupport.accountErrorMessage(pageErrorCode) : "用户关闭了内置浏览器。");
            if (!pageErrorCode.isEmpty()) data.putExtra("code", pageErrorCode);
            setResult(Activity.RESULT_CANCELED, data);
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putString("dengta_browser_url", currentUrl);
        state.putBoolean("dengta_browser_desktop", desktopUa);
        if (BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) state.putString(BrowserSessionSupport.RESTORE_TICKET, BrowserSessionSupport.ACCOUNTS.issueRestoration(accountBinding));
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onPause() {
        BrowserSessionSupport.persistCookies(accountCookies);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        BrowserSessionSupport.ACCOUNTS.removeListener(accountChanged);
        BrowserSessionSupport.persistCookies(accountCookies);
        WebView current = webView;
        webView = null;
        disposeWebView(current);
        super.onDestroy();
    }
}

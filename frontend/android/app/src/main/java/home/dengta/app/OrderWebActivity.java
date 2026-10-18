package home.dengta.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.View;
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

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.Random;

/**
 * 外卖 H5 执行页 — 按《让 AI 替你点外卖》53 坑实录 1:1 复刻：
 *
 * 核心变更（对照各坑）：
 *  - 坑 8 / 30：真正能点的按钮用「真触摸打坐标」（MotionEvent 注入），
 *    不再用 element.click() 合成点击 —— 移动端 H5 按钮监听 touch 事件，
 *    JS 合成 click 页面收不到（"在收银台等于没发生"）。
 *  - 坑 40：筛店卡认「分」（评分），不再只认「起送¥」——免起送店从此不再隐身。
 *  - 坑 50：进店后检测是否「猜你喜欢」小柜台（ITEM_STICKY_CATEGORY_SCHEME），
 *    撞上就用 shopId 重建 SHOP_SCHEME 正门再进，避免进了只有六道菜的小柜台。
 *  - 坑 13：步骤间随机真人节奏 1.5s–4.2s，不当连点器。
 *  - 坑 14 / 24：正文 / DOM / 可见壳 三路认人机验证，撞上就收手交回给人。
 *  - 坑 45：click 前 elementFromPoint 验身，被压住就九宫格换落点。
 *  - 坑 46：卡身 → 卡图 → 「选规格」小钮，三重门铃。
 *  - 坑 48：掉登录认 URL（/login）与备案页脚，当场收手提示重新扫码。
 *
 * 付款永远由人在页面里亲自确认（DengTa 既有设计，与帖子"撞上就交回给人"一致）。
 */
public class OrderWebActivity extends Activity {
    private WebView webView;
    private CookieManager accountCookies;
    private BrowserAccountScope.Binding accountBinding;
    private final Runnable accountChanged = () -> {
        if (!BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding) && !isFinishing() && !isDestroyed()) showTechnicalError("browser_account_changed");
    };
    private String mode;
    private String requestId = "";
    private TextView operationStatus;
    private final OrderPageResultState resultState = new OrderPageResultState();
    private String configJson;
    private int orderStep = 0;
    private boolean automationStopped = false;
    private String technicalErrorCode = "";
    private boolean backHintShown = false;
    private String currentUrl = "";
    private int searchRetries = 0;
    private boolean enterTickPending = false;
    private long pageGeneration = 0;
    // 帖子 11 节「钱的闸」+ 14 节「截图」：
    // maxAmount<=0 表示未设上限（不拦）；quiet 表示加购完自动收手（不等人点「完成后点这里返回」）。
    private double maxAmount = -1.0;
    private boolean quietMode = false;
    private String screenshotBase64 = "";
    private final Random random = new Random();

    private static final String TAG = "OrderWebActivity";

    // 坑 13：真人节奏——每步之间 1.5s~4.2s 随机。
    // 必须 postDelayed 而非 Thread.sleep：evaluateJavascript 回调跑在主线程，sleep 会冻住 UI。
    private void slow(Runnable next) {
        if (!canAutomate()) return;
        postOnPage(webView, () -> { if (canAutomate()) next.run(); }, 1500 + random.nextInt(2701));
    }
    private void postSlow(Runnable r) {
        if (!canAutomate()) return;
        postOnPage(webView, () -> { if (canAutomate()) r.run(); }, 1500 + random.nextInt(2701));
    }

    // 坑 8 / 30：真触摸打坐标——构造 DOWN/UP 触摸序列注入 WebView。
    // 坐标是视口坐标（getBoundingClientRect 得来），WebView 全屏即视口。
    private void realTap(final float x, final float y) {
        if (!canAutomate()) return;
        try {
            final long downTime = SystemClock.uptimeMillis();
            MotionEvent down = MotionEvent.obtain(
                downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0);
            webView.dispatchTouchEvent(down);
            down.recycle();
            postOnPage(webView, () -> {
                if (!canAutomate()) return;
                try {
                    long upTime = SystemClock.uptimeMillis();
                    MotionEvent up = MotionEvent.obtain(
                        downTime, upTime, MotionEvent.ACTION_UP, x, y, 0);
                    webView.dispatchTouchEvent(up);
                    up.recycle();
                } catch (Exception ignored) {
                }
            }, 90 + random.nextInt(140)); // 按下停留：像手指，不是秒点
        } catch (Exception ignored) {
        }
    }

    // 坑 8 / 30 / 45：取元素中心视口坐标 → 落点前验身（九宫格换点）→ 真触摸。
    // js 里打标记后用这一个函数做点击。
    private void tapMarked(final String selector) {
        if (!canAutomate()) return;
        final WebView targetView = webView;
        final long generation = pageGeneration;
        String js = "(function(){"
            + "function inView(e){if(!e)return null;var r=e.getBoundingClientRect();"
            + "if(r.width<2||r.height<2)return null;return r;}"
            + "var el=document.querySelector(" + JSONObject.quote(selector) + ");"
            + "if(!el)return null;"
            + "var r=inView(el);if(!r)return null;"
            + "var width=window.innerWidth,height=window.innerHeight;"
            + "function point(x,y){if(!isFinite(x)||!isFinite(y)||!isFinite(width)||!isFinite(height)||width<=0||height<=0||x<0||y<0||x>=width||y>=height)return null;"
            + "return {x:x,y:y,viewportWidth:width,viewportHeight:height};}"
            + "/* 坑45：中央被飘带/角标压住就九宫格换点 */"
            + "var cx=r.x+r.width/2,cy=r.y+r.height/2;"
            + "var offs=[[0,0],[-0.35,-0.35],[0.35,-0.35],[-0.35,0.35],[0.35,0.35],[0,-0.4],[0,0.4],[-0.4,0],[0.4,0]];"
            + "for(var i=0;i<offs.length;i++){"
            + "var x=r.x+r.width*(0.5+offs[i][0]);var y=r.y+r.height*(0.5+offs[i][1]);"
            + "if(x<0||y<0)continue;"
            + "var top=document.elementFromPoint(x,y);"
            + "var hit=(top===el)||(el.contains(top));"
            + "if(hit){var p=point(x,y);if(p)return p;}"
            + "}"
            + "return null;"
            + "})();";
        evaluateOnPage(targetView, js, value -> {
            if (!activePage(targetView, generation)) return;
            try {
                JSONObject pos = new JSONObject(String.valueOf(value));
                float[] nativePoint = BrowserSessionSupport.nativeTouchPoint(pos.getDouble("x"), pos.getDouble("y"),
                    pos.getDouble("viewportWidth"), pos.getDouble("viewportHeight"), targetView.getWidth(), targetView.getHeight());
                if (nativePoint == null) throw new IllegalArgumentException("invalid_touch_point");
                realTap(nativePoint[0], nativePoint[1]);
            } catch (Exception ignored) {
                finishWithResult("{\"status\":\"error\",\"code\":\"takeout_page_touch_unavailable\",\"error\":\"目标按钮暂不可点击或坐标尚未就绪，已停止自动操作，请在当前页面手动处理。\"}");
            }
        });
    }

    // 坑 14 / 24：三路认人机验证——正文正则 / DOM 选择器 / 可见壳（display:none 的壳不算）
    private void checkVerification(Runnable next) {
        if (!canAutomate()) return;
        String js = "(function(){"
            + "var t=document.body.innerText||'';"
            + "/* 只认验证专用句式，避免正文偶带“验证码”字样误报（坑 14 / 24） */"
            + "var re=/请选择符合描述|拖动滑块|向右滑动|滑动验证|拖拽下方滑块|完成拼图|人机验证|安全验证通过前|验证码已发送到|图形验证码/i;"
            + "if(re.test(t))return {verify:true,path:'text'};"
            + "var el=document.querySelector('#baxia-dialog,.nc-container,.nc_wrapper,#aliyunCaptcha,[id*=\"captcha\"],[class*=\"captcha\"],iframe[src*=\"punish\"],iframe[src*=\"captcha\"],iframe[src*=\"baxia\"]');"
            + "if(el&&el.getBoundingClientRect){var r=el.getBoundingClientRect();"
            + "if(r.width>60&&r.height>30){return {verify:true,path:'dom'};}"
            + "}"
            + "return {verify:false};"
            + "})();";
        evaluateOnPage(webView, js, value -> {
            if (!canAutomate()) return;
            boolean verified = false;
            if (value != null && !value.equals("null") && !String.valueOf(value).contains("verify:false")) {
                try {
                    JSONObject o = new JSONObject(String.valueOf(value));
                    verified = o.optBoolean("verify", false);
                } catch (Exception ignored) {
                }
            }
            if (verified) {
                finishWithResult("{\"status\":\"verification\",\"error\":\"页面弹出人机验证，已停手等你处理：请在页面里手动完成滑动/点选验证后，再点页面底部的「完成后点这里返回」。\"}");
            } else if (next != null) {
                next.run();
            }
        });
    }

    private void checkLoginState(Runnable next) {
        if (!canAutomate()) return;
        checkLoginState(next, 0, webView, pageGeneration);
    }

    private void checkLoginState(Runnable next, int attempt, WebView targetView, long generation) {
        if (!activePage(targetView, generation)) return;
        evaluateOnPage(targetView, BrowserSessionSupport.LOGIN_STATE_SCRIPT, value -> {
            if (!activePage(targetView, generation)) return;
            String state = "unknown";
            try { state = new JSONObject(String.valueOf(value)).optString("state", "unknown"); }
            catch (Exception ignored) {}
            BrowserSessionSupport.LoginDecision decision = BrowserSessionSupport.loginDecision(state, attempt);
            if (decision == BrowserSessionSupport.LoginDecision.REQUIRED) {
                finishWithResult("{\"status\":\"logged_out\",\"error\":\"页面需要登录，已停止自动操作。请在当前页面登录后手动返回。\"}");
            } else if (decision == BrowserSessionSupport.LoginDecision.WAIT) {
                postOnPage(targetView, () -> checkLoginState(next, attempt + 1, targetView, generation), 500);
            } else if (decision == BrowserSessionSupport.LoginDecision.NOT_READY) {
                finishWithResult("{\"status\":\"error\",\"code\":\"takeout_page_not_ready\",\"error\":\"页面仍未加载完整，未执行后续自动操作。请检查网络并在当前页面手动操作。\"}");
            } else if (next != null) {
                next.run();
            }
        });
    }

    private boolean activePage(WebView targetView, long generation) {
        return targetView == webView && generation == pageGeneration && canAutomate();
    }

    private void postOnPage(WebView target, Runnable action, long delay) {
        long generation = pageGeneration;
        target.postDelayed(() -> { if (activePage(target, generation)) action.run(); }, delay);
    }

    private void evaluateOnPage(WebView target, String script, android.webkit.ValueCallback<String> callback) {
        long generation = pageGeneration;
        if (!activePage(target, generation)) return;
        target.evaluateJavascript(script, value -> { if (activePage(target, generation)) callback.onReceiveValue(value); });
    }

    private boolean hasScriptStatus(String value, String expected) {
        try { return expected.equals(new JSONObject(String.valueOf(value)).optString("status")); }
        catch (Exception ignored) { return false; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Intent intent = getIntent();
            mode = intent == null ? "" : intent.getStringExtra("mode");
            requestId = intent == null ? "" : intent.getStringExtra("request_id");
            currentUrl = savedInstanceState == null ? intent == null ? "" : intent.getStringExtra("url") : savedInstanceState.getString("dengta_order_url", "");
            accountBinding = intent == null ? null : savedInstanceState == null
                ? BrowserSessionSupport.ACCOUNTS.consume(intent.getStringExtra(BrowserSessionSupport.REQUEST_TICKET))
                : BrowserSessionSupport.ACCOUNTS.restore(savedInstanceState.getString(BrowserSessionSupport.RESTORE_TICKET));
            if (accountBinding == null) { showTechnicalError(savedInstanceState == null ? "browser_account_required" : "browser_account_restore_required"); return; }
            BrowserSessionSupport.requireAccountProfiles();
            BrowserSessionSupport.ACCOUNTS.addListener(accountChanged);
            if (savedInstanceState != null) {
                automationStopped = savedInstanceState.getBoolean("dengta_order_automation_stopped", true);
                if (savedInstanceState.getBoolean("dengta_order_result_published", false)) resultState.markPublished();
                showTechnicalError("takeout_page_interrupted");
                return;
            }
            onCreateGuarded(savedInstanceState);
        } catch (IllegalArgumentException | IllegalStateException error) {
            showTechnicalError(BrowserSessionSupport.accountErrorCode(error));
        } catch (Throwable ignored) {
            android.util.Log.e(TAG, "takeout_page_init_failed");
            showTechnicalError("takeout_page_init_failed");
        }
    }

    private void onCreateGuarded(Bundle savedInstanceState) {
        onCreateGuarded(savedInstanceState, null);
    }

    private void onCreateGuarded(Bundle savedInstanceState, String reviewUrl) {
        String url = getIntent().getStringExtra("url");
        if (reviewUrl != null && !reviewUrl.isEmpty()) url = reviewUrl;
        // Only an official takeout page can ask for the existing system location permission.
        if (BrowserLocationPolicy.isTrustedPage(url) && !LocationFix.hasPermission(this)) {
            requestPermissions(
                new String[]{
                    android.Manifest.permission.ACCESS_FINE_LOCATION,
                    android.Manifest.permission.ACCESS_COARSE_LOCATION
                },
                1001
            );
        }
        configJson = getIntent().getStringExtra("config");
        String title = getIntent().getStringExtra("title");
        // 从 config 解析帖子 11 节的钱闸参数
        try {
            if (configJson != null && !configJson.isEmpty()) {
                JSONObject config = new JSONObject(configJson);
                if (config.has("max_amount")) {
                    maxAmount = config.optDouble("max_amount", -1.0);
                }
                quietMode = config.optBoolean("quiet", false);
            }
        } catch (Exception ignored) {
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        // 修复显示不全:根容器必须显式 MATCH_PARENT,否则 WebView 会被压扁。
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        TextView header = new TextView(this);
        header.setText(title + "（付款请在此页面人工确认）");
        header.setPadding(24, 24, 24, 12);
        root.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        operationStatus = new TextView(this);
        operationStatus.setText("search".equals(mode) ? "正在读取店铺。结果会交给 AI，页面保留到你手动返回。" : "页面由你手动返回；付款仍需你亲自确认。");
        operationStatus.setPadding(24, 8, 24, 12);
        root.addView(operationStatus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        accountCookies = BrowserSessionSupport.attachAccount(webView, accountBinding);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(false);
        // 移动端 UA + 视口适配,避免桌面版页面挤在一角。
        BrowserSessionSupport.useDeviceUserAgent(webView);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        accountCookies.setAcceptCookie(true);
        accountCookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                android.webkit.GeolocationPermissions.Callback callback
            ) {
                // Only the origin-aware main-frame bridge can read location; native prompts lack frame identity.
                callback.invoke(origin, false, false);
            }
        });
        // 无 GMS 手机 WebView 定位必失败：document-start 注入 mock geolocation（真实坐标）。
        if (!LocationFix.apply(webView, () -> BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) && BrowserLocationPolicy.isTrustedPage(url))
            android.widget.Toast.makeText(this, "当前系统 WebView 不支持安全定位，请更新 WebView，或在外卖 App 中手动选择地址。", android.widget.Toast.LENGTH_LONG).show();
        webView.addJavascriptInterface(new OrderBridge(this), "DengTaOrderBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (view != webView || isFinishing() || isDestroyed()) return;
                currentUrl = url;
                if (automationStopped) return;
                pageGeneration += 1;
                enterTickPending = false;
                // document-start 注入不可靠时的兜底：页面加载早期覆盖 geolocation。
                LocationFix.injectMock(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view != webView || isFinishing() || isDestroyed()) {
                    disposeWebView(view);
                    if (view == webView) webView = null;
                    return true;
                }
                showTechnicalError("takeout_page_renderer_failed");
                return true;
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                if (view == webView && BrowserSessionSupport.isCurrentNavigationFailure(request.getUrl().toString(), currentUrl, request.isForMainFrame()) && !isFinishing() && !isDestroyed()) showTechnicalError("takeout_page_load_failed");
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                super.onPageFinished(view, finishedUrl);
                if (view != webView || isFinishing() || isDestroyed()) return;
                currentUrl = finishedUrl;
                LocationFix.injectMock(view);
                BrowserSessionSupport.persistCookies(accountCookies);
                if (!canAutomate()) return;
                if ("search".equals(mode)) {
                    postOnPage(view, () -> runSearchStep(view), 2500);
                } else if ("order".equals(mode)) {
                    if (orderStep == 0) {
                        postOnPage(view, () -> runOrderStep(view), 2500);
                    } else if (orderStep == 1) {
                        // 坑 50：进店后先识门（小柜台→重建正门；还在搜索→再点一次；正店→选品）
                        if (!enterTickPending) {
                            enterTickPending = true;
                            postOnPage(view, () -> {
                                enterTickPending = false;
                                enterShop(view, 0);
                            }, 2000 + random.nextInt(1500));
                        }
                    }
                    // orderStep>=2：购物车/结算页
                    // 加载后执行结算价检查（帖子 11 节「钱的闸」）
                    postOnPage(view, () -> settlementCheck(), 2000 + random.nextInt(1500));
                }
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        Button done = new Button(this);
        done.setText("完成后点这里返回");
        done.setOnClickListener(v -> {
            if (!technicalErrorCode.isEmpty()) { returnToDengTa(technicalErrorResult()); return; }
            if ("search".equals(mode)) {
                if (resultState.result() == null) cancelUnreadySearch();
                else returnToDengTa(resultState.result());
                return;
            }
            if (resultState.result() != null) { returnToDengTa(resultState.result()); return; }
            captureScreenshot();
            String result = "{\"status\":\"awaiting_payment\",\"note\":\"用户已在页面确认\"";
            if (!screenshotBase64.isEmpty()) {
                result += ",\"screenshot\":\"" + screenshotBase64 + "\"";
            }
            result += "}";
            returnToDengTa(result);
        });
        root.addView(done, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        currentUrl = url;
        setContentView(root);
        SafeWindow.apply(this, root);
        webView.loadUrl(url);
    }

    private void runSearchStep(WebView view) {
        if (!canAutomate()) return;
        evaluateOnPage(view, BrowserSessionSupport.LOGIN_STATE_SCRIPT, value -> {
            String state = "unknown";
            try { state = new JSONObject(String.valueOf(value)).optString("state", "unknown"); } catch (Exception ignored) {}
            if ("login_required".equals(state)) finishWithResult("{\"status\":\"logged_out\",\"error\":\"当前网页需要重新登录，自动搜索已停止，页面仍保留。\"}");
            else readSearchStep(view);
        });
    }

    private void readSearchStep(WebView view) {
        if (!canAutomate()) return;
        // 坑 2：等真数据——轮询直到出现店卡身份证（"分"评分为主，起送只是可选牌子，坑 40）。
        String waitJs = "(function(){var t=document.body.innerText||'';"
            + "return /分\\s*\\|/.test(t)||/起送¥/.test(t)||t.indexOf('起送')>=0;})();";
        String js = "(function(){"
            + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' | ').replace(/\\s+/g,' ').trim();}"
            + "/* 坑 40：店卡身份证是评分「分」，起送不是必须的。 */"
            + "var cards=[].slice.call(document.querySelectorAll('[class*=\"card\" i],[class*=\"item\" i]'))"
            + ".map(function(e){return {t:txt(e),e:e};})"
            + ".filter(function(x){return /\\|\\s*[\\d.]+\\s*\\|\\s*分/.test(x.t)&&x.t.length<300;});"
            + "if(!cards.length){return {shops:[],loading:true};}"
            + "function shopName(t){"
            + "var parts=t.split('|').map(function(s){return s.trim();}).filter(Boolean);"
            + "var bad=/(起送|月售|配送|分钟|km|分|¥|\\+|商家自配送|本店|近期|人好评|好评|支持预订|预订|营业|休息|免配送费|到店|距离|评分|满\\d|蜂鸟)/;"
            + "for(var i=0;i<parts.length;i++){if(parts[i].length>=2&&parts[i].length<=40&&!bad.test(parts[i])){return parts[i];}}"
            + "var m=t.match(/([^|]{2,40})\\s*\\|\\s*[\\d.]+\\s*\\|\\s*分/);"
            + "return m?m[1].trim():t.slice(0,40);}"
            + "return {shops:cards.slice(0,20).map(function(x){"
            + "return {name:shopName(x.t),meta:x.t.slice(0,240)};}),loading:false};"
            + "})();";
        evaluateOnPage(view, waitJs, waited -> {
            checkVerification(() -> {
                boolean ready = "true".equals(String.valueOf(waited).replace("\"", "").trim());
                if (!ready) {
                    if (searchRetries < 10) {
                        searchRetries += 1;
                        postOnPage(view, () -> runSearchStep(view), 2500);
                    } else {
                        evaluateOnPage(view, js, value -> finishWithResult(value));
                    }
                    return;
                }
                evaluateOnPage(view, js, value -> finishWithResult(value));
            });
        });
    }

    private void runOrderStep(WebView view) {
        if (!canAutomate()) return;
        try {
            JSONObject config = new JSONObject(configJson);
            String shopName = config.optString("shop_name", "");
            String js = "(function(){"
                + "var shop=" + JSONObject.quote(shopName) + ";"
                + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' | ').replace(/\\s+/g,' ').trim();}"
                + "/* 坑 40：店卡身份证是评分「分」；起送不是必须。 */"
                + "var cards=[].slice.call(document.querySelectorAll('[class*=\"card\" i],[class*=\"item\" i]'))"
                + ".map(function(e){return {t:txt(e),e:e};})"
                + ".filter(function(x){return /\\|\\s*[\\d.]+\\s*\\|\\s*分/.test(x.t)&&x.t.length<300;});"
                + "var target=null;"
                + "for(var i=0;i<cards.length;i++){"
                + "var n=shopName(cards[i].t);"
                + "if(n.replace(/\\s+/g,'')===shop.replace(/\\s+/g,'')){target=cards[i].e;break;}"
                + "}"
                + "function shopName(t){"
                + "var parts=t.split('|').map(function(s){return s.trim();}).filter(Boolean);"
                + "var bad=/(起送|月售|配送|分钟|km|分|¥|\\+|商家自配送|本店|近期|人好评|好评|支持预订|预订|营业|休息|免配送费|到店|距离|评分|满\\d|蜂鸟)/;"
                + "for(var i=0;i<parts.length;i++){if(parts[i].length>=2&&parts[i].length<=40&&!bad.test(parts[i])){return parts[i];}}"
                + "var m=t.match(/([^|]{2,40})\\s*\\|\\s*[\\d.]+\\s*\\|\\s*分/);"
                + "return m?m[1].trim():'';}"
                + "if(!target){return {status:'shop_not_found',code:'takeout_shop_not_found',error:'没有找到名称完全一致的店铺，未自动选择其他店铺。请在当前页面手动选择。',"
                + "candidates:cards.slice(0,8).map(function(x){return shopName(x.t);})};}"
                + "target.setAttribute('data-dengta-pick','1');"
                + "return {status:'opening_shop',shop:(target.innerText||'').replace(/\\n+/g,' ').slice(0,80)};"
                + "})();";
            orderStep = 1;
            evaluateOnPage(webView, js, value -> {
                // 坑 50：进店后先看是不是「猜你喜欢」小柜台（只有六道菜那种）
                checkLoginState(() -> {
                    if (hasScriptStatus(value, "opening_shop")) {
                        // 真触摸打开店卡（坑 8：认元素打标记后真点），先来一拍真人节奏（坑 13）
                        slow(() -> tapMarked("[data-dengta-pick='1']"));
                        // 进店后的识门/选品交给 onPageFinished → enterShop 处理（坑 50）
                    } else {
                        finishWithResult(value == null || "null".equals(value)
                            ? "{\"status\":\"error\",\"code\":\"takeout_page_script_failed\",\"error\":\"店铺页面没有返回有效结果，未打开其他店铺。\"}"
                            : String.valueOf(value));
                    }
                });
            });
        } catch (Exception error) {
            finishWithResult("{\"status\":\"error\",\"error\":\"参数解析失败\"}");
        }
    }

    // 坑 50 + 坑 19：进店后先识门再选品。
    //  - 正店页（SHOP_SCHEME/restaurant）→ 直接选品
    //  - 小柜台（ITEM_STICKY_CATEGORY_SCHEME「猜你喜欢」）→ 拿 shopId 重建正门
    //  - 还在搜索/中间页 → 再认一拍（坑 19），认不出就按小柜台兜底找 shopId
    private void enterShop(WebView view, int attempt) {
        if (!canAutomate()) return;
        checkLoginState(() -> enterShopReady(view, attempt));
    }

    private void enterShopReady(WebView view, int attempt) {
        if (!canAutomate()) return;
        if (attempt > 4) {
            // 实在认不出门：直接从当前页尝试选品，至少不会卡死
            addProductStep(view);
            return;
        }
        String url = currentUrl == null ? "" : currentUrl;
        boolean isShopDoor = url.contains("SHOP_SCHEME") || url.contains("restaurant")
            || url.contains("pages-poi") || url.contains("/poi/") || url.contains("shopId");
        boolean miniCounter = url.contains("ITEM_STICKY") || url.contains("menu_extra_info")
            || (url.contains("scheme_type") && !url.contains("SHOP_SCHEME"));
        if (isShopDoor && !miniCounter) {
            addProductStep(view);
            return;
        }
        if (miniCounter) {
            reloadShopDoor(view);
            return;
        }
        // 仍在中间页/搜索页：等一拍再认
        postOnPage(view, () -> enterShop(view, attempt + 1), 2500 + random.nextInt(1500));
    }

    // 坑 50：小柜台里必然带着 shopId，抽出数字 id 重建 SHOP_SCHEME 正门再进。
    private void reloadShopDoor(final WebView view) {
        if (!canAutomate()) return;
        String js = "(function(){"
            + "var m=location.href.match(/shopId[=:]\\s*(\\d{4,})/)||location.href.match(/[?&]id=(\\d{4,})/);"
            + "if(m)return m[1];"
            + "var el=document.querySelector('[data-dengta-pick=\"1\"]');"
            + "if(el){var h=(el.getAttribute&&(el.getAttribute('href')||el.getAttribute('data-scheme')||''))||'';"
            + "var m2=h.match(/(\\d{4,})/);if(m2)return m2[1];}"
            + "return '';})();";
        evaluateOnPage(view, js, value -> {
            if (!canAutomate()) return;
            String shopId = String.valueOf(value).replace("\"", "").trim();
            if (shopId.length() >= 4 && shopId.matches("\\d+") && !"null".equals(shopId)) {
                String door = "https://h5.ele.me/minisite/pages-poi/restaurant/index?shopId="
                    + shopId + "&from=mobile.default";
                view.loadUrl(door);
                // loadUrl 后 onPageFinished 会再次触发（orderStep 仍是 1 → enterShop → 正门→选品）
            } else {
                // 找不到 shopId：别把小柜台当菜单页，直接失败收手
                finishWithResult("{\"status\":\"shop_not_found\",\"error\":\"进的不是店铺正门，请换个词重试。\"}");
            }
        });
    }

    // 坑 5 / 46：加购两段 + 三重门铃（卡身 → 卡图 → 「选规格」小钮）
    private void addProductStep(WebView view) {
        if (!canAutomate()) return;
        try {
            JSONObject config = new JSONObject(configJson);
            final String product = config.optString("product", "");
            orderStep = 2;
            String js = "(function(){"
                + "var p=" + JSONObject.quote(product) + ";"
                + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' | ').replace(/\\s+/g,' ').trim();}"
                + "function productName(e){var title=e.querySelector('[class*=\"food-name\" i],[class*=\"foodName\" i],[class*=\"item-name\" i],[class*=\"title\" i]');"
                + "return txt(title||e).split('|')[0].trim();}"
                + "/* 菜单卡：真菜卡认标题类名（.food-name 之类），排除「买过/再来一单」面板（坑 23 / 37） */"
                + "var rows=[].slice.call(document.querySelectorAll('[class*=\"food\" i],[class*=\"menu\" i],[class*=\"item\" i]'))"
                + ".map(function(e){return {t:txt(e),e:e};})"
                + ".filter(function(x){return x.t.length>3&&x.t.length<200&&!/再来一单|购买过|买过/.test(x.t);});"
                + "var target=null;"
                + "for(var i=0;i<rows.length;i++){if(productName(rows[i].e).replace(/\\s+/g,'')===p.replace(/\\s+/g,'')){target=rows[i].e;break;}}"
                + "if(!target){return {status:'product_not_found',code:'takeout_product_not_found',error:'没有找到名称完全一致的商品，未自动添加其他商品。请在当前页面手动选择。',"
                + "candidates:rows.slice(0,8).map(function(x){return productName(x.e);})};}"
                + "target.setAttribute('data-dengta-product','1');"
                + "return {status:'opening_product'};"
                + "})();";
            evaluateOnPage(view, js, value -> {
                checkLoginState(() -> {
                    if (!hasScriptStatus(value, "opening_product")) {
                        finishWithResult(value == null || "null".equals(value)
                            ? "{\"status\":\"error\",\"code\":\"takeout_page_script_failed\",\"error\":\"商品页面没有返回有效结果，未执行加购。\"}"
                            : String.valueOf(value));
                        return;
                    }
                    // 真人节奏后点卡身（坑 13）
                    slow(() -> {
                        tapMarked("[data-dengta-product='1']");
                        postOnPage(view, this::confirmAddToCart, 2500 + random.nextInt(1500));
                    });
                });
            });
        } catch (Exception error) {
            finishWithResult("{\"status\":\"error\",\"error\":\"选品失败\"}");
        }
    }

    // 坑 5：点商品后详情页的「+ 加入购物车」只负责拉出 sku 面板，
    // 面板里通栏 .sku__button 才是真正加购；规格默认已选别乱动（坑 6）。
    private void confirmAddToCart() {
        checkVerification(() -> checkLoginState(() -> {
            String js = "(function(){"
                + "/* 详情页确认已打开（URL 含 detail 或出现选规格字样） */"
                + "var btn=null;"
                + "/* 先找真正加购的通栏钮 */"
                + "var sku=document.querySelector('.sku__button');"
                + "if(sku&&sku.getBoundingClientRect().height>20){sku.setAttribute('data-dengta-any','1');return {w:'sku'};}"
                + "/* 详情页底部「加入购物车」 */"
                + "var add=[].slice.call(document.querySelectorAll('*')).find(function(e){"
                + "var t=(e.innerText||'').trim();return /加入购物车|选规格/.test(t)&&t.length<12&&(e.children.length<3);});"
                + "if(add){add.setAttribute('data-dengta-any','1');return {w:'add'};}"
                + "return {w:'none'};"
                + "})();";
            evaluateOnPage(webView, js, value -> {
                String v = String.valueOf(value);
                // 真人节奏后再判断（坑 13）
                slow(() -> {
                    if (v.contains("sku")) {
                        tapMarked("[data-dengta-any='1']");
                        postOnPage(webView, () -> goToCart(), 2000 + random.nextInt(1500));
                    } else if (v.contains("add")) {
                        tapMarked("[data-dengta-any='1']");
                        postOnPage(webView, () -> {
                            if (!canAutomate()) return;
                            String js2 = "(function(){var s=document.querySelector('.sku__button');"
                                + "if(s&&s.getBoundingClientRect().height>20){s.setAttribute('data-dengta-any','1');return true;}"
                                + "return false;})();";
                            evaluateOnPage(webView, js2, v2 -> {
                                if ("true".equals(String.valueOf(v2).replace("\"", "").trim())) {
                                    slow(() -> {
                                        tapMarked("[data-dengta-any='1']");
                                        postOnPage(webView, this::goToCart, 2000 + random.nextInt(1500));
                                    });
                                } else {
                                    goToCart();
                                }
                            });
                        }, 1500 + random.nextInt(1000));
                    } else {
                        goToCart();
                    }
                });
            });
        }));
    }

    // 坑 7：加完购回购物车页（详情页里没有「去结算」），停那儿让人付款。
    private void goToCart() {
        if (!canAutomate()) return;
        try {
            postOnPage(webView, () -> {
                if (!canAutomate()) return;
                try {
                    webView.loadUrl("https://h5.ele.me/msite/cart");
                } catch (Exception ignored) {
                }
            }, 1200 + random.nextInt(800));
        } catch (Exception ignored) {
        }
    }

    // 帖子 11 节「钱的闸」：购物车页读合计金额 + 件数。
    // 若超出 maxAmount 或车里有旧货时停手，否则继续。
    // 帖子 14 节「截图」：拍下购物车页截图，base64 带回。
    private void settlementCheck() {
        if (!canAutomate()) return;
        String js = "(function(){"
            + "var t=document.body.innerText||'';"
            + "/* 读合计（帖子 11 节：两种写法 A/B） */"
            + "var tail=t.slice(Math.max(0,t.lastIndexOf('合计')));"
            + "var total=NaN;"
            + "var m=t.match(/合计¥\\s*(\\d+(?:\\.\\d+)?)/);"
            + "if(!m)m=tail.match(/已优惠\\s*¥\\s*[\\d.]+[\\s\\S]{0,12}?¥\\s*(\\d+(?:\\.\\d+)?)/);"
            + "if(!m)m=t.match(/¥\\s*(\\d+(?:\\.\\d+)?)/g);"
            + "if(m){total=Number(m[1]||m[0].replace('¥','').trim());}"
            + "/* 车里有旧货闸：商品明细段数 */"
            + "var detail=t.slice(0,(t.indexOf('打包费')+1)||t.length);"
            + "var items=(detail.match(/×\\s*\\d+/g)||[]).length;"
            + "return {total:isNaN(total)?0:total,items:items};"
            + "})();";
        evaluateOnPage(webView, js, value -> {
            if (!canAutomate()) return;
            try {
                if (value == null || "null".equals(value)) {
                    finishWithResult("{\"status\":\"error\",\"code\":\"takeout_page_script_failed\",\"error\":\"购物车金额尚未读取成功，请在当前页面手动核对。\"}");
                    return;
                }
                double total = 0;
                int items = 0;
                if (value != null && !value.equals("null")) {
                    JSONObject o = new JSONObject(String.valueOf(value));
                    total = o.optDouble("total", 0);
                    items = o.optInt("items", 0);
                }
                // 拍购物车截图
                captureScreenshot();
                // 钱闸：超限停手
                if (maxAmount > 0 && total > maxAmount) {
                    finishWithResult("{\"status\":\"over_limit\",\"total\":" + total
                        + ",\"max_amount\":" + maxAmount
                        + ",\"screenshot\":\"" + screenshotBase64 + "\""
                        + ",\"error\":\"合计¥" + total + " 超过上限¥" + maxAmount + "，一分没花，等你点头。\"}");
                    return;
                }
                // 安静模式：不等人点「完成后点这里返回」，自动收工
                if (quietMode) {
                    finishWithResult("{\"status\":\"done\",\"total\":" + total
                        + ",\"items\":" + items
                        + ",\"screenshot\":\"" + screenshotBase64 + "\""
                        + ",\"message\":\"加购完成，在购物车页等你确认付款。\"}");
                    return;
                }
            } catch (Exception ignored) {
            }
        });
    }

    // 帖子 14 节：截图（WebView 当前画面 → base64 JPEG）
    // 使用 View.draw 到 Bitmap，不依赖废弃 API。
    private void captureScreenshot() {
        if (webView == null) return;
        try {
            int width = webView.getWidth();
            int height = webView.getHeight();
            if (width <= 0 || height <= 0) return;
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
            webView.draw(canvas);
            // 帖子 14 节：JPEG 质量 70，够看不够大
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out);
            screenshotBase64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            bitmap.recycle();
        } catch (Exception ignored) {
        }
    }

    private void finishWithResult(String resultJson) {
        if (automationStopped || isFinishing() || isDestroyed() || !resultState.stage(resultJson == null ? "{\"status\":\"error\"}" : resultJson)) return;
        String status = "";
        try { status = new JSONObject(resultState.result()).optString("status", "done"); } catch (Exception ignored) {}
        if (operationStatus != null) operationStatus.setText("verification".equals(status) ? "页面需要验证，自动操作已停止。你可以完成验证后手动返回。"
            : "logged_out".equals(status) ? "页面需要登录，自动操作已停止。你可以登录后手动返回。"
            : "search".equals(mode) ? "搜索结果已交回 AI。你可以继续查看，完成后手动返回。"
            : "自动操作已停止，请核对页面后手动返回。");
        if ("search".equals(mode) && requestId != null && !requestId.isEmpty()) {
            resultState.markPublished();
            OrderBrowserPlugin.publishSearchResult(this, requestId, resultState.result(), null);
        }
    }

    private boolean canAutomate() { return webView != null && BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding) && !automationStopped && !isFinishing() && !isDestroyed() && !resultState.stopped(); }

    private void disposeWebView(WebView view) {
        if (view == null) return;
        try {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        } catch (Exception ignored) {}
        try { view.destroy(); } catch (Exception ignored) {}
    }

    private String technicalErrorResult() {
        return "{\"status\":\"error\",\"code\":\"" + technicalErrorCode + "\",\"loading\":false,\"shops\":[]}";
    }

    private void showTechnicalError(String code) {
        automationStopped = true;
        technicalErrorCode = code;
        BrowserSessionSupport.persistCookies(accountCookies);
        WebView failed = webView;
        webView = null;
        disposeWebView(failed);
        if ("search".equals(mode) && !resultState.published() && requestId != null && !requestId.isEmpty()) {
            resultState.markPublished();
            try { OrderBrowserPlugin.publishSearchResult(this, requestId, null, code); } catch (Exception ignored) {}
        }
        try {
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            operationStatus = new TextView(this);
            operationStatus.setText(OrderBrowserPlugin.technicalErrorMessage(code));
            operationStatus.setPadding(24, 24, 24, 24);
            root.addView(operationStatus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            if (accountBinding != null && BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) {
                Button review = new Button(this);
                review.setText("恢复网页，手动核对");
                review.setOnClickListener(v -> {
                    try {
                        BrowserSessionSupport.ACCOUNTS.requireCurrent(accountBinding);
                        String url = currentUrl;
                        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) url = "https://h5.ele.me/msite/";
                        onCreateGuarded(null, url);
                        operationStatus.setText("已恢复当前账号的网页。自动点餐仍已停止，请手动核对登录和购物车；返回不会重新加购。");
                    } catch (RuntimeException error) { showTechnicalError(BrowserSessionSupport.accountErrorCode(error)); }
                });
                root.addView(review, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            Button done = new Button(this);
            done.setText("完成后点这里返回");
            done.setOnClickListener(v -> returnToDengTa(technicalErrorResult()));
            root.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            setContentView(root);
            SafeWindow.apply(this, root);
        } catch (Throwable ignored) {
            android.util.Log.e(TAG, "takeout_error_ui_failed");
        }
    }

    private void cancelUnreadySearch() {
        if (!resultState.published() && requestId != null && !requestId.isEmpty()) {
            resultState.markPublished();
            OrderBrowserPlugin.publishSearchResult(this, requestId, null, "cancelled");
        }
        setResult(Activity.RESULT_CANCELED);
        finish();
    }

    private void returnToDengTa(String resultJson) {
        BrowserSessionSupport.persistCookies(accountCookies);
        Intent data = new Intent();
        data.putExtra("result", resultJson);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (!technicalErrorCode.isEmpty()) {
            returnToDengTa(technicalErrorResult());
            return;
        }
        if ("search".equals(mode)) {
            if (resultState.result() == null) cancelUnreadySearch();
            else returnToDengTa(resultState.result());
            return;
        }
        // 第一次返回键不直接取消：点餐页还开着，提示用户用页面内“完成后点这里返回”。
        // 避免误触返回导致“外卖搜索被取消、页面关闭”。
        if (!backHintShown) {
            backHintShown = true;
            if (webView != null) {
                webView.post(() -> {
                    android.widget.Toast.makeText(
                        this,
                        "点餐页还开着：完成后点页面底部的「完成后点这里返回」即可，不要按返回键。",
                        android.widget.Toast.LENGTH_LONG
                    ).show();
                });
            }
            return;
        }
        Intent data = new Intent();
        data.putExtra("message", "用户关闭了点餐页面。");
        setResult(Activity.RESULT_CANCELED, data);
        super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("dengta_order_url", currentUrl);
        if (BrowserSessionSupport.ACCOUNTS.isCurrent(accountBinding)) state.putString(BrowserSessionSupport.RESTORE_TICKET, BrowserSessionSupport.ACCOUNTS.issueRestoration(accountBinding));
        state.putBoolean("dengta_order_automation_stopped", true);
        state.putBoolean("dengta_order_result_published", resultState.published());
        super.onSaveInstanceState(state);
    }

    @Override protected void onPause() {
        BrowserSessionSupport.persistCookies(accountCookies);
        super.onPause();
    }

    @Override protected void onDestroy() {
        BrowserSessionSupport.ACCOUNTS.removeListener(accountChanged);
        BrowserSessionSupport.persistCookies(accountCookies);
        if ("search".equals(mode) && !isChangingConfigurations() && !resultState.published() && requestId != null && !requestId.isEmpty()) {
            resultState.markPublished();
            OrderBrowserPlugin.publishSearchResult(this, requestId, null, "cancelled");
        }
        WebView current = webView;
        webView = null;
        disposeWebView(current);
        super.onDestroy();
    }

    private static final class OrderBridge {
        private final OrderWebActivity activity;
        OrderBridge(OrderWebActivity activity) { this.activity = activity; }
        @JavascriptInterface
        public void postResult(String json) {
            activity.runOnUiThread(() -> activity.finishWithResult(json));
        }
    }
}

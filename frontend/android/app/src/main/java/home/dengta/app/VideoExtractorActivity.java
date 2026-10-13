package home.dengta.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Web 视频流提取器（兼容 B站 / 爱奇艺 / 腾讯等平台）。
 *
 * 架构（Castor 启发）：
 * 1. WebView 加载目标网页
 * 2. 拦截 shouldInterceptRequest 捕获视频流 URL
 * 3. 注入 JS 扫描各类视频元素/数据
 * 4. 找到视频后 → 交给 CastPlaybackService 播放
 * 5. 超时保护（25s）防止页面卡死
 */
public final class VideoExtractorActivity extends AppCompatActivity {

    public static final String EXTRA_URL = "extra_url";
    public static final String EXTRA_TITLE = "extra_title";

    private static final String TAG = "VideoExtractor";
    private static final long EXTRACTION_TIMEOUT_MS = 25000;
    private static final long PAGE_LOAD_TIMEOUT_MS = 15000;

    private WebView webView;
    private ProgressBar progressBar;
    private TextView statusText;
    private View overlayView;

    private String targetUrl;
    private String targetTitle;
    private String targetDomain = "";
    private final List<String> discoveredUrls = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean extractionDone = false;
    private boolean pageLoadTimedOut = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        if (intent != null) {
            targetUrl = intent.getStringExtra(EXTRA_URL);
            targetTitle = intent.getStringExtra(EXTRA_TITLE);
        }
        if (targetUrl == null) targetUrl = "";
        if (targetTitle == null) targetTitle = "";

        // 提取域名用于站点特定策略
        try {
            java.net.URL url = new java.net.URL(targetUrl);
            targetDomain = url.getHost().toLowerCase(Locale.ROOT);
        } catch (Exception ignored) {}

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);

        overlayView = createOverlay();
        root.addView(overlayView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));

        webView = createWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);

        if (!targetUrl.isEmpty()) {
            updateStatus("正在打开页面…");
            webView.loadUrl(targetUrl);
            // 页面加载超时保护
            handler.postDelayed(() -> {
                if (!extractionDone) {
                    pageLoadTimedOut = true;
                    Log.w(TAG, "Page load timeout, forcing extraction");
                    // 超时：即使页面未完全加载也尝试提取
                    tryExtractNow();
                }
            }, PAGE_LOAD_TIMEOUT_MS);
            // 总超时保护
            handler.postDelayed(() -> {
                if (!extractionDone) finishExtraction();
            }, EXTRACTION_TIMEOUT_MS);
        } else {
            updateStatus("无效的 URL");
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView wv = new WebView(this);
        try {
            wv.getSettings().setJavaScriptEnabled(true);
            wv.getSettings().setAllowContentAccess(true);
            wv.getSettings().setDomStorageEnabled(true);
            wv.getSettings().setLoadWithOverviewMode(true);
            wv.getSettings().setUseWideViewPort(true);
            wv.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            wv.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            // 站点特定 User-Agent
            wv.getSettings().setUserAgentString(buildUA(targetDomain));
        } catch (Exception e) {
            Log.e(TAG, "WebView settings error", e);
        }

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                Log.i(TAG, "Loading: " + url);
                updateStatus("正在加载页面…");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (pageLoadTimedOut) return;
                Log.i(TAG, "Page loaded: " + url);
                updateStatus("已加载，正在提取视频…");
                tryExtractNow();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    int code = error != null ? error.getErrorCode() : -1;
                    Log.w(TAG, "Page error: " + code);
                    // 页面错误不阻止提取（可能部分内容已加载）
                    tryExtractNow();
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return null;
                String url = request.getUrl().toString().toLowerCase(Locale.ROOT);
                try {
                    if (isVideoUrl(url)) {
                        String original = request.getUrl().toString();
                        Log.i(TAG, "Intercepted: " + original);
                        synchronized (discoveredUrls) {
                            if (!discoveredUrls.contains(original) && !extractionDone) {
                                discoveredUrls.add(original);
                                handler.post(VideoExtractorActivity.this::finishExtraction);
                            }
                        }
                    }
                } catch (Exception ignored) {
                    // 拦截异常不影响页面加载
                }
                return null;
            }
        });

        return wv;
    }

    /** 根据目标域名构建合适的 User-Agent。 */
    private String buildUA(String domain) {
        if (domain.contains("bilibili") || domain.contains("b23")) {
            return "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 BiliApp/7.28.0";
        }
        if (domain.contains("iqiyi") || domain.contains("qiyi")) {
            return "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QYPlayer/14.0";
        }
        if (domain.contains("qq") || domain.contains("v.qq") || domain.contains("tencent")) {
            return "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 QQLive/9.0";
        }
        // 默认：移动端 Chrome
        return "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
    }

    /** 执行视频提取（注入 JS + 扫描已拦截的 URL）。 */
    private void tryExtractNow() {
        if (extractionDone) return;
        // 检查已拦截的 URL
        synchronized (discoveredUrls) {
            if (!discoveredUrls.isEmpty()) {
                finishExtraction();
                return;
            }
        }
        // 注入 JS 提取
        injectVideoExtraction();
    }

    /** 注入 JS 检测网页中的视频元素和数据（兼容多平台）。 */
    private void injectVideoExtraction() {
        if (webView == null) return;
        String js = buildExtractionJS(targetDomain);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            try {
                webView.evaluateJavascript(js, value -> {
                    if (value == null || value.equals("null") || value.equals("[]") || value.equals("\"[]\"")) {
                        // 无结果：等待网络拦截
                        updateStatus("等待视频流加载…");
                        return;
                    }
                    parseExtractionResults(value);
                });
            } catch (Exception e) {
                Log.w(TAG, "evaluateJavascript failed", e);
            }
        }
    }

    /** 构建站点特定的提取 JS。 */
    private String buildExtractionJS(String domain) {
        // 通用提取逻辑
        StringBuilder js = new StringBuilder();
        js.append("(function(){ var r=[];\n");

        // 1. <video> 元素（通用）
        js.append("document.querySelectorAll('video').forEach(function(v){ ");
        js.append("if(v.src) r.push(v.src); ");
        js.append("v.querySelectorAll('source').forEach(function(s){ if(s.src) r.push(s.src); }); });\n");

        // 2. 页面文本中的视频 URL 正则
        js.append("var re=/https?:\\/\\/[^\\\"'\\s<>]+\\.(mp4|m3u8|webm|flv|ts)(\\?[^\\\"'\\s<>]*)?/gi; var m;\n");
        js.append("var txt=document.body?document.body.innerText:''; while((m=re.exec(txt))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); }\n");

        // 3. 所有 <script> 内容
        js.append("document.querySelectorAll('script').forEach(function(s){ if(s.textContent){ re.lastIndex=0; while((m=re.exec(s.textContent))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); } }});\n");

        // 4. __INITIAL_STATE__（B站 / Vue SPA）
        js.append("if(window.__INITIAL_STATE__){ try{ var st=JSON.stringify(window.__INITIAL_STATE__); re.lastIndex=0; while((m=re.exec(st))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); } }catch(e){} }\n");

        // 5. B站 专用：videoData / aid / cid
        if (domain.contains("bilibili") || domain.contains("b23")) {
            js.append("// B站 专用\n");
            js.append("if(window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData){ ");
            js.append("var vd=window.__INITIAL_STATE__.videoData; ");
            js.append("if(vd.pic) r.push('[pic]'+vd.pic); ");
            js.append("if(vd.aid) r.push('[aid]'+vd.aid); }\n");
            js.append("// B站 视频页 JSON 数据\n");
            js.append("var bp=document.querySelector('#bilibili-player'); if(bp){ r.push('[player]'+bp.src); }\n");
        }

        // 6. 爱奇艺 专用
        if (domain.contains("iqiyi") || domain.contains("qiyi")) {
            js.append("// 爱奇艺 专用\n");
            js.append("if(window.__data__){ try{ var d=JSON.stringify(window.__data__); re.lastIndex=0; while((m=re.exec(d))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); } }catch(e){} }\n");
            js.append("if(window.__STATE__){ try{ var d=JSON.stringify(window.__STATE__); re.lastIndex=0; while((m=re.exec(d))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); } }catch(e){} }\n");
        }

        // 7. 腾讯视频 专用
        if (domain.contains("qq") || domain.contains("tencent")) {
            js.append("// 腾讯视频 专用\n");
            js.append("if(window.__DATA__){ try{ var d=JSON.stringify(window.__DATA__); re.lastIndex=0; while((m=re.exec(d))!==null){ if(r.indexOf(m[0])===-1) r.push(m[0]); } }catch(e){} }\n");
        }

        // 8. data-* 属性中的视频 URL
        js.append("['data-video','data-url','data-src','data-play','href'].forEach(function(a){ ");
        js.append("document.querySelectorAll('['+a+']').forEach(function(el){ ");
        js.append("var v=el.getAttribute(a); if(v&&(v.match(/\\.(mp4|m3u8|webm|flv)(\\?|$)/i)||v.match(/^https?:\\/\\//))) r.push(v); }); });\n");

        // 9. JSON-LD 结构化数据
        js.append("document.querySelectorAll('script[type=\"application/ld+json\"]').forEach(function(s){ try{ var d=JSON.parse(s.textContent); if(d&&d.contentUrl) r.push(d.contentUrl); if(d&&d.embedUrl) r.push(d.embedUrl); }catch(e){} });\n");

        // 10. 去重
        js.append("return JSON.stringify([...new Set(r)]); })();");
        return js.toString();
    }

    /** 解析 JS 返回的视频 URL 列表。 */
    private void parseExtractionResults(String json) {
        try {
            String clean = json;
            if (clean.startsWith("\"") && clean.endsWith("\"")) {
                clean = clean.substring(1, clean.length() - 1);
            }
            clean = clean.replace("\\\"", "\"").replace("\\/", "/");
            if (clean.startsWith("[") && clean.endsWith("]")) {
                String inner = clean.substring(1, clean.length() - 1);
                if (!inner.isEmpty()) {
                    String[] parts = inner.split("\",\"");
                    synchronized (discoveredUrls) {
                        for (String part : parts) {
                            String url = part.replaceAll("^\"|\"$", "").trim();
                            // 过滤掉非视频元数据
                            if (!url.isEmpty() && !url.startsWith("[") && isLikelyVideoUrl(url)) {
                                if (!discoveredUrls.contains(url)) {
                                    discoveredUrls.add(url);
                                }
                            }
                        }
                    }
                }
            }
            synchronized (discoveredUrls) {
                if (!discoveredUrls.isEmpty()) {
                    finishExtraction();
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Parse error: " + e.getMessage());
        }
    }

    /** 判断 URL 是否可能是视频流。 */
    private boolean isLikelyVideoUrl(String url) {
        String lower = url.toLowerCase(Locale.ROOT);
        // 必须是 http/https
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) return false;
        // 视频扩展名
        if (lower.contains(".mp4") || lower.contains(".m3u8") || lower.contains(".webm")
            || lower.contains(".flv") || lower.contains(".ts") || lower.contains(".mkv")) return true;
        // 视频关键词
        if (lower.contains("videoplayback") || lower.contains("mime=video")
            || lower.contains("content-type=video") || lower.contains("/video/")) return true;
        // 流媒体关键词
        if (lower.contains("stream") || lower.contains("playurl") || lower.contains("play_url")
            || lower.contains("videosource") || lower.contains("videostream")) return true;
        return false;
    }

    /** 拦截时判断是否是视频 URL。 */
    private boolean isVideoUrl(String url) {
        // 过滤掉非视频资源
        if (url.contains(".js") || url.contains(".css") || url.contains(".png")
            || url.contains(".jpg") || url.contains(".svg") || url.contains(".ico")
            || url.contains("analytics") || url.contains("tracking") || url.contains("advertisement")) {
            return false;
        }
        return isLikelyVideoUrl(url);
    }

    /** 完成提取，选择最佳 URL 并播放。 */
    private void finishExtraction() {
        if (extractionDone) return;
        extractionDone = true;

        String bestUrl;
        synchronized (discoveredUrls) {
            if (discoveredUrls.isEmpty()) {
                updateStatus("未检测到视频流");
                Log.w(TAG, "No video found for: " + targetUrl);
                // 给用户 1.5s 看提示后自动关闭，避免卡死在提取页
                handler.postDelayed(this::finish, 1500);
                return;
            }
            bestUrl = selectBestUrl();
        }

        Log.i(TAG, "Selected: " + bestUrl);
        updateStatus("已提取视频，启动播放器…");

        String title = (targetTitle != null && !targetTitle.isEmpty()) ? targetTitle : "网页视频";

        // 启动播放（捕获前台服务启动异常，避免崩溃）
        try {
            CastPlaybackService.play(this, bestUrl, title);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start playback service", e);
            updateStatus("启动播放器失败，请重试");
            handler.postDelayed(this::finish, 1500);
            return;
        }
        try {
            Intent intent = new Intent(this, CastPlayerActivity.class)
                .putExtra(CastPlayerActivity.EXTRA_URI, bestUrl)
                .putExtra(CastPlayerActivity.EXTRA_TITLE, title)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch player", e);
        }

        handler.postDelayed(this::finish, 1000);
    }

    /** 选择最佳视频 URL。 */
    private String selectBestUrl() {
        String mp4 = null, m3u8 = null, ts = null, flv = null, other = null;
        synchronized (discoveredUrls) {
            for (String url : discoveredUrls) {
                String lower = url.toLowerCase(Locale.ROOT);
                if (lower.contains(".mp4")) mp4 = url;
                else if (lower.contains(".m3u8")) m3u8 = url;
                else if (lower.contains(".ts")) ts = url;
                else if (lower.contains(".flv")) flv = url;
                else other = url;
            }
        }
        return mp4 != null ? mp4 :
               m3u8 != null ? m3u8 :
               flv != null ? flv :
               ts != null ? ts :
               (other != null ? other : discoveredUrls.get(0));
    }

    private void updateStatus(String text) {
        runOnUiThread(() -> {
            if (statusText != null) {
                statusText.setText(text);
            }
        });
    }

    private View createOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xCC000000);

        FrameLayout center = new FrameLayout(this);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        clp.gravity = android.view.Gravity.CENTER;
        overlay.addView(center, clp);

        progressBar = new ProgressBar(this);
        center.addView(progressBar, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        statusText = new TextView(this);
        statusText.setTextColor(0xFFFFFFFF);
        statusText.setTextSize(15);
        statusText.setGravity(android.view.Gravity.CENTER);
        statusText.setPadding(0, dp(60), 0, 0);
        center.addView(statusText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        return overlay;
    }

    private int dp(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception ignored) {}
            webView = null;
        }
        super.onDestroy();
    }
}
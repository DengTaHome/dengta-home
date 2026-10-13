package home.dengta.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Web 视频流提取器插件。
 *
 * 方法：
 *   extractVideo(url, title) — 打开 WebView 提取视频流，自动播放
 */
@CapacitorPlugin(name = "VideoExtractor")
public final class VideoExtractorPlugin extends Plugin {

    @PluginMethod
    public void extractVideo(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        if (url == null || url.isEmpty()) {
            call.reject("missing_url", "缺少网页地址。");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), VideoExtractorActivity.class)
                .putExtra(VideoExtractorActivity.EXTRA_URL, url)
                .putExtra(VideoExtractorActivity.EXTRA_TITLE, title)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("extract_failed", "启动提取器失败: " + e.getMessage());
        }
    }
}
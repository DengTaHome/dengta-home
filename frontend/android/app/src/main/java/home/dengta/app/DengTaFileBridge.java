package home.dengta.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;

/**
 * 导出文件桥：前端把导出内容以 base64 交给原生写入 App 导出目录，
 * 避免 WebView 无法可靠触发文件下载的问题。
 */
public final class DengTaFileBridge {
    private static final String TAG = "DengTaFileBridge";

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public DengTaFileBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void saveExport(String dataUrl, String filename) {
        if (dataUrl == null || filename == null || filename.trim().isEmpty()) {
            toast("导出失败：缺少文件内容或文件名。");
            return;
        }
        String safeName = filename.trim().replaceAll("[^A-Za-z0-9._\\-\u4e00-\u9fa5]", "_");
        if (safeName.length() > 120) safeName = safeName.substring(safeName.length() - 120);
        try {
            String base64 = dataUrl;
            int comma = dataUrl.indexOf(',');
            if (comma >= 0) base64 = dataUrl.substring(comma + 1);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(context.getFilesDir(), "export");
            if (!dir.exists() && !dir.mkdirs()) {
                toast("导出失败：无法创建导出目录。");
                return;
            }
            File target = new File(dir, safeName);
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
            }
            Log.i(TAG, "saved export: " + target.getAbsolutePath() + " (" + bytes.length + " bytes)");
            toast("已导出：" + safeName + "（" + (bytes.length / 1024) + " KB）\n位置：App 文件夹 files/export/，可用文件管理器查看。");
        } catch (Exception error) {
            Log.e(TAG, "save export failed", error);
            toast("导出失败：" + (error.getMessage() != null ? error.getMessage() : "未知原因"));
        }
    }

    private void toast(final String message) {
        mainHandler.post(() -> Toast.makeText(context, message, Toast.LENGTH_LONG).show());
    }
}

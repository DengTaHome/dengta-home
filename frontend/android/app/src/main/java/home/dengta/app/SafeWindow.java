package home.dengta.app;

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

/**
 * 自定义页面窗口适配：避开状态栏与屏幕挖孔（灵动岛），
 * 让顶部工具栏完整可见，WebView 内容从状态栏下方开始。
 */
public final class SafeWindow {

    private SafeWindow() {}

    public static void apply(Activity activity, View root) {
        if (activity == null || activity.getWindow() == null) return;
        Window window = activity.getWindow();
        // 内容不画进挖孔区域（默认策略显式声明，兼容不同厂商）。
        if (Build.VERSION.SDK_INT >= 28) {
            try {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
                window.setAttributes(lp);
            } catch (Exception ignored) {
            }
        }
        // 保持主题默认状态栏样式（深色底白字，保证系统图标可见），
        // 内容区自动让出状态栏与挖孔高度，顶部工具栏不再被灵动岛遮挡。
        if (root != null) {
            root.setFitsSystemWindows(true);
        }
    }
}

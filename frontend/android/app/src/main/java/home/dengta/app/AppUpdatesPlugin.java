package home.dengta.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdates")
public final class AppUpdatesPlugin extends Plugin {
    private boolean pendingLaunch = false;
    private void capture(Intent intent) {
        if (intent != null && intent.getBooleanExtra(AppUpdateWorker.OPEN_UPDATE, false)) {
            pendingLaunch = true;
            intent.removeExtra(AppUpdateWorker.OPEN_UPDATE);
        }
    }
    @Override public void load() { capture(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent); }
    @PluginMethod public void consumeLaunch(PluginCall call) {
        boolean available = pendingLaunch;
        pendingLaunch = false;
        call.resolve(new JSObject().put("available", available));
    }
    @PluginMethod public void schedule(PluginCall call) {
        AppUpdateWorker.schedule(getContext());
        call.resolve(new JSObject().put("enabled", AppUpdateWorker.preferences(getContext()).getBoolean("enabled", true)));
    }
    @PluginMethod public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        AppUpdateWorker.setEnabled(getContext(), enabled);
        call.resolve(new JSObject().put("enabled", enabled));
    }
    @PluginMethod public void openDownload(PluginCall call) {
        String url = call.getString("url", "");
        if (!AppUpdatePolicy.validDownload(url)) { call.reject("更新下载地址无效。", "app_update_manifest_invalid"); return; }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) { call.reject("无法打开系统下载页面。", "app_update_download_failed"); }
    }
}

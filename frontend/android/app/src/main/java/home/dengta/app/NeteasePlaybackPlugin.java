package home.dengta.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.regex.Pattern;

@CapacitorPlugin(name = "NeteasePlayback")
public final class NeteasePlaybackPlugin extends Plugin {
    private static final Pattern RESOURCE_ID = Pattern.compile("^[0-9]{1,20}$");

    @PluginMethod
    public void open(PluginCall call) {
        String resourceType = call.getString("resourceType", "");
        String resourceId = call.getString("resourceId", "");
        if (!("song".equals(resourceType) || "playlist".equals(resourceType)) || !RESOURCE_ID.matcher(resourceId).matches()) {
            call.reject("网易云资源标识无效。");
            return;
        }

        Uri appUri = Uri.parse("orpheus://" + resourceType + "/" + resourceId);
        Uri webUri = Uri.parse("https://music.163.com/#/" + resourceType + "?id=" + resourceId);

        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("在网易云音乐中打开？")
            .setMessage("即将离开 DengTa。普通歌曲、VIP 歌曲及版权可用性由网易云音乐判断。")
            .setNegativeButton("取消", (dialog, which) -> {
                JSObject result = new JSObject();
                result.put("opened", false);
                call.resolve(result);
            })
            .setPositiveButton("继续", (dialog, which) -> openConfirmed(call, appUri, webUri))
            .setOnCancelListener(dialog -> {
                JSObject result = new JSObject();
                result.put("opened", false);
                call.resolve(result);
            })
            .show());
    }

    // AI 放歌：无确认弹窗，直接静默调起网易云播放（用户已明确要求 AI 放歌）。
    @PluginMethod
    public void playSilent(PluginCall call) {
        String resourceType = call.getString("resourceType", "");
        String resourceId = call.getString("resourceId", "");
        if (!"song".equals(resourceType) || !RESOURCE_ID.matcher(resourceId).matches()) {
            call.reject("网易云歌曲编号无效。");
            return;
        }
        Uri appUri = Uri.parse("orpheus://song/" + resourceId);
        Uri webUri = Uri.parse("https://music.163.com/#/song?id=" + resourceId);
        openConfirmed(call, appUri, webUri);
    }

    private void openConfirmed(PluginCall call, Uri appUri, Uri webUri) {
        Uri target = new Intent(Intent.ACTION_VIEW, appUri).resolveActivity(getContext().getPackageManager()) != null ? appUri : webUri;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, target);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("target", "orpheus".equals(target.getScheme()) ? "app" : "web");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开网易云音乐。", error);
        }
    }
}

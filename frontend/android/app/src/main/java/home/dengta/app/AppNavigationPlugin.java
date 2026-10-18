package home.dengta.app;

import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppNavigation")
public class AppNavigationPlugin extends Plugin {
    @PluginMethod
    public void dismissKeyboard(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            View root = getActivity().getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            boolean visible = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
            if (visible) {
                new WindowInsetsControllerCompat(getActivity().getWindow(), root).hide(WindowInsetsCompat.Type.ime());
            }
            JSObject result = new JSObject();
            result.put("hidden", visible);
            call.resolve(result);
        });
    }
}

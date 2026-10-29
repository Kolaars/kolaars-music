package app.kolaars.music;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * System bar geometry for the web layout.
 *
 * Capacitor injects `--safe-area-inset-*`, but on MIUI 12 (Android 11) the
 * WebView reports a zero bottom inset while the navigation bar still covers the
 * last 48 dp of the page: the player bar ends up underneath the system buttons.
 * Reading the window insets here and falling back to the tappable area gives a
 * usable number on both button and gesture navigation.
 */
@CapacitorPlugin(name = "SystemUi")
public class SystemUiPlugin extends Plugin {

    @PluginMethod
    public void insets(PluginCall call) {
        JSObject result = new JSObject();
        float density = getActivity().getResources().getDisplayMetrics().density;
        Insets bars = Insets.NONE;
        int bottom = 0;

        WindowInsetsCompat windowInsets = ViewCompat.getRootWindowInsets(
            getActivity().getWindow().getDecorView()
        );
        if (windowInsets != null) {
            bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            bottom = bars.bottom;
            if (bottom == 0) {
                bottom = windowInsets.getInsets(WindowInsetsCompat.Type.tappableElement()).bottom;
            }
        }

        result.put("top", bars.top / (double) density);
        result.put("bottom", bottom / (double) density);
        result.put("left", bars.left / (double) density);
        result.put("right", bars.right / (double) density);
        call.resolve(result);
    }
}

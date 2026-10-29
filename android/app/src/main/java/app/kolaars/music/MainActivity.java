package app.kolaars.music;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are registered before the bridge starts, otherwise the
        // WebView cannot see them.
        registerPlugin(LocalFilesPlugin.class);
        registerPlugin(SystemUiPlugin.class);
        registerPlugin(PlayerPlugin.class);
        super.onCreate(savedInstanceState);
        disableSystemDarkening();
    }

    /**
     * Keeps the app's own palette intact.
     *
     * MIUI ships a system-wide "dark mode" that repaints web content in any app
     * whose WebView allows it: a white page comes out near-black even though
     * the CSS says `color-scheme: light`. The shell switches themes by itself,
     * so the system must not second-guess it — otherwise the light theme is
     * unusable while the phone is in night mode.
     */
    private void disableSystemDarkening() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) return;
        WebSettings settings = webView.getSettings();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            //noinspection deprecation — replaced by setAlgorithmicDarkeningAllowed on 33+.
            settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
    }
}

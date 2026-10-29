package app.kolaars.music;

import android.os.Bundle;
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
    }
}

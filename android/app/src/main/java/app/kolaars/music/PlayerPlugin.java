package app.kolaars.music;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * The web player's hands and eyes on the native session.
 *
 * The renderer keeps all of its queue, repeat and history logic and drives
 * playback through a small shim that looks like an `HTMLAudioElement`. This
 * plugin is the other end: it connects a {@link MediaController} to
 * {@link PlaybackService} and turns its callbacks into `state`/`time` events.
 */
@CapacitorPlugin(name = "NativePlayer")
public class PlayerPlugin extends Plugin {

    private MediaController controller;
    private ListenableFuture<MediaController> pending;
    private final Deque<Runnable> queued = new ArrayDeque<>();
    private Handler handler;
    private boolean ticking;
    private double lastDuration = 0;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (controller == null || !controller.isPlaying()) {
                ticking = false;
                return;
            }
            JSObject time = new JSObject();
            time.put("position", positionSeconds());
            time.put("duration", durationSeconds());
            notifyListeners("time", time);
            handler.postDelayed(this, 500);
        }
    };

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onEvents(Player player, Player.Events events) {
            boolean interesting = events.containsAny(
                Player.EVENT_PLAYBACK_STATE_CHANGED,
                Player.EVENT_IS_PLAYING_CHANGED,
                Player.EVENT_PLAY_WHEN_READY_CHANGED,
                Player.EVENT_MEDIA_ITEM_TRANSITION,
                Player.EVENT_POSITION_DISCONTINUITY,
                Player.EVENT_PLAYER_ERROR
            );
            if (interesting) emitState();
            if (player.isPlaying() && !ticking) {
                ticking = true;
                handler.post(ticker);
            }
        }
    };

    @Override
    public void load() {
        handler = new Handler(Looper.getMainLooper());
        handler.post(this::connect);
    }

    /* ------------------------------------------------------------------ */
    /* Session                                                             */
    /* ------------------------------------------------------------------ */

    private void connect() {
        SessionToken token = new SessionToken(
            getContext(),
            new ComponentName(getContext(), PlaybackService.class)
        );
        pending = new MediaController.Builder(getContext(), token).buildAsync();
        pending.addListener(
            () -> {
                try {
                    controller = pending.get();
                } catch (Exception error) {
                    JSObject failure = new JSObject();
                    failure.put("error", String.valueOf(error.getMessage()));
                    notifyListeners("state", failure);
                    return;
                }
                controller.addListener(listener);
                while (!queued.isEmpty()) {
                    runSafely(queued.poll());
                }
                emitState();
            },
            ContextCompat.getMainExecutor(getContext())
        );
    }

    /**
     * Runs the action on the main thread, now or as soon as the controller
     * connects: Capacitor calls plugin methods on a background thread, and
     * Media3 refuses to be touched from anywhere but the application thread.
     */
    private void withController(Runnable action) {
        if (controller != null) {
            handler.post(() -> runSafely(action));
            return;
        }
        queued.add(action);
        if (pending == null) handler.post(this::connect);
    }

    /** A Media3 failure must reach the UI, not take the process down. */
    private void runSafely(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException error) {
            JSObject payload = new JSObject();
            payload.put("error", String.valueOf(error.getMessage()));
            notifyListeners("state", payload);
        }
    }

    private double positionSeconds() {
        return controller == null ? 0 : controller.getCurrentPosition() / 1000.0;
    }

    private double durationSeconds() {
        if (controller == null) return 0;
        long duration = controller.getDuration();
        // `C.TIME_UNSET` is a huge negative number, not a duration.
        if (duration <= 0 || duration > 24L * 60L * 60L * 1000L) return lastDuration;
        lastDuration = duration / 1000.0;
        return lastDuration;
    }

    private void emitState() {
        if (controller == null) return;
        int state = controller.getPlaybackState();

        JSObject payload = new JSObject();
        payload.put("state", stateName(state));
        payload.put("playing", controller.isPlaying());
        payload.put("buffering", state == Player.STATE_BUFFERING);
        payload.put("ended", state == Player.STATE_ENDED);
        payload.put("position", positionSeconds());
        payload.put("duration", durationSeconds());
        if (controller.getPlayerError() != null) {
            payload.put("error", controller.getPlayerError().getErrorCodeName());
        }
        notifyListeners("state", payload);
    }

    private String stateName(int state) {
        switch (state) {
            case Player.STATE_BUFFERING:
                return "buffering";
            case Player.STATE_READY:
                return "ready";
            case Player.STATE_ENDED:
                return "ended";
            default:
                return "idle";
        }
    }

    /* ------------------------------------------------------------------ */
    /* Commands                                                            */
    /* ------------------------------------------------------------------ */

    @PluginMethod
    public void open(PluginCall call) {
        String uri = call.getString("src");
        if (uri == null || uri.isEmpty()) {
            call.reject("src is required");
            return;
        }
        String id = call.getString("id", uri);
        String title = call.getString("title");
        String artist = call.getString("artist");
        String album = call.getString("album");
        String artwork = call.getString("artwork");

        withController(() -> {
            MediaItem current = controller.getCurrentMediaItem();
            boolean same =
                current != null &&
                id.equals(current.mediaId) &&
                controller.getPlaybackState() != Player.STATE_IDLE;
            if (!same) {
                MediaMetadata.Builder metadata = new MediaMetadata.Builder();
                if (title != null) metadata.setTitle(title);
                if (artist != null) metadata.setArtist(artist);
                if (album != null) metadata.setAlbumTitle(album);
                if (artwork != null && !artwork.isEmpty()) {
                    metadata.setArtworkUri(Uri.parse(artwork));
                }
                lastDuration = 0;
                controller.setMediaItem(
                    new MediaItem.Builder()
                        .setUri(uri)
                        .setMediaId(id)
                        .setMediaMetadata(metadata.build())
                        .build()
                );
                controller.prepare();
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        withController(() -> {
            controller.setPlayWhenReady(true);
            controller.play();
        });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        withController(() -> controller.pause());
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double seconds = call.getDouble("position");
        if (seconds == null) {
            call.reject("position is required");
            return;
        }
        long millis = Math.max(0, Math.round(seconds * 1000));
        withController(() -> controller.seekTo(millis));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        withController(() -> {
            controller.stop();
            controller.clearMediaItems();
            lastDuration = 0;
        });
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume == null) {
            call.reject("volume is required");
            return;
        }
        float level = (float) Math.min(1, Math.max(0, volume));
        withController(() -> controller.setVolume(level));
        call.resolve();
    }
}

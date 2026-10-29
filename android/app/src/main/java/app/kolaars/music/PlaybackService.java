package app.kolaars.music;

import android.content.Intent;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * Playback that survives the screen going off.
 *
 * The WebView is a fine decoder while the app is in front, but Android is free
 * to kill a backgrounded page. A media session service keeps the process (and
 * the audio) alive, and gives the system the metadata it needs for the lock
 * screen, the notification and headset buttons.
 *
 * The player itself is driven from the web side through {@link PlayerPlugin};
 * this service only owns the session.
 */
public class PlaybackService extends MediaSessionService {

    private ExoPlayer player;
    private MediaSession session;

    @Override
    public void onCreate() {
        super.onCreate();

        player = new ExoPlayer.Builder(this).build();
        // `true` = handle audio focus: other apps pause us, calls duck us.
        player.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true
        );
        player.setHandleAudioBecomingNoisy(true);

        session = new MediaSession.Builder(this, player).build();
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiping the app away is how a phone user "closes" a player; keep the
        // notification and the audio running until they stop it there.
        if (player != null && player.isPlaying()) return;
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.release();
            session = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}

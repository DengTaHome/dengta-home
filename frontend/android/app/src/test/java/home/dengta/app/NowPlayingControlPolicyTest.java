package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class NowPlayingControlPolicyTest {
    @Test public void onlyControlsTheDisplayedSongAndPlayer() {
        assertTrue(NowPlayingControlPolicy.matches("music.a", "Song", "Artist", "music.a", "Song", "Artist"));
        assertFalse(NowPlayingControlPolicy.matches("music.a", "Song", "Artist", "video.b", "Song", "Artist"));
        assertFalse(NowPlayingControlPolicy.matches("music.a", "Song", "Artist", "music.a", "Next", "Artist"));
        assertFalse(NowPlayingControlPolicy.matches("music.a", "Song", "Artist", "music.a", "Song", "Other"));
    }
    @Test public void rejectsMissingTargetAndUnsupportedAction() {
        assertFalse(NowPlayingControlPolicy.matches("", "Song", "", "", "Song", ""));
        assertFalse(NowPlayingControlPolicy.matches("music.a", "", "", "music.a", "", ""));
        assertTrue(NowPlayingControlPolicy.supports(2 | 4, 2));
        assertFalse(NowPlayingControlPolicy.supports(2 | 4, 32));
        assertFalse(NowPlayingControlPolicy.supports(2 | 4, 0));
    }
}

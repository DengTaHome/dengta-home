package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CastPlaybackCommandsTest {
    private static final class Player implements CastPlaybackCommands.Target {
        boolean playing;
        float speed = 1f;
        int effects;
        public void play() { playing = true; effects++; }
        public void pause() { playing = false; effects++; }
        public void setSpeed(float value) { speed = value; effects++; }
    }

    @Test public void commandsAreAppliedOnceAndDoNotToggleOnRetry() {
        Player player = new Player();
        CastPlaybackCommands.execute("play", null, player);
        CastPlaybackCommands.execute("play", null, player);
        assertTrue(player.playing);
        CastPlaybackCommands.execute("pause", null, player);
        assertFalse(player.playing);
        CastPlaybackCommands.execute("speed", 1.5, player);
        assertEquals(1.5f, player.speed, 0f);
        assertEquals(4, player.effects);
    }

    @Test public void invalidInputCannotChangeThePlayer() {
        Player player = new Player();
        for (Double speed : new Double[]{ null, Double.NaN, Double.POSITIVE_INFINITY, -1d, 0d, 0.49, 2.01 }) {
            assertThrows(IllegalArgumentException.class, () -> CastPlaybackCommands.execute("speed", speed, player));
        }
        for (String action : new String[]{ null, "", "fullscreen", "seek", "PLAY" }) {
            assertThrows(IllegalArgumentException.class, () -> CastPlaybackCommands.execute(action, null, player));
        }
        assertEquals(0, player.effects);
        assertEquals(1f, player.speed, 0f);
    }

    @Test public void speedEndpointsAreSupported() {
        Player player = new Player();
        CastPlaybackCommands.execute("speed", 0.5, player);
        assertEquals(0.5f, player.speed, 0f);
        CastPlaybackCommands.execute("speed", 2.0, player);
        assertEquals(2f, player.speed, 0f);
    }

    @Test public void missingPlayerIsAnErrorAndNeverStartsPlayback() {
        assertThrows(IllegalStateException.class, () -> CastPlaybackCommands.execute("play", null, null));
    }
}

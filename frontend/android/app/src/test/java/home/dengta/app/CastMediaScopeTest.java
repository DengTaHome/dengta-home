package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CastMediaScopeTest {
    @Test public void lateCommandsCannotControlAReplacementMedia() {
        assertTrue(CastMediaScope.matches("https://media.test/first?token=a", "https://media.test/first?token=a"));
        assertFalse(CastMediaScope.matches("https://media.test/first?token=a", "https://media.test/second"));
        assertFalse(CastMediaScope.matches("https://media.test/first?token=a", "https://media.test/first?token=b"));
        assertFalse(CastMediaScope.matches("https://media.test/first", ""));
        assertFalse(CastMediaScope.matches("https://media.test/first", null));
    }

    @Test public void ExistingNativeControlsWithoutScopeKeepWorking() {
        assertTrue(CastMediaScope.matches(null, "https://media.test/current"));
        assertTrue(CastMediaScope.matches("", "https://media.test/current"));
    }
}

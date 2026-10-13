package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScreenCaptureScopeTest {
    @Test public void capturesAreBoundToBothAccountAndCompanion() {
        assertTrue(ScreenCaptureScope.matches("a:one", "a:one"));
        assertFalse(ScreenCaptureScope.matches("a:one", "b:one"));
        assertFalse(ScreenCaptureScope.matches("a:one", "a:two"));
        assertFalse(ScreenCaptureScope.matches(null, "a:one"));
        assertFalse(ScreenCaptureScope.matches("", ""));
        assertFalse(ScreenCaptureScope.matches(":", ":"));
    }
}

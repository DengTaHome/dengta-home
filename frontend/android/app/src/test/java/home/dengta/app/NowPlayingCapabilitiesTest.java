package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class NowPlayingCapabilitiesTest {
    @Test public void onlyAdvertisesDirectActionsSupportedByTheController() {
        assertArrayEquals(new String[] {"play", "pause", "next"}, NowPlayingCapabilities.availableActions(4L | 2L | 32L));
        assertArrayEquals(new String[] {"pause"}, NowPlayingCapabilities.availableActions(2L));
        assertArrayEquals(new String[] {"next"}, NowPlayingCapabilities.availableActions(32L));
        assertArrayEquals(new String[0], NowPlayingCapabilities.availableActions(0L));
    }

    @Test public void toggleAndUnrelatedActionsCannotInventDirectControlSupport() {
        assertArrayEquals(new String[0], NowPlayingCapabilities.availableActions(512L));
        assertArrayEquals(new String[] {"pause"}, NowPlayingCapabilities.availableActions(512L | 2L));
        assertArrayEquals(new String[0], NowPlayingCapabilities.availableActions(64L | 256L));
    }
}

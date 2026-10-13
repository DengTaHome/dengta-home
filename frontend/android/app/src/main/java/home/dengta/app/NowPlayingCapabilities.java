package home.dengta.app;

import java.util.ArrayList;

final class NowPlayingCapabilities {
    static String[] availableActions(long actions) {
        ArrayList<String> available = new ArrayList<>();
        // Android PlaybackState direct action bits; PLAY_PAUSE (512) is a separate toggle.
        if (NowPlayingControlPolicy.supports(actions, 4L)) available.add("play");
        if (NowPlayingControlPolicy.supports(actions, 2L)) available.add("pause");
        if (NowPlayingControlPolicy.supports(actions, 32L)) available.add("next");
        return available.toArray(new String[0]);
    }
}

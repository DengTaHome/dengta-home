package home.dengta.app;

/** Validate bridge input before applying a command to the existing player. */
final class CastPlaybackCommands {
    interface Target {
        void play();
        void pause();
        void setSpeed(float speed);
    }

    static void execute(String action, Double value, Target target) {
        if (!"play".equals(action) && !"pause".equals(action) && !"speed".equals(action)) {
            throw new IllegalArgumentException("unsupported_playback_action");
        }
        if ("speed".equals(action)
                && (value == null || !Double.isFinite(value) || value < 0.5 || value > 2.0)) {
            throw new IllegalArgumentException("invalid_playback_speed");
        }
        if (target == null) throw new IllegalStateException("playback_not_active");
        switch (action) {
            case "play": target.play(); break;
            case "pause": target.pause(); break;
            case "speed": target.setSpeed(value.floatValue()); break;
            default: throw new IllegalArgumentException("unsupported_playback_action");
        }
    }

    private CastPlaybackCommands() {}
}

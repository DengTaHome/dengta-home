package home.dengta.app;

final class ScreenCaptureScope {
    static boolean matches(String stored, String current) {
        return stored != null && !stored.isEmpty() && !stored.equals(":") && stored.equals(current);
    }
}

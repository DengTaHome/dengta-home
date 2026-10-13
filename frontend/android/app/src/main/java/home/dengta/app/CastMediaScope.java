package home.dengta.app;

/** Old clients omit a scope; newer clients must control only the media they displayed. */
final class CastMediaScope {
    private CastMediaScope() {}

    static boolean matches(String expectedUri, String currentUri) {
        return expectedUri == null || expectedUri.isEmpty() || expectedUri.equals(currentUri);
    }
}

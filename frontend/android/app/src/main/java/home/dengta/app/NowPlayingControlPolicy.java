package home.dengta.app;

final class NowPlayingControlPolicy {
    static boolean matches(String expectedPackage, String expectedTitle, String expectedArtist,
                           String actualPackage, String actualTitle, String actualArtist) {
        return expectedPackage != null && !expectedPackage.isEmpty()
            && expectedTitle != null && !expectedTitle.isEmpty()
            && expectedPackage.equals(actualPackage) && expectedTitle.equals(actualTitle)
            && (expectedArtist == null || expectedArtist.isEmpty() || expectedArtist.equals(actualArtist));
    }

    static boolean supports(long actions, long required) {
        return required != 0 && (actions & required) == required;
    }
}

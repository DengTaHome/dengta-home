package home.dengta.app;

import java.net.URI;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

final class AppUpdatePolicy {
    static final String FEED_URL = "https://www.dengtahome.com/updates/android.json";
    static boolean validDownload(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "github.com".equals(uri.getHost()) &&
                uri.getUserInfo() == null && uri.getPort() == -1 && uri.getRawQuery() == null && uri.getRawFragment() == null &&
                uri.getRawPath().matches("/DengTaHome/dengta-home(?:-frontend)?/releases/download/v[0-9.]+/[-A-Za-z0-9_.]+\\.apk");
        } catch (Exception error) { return false; }
    }
    static boolean newer(long installed, long candidate) { return installed > 0 && candidate > installed && candidate <= Integer.MAX_VALUE; }
    static long positiveInteger(Object value, long maximum) {
        if (!(value instanceof Number)) return -1;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number >= 1 && number <= maximum && number == Math.rint(number) ? ((Number) value).longValue() : -1;
    }
    static boolean validReleaseFields(Object version, Object sha256, Object size, Object publishedAt) {
        if (!(version instanceof String) || !((String) version).matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:\\.[0-9]+)?") ||
            !(sha256 instanceof String) || !((String) sha256).matches("[a-fA-F0-9]{64}") ||
            positiveInteger(size, 9_007_199_254_740_991L) < 1 || !(publishedAt instanceof String)) return false;
        try { OffsetDateTime.parse((String) publishedAt); return true; }
        catch (DateTimeParseException error) { return false; }
    }
}

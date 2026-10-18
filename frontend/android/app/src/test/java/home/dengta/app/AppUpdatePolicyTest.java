package home.dengta.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppUpdatePolicyTest {
    @Test public void acceptsOnlyOwnedHttpsReleaseAssets() {
        String good = "https://github.com/DengTaHome/dengta-home-frontend/releases/download/v2.10.74/DengTa-2.10.74-122.apk";
        assertTrue(AppUpdatePolicy.validDownload(good));
        for (String bad : new String[] {good.replace("https:", "http:"), good.replace("github.com", "github.com.evil.test"), good.replace("DengTaHome", "other"), good + "?token=x", good + "#x", good.replace("github.com", "user" + "@" + "github.com"), good.replace("DengTa-", "%2f")}) assertFalse(AppUpdatePolicy.validDownload(bad));
    }
    @Test public void installedAndDowngradeVersionsNeverNotify() {
        assertTrue(AppUpdatePolicy.newer(121, 122));
        assertFalse(AppUpdatePolicy.newer(121, 121));
        assertFalse(AppUpdatePolicy.newer(121, 120));
        assertFalse(AppUpdatePolicy.newer(0, 122));
        assertFalse(AppUpdatePolicy.newer(121, Long.MAX_VALUE));
    }
    @Test public void feedNumbersCannotBeCoercedOrTruncated() {
        assertEquals(122, AppUpdatePolicy.positiveInteger(122, Integer.MAX_VALUE));
        assertEquals(122, AppUpdatePolicy.positiveInteger(122.0, Integer.MAX_VALUE));
        for (Object bad : new Object[] {"122", 122.5, 0, -1, null, true, Double.NaN, Double.POSITIVE_INFINITY, 2_147_483_648L}) {
            assertEquals(-1, AppUpdatePolicy.positiveInteger(bad, Integer.MAX_VALUE));
        }
    }
    @Test public void backgroundNotificationsRequireCompleteReleaseMetadata() {
        String digest = new String(new char[64]).replace('\0', 'a');
        assertTrue(AppUpdatePolicy.validReleaseFields("2.10.74", digest, 42_000_000, "2026-10-18T12:34:56.000Z"));
        assertTrue(AppUpdatePolicy.validReleaseFields("2.10.74", digest, 42_000_000, "2026-10-18T20:34:56+08:00"));
        assertFalse(AppUpdatePolicy.validReleaseFields("2.10.74", digest, "42000000", "2026-10-18T12:34:56Z"));
        assertFalse(AppUpdatePolicy.validReleaseFields("2.10.74", digest, 42_000_000, null));
        assertFalse(AppUpdatePolicy.validReleaseFields("2.10.74", digest, 42_000_000, "2026-10-18"));
        assertFalse(AppUpdatePolicy.validReleaseFields("2.10.74", digest, 42_000_000, "2026-02-30T12:34:56Z"));
        assertFalse(AppUpdatePolicy.validReleaseFields("2.10.74", "missing", 42_000_000, "2026-10-18T12:34:56Z"));
    }
}

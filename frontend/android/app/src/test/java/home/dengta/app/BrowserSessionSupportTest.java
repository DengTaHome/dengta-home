package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BrowserSessionSupportTest {
    @Test public void timerAndSubframeRedirectsCannotOpenAnotherApp() {
        assertFalse(BrowserSessionSupport.mayOpenExternalNavigation(false, true));
        assertFalse(BrowserSessionSupport.mayOpenExternalNavigation(true, false));
        assertFalse(BrowserSessionSupport.mayOpenExternalNavigation(false, false));
        assertTrue(BrowserSessionSupport.mayOpenExternalNavigation(true, true));
    }

    @Test public void cookiesAreOnlyACredentialHintAndMustContainAnExactNonemptyAuthName() {
        assertTrue(BrowserSessionSupport.hasAuthenticationCookie("other=1; SID=fictional-value"));
        assertTrue(BrowserSessionSupport.hasAuthenticationCookie("USERID=fictional-user; other=1"));
        assertTrue(BrowserSessionSupport.hasAuthenticationCookie("TOKEN=fictional-value"));
        for (String cookie : new String[]{null, "", "NOTSID=fictional-value", "SID=; other=1", "other=SID=fictional-value", "TOKEN= "}) {
            assertFalse(BrowserSessionSupport.hasAuthenticationCookie(cookie));
        }
    }

    @Test public void browserFailuresHaveDistinctFixedRetryMessages() {
        assertTrue(BrowserSessionSupport.browserErrorMessage("browser_page_init_failed").contains("初始化失败"));
        assertTrue(BrowserSessionSupport.browserErrorMessage("browser_page_renderer_failed").contains("渲染进程"));
        assertTrue(BrowserSessionSupport.browserErrorMessage("browser_page_load_failed").contains("检查网络"));
        assertEquals("网页暂时不可用，请重新打开。", BrowserSessionSupport.browserErrorMessage("fictional private exception"));
        assertTrue(BrowserSessionSupport.accountErrorMessage("browser_account_restore_required").contains("未被清除"));
    }
    @Test public void aFailedOldRedirectOrSubresourceCannotReplaceTheCurrentLoginPage() {
        String current = "https://login.m.taobao.com/login.htm";
        assertFalse(BrowserSessionSupport.isCurrentNavigationFailure("https://h5.ele.me/msite/", current, true));
        assertFalse(BrowserSessionSupport.isCurrentNavigationFailure(current, current, false));
        assertFalse(BrowserSessionSupport.isCurrentNavigationFailure(null, current, true));
        assertTrue(BrowserSessionSupport.isCurrentNavigationFailure(current, current, true));
    }

    @Test public void searchReceiptsPreserveOnlyKnownTechnicalCodesWithoutReplacingAnExplicitStatus() {
        for (String code : new String[]{"takeout_page_not_ready", "takeout_page_touch_unavailable", "takeout_page_load_failed", "browser_account_restore_required"}) {
            assertEquals(code, BrowserSessionSupport.publicTakeoutSearchErrorCode("error", code));
            assertEquals("", BrowserSessionSupport.publicTakeoutSearchErrorCode("done", code));
            assertEquals("", BrowserSessionSupport.publicTakeoutSearchErrorCode("logged_out", code));
        }
        assertEquals("", BrowserSessionSupport.publicTakeoutSearchErrorCode("error", "fictional_private_code"));
        assertEquals("", BrowserSessionSupport.publicTakeoutSearchErrorCode("error", null));
    }

    @Test public void highDensityTouchCoordinatesAreConvertedToTheNativeViewSpace() {
        float[] point = BrowserSessionSupport.nativeTouchPoint(140, 105, 390, 700, 1080, 1938);
        assertNotNull(point);
        assertEquals(140f * 1080f / 390f, point[0], 0.01f);
        assertEquals(105f * 1938f / 700f, point[1], 0.01f);
        assertArrayEquals(new float[]{0, 0}, BrowserSessionSupport.nativeTouchPoint(0, 0, 390, 700, 1080, 1938), 0.01f);
    }

    @Test public void invalidViewportAndOutOfBoundsCoordinatesNeverProduceATouch() {
        for (double invalid : new double[]{0, -1, Double.NaN, Double.POSITIVE_INFINITY, 40000}) {
            assertNull(BrowserSessionSupport.nativeTouchPoint(10, 10, invalid, 700, 1080, 1938));
        }
        for (double x : new double[]{-1, 390, Double.NaN, Double.POSITIVE_INFINITY}) {
            assertNull(BrowserSessionSupport.nativeTouchPoint(x, 10, 390, 700, 1080, 1938));
        }
        assertNull(BrowserSessionSupport.nativeTouchPoint(10, 700, 390, 700, 1080, 1938));
        assertNull(BrowserSessionSupport.nativeTouchPoint(10, 10, 390, 700, 0, 1938));
        assertNull(BrowserSessionSupport.nativeTouchPoint(10, 10, 1, 700, 1080, 1938));
    }

    @Test public void unknownLoginStateWaitsABoundedNumberOfTimesInsteadOfAdvancingOrClaimingExpiry() {
        for (int attempt = 0; attempt < 6; attempt++) {
            assertEquals(BrowserSessionSupport.LoginDecision.WAIT, BrowserSessionSupport.loginDecision("unknown", attempt));
            assertEquals(BrowserSessionSupport.LoginDecision.WAIT, BrowserSessionSupport.loginDecision(null, attempt));
        }
        assertEquals(BrowserSessionSupport.LoginDecision.NOT_READY, BrowserSessionSupport.loginDecision("unknown", 6));
        assertEquals(BrowserSessionSupport.LoginDecision.NOT_READY, BrowserSessionSupport.loginDecision("malformed", 100));
        assertEquals(BrowserSessionSupport.LoginDecision.READY, BrowserSessionSupport.loginDecision("ready", 0));
        assertEquals(BrowserSessionSupport.LoginDecision.REQUIRED, BrowserSessionSupport.loginDecision("login_required", 0));
    }
}

package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BrowserLocationPolicyTest {
    @Test public void onlyOfficialHttpsPagesCanAskForSystemPermission() {
        assertTrue(BrowserLocationPolicy.isTrustedPage("https://h5.ele.me/msite/?x=1"));
        assertTrue(BrowserLocationPolicy.isTrustedPage("https://h5.m.taobao.com/order"));
        assertTrue(BrowserLocationPolicy.isTrustedPage("https://www.tmall.com/"));
        for (String bad : new String[] {null, "", "http://h5.ele.me", "https://h5.ele.me.evil.test/", "https://evilele.me/",
            "https://user" + "@" + "h5.ele.me/", "https://h5.ele.me:444/", "file:///ele.me", "https://www.bilibili.com/", "https://h5.ele.me./"}) {
            assertFalse(String.valueOf(bad), BrowserLocationPolicy.isTrustedPage(bad));
        }
    }
    @Test public void bridgeRequiresTheSameCurrentMainFrameAndExistingSystemPermission() {
        String top = "https://h5.ele.me/shop?id=1";
        assertTrue(BrowserLocationPolicy.mayReadBridge(top, "https://h5.ele.me/", true, true));
        assertTrue(BrowserLocationPolicy.mayReadBridge(top, "https://H5.ELE.ME:443", true, true));
        assertFalse(BrowserLocationPolicy.mayReadBridge(top, "https://h5.ele.me", false, true));
        assertFalse(BrowserLocationPolicy.mayReadBridge(top, "https://h5.ele.me", true, false));
        for (String origin : new String[] {"https://passport.ele.me", "https://h5.m.taobao.com", "https://evil.test",
            "http://h5.ele.me", "https://h5.ele.me:444", "https://h5.ele.me/path", "https://h5.ele.me?x=1", "https://h5.ele.me#x", "null"}) {
            assertFalse(origin, BrowserLocationPolicy.mayReadBridge(top, origin, true, true));
        }
        assertFalse(BrowserLocationPolicy.mayReadBridge("https://evil.test", "https://h5.ele.me", true, true));
    }
}

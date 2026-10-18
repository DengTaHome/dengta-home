package home.dengta.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class BrowserAccountScopeTest {
    private static final String A = "11111111-1111-4111-8111-111111111111";
    private static final String B = "22222222-2222-4222-8222-222222222222";
    @Test public void profilesAndStoredCookieKeysAreSeparate() {
        BrowserAccountScope authority = new BrowserAccountScope();
        authority.bind(A); BrowserAccountScope.Binding a = authority.capture(A);
        authority.bind(B); BrowserAccountScope.Binding b = authority.capture(B);
        assertNotEquals(a.profile, b.profile);
        assertNotEquals(BrowserAccountScope.storageKey(a, "eleme"), BrowserAccountScope.storageKey(b, "eleme"));
        assertFalse(authority.isCurrent(a)); assertTrue(authority.isCurrent(b));
        assertEquals(BrowserAccountScope.profileName(A), BrowserAccountScope.profileName(A.toUpperCase()));
    }
    @Test public void internalTicketsAreSingleUseAndRevokedOnAccountChange() {
        BrowserAccountScope authority = new BrowserAccountScope(); authority.bind(A);
        BrowserAccountScope.Binding binding = authority.capture(A);
        String ticket = authority.issue(binding);
        assertSame(binding, authority.consume(ticket)); assertNull(authority.consume(ticket));
        String next = authority.issue(binding); authority.bind(B); assertNull(authority.consume(next));
        authority.bind(""); assertFalse(authority.isCurrent(binding));
    }
    @Test public void foreignAndMissingAccountCannotCaptureLoginAuthority() {
        BrowserAccountScope authority = new BrowserAccountScope(); authority.bind(A);
        try { authority.capture(B); fail(); } catch (IllegalStateException expected) { assertEquals("browser_account_changed", expected.getMessage()); }
        try { authority.capture(""); fail(); } catch (IllegalArgumentException expected) { assertEquals("browser_account_required", expected.getMessage()); }
        assertNull(authority.consume("external-intent-account"));
    }
    @Test public void recreationUsesSeparateSingleUseAuthorityWithoutReusingTheLaunchTicket() {
        BrowserAccountScope authority = new BrowserAccountScope(); authority.bind(A);
        BrowserAccountScope.Binding binding = authority.capture(A);
        String launch = authority.issue(binding); assertSame(binding, authority.consume(launch));
        String saved = authority.issueRestoration(binding);
        assertNull(authority.consume(launch)); assertSame(binding, authority.restore(saved)); assertNull(authority.restore(saved));
        assertNull(authority.restore(authority.issue(binding)));
        assertNull(authority.consume(authority.issueRestoration(binding)));
    }
    @Test public void backgroundRecreationOutlivesLaunchTicketButNeverOutlivesItsAccountOrProcess() {
        long[] now = { 1 }; BrowserAccountScope authority = new BrowserAccountScope(() -> now[0]); authority.bind(A);
        BrowserAccountScope.Binding binding = authority.capture(A);
        String launch = authority.issue(binding), saved = authority.issueRestoration(binding);
        now[0] += 120_000_000_000L;
        assertNull(authority.consume(launch)); assertSame(binding, authority.restore(saved));
        saved = authority.issueRestoration(binding); authority.bind(B); authority.bind(A); assertNull(authority.restore(saved));
        String revoked = authority.issueRestoration(authority.capture(A)); authority.bind(""); assertNull(authority.restore(revoked));
        authority.bind(A); saved = authority.issueRestoration(authority.capture(A));
        BrowserAccountScope restarted = new BrowserAccountScope(); restarted.bind(A); assertNull(restarted.restore(saved));
        now[0] += 43_200_000_000_001L; assertNull(authority.restore(saved));
    }
    @Test public void restoreAuthorityRemainsBoundedWhenAndroidSavesManyInstances() {
        BrowserAccountScope authority = new BrowserAccountScope(); authority.bind(A);
        BrowserAccountScope.Binding binding = authority.capture(A); String first = authority.issueRestoration(binding), last = "";
        for (int index = 0; index < 100; index++) last = authority.issueRestoration(binding);
        assertNull(authority.restore(first)); assertSame(binding, authority.restore(last));
    }
}

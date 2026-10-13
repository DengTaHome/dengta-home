package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.List;

public class OrderSearchRequestsTest {
    @Test public void readyReceiptCompletesOnceWithoutEndingThePage() {
        OrderSearchRequests requests = new OrderSearchRequests();
        OrderPageResultState page = new OrderPageResultState();
        List<String> results = new ArrayList<>();
        requests.begin("fictional-a", "account-a", (result, error) -> results.add(result));
        assertTrue(page.stage("{\"shops\":[]}"));
        page.markPublished();
        assertTrue(requests.finish("fictional-a", page.result(), null));
        assertTrue(page.stopped());
        assertEquals(1, results.size());
        assertFalse(page.stage("late-page-result"));
        assertFalse(requests.finish("fictional-a", page.result(), null));
        assertFalse(requests.finish("fictional-a", null, "cancelled"));
        assertEquals(1, results.size());
    }
    @Test public void scopeCancellationDropsOldResultsAndKeepsOtherWaits() {
        OrderSearchRequests requests = new OrderSearchRequests();
        List<String> results = new ArrayList<>();
        requests.begin("fictional-a", "account-a", (result, error) -> results.add("a:" + error));
        requests.begin("fictional-b", "account-b", (result, error) -> results.add("b:" + result));
        requests.cancelScope("account-a");
        assertEquals("a:cancelled", results.get(0));
        assertFalse(requests.finish("fictional-a", "late", null));
        assertFalse(requests.finish("unknown-request", "foreign", null));
        assertTrue(requests.finish("fictional-b", "ready", null));
        assertEquals("b:ready", results.get(1));
    }
    @Test public void timeoutAndManualCancelCompleteOnlyTheWait() {
        for (String reason : new String[]{"timeout", "cancelled", "launch_failed"}) {
            OrderSearchRequests requests = new OrderSearchRequests();
            OrderPageResultState page = new OrderPageResultState();
            List<String> errors = new ArrayList<>();
            requests.begin("fictional-request", "account", (result, error) -> errors.add(error));
            assertTrue(requests.finish("fictional-request", null, reason));
            assertFalse(page.stopped());
            assertTrue(page.stage("{\"status\":\"error\"}"));
            assertFalse(requests.finish("fictional-request", page.result(), null));
            assertEquals(1, errors.size()); assertEquals(reason, errors.get(0));
        }
    }
    @Test public void errorsAndVerificationRemainAvailableForManualReturn() {
        for (String status : new String[]{"verification", "logged_out", "error", "shop_not_found"}) {
            OrderPageResultState page = new OrderPageResultState();
            assertTrue(page.stage("{\"status\":\"" + status + "\"}"));
            assertTrue(page.stopped()); assertNotNull(page.result());
            assertFalse(page.stage("unsupported-page-late"));
        }
    }
}

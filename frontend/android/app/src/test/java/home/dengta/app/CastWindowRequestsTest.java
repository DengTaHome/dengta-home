package home.dengta.app;

import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class CastWindowRequestsTest {
    @Test public void onlyOnePendingActionAndOnlyMatchingReplyCanCompleteIt() {
        CastWindowRequests requests = new CastWindowRequests();
        List<String> results = new ArrayList<>();
        assertTrue(requests.begin("a", (error, file) -> results.add(error + file)));
        assertFalse(requests.begin("b", (error, file) -> fail("busy action was admitted")));
        assertFalse(requests.finish("wrong", "", "wrong.png"));
        assertTrue(requests.contains("a"));
        assertTrue(requests.finish("a", "", "saved.png"));
        assertFalse(requests.finish("a", "", "duplicate.png"));
        assertEquals(1, results.size());
        assertEquals("saved.png", results.get(0));
    }

    @Test public void timeoutOrDestroyCannotLetLateReplyFinishANewerAction() {
        CastWindowRequests requests = new CastWindowRequests();
        List<String> errors = new ArrayList<>();
        requests.begin("old", (error, file) -> errors.add(error));
        requests.cancel("timeout");
        assertFalse(requests.contains("old"));
        requests.begin("new", (error, file) -> errors.add(error));
        assertFalse(requests.finish("old", "", "late.png"));
        assertTrue(requests.contains("new"));
        requests.cancel("destroyed");
        requests.cancel("duplicate");
        assertEquals(java.util.Arrays.asList("timeout", "destroyed"), errors);
    }

    @Test public void invalidIdsCannotCreateAnUnfinishableRequest() {
        CastWindowRequests requests = new CastWindowRequests();
        assertFalse(requests.begin(null, (error, file) -> fail()));
        assertFalse(requests.begin("", (error, file) -> fail()));
        assertFalse(requests.begin("a", null));
        assertFalse(requests.contains(null));
    }
}

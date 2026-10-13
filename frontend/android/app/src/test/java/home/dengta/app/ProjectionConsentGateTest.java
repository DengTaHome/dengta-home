package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ProjectionConsentGateTest {
    @Test public void duplicateDialogsAndCallbacksAreRejected() {
        ProjectionConsentGate gate = new ProjectionConsentGate();
        assertTrue(gate.begin("one", "account:companion"));
        assertFalse(gate.begin("two", "account:companion"));
        assertFalse(gate.finish("wrong", "account:companion"));
        assertTrue(gate.finish("one", "account:companion"));
        assertFalse(gate.finish("one", "account:companion"));
    }
    @Test public void stopKeepsDialogSlotLockedUntilItsCancelledCallbackReturns() {
        ProjectionConsentGate gate = new ProjectionConsentGate();
        gate.begin("old", "scope");
        gate.cancel();
        assertFalse(gate.begin("new", "scope"));
        assertFalse(gate.finish("old", "scope"));
        assertTrue(gate.begin("new", "scope"));
        assertFalse(gate.finish("old", "scope"));
        assertTrue(gate.finish("new", "scope"));
    }
    @Test public void AccountOrCompanionSwitchInvalidatesConsent() {
        ProjectionConsentGate gate = new ProjectionConsentGate();
        gate.begin("one", "a:one");
        assertFalse(gate.finish("one", "b:one"));
        gate.begin("two", "a:one");
        assertFalse(gate.finish("two", "a:two"));
        assertFalse(gate.begin(null, "scope"));
    }
    @Test public void oldScopeStopCannotCancelANewerScopeDialog() {
        ProjectionConsentGate gate = new ProjectionConsentGate();
        gate.begin("new", "b:two");
        gate.cancel("a:one");
        assertTrue(gate.finish("new", "b:two"));
        gate.begin("same", "b:two");
        gate.cancel("b:two");
        assertFalse(gate.finish("same", "b:two"));
    }
}

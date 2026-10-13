package home.dengta.app;

final class ProjectionConsentGate {
    private String pendingId;
    private String pendingScope;
    private boolean cancelled;

    synchronized boolean begin(String id, String scope) {
        if (pendingId != null || id == null || id.isEmpty()) return false;
        pendingId = id;
        pendingScope = scope;
        cancelled = false;
        return true;
    }

    synchronized void cancel() {
        // Retain the lease until the system dialog returns: Capacitor has one callback slot.
        if (pendingId != null) cancelled = true;
    }

    synchronized void cancel(String scope) {
        if (scope == null || scope.isEmpty() || java.util.Objects.equals(pendingScope, scope)) cancel();
    }

    synchronized boolean finish(String id, String scope) {
        if (pendingId == null || !pendingId.equals(id)) return false;
        boolean accepted = !cancelled && java.util.Objects.equals(pendingScope, scope);
        pendingId = null;
        pendingScope = null;
        cancelled = false;
        return accepted;
    }
}

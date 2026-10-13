package home.dengta.app;

/** One outstanding window action; timeout and late replies settle it only once. */
final class CastWindowRequests {
    interface Completion { void finish(String errorCode, String fileName); }
    private String pendingId;
    private Completion completion;

    synchronized boolean begin(String id, Completion callback) {
        if (pendingId != null || id == null || id.isEmpty() || callback == null) return false;
        pendingId = id;
        completion = callback;
        return true;
    }

    synchronized boolean contains(String id) { return id != null && id.equals(pendingId); }

    synchronized boolean finish(String id, String errorCode, String fileName) {
        if (!contains(id)) return false;
        Completion callback = completion;
        pendingId = null;
        completion = null;
        callback.finish(errorCode, fileName);
        return true;
    }

    synchronized void cancel(String errorCode) { finish(pendingId, errorCode, ""); }
}

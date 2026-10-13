package home.dengta.app;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;

final class OrderSearchRequests {
    interface Completion { void finish(String result, String error); }
    private static final class Pending {
        final String scope;
        final Completion completion;
        Pending(String scope, Completion completion) { this.scope = scope; this.completion = completion; }
    }
    private final Map<String, Pending> requests = new LinkedHashMap<>();

    synchronized void begin(String id, String scope, Completion completion) {
        if (id == null || id.isEmpty() || requests.containsKey(id)) throw new IllegalArgumentException("duplicate_search_request");
        requests.put(id, new Pending(scope, completion));
    }

    synchronized boolean finish(String id, String result, String error) {
        Pending pending = requests.remove(id);
        if (pending == null) return false;
        pending.completion.finish(result, error);
        return true;
    }

    synchronized void cancelScope(String scope) {
        for (String id : new ArrayList<>(requests.keySet())) {
            Pending pending = requests.get(id);
            if (pending != null && pending.scope.equals(scope)) finish(id, null, "cancelled");
        }
    }

    synchronized void cancelAll() {
        for (String id : new ArrayList<>(requests.keySet())) finish(id, null, "cancelled");
    }
}

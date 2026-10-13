package home.dengta.app;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

final class DlnaDiscovery {
    static final class Snapshot {
        final boolean ssdpReady;
        final boolean httpReady;
        final boolean active;
        final String status;
        final String errorCode;

        Snapshot(boolean started, boolean ssdpReady, boolean httpReady,
                 String ssdpError, String httpError) {
            this.ssdpReady = ssdpReady;
            this.httpReady = httpReady;
            errorCode = !httpError.isEmpty() ? httpError : ssdpError;
            active = started && ssdpReady && httpReady && errorCode.isEmpty();
            status = !started ? "stopped" : !errorCode.isEmpty() ? "error"
                : active ? "ready" : "starting";
        }
    }

    private final long aliveIntervalMs;
    private long generation;
    private boolean started;
    private boolean ssdpReady;
    private boolean httpReady;
    private String ssdpError = "";
    private String httpError = "";
    private ScheduledExecutorService aliveExecutor;
    private Runnable alive;

    DlnaDiscovery() { this(30_000); }

    DlnaDiscovery(long aliveIntervalMs) {
        if (aliveIntervalMs <= 0) throw new IllegalArgumentException("alive interval");
        this.aliveIntervalMs = aliveIntervalMs;
    }

    synchronized long begin(Runnable alive) {
        stop();
        started = true;
        this.alive = alive;
        long current = generation;
        // receive() can block indefinitely; announcements need their own executor.
        aliveExecutor = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "dengta-dlna-alive");
            thread.setDaemon(true);
            return thread;
        });
        aliveExecutor.scheduleWithFixedDelay(() -> announce(current), aliveIntervalMs,
            aliveIntervalMs, TimeUnit.MILLISECONDS);
        return current;
    }

    synchronized void stop() {
        generation++;
        started = false;
        ssdpReady = false;
        httpReady = false;
        ssdpError = "";
        httpError = "";
        alive = null;
        if (aliveExecutor != null) aliveExecutor.shutdownNow();
        aliveExecutor = null;
    }

    synchronized boolean isCurrent(long current) {
        return started && generation == current;
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(started, ssdpReady, httpReady, ssdpError, httpError);
    }

    synchronized boolean ready(long current, boolean http) {
        if (!isCurrent(current)) return false;
        boolean wasActive = snapshot().active;
        if (http) { httpReady = true; httpError = ""; }
        else { ssdpReady = true; ssdpError = ""; }
        if (!wasActive && snapshot().active) aliveExecutor.execute(() -> announce(current));
        return true;
    }

    synchronized boolean failed(long current, boolean http, String errorCode) {
        if (!isCurrent(current)) return false;
        if (http) { httpReady = false; httpError = errorCode; }
        else { ssdpReady = false; ssdpError = errorCode; }
        return true;
    }

    private void announce(long current) {
        Runnable task;
        synchronized (this) {
            if (!isCurrent(current) || !snapshot().active) return;
            task = alive;
        }
        task.run();
    }
}

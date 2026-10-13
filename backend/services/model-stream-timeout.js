const MODEL_STREAM_CONNECT_TIMEOUT_MS = 300_000;
const MODEL_STREAM_IDLE_TIMEOUT_MS = 300_000;

function createModelStreamWatchdog({
    onTimeout,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    connectTimeoutMs = MODEL_STREAM_CONNECT_TIMEOUT_MS,
    idleTimeoutMs = MODEL_STREAM_IDLE_TIMEOUT_MS
} = {}) {
    if (typeof onTimeout !== "function") {
        throw new TypeError("Model stream watchdog requires an onTimeout callback.");
    }
    let timer = null;

    function arm(phase, delay) {
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => onTimeout(phase), delay);
    }

    return {
        start() {
            arm("connect", connectTimeoutMs);
        },
        pulse() {
            arm("idle", idleTimeoutMs);
        },
        stop() {
            if (timer !== null) clearTimer(timer);
            timer = null;
        }
    };
}

module.exports = {
    MODEL_STREAM_CONNECT_TIMEOUT_MS,
    MODEL_STREAM_IDLE_TIMEOUT_MS,
    createModelStreamWatchdog
};

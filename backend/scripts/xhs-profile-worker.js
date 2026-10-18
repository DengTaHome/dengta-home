const path = require("node:path");
const http = require("node:http");
const { createXhsProfileGateway, createBrowserProfileFactory } = require("../services/xhs-profile-gateway");
const { createEncryptedXhsProfileStore } = require("../services/xhs-profile-store");
const { createXhsWebOperations } = require("../services/xhs-web-operations");

async function startWorker({ env = process.env, playwright = null } = {}) {
    if (String(env.XHS_SERVICE_TOKEN || "").length < 32 || String(env.XHS_PROFILE_ENCRYPTION_KEY || "").length < 32 || !path.isAbsolute(String(env.XHS_PROFILE_DIRECTORY || ""))) {
        throw Object.assign(new Error("XHS worker configuration missing"), { code: "xhs_worker_configuration_required" });
    }
    const port = Number(env.XHS_GATEWAY_PORT || 3014);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("XHS port invalid"), { code: "xhs_worker_configuration_required" });
    let runtime = playwright;
    if (!runtime) {
        try { runtime = require(env.XHS_PLAYWRIGHT_MODULE || "playwright"); }
        catch { throw Object.assign(new Error("XHS browser runtime missing"), { code: "xhs_browser_runtime_required" }); }
    }
    let browser;
    try { browser = await runtime.chromium.launch({ headless: true, ...(env.XHS_BROWSER_CHANNEL ? { channel: env.XHS_BROWSER_CHANNEL } : {}) }); }
    catch { throw Object.assign(new Error("XHS browser launch failed"), { code: "xhs_browser_unavailable" }); }
    const store = createEncryptedXhsProfileStore({ directory: env.XHS_PROFILE_DIRECTORY, secret: env.XHS_PROFILE_ENCRYPTION_KEY });
    const gateway = createXhsProfileGateway({ token: env.XHS_SERVICE_TOKEN, createProfile: createBrowserProfileFactory({ browser, store, operations: createXhsWebOperations() }) });
    let server;
    try {
        server = await new Promise((resolve, reject) => {
            const listener = http.createServer({ maxHeaderSize: 64 * 1024 }, gateway.app);
            listener.listen(port, env.XHS_GATEWAY_HOST || "127.0.0.1", () => resolve(listener)); listener.once("error", reject);
        });
    } catch { await gateway.close(); await browser.close(); throw Object.assign(new Error("XHS listener failed"), { code: "xhs_worker_listen_failed" }); }
    return { server, async close() {
        const stopped = new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        await gateway.close(); await browser.close(); await stopped;
    } };
}
if (require.main === module) {
    startWorker().then(worker => {
        console.log(JSON.stringify({ status: "ready", isolation: "profile-v1", browser: "independent-contexts", adapter: "read-only-webpage" }));
        let stopping = false;
        const stop = () => { if (stopping) return; stopping = true; void worker.close().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); };
        process.once("SIGINT", stop); process.once("SIGTERM", stop);
    }).catch(error => { console.error(JSON.stringify({ status: "error", code: error.code || "xhs_browser_unavailable" })); process.exitCode = 1; });
}
module.exports = { startWorker };

const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createCoWatchRouter } = require("../routes/co-watch");
const { runCoWatchFrame } = require("../services/co-watch");
const { createRequestScope } = require("../services/request-scope");

const database = { from() {} };
const sessionId = "2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50";
const baseFrame = {
    sessionId,
    epoch: 1,
    sequence: 1,
    capturedAt: "2026-08-13T06:00:00.000Z",
    mimeType: "image/jpeg"
};

function frameDependencies(overrides = {}) {
    const calls = { generated: 0, saved: 0, delivered: 0 };
    return {
        calls,
        options: {
            database,
            frame: baseFrame,
            image: Buffer.from("jpeg"),
            findReaction: async () => null,
            findConversation: async () => ({ id: "conversation-latest" }),
            findSession: async () => ({
                id: sessionId,
                status: "active",
                conversation_id: "conversation-1",
                cadence_seconds: 90
            }),
            getSettings: async () => ({ ai_name: "Companion" }),
            loadChatContext: async () => ({ messages: [], memories: [] }),
            generateReply: async () => {
                calls.generated += 1;
                return { text: "I saw that scene." };
            },
            saveMessage: async () => {
                calls.saved += 1;
                return { id: 701 };
            },
            touchConversation: async () => {},
            ensureDeliveryEvent: async () => {
                calls.delivered += 1;
            },
            recordSessionReaction: async () => ({
                id: sessionId,
                status: "active",
                cadence_seconds: 90
            }),
            ...overrides
        }
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function testRequestScope() {
    const userId = "8f4a99b7-338a-4d31-a207-093ec58ac866";
    const companionId = "70aa0a6a-bb20-44ca-b8f4-73f9c547a6d6";
    return createRequestScope({
        adminSupabase: { from() {} },
        user: { id: userId },
        profile: { id: userId, status: "active", role: "member" },
        companions: [
            { id: companionId, user_id: userId, status: "active" }
        ],
        companion: { id: companionId, user_id: userId, status: "active" }
    });
}

async function routeCancellationFixture() {
    const generationStarted = deferred();
    const releaseGeneration = deferred();
    const requestFinished = deferred();
    let saved = 0;
    let delivered = 0;
    const app = express();
    const scope = testRequestScope();
    app.use((req, _res, next) => {
        req.scope = scope;
        next();
    });
    app.use(
        "/api/v2/co-watch",
        createCoWatchRouter({
            findReaction: async () => null,
            findConversation: async () => ({ id: "conversation-latest" }),
            findSession: async () => ({
                id: sessionId,
                status: "active",
                conversation_id: "conversation-1",
                cadence_seconds: 90
            }),
            getSettings: async () => ({ ai_name: "Companion" }),
            loadChatContext: async () => ({ messages: [], memories: [] }),
            generateReply: async () => {
                generationStarted.resolve();
                await releaseGeneration.promise;
                return { text: "This response arrived after disconnect." };
            },
            saveMessage: async () => {
                saved += 1;
                return { id: 702 };
            },
            touchConversation: async () => {},
            ensureDeliveryEvent: async () => {
                delivered += 1;
                requestFinished.resolve(null);
            },
            recordSessionReaction: async () => ({
                id: sessionId,
                status: "active",
                cadence_seconds: 90
            })
        })
    );
    app.use((error, _req, _res, _next) => {
        requestFinished.resolve(error);
    });

    const server = http.createServer(app);
    const clientDisconnected = deferred();
    server.on("connection", (socket) => {
        socket.once("close", clientDisconnected.resolve);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const request = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: `/api/v2/co-watch/frame?session_id=${sessionId}&epoch=1&sequence=9`,
        headers: {
            "content-type": "image/jpeg",
            "content-length": 4
        }
    });
    request.on("error", () => {});
    request.end("jpeg");

    await generationStarted.promise;
    request.destroy();
    await clientDisconnected.promise;
    releaseGeneration.resolve();
    const error = await requestFinished.promise;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    return { error, saved, delivered };
}

async function main() {
    {
        const fixture = frameDependencies({ isRequestActive: () => false });
        await assert.rejects(
            runCoWatchFrame(fixture.options),
            (error) =>
                error?.status === 499 &&
                error?.code === "co_watch_request_cancelled"
        );
        assert.deepEqual(fixture.calls, {
            generated: 0,
            saved: 0,
            delivered: 0
        });
    }

    {
        let active = true;
        const fixture = frameDependencies({
            isRequestActive: () => active,
            generateReply: async () => {
                fixture.calls.generated += 1;
                active = false;
                return { text: "This response must not be saved." };
            }
        });
        await assert.rejects(
            runCoWatchFrame(fixture.options),
            (error) =>
                error?.status === 499 &&
                error?.code === "co_watch_request_cancelled"
        );
        assert.deepEqual(fixture.calls, {
            generated: 1,
            saved: 0,
            delivered: 0
        });
    }

    {
        let checks = 0;
        const fixture = frameDependencies({
            isRequestActive: () => {
                checks += 1;
                return checks < 5;
            }
        });
        await assert.rejects(
            runCoWatchFrame(fixture.options),
            (error) =>
                error?.status === 499 &&
                error?.code === "co_watch_request_cancelled"
        );
        assert.equal(checks, 5);
        assert.deepEqual(fixture.calls, {
            generated: 1,
            saved: 0,
            delivered: 0
        });
    }

    {
        let sessionReads = 0;
        const fixture = frameDependencies({
            findSession: async () => {
                sessionReads += 1;
                return {
                    id: sessionId,
                    status: sessionReads === 1 ? "active" : "ended",
                    conversation_id: "conversation-1",
                    cadence_seconds: 90
                };
            }
        });
        await assert.rejects(
            runCoWatchFrame(fixture.options),
            (error) =>
                error?.status === 409 &&
                error?.code === "co_watch_session_finished"
        );
        assert.equal(sessionReads, 2);
        assert.deepEqual(fixture.calls, {
            generated: 1,
            saved: 0,
            delivered: 0
        });
    }

    {
        let active = true;
        const fixture = frameDependencies({
            isRequestActive: () => active,
            findReaction: async () => {
                active = false;
                return {
                    id: 700,
                    conversation_id: "conversation-1",
                    content: "Previously generated reaction."
                };
            }
        });
        await assert.rejects(
            runCoWatchFrame(fixture.options),
            (error) =>
                error?.status === 499 &&
                error?.code === "co_watch_request_cancelled"
        );
        assert.deepEqual(fixture.calls, {
            generated: 0,
            saved: 0,
            delivered: 0
        });
    }

    {
        const result = await routeCancellationFixture();
        assert.equal(result.error?.status, 499);
        assert.equal(result.error?.code, "co_watch_request_cancelled");
        assert.equal(result.saved, 0);
        assert.equal(result.delivered, 0);
    }

    console.log("co-watch request lifecycle tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

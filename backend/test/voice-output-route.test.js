const assert = require("node:assert/strict");
const express = require("express");
const { createVoiceOutputRouter } = require("../routes/voice-output");
const { createRequestScope } = require("../services/request-scope");

const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";

function createAdminDatabase() {
    const state = { row: null };
    function builder(action) {
        let resultPromise = null;
        const execute = () => {
            if (!resultPromise) resultPromise = Promise.resolve().then(action);
            return resultPromise;
        };
        const value = {
            eq() {
                return value;
            },
            select() {
                return value;
            },
            maybeSingle() {
                return execute();
            },
            single() {
                return execute();
            },
            then(resolve, reject) {
                return execute().then(resolve, reject);
            }
        };
        return value;
    }
    return {
        state,
        from(table) {
            assert.equal(table, "voice_provider_profiles");
            return {
                select() {
                    return builder(() => ({
                        data: state.row ? { ...state.row } : null,
                        error: null
                    }));
                },
                insert(values) {
                    return builder(() => {
                        state.row = { ...values };
                        return { data: { ...state.row }, error: null };
                    });
                },
                update(values) {
                    return builder(() => {
                        state.row = { ...(state.row || {}), ...values };
                        return { data: { ...state.row }, error: null };
                    });
                },
                delete() {
                    return builder(() => {
                        state.row = null;
                        return { data: null, error: null };
                    });
                }
            };
        }
    };
}

async function run() {
    const adminSupabase = createAdminDatabase();
    const companion = {
        id: companionId,
        user_id: userId,
        name: "Companion",
        status: "active",
        is_default: true
    };
    const scope = createRequestScope({
        adminSupabase,
        user: { id: userId, email: "owner@example.test" },
        profile: { id: userId, role: "owner", status: "active" },
        companions: [companion],
        companion
    });
    const env = {
        MCP_ENCRYPTION_KEY: "http-route-voice-encryption-secret-long-enough",
        EXPRESSIVE_TTS_PROVIDER: "minimax",
        MINIMAX_API_KEY: "global-minimax-key",
        MINIMAX_TTS_VOICE_ID: "global-minimax-voice"
    };
    const app = express();
    let upstreamCalls = 0;
    app.use(express.json());
    app.use((req, _res, next) => {
        req.scope = scope;
        next();
    });
    app.use(
        "/api/v2/voice-output",
        createVoiceOutputRouter({
            env,
            async fetchImpl() {
                upstreamCalls += 1;
                throw new Error("disabled preview must not call upstream");
            }
        })
    );
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}/api/v2/voice-output`;
    try {
        const defaultResponse = await fetch(base);
        assert.equal(defaultResponse.status, 200);
        const defaultBody = await defaultResponse.json();
        assert.equal(defaultBody.voice_output.provider, "server_default");
        assert.equal(defaultBody.voice_output.enabled, true);
        assert.equal(defaultBody.voice_output.configured, true);
        assert.equal(defaultBody.voice_output.chinese_fallback_available, true);
        assert.equal(defaultBody.voice_output.model_options.length >= 20, true);
        assert.deepEqual(defaultBody.voice_output.region_options, ["global", "eu", "au"]);
        const statusBody = await (await fetch(`${base}/status`)).json();
        assert.equal(statusBody.profile.provider, "server_default");
        assert.equal(statusBody.profile.chinese_fallback_available, true);
        assert.equal(statusBody.profile.model_options.length >= 20, true);

        const saveResponse = await fetch(base, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                provider: "deepgram",
                enabled: false,
                model: "aura-2-helena-en",
                region: "global",
                speed: 1,
                credential: "deepgram-route-secret"
            })
        });
        assert.equal(saveResponse.status, 200);
        const saved = (await saveResponse.json()).voice_output;
        assert.equal(saved.provider, "deepgram");
        assert.equal(saved.enabled, false);
        assert.equal(saved.configured, false);
        assert.equal(saved.credential_configured, true);
        assert.equal(saved.chinese_fallback_available, true);
        assert.doesNotMatch(JSON.stringify(saved), /deepgram-route-secret|secret_ciphertext/);

        const readBack = (await (await fetch(base)).json()).voice_output;
        assert.equal(readBack.enabled, false);
        assert.equal(readBack.provider, "deepgram");
        assert.equal(readBack.configured, false);

        const disabledPreview = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "This must stay silent." })
        });
        assert.equal(disabledPreview.status, 409);
        const disabledBody = await disabledPreview.json();
        assert.equal(disabledBody.error, "VOICE_OUTPUT_DISABLED");
        assert.equal(upstreamCalls, 0);
    } finally {
        await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
    }
}

run()
    .then(() => console.log("voice output authenticated HTTP route tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

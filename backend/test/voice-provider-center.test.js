const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createVoiceProviderCenter,
    publicVoiceProfile,
    publicVoiceProviderError
} = require("../services/voice-provider-center");
const { decryptCredential } = require("../services/mcp-device-center");

const env = {
    MCP_ENCRYPTION_KEY: "voice-provider-encryption-secret-long-enough"
};

function createDatabase() {
    const state = { row: null };
    function writeResult(values, insert = false) {
        state.row = {
            ...(insert ? {} : state.row || {}),
            ...values
        };
        return {
            select() {
                return {
                    async single() {
                        return { data: { ...state.row }, error: null };
                    }
                };
            },
            then(resolve) {
                return Promise.resolve(resolve({ data: null, error: null }));
            }
        };
    }
    return {
        state,
        from(table) {
            assert.equal(table, "voice_provider_profiles");
            return {
                select() {
                    return {
                        async maybeSingle() {
                            return { data: state.row ? { ...state.row } : null, error: null };
                        }
                    };
                },
                insert(values) {
                    return writeResult(values, true);
                },
                update(values) {
                    return writeResult(values, false);
                },
                async delete() {
                    state.row = null;
                    return { data: null, error: null };
                }
            };
        }
    };
}

function audioResponse() {
    const audio = Buffer.from("voice-test-mp3");
    return {
        ok: true,
        status: 200,
        headers: {
            get(name) {
                if (name.toLowerCase() === "content-type") return "audio/mpeg";
                if (name.toLowerCase() === "content-length") return String(audio.length);
                return null;
            }
        },
        async arrayBuffer() {
            return Uint8Array.from(audio).buffer;
        }
    };
}

async function run() {
    const database = createDatabase();
    let authHeader = "";
    const center = createVoiceProviderCenter({
        database,
        env,
        async fetchImpl(_url, options) {
            authHeader = options.headers.Authorization;
            return audioResponse();
        }
    });

    const defaultStatus = await center.status();
    assert.equal(defaultStatus.profile.provider, "server_default");
    assert.equal(defaultStatus.profile.enabled, true);
    assert.equal(defaultStatus.profile.configured, false);
    assert.equal(defaultStatus.profile.chinese_fallback_available, false);
    assert.equal(
        defaultStatus.profile.model_options.some(
            (item) => item.id === "aura-2-helena-en"
        ),
        true
    );
    assert.deepEqual(defaultStatus.profile.region_options, ["global", "eu", "au"]);
    await assert.rejects(
        () => center.saveProfile({ provider: "deepgram", enabled: true }),
        (error) => error.code === "VOICE_PROVIDER_CREDENTIAL_REQUIRED"
    );

    const saved = await center.saveProfile({
        provider: "deepgram",
        enabled: true,
        model: "aura-2-helena-en",
        region: "eu",
        speed: 1.1,
        credential: "tenant-deepgram-key"
    });
    assert.equal(saved.configured, true);
    assert.equal(saved.credential_configured, true);
    assert.equal(saved.region, "eu");
    assert.doesNotMatch(JSON.stringify(saved), /tenant-deepgram-key|secret_ciphertext/);
    assert.notEqual(database.state.row.secret_ciphertext, "tenant-deepgram-key");
    assert.equal(
        decryptCredential(database.state.row.secret_ciphertext, env),
        "tenant-deepgram-key"
    );

    const previousCiphertext = database.state.row.secret_ciphertext;
    const updated = await center.saveProfile({
        enabled: true,
        model: "aura-2-thalia-en",
        region: "global",
        speed: 1,
        credential: ""
    });
    assert.equal(updated.configured, true);
    assert.equal(database.state.row.secret_ciphertext, previousCiphertext);

    const runtime = await center.resolveRuntimeProfile();
    assert.equal(runtime.provider, "deepgram");
    assert.equal(runtime.apiKey, "tenant-deepgram-key");
    assert.equal(runtime.model, "aura-2-thalia-en");
    assert.ok(Object.hasOwn(runtime, "updatedAt"));

    const speech = await center.testProfile({ text: "Hello from DengTa." });
    assert.equal(speech.provider, "deepgram");
    assert.equal(authHeader, "Token tenant-deepgram-key");
    assert.equal(database.state.row.last_status, "connected");
    assert.equal(JSON.stringify(await center.status()).includes("tenant-deepgram-key"), false);

    await center.saveProfile({ enabled: false, credential: "" });
    assert.deepEqual(await center.resolveRuntimeProfile(), {
        provider: "disabled",
        updatedAt: database.state.row.updated_at
    });
    await assert.rejects(
        () =>
            require("../services/expressive-speech").synthesizeExpressiveSpeech({
                text: "hello",
                providerConfig: { provider: "disabled" },
                env
            }),
        (error) => error.code === "VOICE_OUTPUT_DISABLED" && error.status === 409
    );
    assert.deepEqual(await center.deleteProfile(), { deleted: true });
    assert.deepEqual(await center.deleteProfile(), { deleted: false });

    const publicValue = publicVoiceProfile({
        enabled: true,
        region: "global",
        model: "aura-2-helena-en",
        speed: 1,
        secret_ciphertext: "must-not-leak",
        last_status: "error",
        last_error: "upstream leaked detail"
    });
    assert.equal(publicValue.configured, true);
    assert.doesNotMatch(JSON.stringify(publicValue), /must-not-leak|upstream leaked detail/);
    const safe = publicVoiceProviderError(new Error("raw secret failure"));
    assert.equal(safe.code, "VOICE_PROVIDER_CENTER_ERROR");
    assert.doesNotMatch(safe.message, /raw secret failure/);

    const migration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "027_voice_provider_profiles.sql"),
        "utf8"
    );
    assert.match(migration, /primary key \(user_id, companion_id\)/i);
    assert.match(migration, /references public\.companions\(user_id, id\)/i);
    assert.match(migration, /AES-256-GCM|ciphertext/i);
    assert.match(migration, /revoke all[\s\S]*anon, authenticated/i);

    const route = fs.readFileSync(
        path.join(__dirname, "..", "routes", "voice-output.js"),
        "utf8"
    );
    assert.match(route, /requireRequestScope/);
    assert.match(route, /router\.get\("\/"/);
    assert.match(route, /router\.put\("\/"/);
    assert.match(route, /router\.post\("\/"/);
    assert.match(route, /router\.delete\("\/"/);

    const server = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(
        server,
        /app\.use\("\/api\/v2\/voice-output", createVoiceOutputRouter\(\)\)/
    );
    assert.match(server, /createVoiceProviderCenter[\s\S]*resolveRuntimeProfile/);
    assert.match(server, /synthesizeExpressiveSpeech\(\{[\s\S]*providerConfig/);
    assert.match(server, /"X-DengTa-Voice-Model": speech\.model \|\| ""/);
    assert.match(
        server,
        /req\.scope\?\.userId[\s\S]*req\.scope\?\.companionId[\s\S]*providerConfig\?\.updatedAt/
    );
}

run()
    .then(() => console.log("voice provider center tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

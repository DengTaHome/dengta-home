const assert = require("node:assert/strict");
const {
    DEEPGRAM_ENDPOINTS,
    MAX_DEEPGRAM_AUDIO_BYTES,
    buildDeepgramRequest,
    deepgramModelLanguage,
    normalizeDeepgramModel,
    normalizeDeepgramRegion,
    readDeepgramAudio,
    synthesizeDeepgramSpeech
} = require("../services/deepgram-speech");

assert.equal(DEEPGRAM_ENDPOINTS.global, "https://api.deepgram.com/v1/speak");
assert.equal(DEEPGRAM_ENDPOINTS.eu, "https://api.eu.deepgram.com/v1/speak");
assert.equal(DEEPGRAM_ENDPOINTS.au, "https://api.au.deepgram.com/v1/speak");
assert.equal(normalizeDeepgramRegion("EU"), "eu");
assert.throws(() => normalizeDeepgramRegion("custom"), /global.*eu.*au/);
assert.equal(normalizeDeepgramModel("AURA-2-HELENA-EN"), "aura-2-helena-en");
assert.equal(deepgramModelLanguage("aura-2-izanami-ja"), "ja");
assert.throws(() => normalizeDeepgramModel("aura-2-unknown-en"), /Aura-2/);
assert.throws(() => normalizeDeepgramModel("aura-2-helena-zh"), /Aura-2/);

const request = buildDeepgramRequest({
    region: "au",
    model: "aura-2-thalia-en",
    speed: 99
});
const requestUrl = new URL(request.url);
assert.equal(requestUrl.origin, "https://api.au.deepgram.com");
assert.equal(requestUrl.pathname, "/v1/speak");
assert.equal(requestUrl.searchParams.get("model"), "aura-2-thalia-en");
assert.equal(requestUrl.searchParams.get("encoding"), "mp3");
assert.equal(requestUrl.searchParams.get("speed"), "1.5");

function audioResponse(audio = Buffer.from("fake-mp3"), contentType = "audio/mpeg") {
    return {
        ok: true,
        status: 200,
        headers: {
            get(name) {
                if (name.toLowerCase() === "content-type") return contentType;
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
    const streamed = await readDeepgramAudio({
        body: {
            getReader() {
                const chunks = [Uint8Array.from([1, 2]), Uint8Array.from([3])];
                return {
                    async read() {
                        return chunks.length
                            ? { done: false, value: chunks.shift() }
                            : { done: true };
                    },
                    releaseLock() {}
                };
            }
        }
    });
    assert.deepEqual(streamed, Buffer.from([1, 2, 3]));

    let captured;
    const speech = await synthesizeDeepgramSpeech({
        text: "x".repeat(2100),
        apiKey: "deepgram-secret-value",
        model: "aura-2-helena-en",
        region: "global",
        speed: 0.2,
        async fetchImpl(url, options) {
            captured = { url, options };
            return audioResponse();
        }
    });
    assert.equal(new URL(captured.url).origin, "https://api.deepgram.com");
    assert.equal(new URL(captured.url).searchParams.get("speed"), "0.7");
    assert.equal(captured.options.headers.Authorization, "Token deepgram-secret-value");
    assert.equal(captured.options.headers.Accept, "audio/mpeg");
    assert.equal(Array.from(JSON.parse(captured.options.body).text).length, 2000);
    assert.equal(speech.provider, "deepgram");
    assert.equal(speech.model, "aura-2-helena-en");
    assert.equal(speech.contentType, "audio/mpeg");
    assert.deepEqual(speech.audio, Buffer.from("fake-mp3"));

    await assert.rejects(
        () => synthesizeDeepgramSpeech({ text: "hello", apiKey: "" }),
        (error) => error.code === "DEEPGRAM_CREDENTIAL_REQUIRED"
    );
    await assert.rejects(
        () => synthesizeDeepgramSpeech({
            text: "hello",
            apiKey: "never-leak-this",
            async fetchImpl() {
                return audioResponse(Buffer.from("json"), "application/json");
            }
        }),
        (error) => {
            assert.equal(error.code, "DEEPGRAM_AUDIO_TYPE_INVALID");
            assert.doesNotMatch(error.message, /never-leak-this/);
            return true;
        }
    );
    await assert.rejects(
        () => synthesizeDeepgramSpeech({
            text: "hello",
            apiKey: "never-leak-this",
            async fetchImpl() {
                return {
                    ...audioResponse(),
                    headers: {
                        get(name) {
                            if (name.toLowerCase() === "content-type") return "audio/mpeg";
                            if (name.toLowerCase() === "content-length") {
                                return String(MAX_DEEPGRAM_AUDIO_BYTES + 1);
                            }
                            return null;
                        }
                    }
                };
            }
        }),
        (error) => error.code === "DEEPGRAM_AUDIO_TOO_LARGE"
    );
    await assert.rejects(
        () => synthesizeDeepgramSpeech({
            text: "hello",
            apiKey: "never-leak-this",
            async fetchImpl() {
                return { ok: false, status: 401, headers: { get: () => null } };
            }
        }),
        (error) => {
            assert.equal(error.code, "DEEPGRAM_AUTH_FAILED");
            assert.doesNotMatch(error.message, /never-leak-this/);
            return true;
        }
    );
    await assert.rejects(
        () => synthesizeDeepgramSpeech({
            text: "hello",
            apiKey: "never-leak-this",
            async fetchImpl() {
                throw new Error("network failure includes never-leak-this");
            }
        }),
        (error) => {
            assert.equal(error.code, "DEEPGRAM_CONNECTION_FAILED");
            assert.doesNotMatch(error.message, /never-leak-this/);
            return true;
        }
    );
}

run()
    .then(() => console.log("deepgram speech adapter tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

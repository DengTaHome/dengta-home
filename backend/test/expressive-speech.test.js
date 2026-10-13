const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    buildMiniMaxRequest,
    decodeMiniMaxAudio,
    getExpressiveSpeechCapabilities,
    inferSpeechEmotion,
    isSafeSpeechMessageId,
    normalizeEmotionHint,
    normalizeMiniMaxEndpoint,
    prepareSpeechText,
    synthesizeExpressiveSpeech
} = require("../services/expressive-speech");
assert.equal(isSafeSpeechMessageId("65"), true);
assert.equal(isSafeSpeechMessageId("9223372036854775807"), true);
assert.equal(
    isSafeSpeechMessageId("00000000-0000-4000-8000-000000000000"),
    false
);
assert.equal(isSafeSpeechMessageId("0"), false);

assert.deepEqual(getExpressiveSpeechCapabilities({}), {
    configured: false,
    provider_configured: false,
    api_key_configured: false,
    voice_configured: false,
    emotion_supported: false,
    device_tts_fallback: false
});
const keyOnlyCapabilities = getExpressiveSpeechCapabilities({
    MINIMAX_API_KEY: "secret"
});
assert.equal(keyOnlyCapabilities.provider_configured, true);
assert.equal(keyOnlyCapabilities.api_key_configured, true);
assert.equal(keyOnlyCapabilities.voice_configured, false);
assert.equal(keyOnlyCapabilities.configured, false);
const configuredCapabilities = getExpressiveSpeechCapabilities({
    EXPRESSIVE_TTS_PROVIDER: "minimax",
    MINIMAX_API_KEY: "secret",
    MINIMAX_TTS_VOICE_ID: "test-voice"
});
assert.equal(configuredCapabilities.configured, true);
assert.doesNotMatch(
    JSON.stringify(configuredCapabilities),
    /secret|test-voice|speech-2\.8|api\.minimax/i
);
assert.equal(
    normalizeMiniMaxEndpoint("https://api.minimax.io/v1/t2a_v2/"),
    "https://api.minimax.io/v1/t2a_v2"
);
assert.throws(
    () => normalizeMiniMaxEndpoint("https://example.com/v1/t2a_v2"),
    /允许列表/
);

assert.equal(normalizeEmotionHint("tender"), "calm");
assert.equal(normalizeEmotionHint("excited"), "happy");
assert.equal(normalizeEmotionHint("neutral"), "");
assert.equal(normalizeEmotionHint("auto"), "");
assert.equal(normalizeEmotionHint("unknown"), "");
assert.equal(inferSpeechEmotion("嘿嘿，我也很想你呀。"), "happy");
assert.equal(inferSpeechEmotion("别怕，我会陪着你。"), "fearful");
assert.equal(inferSpeechEmotion("今天慢慢来。"), "calm");
assert.equal(inferSpeechEmotion("今天吃了面。"), "");

const prepared = prepareSpeechText(
    "# 标题\n[看看](https://example.com) (laughs) `代码` https://example.com/a",
    3000
);
assert.equal(prepared, "标题\n看看 代码 链接");
assert.equal(
    prepareSpeechText("一".repeat(120), 100),
    "一".repeat(100)
);

const audioBytes = Buffer.from("fake mp3 bytes", "utf8");
assert.deepEqual(
    decodeMiniMaxAudio({
        data: { audio: audioBytes.toString("hex") },
        base_resp: { status_code: 0 }
    }),
    audioBytes
);
assert.throws(
    () =>
        decodeMiniMaxAudio({
            data: { audio: "not-hex" },
            base_resp: { status_code: 0 }
        }),
    /可播放/
);

const automaticRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice",
        MINIMAX_TTS_SPEED: "99",
        MINIMAX_TTS_VOLUME: "0",
        MINIMAX_TTS_PITCH: "-99",
        MINIMAX_TTS_EMOTION: "auto"
    },
    "嘿嘿，我很开心。",
    "happy"
);
assert.equal(automaticRequest.emotion, "auto");
assert.equal(
    Object.hasOwn(automaticRequest.payload.voice_setting, "emotion"),
    false,
    "auto 必须省略 provider emotion 字段"
);
assert.equal(automaticRequest.payload.voice_setting.speed, 2);
assert.equal(automaticRequest.payload.voice_setting.vol, 0.01);
assert.equal(automaticRequest.payload.voice_setting.pitch, -12);

const inferredRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    "嘿嘿，我也想你。"
);
assert.equal(inferredRequest.payload.voice_setting.emotion, "happy");
assert.equal(
    Object.hasOwn(inferredRequest.payload, "voice_modify"),
    false,
    "默认值不应发送 voice_modify"
);

const modifiedVoiceRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice",
        MINIMAX_TTS_VOICE_MODIFY_PITCH: "-120",
        MINIMAX_TTS_VOICE_MODIFY_INTENSITY: "35.6",
        MINIMAX_TTS_VOICE_MODIFY_TIMBRE: "12.2",
        MINIMAX_TTS_VOICE_MODIFY_SOUND_EFFECT: "SPACIOUS_ECHO"
    },
    "你好。"
);
assert.deepEqual(modifiedVoiceRequest.payload.voice_modify, {
    pitch: -100,
    intensity: 36,
    timbre: 12,
    sound_effects: "spacious_echo"
});

const invalidSoundEffectRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_VOICE_ID: "test-voice",
        MINIMAX_TTS_VOICE_MODIFY_SOUND_EFFECT: "not-supported"
    },
    "你好。"
);
assert.equal(
    Object.hasOwn(invalidSoundEffectRequest.payload, "voice_modify"),
    false
);

const neutralRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    "今天吃了面。"
);
assert.equal(neutralRequest.emotion, "auto");
assert.equal(
    Object.hasOwn(neutralRequest.payload.voice_setting, "emotion"),
    false
);

const incompatibleWhisperRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice",
        MINIMAX_TTS_EMOTION: "whisper"
    },
    "晚安。"
);
assert.equal(incompatibleWhisperRequest.emotion, "auto");
assert.equal(
    Object.hasOwn(
        incompatibleWhisperRequest.payload.voice_setting,
        "emotion"
    ),
    false
);
const compatibleWhisperRequest = buildMiniMaxRequest(
    {
        MINIMAX_TTS_MODEL: "speech-2.6-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice",
        MINIMAX_TTS_EMOTION: "whisper"
    },
    "晚安。"
);
assert.equal(
    compatibleWhisperRequest.payload.voice_setting.emotion,
    "whisper"
);
assert.throws(
    () =>
        buildMiniMaxRequest(
            {
                MINIMAX_TTS_VOICE_ID: "test-voice",
                MINIMAX_TTS_EMOTION: "invented-emotion"
            },
            "你好。"
        ),
    /不是 MiniMax 支持的情绪值/
);
assert.throws(
    () => buildMiniMaxRequest({ MINIMAX_API_KEY: "secret" }, "你好。"),
    /voice_id/
);

async function runAsyncTests() {
let capturedRequest;
const synthesized = await synthesizeExpressiveSpeech({
    text: "嘿嘿，我也想你。",
    env: {
        EXPRESSIVE_TTS_PROVIDER: "minimax",
        MINIMAX_API_KEY: "test-secret",
        MINIMAX_TTS_MODEL: "speech-2.8-turbo",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    async fetchImpl(url, options) {
        capturedRequest = { url, options };
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    data: { audio: audioBytes.toString("hex") },
                    base_resp: { status_code: 0 }
                };
            }
        };
    }
});

assert.equal(capturedRequest.url, "https://api.minimax.io/v1/t2a_v2");
assert.equal(capturedRequest.options.headers.Authorization, "Bearer test-secret");
const body = JSON.parse(capturedRequest.options.body);
assert.equal(body.model, "speech-2.8-turbo");
assert.equal(body.language_boost, "Chinese");
assert.equal(body.voice_setting.voice_id, "test-voice");
assert.equal(body.voice_setting.emotion, "happy");
assert.deepEqual(synthesized.audio, audioBytes);
assert.equal(synthesized.provider, "minimax");
assert.equal(synthesized.emotion, "happy");

let chineseFallbackAuthorization = "";
const chineseFallback = await synthesizeExpressiveSpeech({
    text: "欢迎回家。",
    providerConfig: {
        provider: "deepgram",
        apiKey: "deepgram-key",
        model: "aura-2-helena-en",
        region: "global",
        speed: 1
    },
    env: {
        EXPRESSIVE_TTS_PROVIDER: "minimax",
        MINIMAX_API_KEY: "minimax-key",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    async fetchImpl(_url, options) {
        chineseFallbackAuthorization = options.headers.Authorization;
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    data: { audio: audioBytes.toString("hex") },
                    base_resp: { status_code: 0 }
                };
            }
        };
    }
});
assert.equal(chineseFallback.provider, "minimax");
assert.equal(chineseFallbackAuthorization, "Bearer minimax-key");

let mixedLanguageDeepgramBody = null;
const mixedLanguageDeepgram = await synthesizeExpressiveSpeech({
    text:
        "\u4eca\u5929\u771f\u7684\u5f88\u5f00\u5fc3\u3002Welcome home, I missed you. \u6211\u4eec\u4e00\u8d77\u4f11\u606f\u5427\u3002",
    providerConfig: {
        provider: "deepgram",
        apiKey: "deepgram-key",
        model: "aura-2-helena-en",
        region: "global",
        speed: 1
    },
    env: {},
    async fetchImpl(_url, options) {
        mixedLanguageDeepgramBody = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            headers: { get: () => "audio/mpeg" },
            async arrayBuffer() {
                return Uint8Array.from([1, 2, 3]).buffer;
            }
        };
    }
});
assert.equal(mixedLanguageDeepgram.provider, "deepgram");
assert.equal(mixedLanguageDeepgramBody.text, "Welcome home, I missed you.");

let mixedJapaneseDeepgramBody = null;
const mixedJapaneseDeepgram = await synthesizeExpressiveSpeech({
    text:
        "\u6b22\u8fce\u56de\u5bb6\u3002\u304a\u304b\u3048\u308a\u306a\u3055\u3044\u3002",
    providerConfig: {
        provider: "deepgram",
        apiKey: "deepgram-key",
        model: "aura-2-izanami-ja",
        region: "global",
        speed: 1
    },
    env: {},
    async fetchImpl(_url, options) {
        mixedJapaneseDeepgramBody = JSON.parse(options.body);
        return {
            ok: true,
            status: 200,
            headers: { get: () => "audio/mpeg" },
            async arrayBuffer() {
                return Uint8Array.from([1, 2, 3]).buffer;
            }
        };
    }
});
assert.equal(mixedJapaneseDeepgram.provider, "deepgram");
assert.equal(
    mixedJapaneseDeepgramBody.text,
    "\u304a\u304b\u3048\u308a\u306a\u3055\u3044\u3002"
);

const mixedLanguageText =
    "\u4eca\u5929\u771f\u7684\u5f88\u5f00\u5fc3\u3002Welcome home, I missed you. \u6211\u4eec\u4e00\u8d77\u4f11\u606f\u5427\u3002";
let mixedLanguageMiniMaxRequest = null;
const mixedLanguageMiniMax = await synthesizeExpressiveSpeech({
    text: mixedLanguageText,
    providerConfig: {
        provider: "deepgram",
        apiKey: "deepgram-key",
        model: "aura-2-helena-en",
        region: "global",
        speed: 1
    },
    env: {
        EXPRESSIVE_TTS_PROVIDER: "minimax",
        MINIMAX_API_KEY: "minimax-key",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    async fetchImpl(url, options) {
        mixedLanguageMiniMaxRequest = { url, body: JSON.parse(options.body) };
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    data: { audio: audioBytes.toString("hex") },
                    base_resp: { status_code: 0 }
                };
            }
        };
    }
});
assert.equal(mixedLanguageMiniMax.provider, "minimax");
assert.equal(
    mixedLanguageMiniMaxRequest.url,
    "https://api.minimax.io/v1/t2a_v2"
);
assert.equal(mixedLanguageMiniMaxRequest.body.text, mixedLanguageText);

let unsupportedLanguageUpstreamCalls = 0;
await assert.rejects(
    () =>
        synthesizeExpressiveSpeech({
            text: "\u6b22\u8fce\u56de\u5bb6\u3002",
            providerConfig: {
                provider: "deepgram",
                apiKey: "deepgram-key",
                model: "aura-2-helena-en",
                region: "global",
                speed: 1
            },
            env: {},
            async fetchImpl() {
                unsupportedLanguageUpstreamCalls += 1;
                throw new Error("unsupported language must not call upstream");
            }
        }),
    (error) =>
        error.code === "VOICE_LANGUAGE_UNSUPPORTED" &&
        error.status === 422
);
assert.equal(unsupportedLanguageUpstreamCalls, 0);

let japaneseModelChineseAuthorization = "";
const japaneseModelChineseFallback = await synthesizeExpressiveSpeech({
    text: "欢迎回家。",
    providerConfig: {
        provider: "deepgram",
        apiKey: "deepgram-key",
        model: "aura-2-izanami-ja",
        region: "global",
        speed: 1
    },
    env: {
        EXPRESSIVE_TTS_PROVIDER: "minimax",
        MINIMAX_API_KEY: "minimax-key",
        MINIMAX_TTS_VOICE_ID: "test-voice"
    },
    async fetchImpl(_url, options) {
        japaneseModelChineseAuthorization = options.headers.Authorization;
        return {
            ok: true,
            status: 200,
            async json() {
                return {
                    data: { audio: audioBytes.toString("hex") },
                    base_resp: { status_code: 0 }
                };
            }
        };
    }
});
assert.equal(japaneseModelChineseFallback.provider, "minimax");
assert.equal(japaneseModelChineseAuthorization, "Bearer minimax-key");

await assert.rejects(
    () => synthesizeExpressiveSpeech({ text: "你好", env: {} }),
    (error) => {
        assert.match(error.message, /尚未同时配置 MiniMax API Key 和 voice_id/);
        assert.match(error.message, /文字聊天不受影响/);
        assert.doesNotMatch(error.message, /系统朗读|备用朗读|手机朗读/i);
        return true;
    }
);

await assert.rejects(
    () =>
        synthesizeExpressiveSpeech({
            text: "你好",
            env: {
                EXPRESSIVE_TTS_PROVIDER: "minimax",
                MINIMAX_API_KEY: "do-not-leak-this-secret",
                MINIMAX_TTS_VOICE_ID: "test-voice"
            },
            async fetchImpl() {
                throw new Error("network failed with do-not-leak-this-secret");
            }
        }),
    (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, "EXPRESSIVE_TTS_UPSTREAM_ERROR");
        assert.doesNotMatch(error.message, /do-not-leak-this-secret/);
        assert.match(error.message, /本次只显示文字回复/);
        assert.doesNotMatch(error.message, /系统朗读|备用朗读|手机朗读/i);
        return true;
    }
);

await assert.rejects(
    () =>
        synthesizeExpressiveSpeech({
            text: "你好",
            env: {
                EXPRESSIVE_TTS_PROVIDER: "minimax",
                MINIMAX_API_KEY: "test-secret",
                MINIMAX_TTS_VOICE_ID: "test-voice"
            },
            async fetchImpl() {
                const error = new Error("request aborted");
                error.name = "AbortError";
                throw error;
            }
        }),
    (error) => {
        assert.equal(error.status, 504);
        assert.equal(error.code, "EXPRESSIVE_TTS_UPSTREAM_ERROR");
        assert.match(error.message, /等待超时/);
        assert.match(error.message, /本次只显示文字回复/);
        assert.doesNotMatch(error.message, /系统朗读|备用朗读|手机朗读/i);
        return true;
    }
);

for (const relativePath of [
    "services/expressive-speech.js",
    "docs/minimax-tts.md"
]) {
    const source = fs.readFileSync(
        path.join(__dirname, "..", relativePath),
        "utf8"
    );
    assert.doesNotMatch(
        source,
        /系统朗读|备用朗读|手机朗读|device TTS/i
    );
}

}

runAsyncTests()
    .then(() => console.log("expressive speech tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

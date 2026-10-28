/**
 * 自定义语音服务（Edge 免费 / OpenAI 兼容 / 任意 HTTP）单元测试。
 * 网络全部注入 mock，不发真实请求。
 */
"use strict";

const assert = require("node:assert/strict");
const {
    CUSTOM_PROVIDER_IDS,
    EDGE_VOICES,
    assertSafeOutboundUrl,
    customProviderCatalog,
    customSpeechError,
    normalizeFormat,
    normalizeResponseMode,
    secMsGec,
    synthesizeCustomHttpSpeech,
    synthesizeCustomSpeech,
    synthesizeEdgeSpeech,
    synthesizeOpenAiSpeech
} = require("../services/custom-speech");

function jsonResponse(data, { status = 200, contentType = "application/json" } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                const key = String(name).toLowerCase();
                if (key === "content-type") return contentType;
                if (key === "content-length") return String(Buffer.byteLength(JSON.stringify(data)));
                return null;
            }
        },
        async arrayBuffer() {
            return Uint8Array.from(Buffer.from(typeof data === "string" ? data : JSON.stringify(data))).buffer;
        },
        async json() {
            return typeof data === "string" ? JSON.parse(data) : data;
        }
    };
}

function audioResponse(bytes, { status = 200, contentType = "audio/mpeg" } = {}) {
    const buffer = Buffer.from(bytes);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                const key = String(name).toLowerCase();
                if (key === "content-type") return contentType;
                if (key === "content-length") return String(buffer.length);
                return null;
            }
        },
        async arrayBuffer() {
            return Uint8Array.from(buffer).buffer;
        }
    };
}

function fakeSocketClass({ audio = Buffer.from("edge-audio"), empty = false } = {}) {
    return class FakeWebSocket {
        constructor(url) {
            this.url = url;
            this.sent = [];
            this.listeners = {};
            setTimeout(() => this.emit("open"), 0);
        }
        addEventListener(name, handler) {
            (this.listeners[name] ||= []).push(handler);
        }
        emit(name, event) {
            for (const handler of this.listeners[name] || []) handler(event);
        }
        send(payload) {
            this.sent.push(payload);
            if (!payload.includes("Path:speech.config")) return;
            setTimeout(() => {
                if (!empty) {
                    const header = Buffer.from("Path:audio\r\n", "utf8");
                    const frame = Buffer.concat([
                        Buffer.from([(header.length >> 8) & 0xff, header.length & 0xff]),
                        header,
                        audio
                    ]);
                    this.emit("message", { data: frame });
                }
                this.emit("message", { data: "X-RequestId:1\r\nPath:turn.end\r\n" });
            }, 5);
        }
        close() {
            this.closed = true;
        }
    };
}

async function testEdgeSynthesis() {
    const Socket = fakeSocketClass({ audio: Buffer.from("edge-hello") });
    const result = await synthesizeEdgeSpeech({
        text: "你好，灯塔。",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 10,
        pitch: -5,
        WebSocketImpl: Socket
    });
    assert.equal(result.provider, "edge");
    assert.equal(result.model, "zh-CN-XiaoxiaoNeural");
    assert.equal(result.contentType, "audio/mpeg");
    assert.equal(result.audio.toString(), "edge-hello");

    await assert.rejects(
        () =>
            synthesizeEdgeSpeech({
                text: "hi",
                WebSocketImpl: fakeSocketClass({ empty: true })
            }),
        (error) => error.code === "CUSTOM_TTS_EDGE_EMPTY"
    );
    await assert.rejects(
        () => synthesizeEdgeSpeech({ text: "hi", voice: "not-a-voice" }),
        (error) => error.code === "CUSTOM_TTS_VOICE_INVALID"
    );
    await assert.rejects(
        () => synthesizeEdgeSpeech({ text: "hi", WebSocketImpl: null }),
        (error) => error.code === "CUSTOM_TTS_EDGE_UNAVAILABLE"
    );

    // 所有内置 Edge 音色都必须通过服务端校验
    for (const voice of EDGE_VOICES) {
        assert.ok(voice.id.endsWith("Neural"));
    }
    const gec = secMsGec(Date.parse("2026-10-28T00:00:00Z"));
    assert.equal(gec.length, 64);
    assert.equal(gec, gec.toUpperCase());
    assert.equal(gec, secMsGec(Date.parse("2026-10-28T00:01:00Z")));
}

async function testOpenAiSynthesis() {
    let captured;
    const result = await synthesizeOpenAiSpeech({
        text: "你好呀",
        apiBaseUrl: "https://tts.example.com/v1",
        apiKey: "sk-test",
        model: "tts-1",
        voice: "alloy",
        format: "opus",
        speed: 1.2,
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return audioResponse("openai-audio", { contentType: "audio/ogg" });
        }
    });
    assert.equal(captured.url, "https://tts.example.com/v1/audio/speech");
    assert.equal(captured.options.headers.Authorization, "Bearer sk-test");
    const body = JSON.parse(captured.options.body);
    assert.equal(body.input, "你好呀");
    assert.equal(body.voice, "alloy");
    assert.equal(body.response_format, "opus");
    assert.equal(result.provider, "openai_compatible");
    assert.equal(result.contentType, "audio/ogg");
    assert.equal(result.audio.toString(), "openai-audio");

    await assert.rejects(
        () =>
            synthesizeOpenAiSpeech({
                text: "hi",
                apiBaseUrl: "https://tts.example.com/v1",
                fetchImpl: async () => {
                    throw Object.assign(new Error("boom"), { name: "AbortError" });
                }
            }),
        (error) => error.code === "CUSTOM_TTS_TIMEOUT"
    );
    await assert.rejects(
        () =>
            synthesizeOpenAiSpeech({
                text: "hi",
                apiBaseUrl: "https://tts.example.com/v1",
                fetchImpl: async () => jsonResponse({ error: "nope" }, { status: 401 })
            }),
        (error) => error.code === "CUSTOM_TTS_UPSTREAM" && error.status === 502
    );
}

async function testCustomHttp() {
    let captured;
    const binary = await synthesizeCustomHttpSpeech({
        text: '你好 "灯塔"',
        apiBaseUrl: "https://tts.example.com/speak",
        apiKey: "secret-key",
        bodyTemplate:
            '{"input":"{{text_json}}","speaker":"{{voice}}","token":"{{api_key}}"}',
        headersTemplate: '{"X-Client":"dengta"}',
        responseMode: "binary",
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return audioResponse("custom-binary", { contentType: "audio/wav" });
        }
    });
    assert.equal(captured.url, "https://tts.example.com/speak");
    assert.equal(captured.options.headers["X-Client"], "dengta");
    assert.equal(captured.options.headers.Authorization, "Bearer secret-key");
    assert.equal(JSON.parse(captured.options.body).input, '你好 "灯塔"');
    assert.equal(captured.options.body.includes("secret-key"), true);
    assert.equal(binary.contentType, "audio/wav");
    assert.equal(binary.audio.toString(), "custom-binary");

    const base64 = await synthesizeCustomHttpSpeech({
        text: "hi",
        apiBaseUrl: "https://tts.example.com/speak",
        responseMode: "json_base64",
        audioPath: "data.audio",
        fetchImpl: async () =>
            jsonResponse({ data: { audio: Buffer.from("base64-audio").toString("base64") } })
    });
    assert.equal(base64.audio.toString(), "base64-audio");

    let calls = 0;
    const urlMode = await synthesizeCustomHttpSpeech({
        text: "hi",
        apiBaseUrl: "https://tts.example.com/speak",
        responseMode: "json_url",
        fetchImpl: async (url) => {
            calls += 1;
            if (calls === 1) return jsonResponse({ data: { url: "https://cdn.example.com/a.mp3" } });
            assert.equal(url, "https://cdn.example.com/a.mp3");
            return audioResponse("downloaded", { contentType: "audio/mpeg" });
        }
    });
    assert.equal(urlMode.audio.toString(), "downloaded");
    assert.equal(calls, 2);

    await assert.rejects(
        () =>
            synthesizeCustomHttpSpeech({
                text: "hi",
                apiBaseUrl: "https://tts.example.com/speak",
                headersTemplate: "[]",
                fetchImpl: async () => audioResponse("x")
            }),
        (error) => error.code === "CUSTOM_TTS_HEADERS_INVALID"
    );
    await assert.rejects(
        () =>
            synthesizeCustomHttpSpeech({
                text: "hi",
                apiBaseUrl: "https://tts.example.com/speak",
                responseMode: "json_base64",
                fetchImpl: async () => jsonResponse({ data: {} })
            }),
        (error) => error.code === "CUSTOM_TTS_RESPONSE_MISSING"
    );
}

async function testUrlSafety() {
    assert.ok(assertSafeOutboundUrl("https://tts.example.com/v1"));
    assert.throws(
        () => assertSafeOutboundUrl("http://tts.example.com/v1"),
        (error) => error.code === "CUSTOM_TTS_URL_INSECURE"
    );
    assert.throws(
        () => assertSafeOutboundUrl("https://127.0.0.1:8080/v1"),
        (error) => error.code === "CUSTOM_TTS_URL_PRIVATE"
    );
    assert.throws(
        () => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data"),
        (error) => error.code === "CUSTOM_TTS_URL_PRIVATE"
    );
    assert.ok(
        assertSafeOutboundUrl("http://127.0.0.1:9880/tts", {
            VOICE_CUSTOM_ALLOW_HTTP: "1",
            VOICE_CUSTOM_ALLOW_PRIVATE: "1"
        })
    );
    assert.throws(
        () => assertSafeOutboundUrl("not a url"),
        (error) => error.code === "CUSTOM_TTS_URL_INVALID"
    );
}

async function testDispatch() {
    const result = await synthesizeCustomSpeech({
        providerConfig: {
            provider: "openai_compatible",
            enabled: true,
            apiBaseUrl: "https://tts.example.com/v1",
            apiKey: "k",
            model: "tts-1",
            voiceId: "alloy",
            outputFormat: "mp3"
        },
        text: "hello",
        fetchImpl: async () => audioResponse("dispatched")
    });
    assert.equal(result.provider, "openai_compatible");
    assert.equal(result.audio.toString(), "dispatched");

    await assert.rejects(
        () =>
            synthesizeCustomSpeech({
                providerConfig: { provider: "disabled", enabled: false },
                text: "hello"
            }),
        (error) => error.code === "CUSTOM_TTS_PROVIDER_INVALID"
    );

    for (const id of CUSTOM_PROVIDER_IDS) {
        assert.ok(customProviderCatalog().some((item) => item.id === id));
    }
    assert.equal(normalizeFormat("WAV"), "wav");
    assert.equal(normalizeFormat("unknown"), "mp3");
    assert.equal(normalizeResponseMode("json_url"), "json_url");
    assert.equal(normalizeResponseMode("bad"), "binary");
}

async function main() {
    await testUrlSafety();
    await testEdgeSynthesis();
    await testOpenAiSynthesis();
    await testCustomHttp();
    await testDispatch();
    console.log("custom-speech tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

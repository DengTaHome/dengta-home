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
    fetchWithSafeRedirects,
    isPrivateHostname,
    isPrivateIpAddress,
    resolveSafeHost,
    customSpeechError,
    normalizeFormat,
    normalizeResponseMode,
    secMsGecV2,
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
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.handlers = {};
            this.closed = false;
            setTimeout(() => this.emit("open"), 0);
        }
        on(event, handler) {
            (this.handlers[event] ||= []).push(handler);
            return this;
        }
        emit(event, ...args) {
            for (const handler of this.handlers[event] || []) handler(...args);
        }
        send(payload) {
            if (!payload.includes("Path:speech.config")) return;
            setTimeout(() => {
                if (!empty) {
                    const header = Buffer.from("Path:audio\r\n", "utf8");
                    const frame = Buffer.concat([
                        Buffer.from([(header.length >> 8) & 0xff, header.length & 0xff]),
                        header,
                        audio
                    ]);
                    this.emit("message", frame, true);
                }
                this.emit("message", "X-RequestId:1\r\nPath:turn.end\r\n", false);
            }, 5);
        }
        close() {
            this.closed = true;
        }
        terminate() {
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
        () =>
            synthesizeEdgeSpeech({
                text: "hi",
                WebSocketImpl: class {
                    constructor() {
                        throw new Error("no ws");
                    }
                }
            }),
        (error) => error.code === "CUSTOM_TTS_EDGE_CONNECT"
    );

    // 所有内置 Edge 音色都必须通过服务端校验
    for (const voice of EDGE_VOICES) {
        assert.ok(voice.id.endsWith("Neural"));
    }
    // 已知向量（与 rany2/edge-tts / node-edge-tts v2 参考实现逐字节一致）
    assert.equal(
        secMsGecV2(1761600000 * 1000),
        "2E35E683F6E3EEF9-ACC6E18CDE9E31DD20FA1F06D71A048C2E12A47C007A19FA4FD78E3F1550DD0F"
    );
    assert.equal(
        secMsGecV2(1761600300 * 1000),
        "6F4A77904967B04A-8C80B22CC1C9374A9DA5256CB46A06FD16DBF28629960D19779C604B33BCAC30"
    );
    // 5 分钟一个桶：00:00 与 00:04 相同，00:05 不同
    assert.equal(secMsGecV2(1761600000 * 1000), secMsGecV2(1761600240 * 1000));
    assert.notEqual(secMsGecV2(1761600000 * 1000), secMsGecV2(1761600300 * 1000));

    // 方言音色必须被允许（zh-CN-liaoning-XiaobeiNeural 等）
    await assert.doesNotReject(() =>
        synthesizeEdgeSpeech({
            text: "你好",
            voice: "zh-CN-liaoning-XiaobeiNeural",
            WebSocketImpl: fakeSocketClass({ audio: Buffer.from("dialect") })
        })
    );
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
        env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
                env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
                env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
        env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
        env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
        fetchImpl: async () =>
            jsonResponse({ data: { audio: Buffer.from("base64-audio").toString("base64") } })
    });
    assert.equal(base64.audio.toString(), "base64-audio");

    let calls = 0;
    const urlMode = await synthesizeCustomHttpSpeech({
        text: "hi",
        apiBaseUrl: "https://tts.example.com/speak",
        responseMode: "json_url",
        env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
                env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
                env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
        fetchImpl: async () => jsonResponse({ data: {} })
            }),
        (error) => error.code === "CUSTOM_TTS_RESPONSE_MISSING"
    );
}

async function testUrlSafety() {
    assert.ok(assertSafeOutboundUrl("https://tts.example.com/v1"));
    // 私网变体：尾部点、十进制、IPv4-mapped IPv6
    assert.equal(isPrivateHostname("127.0.0.1."), true);
    assert.equal(isPrivateHostname("2130706433"), true);
    assert.equal(isPrivateHostname("::ffff:127.0.0.1"), true);
    assert.equal(isPrivateHostname("::ffff:7f00:1"), true);
    assert.equal(isPrivateHostname("10.0.0.1"), true);
    assert.equal(isPrivateHostname("tts.example.com"), false);
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
    assert.equal(isPrivateIpAddress("::127.0.0.1"), true);
    assert.equal(isPrivateIpAddress("64:ff9b::7f00:1"), true);

    // DNS 解析：域名指向回环/私网必须拒绝（localtest.me / nip.io 类）
    await assert.rejects(
        () =>
            resolveSafeHost(
                "https://tts.example.com/v1",
                {},
                async () => [{ address: "127.0.0.1", family: 4 }]
            ),
        (error) => error.code === "CUSTOM_TTS_DNS_PRIVATE"
    );
    const safe = await resolveSafeHost(
        "https://tts.example.com/v1",
        {},
        async () => [{ address: "93.184.216.34", family: 4 }]
    );
    assert.equal(safe.hostname, "tts.example.com");
}

async function testRedirectSafety() {
    const redirect = (location, status = 302) => ({
        ok: false,
        status,
        headers: { get: (name) => (String(name).toLowerCase() === "location" ? location : null) },
        async arrayBuffer() { return new ArrayBuffer(0); }
    });

    const noDnsEnv = { VOICE_CUSTOM_ALLOW_PRIVATE: "1" };
    // 302 到 http 私网必须拒绝（即使首地址合法）
    await assert.rejects(
        () =>
            fetchWithSafeRedirects(
                async () => redirect("http://127.0.0.1:8080/secret"),
                "https://tts.example.com/v1",
                {},
                noDnsEnv
            ),
        (error) => ["CUSTOM_TTS_URL_INSECURE", "CUSTOM_TTS_URL_PRIVATE"].includes(error.code)
    );

    // 跨源重定向必须拒绝（防止 Authorization / 文本被带到别的域）
    await assert.rejects(
        () =>
            fetchWithSafeRedirects(
                async () => redirect("https://cdn.attacker.example/steal"),
                "https://tts.example.com/v1",
                { headers: { Authorization: "Bearer SECRET-KEY" } },
                noDnsEnv
            ),
        (error) => error.code === "CUSTOM_TTS_REDIRECT_CROSS_ORIGIN"
    );

    // 同源 302 允许继续
    let calls = 0;
    const final = await fetchWithSafeRedirects(
        async (url) => {
            calls += 1;
            if (calls === 1) return redirect("https://tts.example.com/speech.mp3");
            assert.equal(url, "https://tts.example.com/speech.mp3");
            return audioResponse("redirected-audio");
        },
        "https://tts.example.com/v1",
        {},
        noDnsEnv
    );
    assert.equal(calls, 2);
    assert.equal(Buffer.from(await final.arrayBuffer()).toString(), "redirected-audio");

    // 重定向循环上限
    let loops = 0;
    await assert.rejects(
        () =>
            fetchWithSafeRedirects(
                async () => {
                    loops += 1;
                    return redirect("https://tts.example.com/again");
                },
                "https://tts.example.com/v1",
                {},
                noDnsEnv
            ),
        (error) => error.code === "CUSTOM_TTS_REDIRECT_LOOP"
    );
    assert.ok(loops >= 4);
}

async function testEdgeProductionDispatch() {
    // 生产入口 synthesizeCustomSpeech 必须把 Edge 交给 ws 实现（而不是内置 WebSocket）
    const result = await synthesizeCustomSpeech({
        providerConfig: {
            provider: "edge",
            enabled: true,
            voiceId: "zh-CN-YunxiNeural"
        },
        text: "生产路径测试",
        WebSocketImpl: fakeSocketClass({ audio: Buffer.from("edge-production") })
    });
    assert.equal(result.provider, "edge");
    assert.equal(result.model, "zh-CN-YunxiNeural");
    assert.equal(result.audio.toString(), "edge-production");
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
        env: { VOICE_CUSTOM_ALLOW_PRIVATE: "1" },
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
    await testRedirectSafety();
    await testEdgeProductionDispatch();
    await testDispatch();
    console.log("custom-speech tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

/**
 * voice-provider-center 自定义语音服务接入测试（不连真实网络）。
 */
"use strict";

const assert = require("node:assert/strict");
const {
    createVoiceProviderCenter,
    publicVoiceProviderError
} = require("../services/voice-provider-center");

const env = {
    MCP_ENCRYPTION_KEY: "voice-provider-encryption-secret-long-enough",
    // 单测不发外网 DNS：允许私网后 resolveSafeHost 直接跳过解析
    VOICE_CUSTOM_ALLOW_PRIVATE: "1"
};

function createDatabase() {
    const state = { row: null };
    function writeResult(values, insert = false) {
        state.row = { ...(insert ? {} : state.row || {}), ...values };
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

function audioResponse(bytes = "audio-bytes") {
    const buffer = Buffer.from(bytes);
    return {
        ok: true,
        status: 200,
        headers: {
            get(name) {
                if (String(name).toLowerCase() === "content-type") return "audio/mpeg";
                if (String(name).toLowerCase() === "content-length") return String(buffer.length);
                return null;
            }
        },
        async arrayBuffer() {
            return Uint8Array.from(buffer).buffer;
        }
    };
}

function fakeSocketClass() {
    return class FakeWebSocket {
        constructor(url, options) {
            this.url = url;
            this.options = options;
            this.handlers = {};
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
                const header = Buffer.from("Path:audio\r\n");
                this.emit(
                    "message",
                    Buffer.concat([
                        Buffer.from([(header.length >> 8) & 0xff, header.length & 0xff]),
                        header,
                        Buffer.from("edge-voice")
                    ]),
                    true
                );
                this.emit("message", "Path:turn.end\r\n", false);
            }, 5);
        }
        close() {}
        terminate() {}
    };
}

async function main() {
    const database = createDatabase();
    const center = createVoiceProviderCenter({
        database,
        env,
        fetchImpl: async () => audioResponse(),
        webSocketImpl: fakeSocketClass()
    });

    const status = await center.status();
    const ids = status.providers.map((item) => item.id);
    assert.ok(ids.includes("edge"));
    assert.ok(ids.includes("openai_compatible"));
    assert.ok(ids.includes("custom_http"));
    assert.equal(status.profile.provider, "server_default");

    // Edge：不需要 Key，保存即 configured
    const edge = await center.saveProfile({
        provider: "edge",
        enabled: true,
        voice_id: "zh-CN-YunxiNeural",
        rate: 8
    });
    assert.equal(edge.provider, "edge");
    assert.equal(edge.voice_id, "zh-CN-YunxiNeural");
    assert.equal(edge.configured, true);
    assert.equal(edge.rate, 8);

    const edgeRuntime = await center.resolveRuntimeProfile();
    assert.equal(edgeRuntime.provider, "edge");
    assert.equal(edgeRuntime.voiceId, "zh-CN-YunxiNeural");

    // OpenAI 兼容：需要 base URL，Key 加密保存
    const openai = await center.saveProfile({
        provider: "openai_compatible",
        enabled: true,
        api_base_url: "https://tts.example.com/v1",
        api_key: "sk-custom",
        model: "tts-1",
        voice_id: "alloy",
        output_format: "opus",
        speed: 1.1
    });
    assert.equal(openai.provider, "openai_compatible");
    assert.equal(openai.api_base_url, "https://tts.example.com/v1");
    assert.equal(openai.credential_configured, true);
    assert.equal(openai.configured, true);
    assert.notEqual(database.state.row.secret_ciphertext, "sk-custom");

    const runtime = await center.resolveRuntimeProfile();
    assert.equal(runtime.provider, "openai_compatible");
    assert.equal(runtime.apiKey, "sk-custom");
    assert.equal(runtime.apiBaseUrl, "https://tts.example.com/v1");

    // 不带 Key 再保存：保留原密文
    const cipherBefore = database.state.row.secret_ciphertext;
    await center.saveProfile({
        provider: "openai_compatible",
        enabled: true,
        api_base_url: "https://tts.example.com/v1",
        model: "tts-1",
        voice_id: "alloy"
    });
    assert.equal(database.state.row.secret_ciphertext, cipherBefore);

    // 试听：走注入的 fetch
    const speech = await center.testProfile({ text: "你好，灯塔。" });
    assert.equal(speech.audio.toString(), "audio-bytes");
    assert.equal(database.state.row.last_status, "connected");

    // 非法地址/请求头被拒绝
    await assert.rejects(
        () =>
            center.saveProfile({
                provider: "custom_http",
                enabled: true,
                api_base_url: "http://127.0.0.1:9880/tts"
            }),
        (error) => error.code === "VOICE_PROVIDER_BASE_URL_INVALID" || error.code === "CUSTOM_TTS_URL_INSECURE"
    );
    await assert.rejects(
        () =>
            center.saveProfile({
                provider: "custom_http",
                enabled: true,
                api_base_url: "https://tts.example.com/speak",
                headers_template: "{bad json"
            }),
        (error) => error.code === "VOICE_PROVIDER_HEADERS_INVALID"
    );
    await assert.rejects(
        () =>
            center.saveProfile({
                provider: "openai_compatible",
                enabled: true,
                api_base_url: ""
            }),
        (error) => error.code === "VOICE_PROVIDER_BASE_URL_REQUIRED"
    );

    // 自定义 HTTP 保存 + 试听（二进制）
    const custom = await center.saveProfile({
        provider: "custom_http",
        enabled: true,
        api_base_url: "https://tts.example.com/speak",
        body_template: '{"text":"{{text}}"}',
        response_mode: "binary",
        output_format: "wav"
    });
    assert.equal(custom.provider, "custom_http");
    assert.equal(custom.configured, true);

    // Edge 试听：走注入的 ws 风格 fake socket
    await center.saveProfile({ provider: "edge", enabled: true, voice_id: "zh-CN-XiaoxiaoNeural" });
    const edgeSpeech = await center.testProfile({ text: "测试免费语音。" });
    assert.equal(edgeSpeech.provider, "edge");
    assert.equal(edgeSpeech.audio.toString(), "edge-voice");

    // 错误映射
    const mapped = publicVoiceProviderError(
        Object.assign(new Error("bad"), { isCustomSpeechError: true, code: "CUSTOM_TTS_UPSTREAM", status: 502 })
    );
    assert.equal(mapped.code, "CUSTOM_TTS_UPSTREAM");
    assert.equal(mapped.status, 502);

    console.log("voice-provider-custom tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

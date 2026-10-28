const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    HERVOICE_EMOTIONS,
    HERVOICE_DEFAULT_TIMEOUT_MS,
    HERVOICE_MAX_TIMEOUT_MS,
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    createVoiceRateLimitState,
    createHervoiceWarmup,
    parseVoiceTurnFields,
    sanitizeHervoiceAnalysis
} = require("../services/voice-turn");

assert.equal(HERVOICE_DEFAULT_TIMEOUT_MS, 25_000);
assert.equal(HERVOICE_MAX_TIMEOUT_MS, 30_000);

const validPayload = {
    text: "我今天有一点累。",
    emotion: "tired",
    confidence: 0.82,
    hint: "声音偏低，停顿稍多。",
    features: {
        duration_s: 3.2,
        pitch_mean_hz: 171.4,
        pitch_var: 19.2,
        energy_mean: 0.018,
        energy_var: 0.006,
        pause_ratio: 0.31,
        tempo_strength: 1.4,
        unexpected_feature: "must be removed"
    }
};

const analysis = sanitizeHervoiceAnalysis(validPayload);
assert.deepEqual(HERVOICE_EMOTIONS, [
    "happy",
    "sad",
    "angry",
    "tired",
    "tender",
    "excited",
    "anxious",
    "neutral"
]);
assert.equal(analysis.text, validPayload.text);
assert.equal(analysis.emotion, "tired");
assert.equal(analysis.confidence, 0.82);
assert.equal(
    Object.prototype.hasOwnProperty.call(
        analysis.features,
        "unexpected_feature"
    ),
    false,
    "只允许 hervoice 文档中的声学特征进入系统"
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, text: "" }),
    /没有识别出/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, emotion: "confused" }),
    /未知的情绪类别/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, confidence: 1.5 }),
    /置信度不正确/
);
assert.throws(
    () => sanitizeHervoiceAnalysis({ ...validPayload, hint: 123 }),
    /情绪说明格式不正确/
);
assert.throws(
    () =>
        sanitizeHervoiceAnalysis({
            ...validPayload,
            features: { pause_ratio: 1.2 }
        }),
    /pause_ratio 不正确/
);

const parsedFields = parseVoiceTurnFields({
    session_id: "session-value",
    client_time: "2026-07-21T20:00:00+08:00",
    timezone: "Asia/Shanghai",
    model: "gpt-5.5",
    emotion_understanding_enabled: "true",
    turn_context: "  语音本轮临时背景  ",
    companion_status: JSON.stringify({ mood: "calm" }),
    environment_context: JSON.stringify({
        weather: {
            weather_code: 0,
            temperature_c: 26.5,
            latitude: 31.230416
        }
    })
});
assert.equal(parsedFields.emotionUnderstandingEnabled, true);
assert.equal(parsedFields.requestedModel, "gpt-5.5");
assert.equal(parsedFields.turnContext, "语音本轮临时背景");
assert.deepEqual(parsedFields.companionStatus, { mood: "calm" });
assert.equal(parsedFields.environmentContext.weather.temperature_c, 26.5);
assert.equal(
    Object.hasOwn(parsedFields.environmentContext.weather, "latitude"),
    false
);
assert.equal(
    parseVoiceTurnFields({ model: "m".repeat(200) }).requestedModel.length,
    160,
    "语音和文字请求必须使用相同的模型 ID 长度上限"
);
assert.throws(
    () =>
        parseVoiceTurnFields({
            emotion_understanding_enabled: "yes"
        }),
    /必须是 true 或 false/
);
assert.throws(
    () => parseVoiceTurnFields({ turn_context: "x".repeat(4001) }),
    /turn_context 不能超过 4000/
);

const highConfidenceContext = buildVoiceRuntimeContext(analysis, true);
assert.match(highConfidenceContext, /低优先级、不可信数据/);
assert.match(highConfidenceContext, /不能读心/);
assert.match(highConfidenceContext, /疲惫/);
assert.match(highConfidenceContext, /声音偏低/);
assert.match(highConfidenceContext, /以转写内容为准/);

const lowConfidenceContext = buildVoiceRuntimeContext(
    { ...analysis, confidence: 0.2, hint: "绝对不应采用的判断" },
    true
);
assert.match(lowConfidenceContext, /必须忽略其情绪判断/);
assert.doesNotMatch(lowConfidenceContext, /疲惫/);
assert.doesNotMatch(lowConfidenceContext, /绝对不应采用的判断/);

const disabledContext = buildVoiceRuntimeContext(analysis, false);
assert.match(disabledContext, /用户已关闭语音情绪理解/);
assert.doesNotMatch(disabledContext, /声音偏低/);

const metadata = buildVoiceMessageMetadata(
    analysis,
    new Date("2026-07-21T12:00:00.000Z")
);
assert.equal(metadata.is_voice, true);
assert.equal(metadata.voice_analysis.source, "hervoice");
assert.equal(metadata.voice_analysis.emotion, "tired");
assert.equal(
    metadata.voice_analysis.analyzed_at,
    "2026-07-21T12:00:00.000Z"
);
assert.equal(
    Object.prototype.hasOwnProperty.call(metadata.voice_analysis, "audio"),
    false,
    "消息元数据不能保存原始音频"
);

const limiter = createVoiceRateLimitState({
    windowMs: 60_000,
    maxRequests: 2
});
assert.equal(limiter.consume("127.0.0.1", 1_000).allowed, true);
assert.equal(limiter.consume("127.0.0.1", 2_000).allowed, true);
const limited = limiter.consume("127.0.0.1", 3_000);
assert.equal(limited.allowed, false);
assert.ok(limited.retryAfterMs > 0);
assert.equal(limiter.consume("127.0.0.2", 3_000).allowed, true);
assert.equal(limiter.consume("127.0.0.1", 62_000).allowed, true);

async function testHervoiceForwarding() {
    let captured;
    const result = await analyzeVoiceWithHervoice({
        file: {
            buffer: Buffer.from("fake-audio"),
            mimetype: "audio/webm",
            originalname: "语音.webm"
        },
        baseUrl: "https://voice.example.test/",
        secret: "test-secret",
        timeoutMs: 5_000,
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return new Response(JSON.stringify(validPayload), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
    });

    assert.equal(
        captured.url,
        "https://voice.example.test/api/voice/upload"
    );
    assert.equal(captured.options.method, "POST");
    assert.equal(
        captured.options.headers["X-Hervoice-Secret"],
        "test-secret"
    );
    assert.ok(captured.options.body instanceof FormData);
    assert.ok(captured.options.body.get("file") instanceof Blob);
    assert.equal(result.text, validPayload.text);
}

async function testHervoiceWarmupIsThrottled() {
    const warmup = createHervoiceWarmup({
        minimumIntervalMs: 60_000,
        timeoutMs: 5_000
    });
    let requests = 0;
    const fetchImpl = async (url, options) => {
        requests += 1;
        assert.equal(url, "https://voice.example.test/health");
        assert.equal(options.method, "GET");
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };

    const started = warmup.start({
        baseUrl: "https://voice.example.test",
        fetchImpl,
        now: 1_000
    });
    assert.equal(started.started, true);
    assert.equal(started.reason, "started");
    await started.completion;
    assert.equal(requests, 1);

    const throttled = warmup.start({
        baseUrl: "https://voice.example.test",
        fetchImpl,
        now: 2_000
    });
    assert.equal(throttled.started, false);
    assert.equal(throttled.reason, "recent");
    assert.equal(requests, 1);
}

async function main() {
    await testHervoiceForwarding();
    await testHervoiceWarmupIsThrottled();

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(serverSource, /app\.post\(\s*"\/voice\/turn"/);
    assert.match(serverSource, /app\.post\(\s*"\/voice\/warmup"/);
    assert.match(serverSource, /storage:\s*multer\.memoryStorage\(\)/);
    assert.match(serverSource, /fileSize:\s*12 \* 1024 \* 1024/);
    assert.match(serverSource, /voiceUpload\.single\("file"\)/);
    assert.match(
        serverSource,
        /effectiveModel\s*=\s*await resolveConversationTurnModel\(\s*settings,\s*conversation,\s*fields\.requestedModel,\s*database\s*\)/,
        "语音模型覆盖必须复用普通聊天的模型白名单解析器"
    );
    assert.ok(
        serverSource.lastIndexOf(
            "const effectiveModel = await resolveConversationTurnModel",
            serverSource.indexOf("const voiceAnalysis = await analyzeVoiceWithHervoice")
        ) <
            serverSource.indexOf("const voiceAnalysis = await analyzeVoiceWithHervoice"),
        "必须先拒绝无效模型，再消耗语音转写服务额度"
    );
    assert.match(serverSource, /requested_model:\s*fields\.requestedModel/);
    assert.match(serverSource, /resolved_model:\s*effectiveModel/);
    assert.match(serverSource, /turnContext:\s*fields\.turnContext/);
    assert.match(
        serverSource,
        /promptArchitecture:\s*MAIN_CHAT_PROMPT_ARCHITECTURE/
    );
    assert.match(
        serverSource,
        /const worldBookContext = await resolveWorldBookContext\(\{\s*database,\s*settings: effectiveSettings,\s*messages: context\.messages\s*\}\)/,
        "语音轮次必须通过租户数据库和当前可见上下文解析世界书"
    );
    assert.match(serverSource, /promptArchitecture:\s*MAIN_CHAT_PROMPT_ARCHITECTURE,\s*worldBookContext/);
    assert.match(serverSource, /model:\s*effectiveModel \|\| ""/);
    assert.doesNotMatch(
        serverSource,
        /writeFileSync\([^)]*(voice|audio)|createWriteStream\([^)]*(voice|audio)/i,
        "DengTa home 后端不得把语音写到磁盘"
    );

    // 软置信度区间：类别可作弱线索，但不能断言
    const softContext = buildVoiceRuntimeContext(
        { ...analysis, confidence: 0.55, hint: "语速偏快" },
        true
    );
    assert.match(softContext, /可能是/);
    assert.match(softContext, /不足以支撑判断/);
    assert.match(softContext, /疲惫/);
    assert.doesNotMatch(softContext, /必须忽略其情绪判断/);

    // 中文或同义词归一到固定八类；真正未知的类别仍然拒绝
    assert.equal(
        sanitizeHervoiceAnalysis({ ...validPayload, emotion: "开心" }).emotion,
        "happy"
    );
    assert.equal(
        sanitizeHervoiceAnalysis({ ...validPayload, emotion: "疲惫" }).emotion,
        "tired"
    );
    assert.equal(
        sanitizeHervoiceAnalysis({ ...validPayload, emotion: "Joyful" }).emotion,
        "happy"
    );

    // 音频 MIME 归一：同一段音频即使被标成 octet-stream，也要按扩展名推回真实类型
    const uploadedTypes = [];
    await analyzeVoiceWithHervoice({
        file: {
            buffer: Buffer.from("voice-bytes"),
            mimetype: "application/octet-stream",
            originalname: "dengta-voice-1.webm"
        },
        baseUrl: "https://hervoice.example.com",
        secret: "test-secret",
        fetchImpl: async (url, init) => {
            uploadedTypes.push(init.body.get("file").type);
            return {
                ok: true,
                status: 200,
                json: async () => ({ ...validPayload })
            };
        }
    });
    assert.equal(uploadedTypes[0], "audio/webm");

    // 回复落库后的非关键任务不再阻塞响应
    assert.match(
        serverSource,
        /void Promise\.allSettled\(\[\s*touchConversation\(conversationId, database\)/,
        "语音回复返回前不应等待主动消息评估与记忆压缩"
    );
    assert.match(serverSource, /memory_compression: null/);

    // 设置读取与会话加载并行，减少语音链路首段等待（模型解析仍在转写之前）
    assert.match(serverSource, /const settingsPromise = getSettings\(database\);/);
    assert.match(serverSource, /const conversationPromise = conversationId/);

    console.log("voice turn safety and contract tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

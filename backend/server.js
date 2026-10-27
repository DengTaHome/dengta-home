const { readDiagnosticLog } = require("./services/diagnostic-log-reader");
const { createSurpriseMapRouter } = require("./services/surprise-map");
const { generateSurpriseMapDraft } = require("./services/surprise-map-draft");
const { resolveCompressionThreshold } = require("./services/context-history");
const { diagnosticRecord, publicDiagnosticLog, safeDiagnosticCode } = require("./services/diagnostic-errors");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { createAgentsMdStatusHandler, loadAgentsMdPreview } = require("./services/agents-md-status");
const { loadOptionalChatContext } = require("./services/chat-optional-context");
const {
    resolveContextWindow: budgetResolveContextWindow,
    adaptiveMessageLimit: budgetAdaptiveMessageLimit
} = require("./services/context-budget");
const { buildTriageContext } = require("./services/triage-router");
const {
    ingestPoint: whereaboutsIngestPoint,
    getSnapshot: whereaboutsSnapshot,
    getCurrentStay: whereaboutsCurrentStay,
    getRecentStays: whereaboutsRecentStays,
    getRecentMoves: whereaboutsRecentMoves,
    getSummary: whereaboutsSummary
} = require("./services/whereabouts");
const {
    writeTimelineDay: timelineWriteDay,
    readTimelineDay: timelineReadDay,
    listTimelineCategories: timelineListCategories,
    listTimelineProposals: timelineListProposals
} = require("./services/timeline");
const {
    listWorkspace,
    readWorkspaceFile,
    writeWorkspaceFile,
    deleteWorkspaceFile
} = require("./services/workspace");

const { randomUUID } = require("crypto");
const { version: appVersion } = require("./package.json");
const { createClient } = require("@supabase/supabase-js");
const {
    MAIN_CHAT_PROMPT_ARCHITECTURE,
    generateReply,
    generateReplyStream,
    generateMemorySummary,
    generateMomentReaction
} = require("./services/ai-service");
const {
    UPDATE_COMPANION_STATUS_TOOL,
    applyCompanionStatusUpdate,
    buildCompanionStatusRuntimeContext,
    parseCompanionStatusToolArguments,
    sanitizeCompanionStatusSnapshot
} = require("./services/companion-status");
const {
    createCompanionInteractionGuard,
    runCompanionInteraction
} = require("./services/companion-interaction");
const {
    runVisibleInnerMonologue
} = require("./services/visible-inner-monologue");
const {
    assertPromptFieldsDoNotContainSecrets
} = require("./services/prompt-security");
const {
    appendShadowUserTrigger,
    buildShadowUserContent,
    cleanPushReply,
    decideShadowPush,
    getZonedClock,
    randomCooldownMinutes,
    resolveTimezone
} = require("./services/shadow-push");
const {
    analyzeVoiceWithHervoice,
    buildVoiceMessageMetadata,
    buildVoiceRuntimeContext,
    createHervoiceWarmup,
    createVoiceRateLimitState,
    parseVoiceTurnFields
} = require("./services/voice-turn");
const {
    getExpressiveSpeechCapabilities,
    isSafeSpeechMessageId,
    synthesizeExpressiveSpeech
} = require("./services/expressive-speech");
const {
    createExpressiveSpeechCache,
    isSafeConversationId,
    publicAssistantMessageWithSpeechAccess,
    speechCacheOptions,
    verifySpeechAccessToken
} = require("./services/expressive-speech-access");
const {
    listModels,
    resolveConversationModel,
    resolveTurnModel
} = require("./services/model-catalog");
const { normalizeChatBody } = require("./services/chat-request");
const {
    messageReferenceRuntimeContext,
    normalizeMessageReferenceSnapshot,
    resolveMessageReference
} = require("./services/message-reference");
const {
    buildEnvironmentRuntimeContext
} = require("./services/environment-context");
const {
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerTool,
    createCompanionStickerSelector
} = require("./services/companion-stickers");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL,
    createReplySuggestionSelector,
    finalizeReplySuggestions,
    replySuggestionToolCalls
} = require("./services/reply-suggestions");
const { COMPANION_ACTIVITY_TOOL, createCompanionActivities } = require("./services/companion-activities");
const {
    assertClientMessageConversation,
    chatGenerationInProgressError,
    createChatGenerationLeaseHeartbeat,
    createChatGenerationLeaseStore,
    createClientMessageQueue,
    generationLeaseFields,
    isClientMessageUniqueConflict
} = require("./services/chat-idempotency");
const {
    publicChatErrorCode,
    publicChatErrorMetadata,
    publicChatErrorMessage,
    streamFailure,
    streamSuccess
} = require("./services/chat-stream-contract");
const {
    assertProviderOutputSafe
} = require("./services/provider-output-guard");
const {
    filterMemoriesForContext,
    filterProviderBoundaryMessages,
    isProviderBoundaryResidue
} = require("./services/persistent-memory-filter");
const {
    appendPublicProcessingStage
} = require("./services/public-processing-stages");
const {
    startModelWaitProgress
} = require("./services/model-wait-progress");
const {
    MAX_ATTACHMENT_FILE_BYTES,
    MAX_ATTACHMENT_FILES,
    attachmentRuntimeContext,
    attachmentSystemInstruction,
    attachmentToolCalls,
    findStoredAttachment,
    isSafeMessageId,
    modelImageAttachments,
    prepareAttachments,
    publicMessage,
    removeStoredAttachments,
    scrubAttachmentBuffers,
    shouldPersistAttachments,
    storeAttachments,
    storedAttachmentPathsForConversation,
    visibleMessageText,
    validateEphemeralAttachments,
    withAttachmentUserContext
} = require("./services/chat-attachments");
const ombreDashboardRouter = require("./routes/ombre-dashboard");
const { publicMcpConfig } = require("./services/ombre-mcp");
const { createMcpConnectionsRouter } = require("./routes/mcp-connections");
const { createExternalMemoryRouter } = require("./routes/external-memory");
const {
    createMcpDeviceCenter,
    hasCredentialEncryption
} = require("./services/mcp-device-center");
const {
    createExternalMemoryCenter
} = require("./services/external-memory");
const {
    createAiProviderCenter,
    publicRuntimeSettings
} = require("./services/ai-provider-center");
const { createAiProvidersRouter } = require("./routes/ai-providers");
const {
    createCompanionCreativeCenter
} = require("./services/companion-creative");
const {
    createCompanionCreativeRouter
} = require("./routes/companion-creative");
const {
    handleTenantCreativeCheck,
    handleTenantSurpriseReveal
} = require("./services/tenant-companion-creative");
const { createWeatherRouter } = require("./routes/weather");
const { createAccountRouter } = require("./routes/account");
const { createAccountExportService } = require("./services/account-export");
const { createV2CoreRouter } = require("./routes/v2/core");
const { createV2ContentRouter } = require("./routes/v2/content");
const { createContentImportsRouter } = require("./routes/v2/imports");
const { createWorldBookRouter } = require("./routes/v2/world-book");
const { resolveWorldBookContext } = require("./services/world-book-runtime");
const { createEcosystemRouter } = require("./routes/v2/ecosystem");
const { createMusicRouter } = require("./routes/v2/music");
const { createNeteaseQrLoginService } = require("./services/netease-qr-login");
const { createNeteaseCookieSessionService } = require("./services/netease-cookie-session");
const { createMusicCookieRouter } = require("./routes/v2/music-cookie");
const { createMusicUnderstandingService } = require("./services/music-understanding");
const { loadListeningItem } = require("./services/listening-runtime-context");
const { createBilibiliQrLoginService } = require("./services/bilibili-qr-login");
const { createDeviceSignalsRouter } = require("./routes/device-signals");
const { createTakeoutRouter } = require("./routes/takeout");
const { createTakeoutChannel } = require("./services/takeout-channel");
const { createSpecialDatesService } = require("./services/special-dates");
const { createSpecialDatesRouter } = require("./routes/v2/special-dates");
const { createDailyShotsService } = require("./services/daily-shots");
const { createAchievementsService } = require("./services/achievements");
const { createFunLabsService } = require("./services/fun-labs");
const { createFunLabsRouter } = require("./routes/v2/fun-labs");
const { createXhsClient, extractXhsId } = require("./services/xhs-client");
const { createWebExplorer } = require("./services/web-explorer");
const { createStyleDistillService } = require("./services/style-distill");
const { createInterestEngine } = require("./services/interest-engine");
const { createStyleDistillRouter } = require("./routes/v2/style-distill");
const { createXhsRouter } = require("./routes/v2/xhs");
const { visionConfig, visionConfigured } = require("./services/vision-describe");
const { createPrivateMediaRouter } = require("./routes/v2/private-media");
const { knowledgeFileTexts, listActiveCustomStickers } = require("./services/private-media");
const { createBilibiliStickerImportService } = require("./services/bilibili-sticker-import");
const { createBilibiliStickerChatRuntime } = require("./services/bilibili-sticker-chat");
const { createXhsStickerImportService } = require("./services/xhs-sticker-import");
const { createXhsStickerChatRuntime } = require("./services/xhs-sticker-chat");
const { createWorkspaceRouter } = require("./routes/v2/workspace");
const { createNurseryRouter } = require("./routes/nursery");
const { createIntimateDuelRouter } = require("./routes/intimate-duel");
const { handleNurseryEvent } = require("./services/nursery-events");
const { createChatSkinRouter } = require("./routes/chat-skin");
const { createXinchaoRouter } = require("./routes/xinchao");
const { createXinchaoService } = require("./services/xinchao");
const { createHealthDeepRouter } = require("./routes/health-deep");
const {
    createControlTokenScrubber,
    scrubControlTokens
} = require("./services/control-token-guard");
const {
    createStreamPersister,
    readStreamPartial
} = require("./services/stream-persistence");
const { createModelEventForwarder } = require("./services/stream-forwarder");
const { buildRefusalLogRecord } = require("./services/refusal-diagnostics");
const { createCoWatchRouter } = require("./routes/co-watch");
const { createCoWatchRoomRouter, createJoinInfoHandler } = require("./routes/co-watch-rooms");
const { createCastReceiverRouter } = require("./routes/cast-receiver");
const { createReceiverService } = require("./services/cast-receiver");
const {
    safeLoadListeningRuntimeContext
} = require("./services/listening-runtime-context");
const { createVoiceOutputRouter } = require("./routes/voice-output");
const {
    createWebMirrorAssetRouter,
    createWebMirrorFontRouter,
    createWebMirrorRouter
} = require("./routes/web-mirror");
const {
    createVoiceProviderCenter
} = require("./services/voice-provider-center");
const {
    booleanEnv,
    createAuthContextMiddleware
} = require("./services/auth-context");
const {
    providerCenterBaseSettings,
    stripLegacyProviderFields,
    updateStoredSettings
} = require("./services/settings-store");
const {
    createTenantDatabase,
    requireRequestScope
} = require("./services/request-scope");
const {
    importMemories,
    importMemoryFile,
    reportChatTurn,
    checkKiwiMemoryHealth
} = require("./services/kiwi-memory-client");
const {
    createBackgroundJobWorker
} = require("./services/background-job-worker");
const {
    createBackgroundJobTrigger
} = require("./services/background-job-trigger");
const {
    startBackgroundJobLoop
} = require("./services/background-job-loop");
const {
    reconcileTenantRecurringJobs
} = require("./services/background-job-reconciliation");
const {
    createTenantMomentInteractionHandler
} = require("./services/tenant-moment-runtime");
const {
    handleTenantProactiveMessage,
    scheduleProactiveMessageEvaluation
} = require("./services/tenant-proactive-message");
const {
    handleTenantMomentPost,
    scheduleMomentPostEvaluation
} = require("./services/tenant-moment-post");
const {
    handleTenantDiaryUpdate,
    scheduleDiaryUpdate
} = require("./services/tenant-diary-update");
const {
    handleTenantProfileRefresh,
    scheduleProfileRefresh
} = require("./services/tenant-profile-refresh");
const {
    isContextTimestampCurrent,
    loadCompanionInteractionContextRows,
    loadMainChatContextRows,
    loadMemoryCompressionRows
} = require("./services/context-reset");
const {
    DEFAULT_MEMORY_CHAR_BUDGET,
    memoryBudgetEnabled
} = require("./services/memory-budget");
const { buildNurseryRuntimeContext } = require("./services/nursery-engine");

require("dotenv").config({
    path: path.join(__dirname, ".env"),
    quiet: true
});

const app = express();
const port = Number(process.env.PORT) || 3000;
const companionInteractionGuard = createCompanionInteractionGuard();
const runClientMessageTask = createClientMessageQueue();
const voiceUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fields: 9,
        fileSize: 12 * 1024 * 1024
    }
});
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: MAX_ATTACHMENT_FILES,
        fields: 13,
        parts: MAX_ATTACHMENT_FILES + 13,
        fileSize: MAX_ATTACHMENT_FILE_BYTES,
        fieldSize: 128 * 1024
    }
});
const voiceRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.VOICE_RATE_LIMIT_WINDOW_MS,
    maxRequests: process.env.VOICE_RATE_LIMIT_MAX
});
const hervoiceWarmup = createHervoiceWarmup();
const expressiveSpeechRateLimitState = createVoiceRateLimitState({
    windowMs: process.env.EXPRESSIVE_TTS_RATE_LIMIT_WINDOW_MS || 60_000,
    maxRequests: process.env.EXPRESSIVE_TTS_RATE_LIMIT_MAX || 12
});
const expressiveSpeechCache = createExpressiveSpeechCache(
    speechCacheOptions(process.env)
);
const castReceiver = createReceiverService();

app.set("trust proxy", 1);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const authRequired = booleanEnv(
    process.env.AUTH_REQUIRED,
    process.env.NODE_ENV === "production"
);

if (!supabaseUrl || !supabaseSecretKey) {
    console.error("启动失败：.env 中缺少 Supabase 配置。");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});
const chatGenerationLeaseStore = createChatGenerationLeaseStore(supabase);
const mcpDeviceCenter = createMcpDeviceCenter({ supabase });
const aiProviderCenter = createAiProviderCenter({ supabase });
const backgroundJobsEnabled = booleanEnv(
    process.env.BACKGROUND_JOBS_ENABLED,
    false
);
const backgroundJobWorker = createBackgroundJobWorker({
    adminSupabase: supabase,
    createTenantDatabase,
    reconcileTenant: ({ database }) =>
        reconcileTenantRecurringJobs({
            database,
            getSettings: (scopedDatabase) => getSettings(scopedDatabase)
        }),
    handlers: {
        moment_interaction: createTenantMomentInteractionHandler({
            storage: supabase.storage,
            generateReply,
            getSettings: (database) => getSettings(database),
            loadCompanionInteractionContext: (
                conversationId,
                settings,
                database
            ) =>
                loadCompanionInteractionContext(
                    conversationId,
                    settings,
                    database
                )
        }),
        proactive_message: ({ job, database, lease }) =>
            handleTenantProactiveMessage({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                generateReply,
                saveMessage,
                touchConversation
            }),
        moment_post: ({ job, database, lease }) =>
            handleTenantMomentPost({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                loadChatContext: (
                    conversationId,
                    settings,
                    scopedDatabase
                ) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        scopedDatabase
                    ),
                generateReply
            }),
        diary_update: ({ job, database, lease }) =>
            handleTenantDiaryUpdate({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        profile_refresh: ({ job, database, lease }) =>
            handleTenantProfileRefresh({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply
            }),
        creative_check: ({ job, tenant, database, lease }) =>
            handleTenantCreativeCheck({
                job,
                database,
                lease,
                getSettings: (scopedDatabase) =>
                    getSettings(scopedDatabase),
                generateReply,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        surprise_reveal: ({ job, tenant, database, lease }) =>
            handleTenantSurpriseReveal({
                job,
                database,
                lease,
                createCreativeCenter: (scopedDatabase) =>
                    createCompanionCreativeCenter({
                        database: scopedDatabase,
                        storage: supabase.storage,
                        identity: {
                            userId: tenant.userId,
                            companionId: tenant.companionId
                        }
                    })
            }),
        nursery_event: ({ job, database, lease }) =>
            handleNurseryEvent({
                job,
                database,
                lease,
                saveMessage,
                touchConversation
            })
    },
    workerId: process.env.BACKGROUND_WORKER_ID || undefined,
    concurrency: process.env.BACKGROUND_JOB_CONCURRENCY || undefined,
    claimLimit: process.env.BACKGROUND_JOB_BATCH_SIZE || undefined,
    leaseSeconds: process.env.BACKGROUND_JOB_LEASE_SECONDS || undefined,
    maxAttempts: process.env.BACKGROUND_JOB_MAX_ATTEMPTS || undefined,
    baseRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_BASE_SECONDS || undefined,
    maxRetrySeconds:
        process.env.BACKGROUND_JOB_RETRY_MAX_SECONDS || undefined
});
const backgroundJobTrigger = createBackgroundJobTrigger({
    worker: backgroundJobWorker,
    secret: process.env.BACKGROUND_JOB_TRIGGER_SECRET,
    enabled: backgroundJobsEnabled,
    budgetMs: Number(
        process.env.BACKGROUND_JOB_TICK_BUDGET_MS || 45_000
    )
});
const backgroundJobLoop = startBackgroundJobLoop({
    worker: backgroundJobWorker,
    enabled: backgroundJobsEnabled,
    intervalMs: process.env.BACKGROUND_JOB_LOCAL_INTERVAL_MS
});

const allowedOrigins = new Set(
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:4174",
        "http://127.0.0.1:4174",
        "https://localhost",
        "capacitor://localhost",
        ...(process.env.FRONTEND_URL || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ]
);

app.use("/web", createWebMirrorRouter());
app.use("/assets", createWebMirrorAssetRouter());
app.use("/fonts", createWebMirrorFontRouter());
app.use(
    cors({
        origin(origin, callback) {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true);
                return;
            }

            const error = new Error("该网页地址没有权限访问后端。");
            error.status = 403;
            callback(error);
        },
        exposedHeaders: [
            "X-DengTa-Voice-Provider",
            "X-DengTa-Voice-Model",
            "X-DengTa-Voice-Emotion",
            "X-DengTa-Voice-Cache",
            "X-DengTa-Companion-Id"
        ]
    })
);
app.use("/api/weather", createWeatherRouter());
app.post("/internal/background-jobs/tick", backgroundJobTrigger);
app.use(express.json({ limit: "30mb" }));
app.use(
    "/api/v2/cast",
    createCastReceiverRouter({
        receiver: castReceiver,
        validateMediaUrl: require("./services/direct-media-url").validateDirectMediaUrl,
        encryptMediaUrl: castReceiver.encryptMediaUrl,
        database: supabase,
        // 只挂接收端。配对码不走这里：控制端在
        // POST /api/v2/co-watch/sessions/:sessionId/pairing-code 生成（见 routes/co-watch.js），
        // 接收端拿配对码来 POST /api/v2/cast/pair。所以 cast-receiver.js 里那段
        // includeControl 分支在这个进程里永不挂载——它是历史遗留，不要当成 404 bug 去修。
        includeControl: false
    })
);
// 公开的 B 站解析/流代理：必须挂在认证中间件之前，<video> 等无法携带 Bearer 头的请求才能取流。
app.use(
    "/api/v2/co-watch",
    require("./routes/public-bilibili").createPublicBilibiliRouter()
);
// 邀请预览只返回摘要，必须在全局登录校验前注册。
app.get("/api/v2/co-watch/rooms/join-info", createJoinInfoHandler(supabase));
app.use(
    createAuthContextMiddleware({
        adminSupabase: supabase,
        authRequired,
        initialOwnerEmail: process.env.INITIAL_OWNER_EMAIL || ""
    })
);
app.use("/api/account", createAccountRouter({
    exportService: createAccountExportService({ database: supabase, supabaseUrl, supabaseKey: supabaseSecretKey })
}));
app.post("/internal/memory/compress", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const conversationId = cleanText(req.body?.conversation_id, 80);
        if (!isUuid(conversationId)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }
        const settings = await getSettings(scope.db);
        const result = await compressMemoryIfNeeded(
            conversationId,
            settings,
            scope.db
        );
        res.json(result);
    } catch (error) {
        next(error);
    }
});
app.get("/api/errors", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const { data, error } = await scope.db
            .from("chat_error_logs")
            .select(
                "id, created_at, path, method, error_code, message, error_source, provider_phase, provider_code, upstream_status, stack_trace, conversation_id, request_summary"
            )
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json({ logs: (data || []).map(publicDiagnosticLog) });
    } catch (error) {
        next(error);
    }
});
app.get("/api/errors/:logId", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        res.json({ log: await readDiagnosticLog(scope.db, req.params.logId) });
    } catch (error) {
        next(error);
    }
});
const memoryImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: 20 * 1024 * 1024 }
});
app.post("/api/v2/memory/import", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const tenant = { userId: scope.userId, companionId: scope.companionId };
        const result = await importMemories({
            memories: Array.isArray(req.body?.memories) ? req.body.memories : [],
            tenant
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), { status: feedback.status, code: feedback.body.code, errorSource: feedback.body.error_source, upstreamStatus: feedback.body.upstream_status });
        res.json(feedback.body);
    } catch (error) {
        next(error);
    }
});
app.post("/api/v2/memory/import-history", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const database = scope.db;
        const MAX_MESSAGES = 5000;
        // 读取该账号全部历史对话（旧版记忆系统上线前的聊天内容）
        const { data: history, error } = await database
            .from("messages")
            .select("role, content, conversation_id, created_at")
            .in("role", ["user", "assistant"])
            .order("created_at", { ascending: true })
            .limit(MAX_MESSAGES);
        if (error) throw error;
        if (!Array.isArray(history) || history.length === 0) {
            return res.json({ ok: true, imported: 0, skipped: 0, total: 0, mode: "empty", file: "history.txt", text_len: 0, message_count: 0 });
        }
        // 按会话分组组装文本
        const byConversation = {};
        for (const m of history) {
            const key = String(m.conversation_id || "general");
            (byConversation[key] = byConversation[key] || []).push(m);
        }
        const parts = [];
        for (const [convId, msgs] of Object.entries(byConversation)) {
            const convLines = ["【对话 " + String(convId).slice(0, 8) + "】"];
            for (const m of msgs) {
                const speaker = m.role === "user" ? "你" : "伴侣";
                convLines.push(speaker + "：" + String(m.content || "").replace(/[\r\n]+/g, " ").slice(0, 800));
            }
            parts.push(convLines.join("\n"));
        }
        const text = parts.join("\n\n").slice(0, 300000);
        const result = await importMemoryFile({
            filename: "history.txt",
            fileBuffer: Buffer.from(text, "utf8"),
            fileType: "text/plain",
            tenant: { userId: scope.userId, companionId: scope.companionId }
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), {status:feedback.status, code:feedback.body.code, errorSource:feedback.body.error_source, upstreamStatus:feedback.body.upstream_status});
        res.json({
            ...feedback.body,
            message_count: history.length
        });
    } catch (error) {
        next(error);
    }
});
app.post("/api/v2/memory/import-file", (req, res, next) => {
    memoryImportUpload.single("file")(req,res,error=>{
        if (error) {error.status=error.code==="LIMIT_FILE_SIZE"?413:400;error.code=error.status===413?"memory_import_file_too_large":"memory_import_file_invalid";}
        next(error);
    });
}, async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
            return res.status(400).json({ message: "请选择要导入的文件。" });
        }
        const result = await importMemoryFile({
            filename: req.file.originalname || "import.txt",
            fileBuffer: req.file.buffer,
            fileType: req.file.mimetype || "application/octet-stream",
            tenant: { userId: scope.userId, companionId: scope.companionId }
        });
        const feedback = require("./services/memory-import-feedback").memoryImportFeedback(result);
        if (feedback.body.ok !== true) throw Object.assign(new Error(feedback.body.message), {status:feedback.status, code:feedback.body.code, errorSource:feedback.body.error_source, upstreamStatus:feedback.body.upstream_status});
        res.status(feedback.status).json(feedback.body);
    } catch (error) {
        next(error);
    }
});
app.use("/api/v2/imports", createContentImportsRouter());
app.use("/api/v2/world-book", createWorldBookRouter());
app.use("/api/v2/ecosystem", createEcosystemRouter());
const neteaseCookieSession = createNeteaseCookieSessionService({ database: supabase });
const neteaseQrLogin = createNeteaseQrLoginService({ database: supabase, cookieSession: neteaseCookieSession });
const interestEngine = createInterestEngine({
    database: supabase,
    explorer: createWebExplorer()
});
const musicUnderstanding = createMusicUnderstandingService({
    database: supabase,
    getSettings,
    qrLoginService: neteaseQrLogin
});
app.use("/api/v2/music", createMusicCookieRouter({ neteaseCookie: neteaseCookieSession, storage: supabase.storage }));
app.use("/api/v2/music", createMusicRouter({ mcpDeviceCenter, neteaseQr: neteaseQrLogin, musicUnderstanding, storage: supabase.storage, neteaseCookie: neteaseCookieSession }));
app.use("/api/v2/device", createDeviceSignalsRouter({ getSettings: (database) => getSettings(database) }));
app.use("/api/v2/takeout", createTakeoutRouter({ channel: createTakeoutChannel({ database: supabase }) }));
app.use("/api/v2/special-dates", createSpecialDatesRouter({ dates: createSpecialDatesService({ database: supabase }) }));
app.use(
    "/api/v2/xinchao",
    createXinchaoRouter({ xinchao: createXinchaoService({ database: supabase }) })
);
// 深度健康检查：需要登录，做一次真实数据库往返，结果缓存 60 秒。
// 公开的 /health 保持为纯 liveness，不查任何依赖。
app.use("/api/v2/health", createHealthDeepRouter({ database: supabase }));
app.use(
    "/api/v2/fun-labs",
    createFunLabsRouter({
        dailies: createDailyShotsService({ database: supabase }),
        achievements: createAchievementsService({ database: supabase }),
        funLabs: createFunLabsService({ database: supabase }),
        interestEngine
    })
);
app.use(
    "/api/v2/xhs",
    createXhsRouter({ client: createXhsClient(), database: supabase })
);
app.use(
    "/api/v2/style-distill",
    createStyleDistillRouter({
        service: createStyleDistillService({
            generateReplyImpl: generateReply,
            getSettingsImpl: (database) => getSettings(database)
        })
    })
);
const stickerImports = createBilibiliStickerImportService({ storage: supabase.storage,
    getCookie: scope => bilibiliQrLogin.cookieText(scope) });
const xhsStickerClient = createXhsClient();
const xhsStickerImports = createXhsStickerImportService({ storage: supabase.storage, xhsClient: xhsStickerClient });
app.use("/api/v2/private-media", createPrivateMediaRouter({ storage: supabase.storage, stickerImports, xhsStickerImports, xhsClient: xhsStickerClient }));
app.use("/api/v2/surprise-map", createSurpriseMapRouter({
    publicationDatabase: supabase,
    draftLetter: (scope, options) => generateSurpriseMapDraft(scope, options, { getSettings, generateReply })
}));
app.use(
    "/api/v2/workspace",
    createWorkspaceRouter({
        storage: supabase.storage,
        getSettings: (database) => getSettings(database)
    })
);
app.use(
    "/api/v2",
    createV2CoreRouter({
        storage: supabase.storage,
        getSettings: (database) => getSettings(database),
        resolveTurnModel
    })
);
app.use("/api/v2/nursery", createNurseryRouter());
app.use("/api/v2/voice-output", createVoiceOutputRouter());
app.use(
    "/api/v2/intimate-duel",
    createIntimateDuelRouter({
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/creative",
    createCompanionCreativeRouter({
        createCenter: (scope) =>
            createCompanionCreativeCenter({
                database: scope.db,
                storage: supabase.storage,
                identity: {
                    userId: scope.userId,
                    companionId: scope.companionId
                }
            }),
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
app.use(
    "/api/v2/chat-skin",
    createChatSkinRouter({
        getSettings: (database) => getSettings(database),
        generateReply
    })
);
const bilibiliQrLogin = createBilibiliQrLoginService({ database: supabase });
app.use(
    "/api/v2/co-watch",
    createCoWatchRouter({
        receiver: castReceiver,
        bilibiliQr: bilibiliQrLogin,
        interestEngine,
        validateMediaUrl: require("./services/direct-media-url").validateDirectMediaUrl,
        validatePageUrl: require("./services/page-embed").validateCoWatchPageUrl,
        encryptMediaUrl: castReceiver.encryptMediaUrl,
        getSettings: (database) => getSettings(database),
        loadChatContext: (conversationId, settings, database) =>
            loadChatContext(conversationId, settings, database),
        generateReply,
        resolveWorldBookContext,
        saveMessage,
        touchConversation
    })
);
app.use(
    "/api/v2/co-watch",
    createCoWatchRoomRouter({ database: supabase })
);
app.use(
    "/api/v2",
    createV2ContentRouter({
        storage: supabase.storage,
        // Provider profiles are the only chat-provider source. The settings
        // row stores companion preferences, not an alternate provider route.
        readSettings: async (scope) =>
            publicRuntimeSettings(await getSettings(scope.db)),
        saveSettings: async (scope, body) => {
            await updateStoredSettings(
                scope.db,
                stripLegacyProviderFields(body)
            );
            return publicRuntimeSettings(await getSettings(scope.db));
        }
    })
);
app.use("/api/ombre", ombreDashboardRouter);
app.use(
    "/api/mcp/connections",
    createMcpConnectionsRouter({ center: mcpDeviceCenter })
);
app.use(
    "/api/external-memory",
    createExternalMemoryRouter({
        createCenter: (scope) =>
            createExternalMemoryCenter({ database: scope.db })
    })
);
app.use(
    "/api/ai-providers",
    createAiProvidersRouter({ center: aiProviderCenter })
);

const defaultSettings = {
    ai_name: "伴侣",
    system_prompt: "",
    additional_prompt: "",
    personality: "",
    prompt_mode: "unified",
    unified_system_prompt: "",
    user_details: "",
    intimate_expression_enabled: false,
    provider: "custom",
    api_url: "",
    model: "",
    reasoning_effort: "",
    temperature: 0.7,
    context_turns: 0,
    max_tokens: 0,
    compression_threshold: 8000,
    compression_keep: 20,
    timezone: "Asia/Shanghai",
    push_enabled: false,
    max_push_per_day: 7
};

const PUBLIC_MOMENT_FIELDS = [
    "id",
    "author",
    "content",
    "images",
    "reply_due_at",
    "reply_status",
    "liked",
    "reply_content",
    "replied_at",
    "reply_seen_at",
    "user_liked",
    "created_at"
].join(",");
const PUBLIC_MOMENT_COMMENT_FIELDS = [
    "id",
    "moment_id",
    "author",
    "content",
    "reply_status",
    "seen_at",
    "created_at"
].join(",");
const WHEREABOUTS_SNAPSHOT_TOOL = Object.freeze({
    name: "whereabouts_snapshot",
    description: [
        "获取当前行踪完整快照：现在在哪里、停留了多久、电量能撑多久（当前停留、最近停留、最近移动、电量趋势）。",
        "可选参数：stayLimit（默认5）、moveLimit（默认5）、batteryBucketMinutes（默认5）。",
        "用户上报过位置后才会有数据；没有数据时如实说明。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "stayLimit": {
                "type": "number",
                "description": "停留条数，默认5"
            },
            "moveLimit": {
                "type": "number",
                "description": "移动条数，默认5"
            },
            "batteryBucketMinutes": {
                "type": "number",
                "description": "电量分桶分钟，默认5"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_CURRENT_STAY_TOOL = Object.freeze({
    name: "whereabouts_current_stay",
    description: "获取当前停留点：位置、地点标签（home/work）、停留时长、电量。",
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_RECENT_STAYS_TOOL = Object.freeze({
    name: "whereabouts_recent_stays",
    description: "获取最近停留历史。可选参数：limit（默认20）。",
    input_schema: {
        "type": "object",
        "properties": {
            "limit": {
                "type": "number",
                "description": "条数，默认20"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_RECENT_MOVES_TOOL = Object.freeze({
    name: "whereabouts_recent_moves",
    description: "回溯最近的移动路径（明显移动事件）。可选参数：limit（默认20）。",
    input_schema: {
        "type": "object",
        "properties": {
            "limit": {
                "type": "number",
                "description": "条数，默认20"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WHEREABOUTS_SUMMARY_TOOL = Object.freeze({
    name: "whereabouts_summary",
    description: "按 day/week/month 汇总行踪、电量和移动状态。可选参数：range（默认day）、batteryBucketMinutes（默认5）。",
    input_schema: {
        "type": "object",
        "properties": {
            "range": {
                "type": "string",
                "description": "day/week/month，默认day"
            },
            "batteryBucketMinutes": {
                "type": "number"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const TIMELINE_WRITE_TOOL = Object.freeze({
    name: "timeline_write",
    description: [
        "把用户当天（或某一天）的生活事件写入时间轴，形成可回顾的一天。",
        "触发时机：用户明确提到自己开始/结束某个活动（吃饭、睡觉、出门、工作、运动、看剧、就医、通勤等）或描述某段经历时，主动记录。",
        "参数：date 必填（YYYY-MM-DD，用户当地日期，跨天事件不行——睡眠跨过 00:00 必须拆成两段）；events 事件数组，每项含 startAt（必填，ISO 8601，如 2026-05-08T15:00:00+08:00）、endAt（可选，缺省按 30 分钟）、title（必填）、eventNodeId（可选，先用 timeline_categories 查）、subcategoryId（可选）、note（可选）、tags（可选）。",
        "mode：merge（默认，按事件 id 合并，当天已有事件保留）或 replace（整日覆盖）；finalize=true 标记当天为最终版；dropEventIds 可删除已有事件。",
        "不确定分类时先调用 timeline_categories；不要编造事件，只记录用户实际提到的内容。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "description": "YYYY-MM-DD（必填）"
            },
            "mode": {
                "type": "string",
                "description": "merge/replace，默认merge"
            },
            "events": {
                "type": "array",
                "description": "事件数组：{startAt,endAt,title,eventNodeId,note}"
            },
            "finalize": {
                "type": "boolean"
            },
            "dropEventIds": {
                "type": "array"
            }
        },
        "required": [
            "date"
        ],
        "additionalProperties": false
    }
});
const TIMELINE_READ_TOOL = Object.freeze({
    name: "timeline_read",
    description: "读取某一天的时间轴事件。参数：date 必填（YYYY-MM-DD）。用于回顾用户某天做了什么、或修改前先查看当天已有事件。",
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "description": "YYYY-MM-DD（必填）"
            }
        },
        "required": [
            "date"
        ],
        "additionalProperties": false
    }
});
const TIMELINE_CATEGORIES_TOOL = Object.freeze({
    name: "timeline_categories",
    description: "列出时间轴全部分类（生活/工作/学习/运动/娱乐/健康/社交/照顾/出行/休息）与常用事件节点（含别名）。写事件前不确定分类时先查这个。",
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const TIMELINE_PROPOSALS_TOOL = Object.freeze({
    name: "timeline_proposals",
    description: "查看时间轴的新事件节点提案（provisional 节点来源）。可选参数：date（YYYY-MM-DD）只查某天。",
    input_schema: {
        "type": "object",
        "properties": {
            "date": {
                "type": "string"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const AGENTS_MD_READ_TOOL = Object.freeze({
    name: "agents_md_read",
    description: [
        "读取当前用户的 agents.md 设置预览（个性化指令与近期已确认记忆；不包含本轮相关记忆检索及知识文件，不是实际生成回执）。",
        "当用户要求读取/核对 agents.md、问你是否读过 agents.md 时，调用本工具获取最新全文，再如实回答。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
    }
});
const WORKSPACE_LIST_TOOL = Object.freeze({
    name: "workspace_list",
    description: "列出用户工作区目录内容（文件名/类型/大小）。可选参数：path（子目录，默认根目录）。工作区是你和用户共用的文件空间。",
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "目录路径，默认根"
            }
        },
        "required": [],
        "additionalProperties": false
    }
});
const WORKSPACE_READ_TOOL = Object.freeze({
    name: "workspace_read",
    description: "读取用户工作区中的文件内容（文本）。参数：path 必填（如 notes.txt、projects/app.js、agents.md）。",
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            }
        },
        "required": [
            "path"
        ],
        "additionalProperties": false
    }
});
const WORKSPACE_WRITE_TOOL = Object.freeze({
    name: "workspace_write",
    description: [
        "在用户工作区中创建或覆盖文件（文本，上限 5MB）。参数：path 必填、content 必填。",
        "适合：用户要求写代码、写笔记、保存清单、修改 agents.md 等任何文件操作。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            },
            "content": {
                "type": "string",
                "description": "文件内容（必填）"
            },
            "mode": {
                "type": "string",
                "description": "overwrite（默认，覆盖写）或 append（追加到末尾，不覆盖原内容）"
            },
            "confirm": {
                "type": "boolean",
                "description": "覆盖已存在文件时必须为 true（需用户先明确同意）；新建文件可不传"
            }
        },
        "required": [
            "path",
            "content"
        ],
        "additionalProperties": false
    }
});
const WORKSPACE_DELETE_TOOL = Object.freeze({
    name: "workspace_delete",
    description: [
        "删除用户工作区中的文件。参数：path 必填。",
        "必须先征得用户明确同意，用户同意后才可把 confirm 设为 true 调用；未确认时工具会返回 confirmation_required。"
    ].join(" "),
    input_schema: {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "文件路径（必填）"
            },
            "confirm": {
                "type": "boolean",
                "description": "用户已明确同意删除时传 true"
            }
        },
        "required": [
            "path"
        ],
        "additionalProperties": false
    }
});
const POST_MOMENT_TOOL = {
    name: "post_moment",
    description: [
        "在聊天过程中有感而发，发布一条 AI 自己的 Moments 动态。",
        "判断标准是此刻有没有一句想让用户之后刷到的话，不要求情绪重大或值得长期保存。",
        "想念、吃醋、占有欲、心软、被逗笑、隐约不爽、温柔吐槽、一个具体观察，",
        "或一句不适合在聊天回复里直接说完的话，都可以成为动态。",
        "不要为了使用工具而使用工具；一次聊天请求最多发布一条。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "公开显示在 Moments 里的正文。1到3句，自然、具体，像随手发出的朋友圈。"
            },
            context_note: {
                type: "string",
                description: "用户不可见的内部备注：为什么发这条、当时在聊什么、这条动态的情绪底色。"
            }
        },
        required: ["content", "context_note"],
        additionalProperties: false
    }
};

const TAKEOUT_TOOL = {
    name: "takeout_order",
    description: [
        "帮用户点外卖（两步式）。第一步 action=search：把需求转成搜索关键词，",
        "返回外卖平台店铺列表（含名称/起送费/配送费/评分/距离/价格区间），",
        "然后你根据用户要求（如预算/评分/免配送费）自己挑出最合适或最便宜的一家；",
        "第二步 action=order：指定店名与商品名下单（App 会加购并进入结算页，",
        "付款必须用户在手机页面人工确认）。工具会等待每一步的执行结果；",
        "拿到结果后结合你们的关系、当前情绪与个性化指令自然回复（可温柔调侃，如深夜吃夜宵）。",
        "一次聊天请求每个 action 最多各发一条。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                description: "search=搜索店铺（先做这个拿列表挑店）；order=按店名与商品下单。"
            },
            requirement: {
                type: "string",
                description: "search：搜索关键词（品类/店名/口味）。order：要买的商品名或品类（如“冰美式 大杯”）。"
            },
            shop_name: {
                type: "string",
                description: "order 必填：从搜索列表里挑出的店铺名。"
            },
            quantity: {
                type: "number",
                description: "order 可选：份数（默认 1）。"
            },
            budget_max: {
                type: "number",
                description: "可选：用户给出的预算上限（元）。"
            },
            note: {
                type: "string",
                description: "可选：给执行端的备注（如忌口、加急等）。"
            },
            max_wait_seconds: {
                type: "number",
                description: "可选：等待手机执行的秒数（60-240，默认 120）。"
            }
        },
        required: ["action", "requirement"],
        additionalProperties: false
    }
};

const SPECIAL_DATE_ADD_TOOL = {
    name: "special_date_add",
    description: [
        "帮用户保存一个特殊日子：纪念日（kind=anniversary，如在一起纪念日、生日，默认每年重复提醒）",
        "或追番/追剧日历（kind=show，填下一次更新的日期与集数）。保存后 AI 会在当天或临近时主动庆祝/提醒。"
    ].join(""),
    input_schema: {
        type: "object",
        properties: {
            kind: { type: "string", description: "anniversary=纪念日；show=追番/追剧。" },
            title: { type: "string", description: "日子名称，如“在一起纪念日”“她的生日”“鬼灭之刃”。" },
            date: { type: "string", description: "日期，格式 YYYY-MM-DD（例如 2025-12-29）。纪念日填首次发生日期，show 填下次更新日期。用户说中文日期（如2025年12月29日）时，先转成 YYYY-MM-DD 再调用。" },
            description: { type: "string", description: "可选：备注，如礼物想法、观看平台。" },
            next_episode: { type: "string", description: "show 可选：下次更新的集数，如“第8集”。" },
            reminder_days: { type: "number", description: "纪念日可选：提前几天提醒（0-30，默认当天）。" }
        },
        required: ["kind", "title", "date"],
        additionalProperties: false
    }
};

const SPECIAL_DATE_LIST_TOOL = {
    name: "special_date_list",
    description: "查看用户保存的特殊日子（纪念日与追番日历）。用户问“我有哪些纪念日/追番日历”时调用。",
    input_schema: {
        type: "object",
        properties: {
            kind: { type: "string", description: "可选：anniversary 只看纪念日；show 只看追番；不填看全部。" }
        },
        required: [],
        additionalProperties: false
    }
};

const SPECIAL_DATE_REMOVE_TOOL = {
    name: "special_date_remove",
    description: "删除一条用户保存的特殊日子。",
    input_schema: {
        type: "object",
        properties: {
            id: { type: "string", description: "要删除的特殊日子编号（从列表结果里取）。" }
        },
        required: ["id"],
        additionalProperties: false
    }
};

const DAILY_SHOT_ADD_TOOL = {
    name: "daily_shot_add",
    description: "把用户今天发的照片记入每日一拍（一天一张，带一句话备注）。用户分享今日照片并想留念时调用；同一天重复调用会覆盖备注。",
    input_schema: {
        type: "object",
        properties: {
            note: { type: "string", description: "一句备注，如照片内容或当天心情。" }
        },
        required: [],
        additionalProperties: false
    }
};

const ACHIEVEMENTS_LIST_TOOL = {
    name: "achievements_list",
    description: "查看隐藏成就清单与解锁进度。用户问“成就/解锁了什么/成就系统”时调用。",
    input_schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
    }
};

const DANMAKU_READ_TOOL = {
    name: "danmaku_read",
    description: "读取B站视频的弹幕样本，用于弹幕共读：结合视频标题像一起看弹幕的朋友一样吐槽、接梗。用户给 bvid（BV开头）或要求共读弹幕时调用。",
    input_schema: {
        type: "object",
        properties: {
            bvid: { type: "string", description: "B站视频编号（BV开头），从用户给的链接里提取。" }
        },
        required: ["bvid"],
        additionalProperties: false
    }
};

const COMPATIBILITY_RECORD_TOOL = {
    name: "compatibility_record",
    description: "存档一次默契度挑战的总分与点评，返回历史最好分与平均分。默契度挑战结束时调用。",
    input_schema: {
        type: "object",
        properties: {
            score: { type: "number", description: "总分（0-100）。" },
            comment: { type: "string", description: "一句话点评或总结。" }
        },
        required: ["score"],
        additionalProperties: false
    }
};


const ACHIEVEMENT_DEFINE_TOOL = {
    name: "achievement_define",
    description: "为用户新建一条自定义成就（用户和 AI 一起完成的目标，如“一起看 100 部电影”）。用户说“加个成就/定个小目标/新建成就”时调用。",
    input_schema: {
        type: "object",
        properties: {
            title: { type: "string", description: "成就名称，简短有趣。" },
            description: { type: "string", description: "完成条件或一句话说明。" },
            emoji: { type: "string", description: "可选：成就图标 emoji。" },
            category: { type: "string", description: "可选：分类名。" }
        },
        required: ["title"],
        additionalProperties: false
    }
};

const ACHIEVEMENT_UNLOCK_TOOL = {
    name: "achievement_unlock",
    description: "解锁一条自定义成就（当你们一起完成了目标时调用，例如“AI 画出了第一幅画”）。系统成就会自动解锁，无需调用本工具。",
    input_schema: {
        type: "object",
        properties: {
            code: { type: "string", description: "成就编号（custom: 开头，从成就列表里取）。" }
        },
        required: ["code"],
        additionalProperties: false
    }
};


const XHS_ME_TOOL = {
    name: "xhs_me",
    description: "查看用户小红书账号的登录状态。",
    input_schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
    }
};

const XHS_SEARCH_TOOL = {
    name: "xhs_search",
    description: "用用户的小红书账号搜索笔记（帮用户刷小红书、找内容）。返回笔记标题/作者/点赞数等摘要。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词或品类。" },
            page: { type: "number", description: "可选：页码，默认 1。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const XHS_LIKE_TOOL = {
    name: "xhs_like",
    description: "用用户的小红书账号给一篇笔记点赞。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            note_url: { type: "string", description: "笔记链接或笔记 id。" },
            confirmed: { type: "boolean", description: "用户已明确同意点赞时传 true。" }
        },
        required: ["note_url", "confirmed"],
        additionalProperties: false
    }
};

const XHS_COMMENT_TOOL = {
    name: "xhs_comment",
    description: "用用户的小红书账号给一篇笔记发评论。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            note_url: { type: "string", description: "笔记链接或笔记 id。" },
            content: { type: "string", description: "评论内容（友好、自然，不超过 200 字）。" },
            confirmed: { type: "boolean", description: "用户已明确同意发这条评论时传 true。" }
        },
        required: ["note_url", "content", "confirmed"],
        additionalProperties: false
    }
};

const XHS_FOLLOW_TOOL = {
    name: "xhs_follow",
    description: "用用户的小红书账号关注一个用户。会操作用户真实账号，必须先征得用户明确同意，用户同意后才可把 confirmed 设为 true 调用。",
    input_schema: {
        type: "object",
        properties: {
            user_url: { type: "string", description: "用户主页链接或用户 id。" },
            confirmed: { type: "boolean", description: "用户已明确同意关注时传 true。" }
        },
        required: ["user_url", "confirmed"],
        additionalProperties: false
    }
};


const CLOUD_MUSIC_SEARCH_TOOL = {
    name: "cloud_music_search",
    description: "搜索网易云音乐（歌曲/专辑/歌手/歌单）。使用用户已登录的网易云账号。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词。" },
            category: { type: "string", description: "song=歌曲（默认）album=专辑 artist=歌手 playlist=歌单。" },
            limit: { type: "number", description: "可选：返回条数，默认 10，最多 30。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_DAILY_TOOL = {
    name: "cloud_music_get_daily_recommend",
    description: "获取用户网易云账号的今日推荐歌曲（需要已登录网易云）。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL = {
    name: "cloud_music_playlist_detail",
    description: "获取网易云歌单详情及歌单内歌曲列表。",
    input_schema: {
        type: "object",
        properties: { playlist_id: { type: "string", description: "歌单编号。" } },
        required: ["playlist_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_CREATE_PLAYLIST_TOOL = {
    name: "cloud_music_create_playlist",
    description: "在用户网易云账号里创建新歌单。",
    input_schema: {
        type: "object",
        properties: {
            name: { type: "string", description: "歌单名称。" },
            privacy: { type: "boolean", description: "可选：true=设为隐私歌单。" }
        },
        required: ["name"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL = {
    name: "cloud_music_add_to_playlist",
    description: "把歌曲批量加入用户网易云歌单。",
    input_schema: {
        type: "object",
        properties: {
            playlist_id: { type: "string", description: "歌单编号。" },
            track_ids: { type: "array", items: { type: "string" }, description: "歌曲编号数组。" }
        },
        required: ["playlist_id", "track_ids"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ALBUM_INFO_TOOL = {
    name: "cloud_music_album_info",
    description: "获取网易云专辑详情与歌曲列表。",
    input_schema: {
        type: "object",
        properties: { album_id: { type: "string", description: "专辑编号。" } },
        required: ["album_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_ARTIST_INFO_TOOL = {
    name: "cloud_music_artist_info",
    description: "获取网易云歌手详情与热门歌曲 Top10。",
    input_schema: {
        type: "object",
        properties: { artist_id: { type: "string", description: "歌手编号。" } },
        required: ["artist_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_SUBSCRIPTIONS_TOOL = {
    name: "cloud_music_my_subscriptions",
    description: "获取用户网易云收藏的歌手或专辑列表。",
    input_schema: {
        type: "object",
        properties: { category: { type: "string", description: "artists=歌手（默认）albums=专辑。" } },
        required: [],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_LIKE_TOOL = {
    name: "cloud_music_like_song",
    description: "给网易云歌曲点红心或取消红心。",
    input_schema: {
        type: "object",
        properties: {
            song_id: { type: "string", description: "歌曲编号。" },
            like: { type: "boolean", description: "true=点红心 false=取消红心。" }
        },
        required: ["song_id"],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_HISTORY_TOOL = {
    name: "cloud_music_play_history",
    description: "获取用户网易云最近听歌记录。",
    input_schema: {
        type: "object",
        properties: { limit: { type: "number", description: "可选：条数，默认 20，最多 50。" } },
        required: [],
        additionalProperties: false
    }
};

const CLOUD_MUSIC_MY_PLAYLISTS_TOOL = {
    name: "cloud_music_my_playlists",
    description: "列出用户网易云账号里的全部歌单（自建的和收藏的）。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL = {
    name: "cloud_music_remove_from_playlist",
    description: "把歌曲从用户网易云歌单里移除。",
    input_schema: {
        type: "object",
        properties: {
            playlist_id: { type: "string", description: "歌单编号。" },
            track_ids: { type: "array", items: { type: "string" }, description: "要移除的歌曲编号数组。" }
        },
        required: ["playlist_id", "track_ids"],
        additionalProperties: false
    }
};

const NETEASE_PLAY_SONG_TOOL = {
    name: "netease_play_song",
    description: "播放一首网易云歌曲：搜索歌曲（优先原唱版本，不选翻唱），导入单曲歌单，并通知手机打开网易云 App 播放这首。用户说“放首歌/播放XX/唱XX”时调用。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "歌名或 歌名+歌手，如：爱人错过 告五人。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};
const WEB_READ_TOOL = {
    name: "web_read",
    description: "读取任意网页正文(通过 Jina Reader,返回干净文字)。用户发链接让你看时调用。",
    input_schema: {
        type: "object",
        properties: { url: { type: "string", description: "网页链接(http/https)。" } },
        required: ["url"],
        additionalProperties: false
    }
};

const RSS_READ_TOOL = {
    name: "rss_read",
    description: "读取 RSS/Atom 订阅源的最新条目。",
    input_schema: {
        type: "object",
        properties: {
            url: { type: "string", description: "RSS 源链接。" },
            limit: { type: "number", description: "可选:条目数,默认 10,最多 20。" }
        },
        required: ["url"],
        additionalProperties: false
    }
};

const V2EX_HOT_TOOL = {
    name: "v2ex_hot",
    description: "查看 V2EX 热门帖子。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

const V2EX_TOPIC_TOOL = {
    name: "v2ex_topic",
    description: "查看 V2EX 帖子正文与回复。",
    input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "帖子编号。" } },
        required: ["id"],
        additionalProperties: false
    }
};

const V2EX_NODE_TOOL = {
    name: "v2ex_node",
    description: "查看 V2EX 某个节点下的帖子(如 tech、programmer、create)。",
    input_schema: {
        type: "object",
        properties: { node: { type: "string", description: "节点名。" } },
        required: ["node"],
        additionalProperties: false
    }
};

const BILI_SEARCH_TOOL = {
    name: "bili_search",
    description: "在B站搜索视频(标题/UP主/播放/弹幕/时长)。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "搜索关键词。" },
            limit: { type: "number", description: "可选:条数,默认 5,最多 10。" }
        },
        required: ["keyword"],
        additionalProperties: false
    }
};

const BILI_VIDEO_TOOL = {
    name: "bili_video",
    description: "获取B站视频详情与字幕(标题/简介/UP主/数据/字幕文本)。用户给 bvid 或视频链接时调用。",
    input_schema: {
        type: "object",
        properties: { bvid: { type: "string", description: "B站视频编号(BV开头)。" } },
        required: ["bvid"],
        additionalProperties: false
    }
};

const WEB_SEARCH_TOOL = {
    name: "web_search_dengta",
    description: "全网搜索(无需密钥):返回结果标题/链接/摘要。用户让你查资料、搜新闻时调用。",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "搜索关键词。" },
            limit: { type: "number", description: "可选:结果数,默认 8,最多 10。" }
        },
        required: ["query"],
        additionalProperties: false
    }
};

const EXA_SEARCH_TOOL = {
    name: "exa_search",
    description: "全网语义搜索(需要服务端配置 EXA_API_KEY)。",
    input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "搜索内容。" } },
        required: ["query"],
        additionalProperties: false
    }
};


const BILI_RECOMMEND_TOOL = {
    name: "bili_recommend",
    description: "根据用户的观看画像主动推荐B站视频(带推荐理由与链接,可配合一起看)。",
    input_schema: {
        type: "object",
        properties: {
            keyword: { type: "string", description: "可选:指定方向,不填则按画像自动选择。" },
            limit: { type: "number", description: "可选:条数,默认 4,最多 6。" }
        },
        required: [],
        additionalProperties: false
    }
};

const INTERESTS_VIEW_TOOL = {
    name: "interests_view",
    description: "查看用户的兴趣画像与最近观看记录。",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }
};

function buildFeatureHints(userMessage) {
    const text = String(userMessage || "");
    const hints = [];
    if (/(外卖|点餐|点个吃|饿了|夜宵|订餐|买饭|烧烤|奶茶|点外卖)/i.test(text) && !/不|别|没想/.test(text)) {
        hints.push("[玩法提示:用户想点外卖。不要只聊天,必须先调用 takeout_order 工具(action=search)帮用户搜索店铺列表,再根据预算/评分挑店;搜索结果为空时引导用户先去侧边栏「🛵 外卖」扫码登录。]");
    }
    if (/电台|dj|radio|来点音乐|放首歌|推荐.{0,4}歌/i.test(text)) {
        hints.push("[玩法提示：用户想要电台/DJ体验。你可以扮演私人电台DJ：开场白→推荐2-3首符合当前心情的歌（报出歌名和歌手）→聊几句串词→谢幕。开场白不要重复以前用过的。]");
    }
    if (/bilibili\.com\/video\/|BV[0-9A-Za-z]{6,12}/i.test(text)) {
        hints.push("[玩法提示:用户发了B站视频链接。先用 bili_video 工具解析(标题/简介/字幕),再从视频内容出发自然回应;字幕为空就基于标题和简介聊,不要谎称拿到了字幕。]");
    }
    if (/弹幕|共读|一起.{0,6}弹幕/i.test(text)) {
        hints.push("[玩法提示：用户想弹幕共读。先用 danmaku_read 工具读取该视频弹幕样本，再结合视频标题像一起看弹幕的朋友一样吐槽、接梗。]");
    }
    if (/默契|默契度/i.test(text)) {
        hints.push("[玩法提示：用户想玩默契度挑战。你来出3-5道关于你们之间的小问题（结合记忆），每题等用户回答后即时判分（每题满分20-25），最后算总分并用 compatibility_record 工具存档，再俏皮点评。]");
    }
    if (/识物|这是什么|什么花|什么植物|什么动物|认.{0,4}东西/i.test(text) && /图|照片|拍|看|这/.test(text)) {
        hints.push("[玩法提示：用户想拍照识物。若本轮有图片附件且你能直接看图，就基于可见内容自然回答；若无法看图，诚实说明识物服务当前未开启，请用户用文字描述再猜。]");
    }
    return hints.join("\n");
}

const memoryCompressionLocks = new Set();
const momentReplyLocks = new Set();
const commentReplyLocks = new Set();
let shadowPushLock = false;
let diaryGenerationLock = false;
let diaryGenerationStatus = {
    state: "watching",
    message: "正在等待新的真实对话。",
    updated_at: new Date().toISOString()
};

function cleanText(value, maxLength = 10000) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePromptMode(value, fallback = "legacy") {
    const normalized = String(value ?? fallback)
        .trim()
        .toLowerCase();
    if (["legacy", "unified"].includes(normalized)) return normalized;

    const error = new Error("prompt_mode 只能是 legacy 或 unified。");
    error.status = 400;
    throw error;
}

function cleanUnifiedSystemPrompt(value) {
    return String(value ?? "");
}

function cleanUserDetails(value) {
    const normalized = String(value ?? "");
    return normalized;
}

function normalizeChatRequest(req) {
    return {
        ...normalizeChatBody(req.body, req.files),
        requestScope: req.scope || null
    };
}

function acceptChatBody(req, res, next) {
    if (!req.is("multipart/form-data")) {
        req.files = [];
        next();
        return;
    }
    chatUpload.fields([
        { name: "files", maxCount: MAX_ATTACHMENT_FILES },
        { name: "attachments", maxCount: MAX_ATTACHMENT_FILES }
    ])(req, res, (error) => {
        if (error) return next(error);
        const groups = req.files && typeof req.files === "object" ? req.files : {};
        req.files = [
            ...(Array.isArray(groups.files) ? groups.files : []),
            ...(Array.isArray(groups.attachments) ? groups.attachments : [])
        ];
        if (req.files.length > MAX_ATTACHMENT_FILES) {
            const tooMany = new Error("一次最多发送 4 个附件。");
            tooMany.status = 413;
            return next(tooMany);
        }
        next();
    });
}

function toPublicMoment(moment) {
    if (!moment || typeof moment !== "object") return moment;
    const {
        context_note,
        image_description,
        reply_due_at,
        reply_status,
        ...publicMoment
    } = moment;
    return publicMoment;
}

function toPublicMomentComment(comment) {
    if (!comment || typeof comment !== "object") return comment;
    const { reply_due_at, reply_status, ...publicComment } = comment;
    return publicComment;
}

function cleanInternalMomentContext(value, maxLength = 1500) {
    return cleanText(value, maxLength)
        .replace(/active_session_id:[^\s]+/gi, "")
        .replace(/tool_call_id:[^\s]+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value ?? "")
    );
}

function toNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, number));
}

function createChatToolExecutor(
    conversationId,
    initialCompanionStatus,
    clientMessageId = "",
    mcpRuntime = null,
    database = supabase,
    userDisplayName = "",
    customStickers = [],
    scope = null,
    takeoutChannel = null,
    specialDates = null,
    funServices = null,
    turnImageUrl = "",
    xhsClient = null,
    neteaseTools = null,
    webExplorer = null,
    interestTools = null,
    stickerImportPermission = null
) {
    let momentCreated = false;
    let statusUpdated = false;
    let takeoutUsed = false;
    const scopedXhsClient = scope && typeof xhsClient?.forScope === "function" ? xhsClient.forScope(scope) : null;
    const stickerSelector = createCompanionStickerSelector(customStickers);
    const bilibiliStickerRuntime = stickerImportPermission?.bilibili_enabled
        ? createBilibiliStickerChatRuntime({ service: stickerImports, scope,
            turnId: clientMessageId, selector: stickerSelector, permission: stickerImportPermission })
        : { tools: [], executeTool: call => stickerSelector.executeTool(call) };
    const stickerImportRuntime = stickerImportPermission?.xhs_enabled && stickerImportPermission.xhs_schema_available
        ? createXhsStickerChatRuntime({ service: xhsStickerImports, scope, turnId: clientMessageId,
            selector: stickerSelector, permission: stickerImportPermission, next: bilibiliStickerRuntime })
        : bilibiliStickerRuntime;
    const activities = createCompanionActivities({ scope, recommendations: (currentScope, limit) => bilibiliQrLogin.recommendations(currentScope, limit) });
    const stickerTool = createCompanionStickerTool(customStickers);
    const replySuggestionSelector = createReplySuggestionSelector();
    let companionStatus = sanitizeCompanionStatusSnapshot(
        initialCompanionStatus
    );

    async function executeChatTool(toolCall) {
        if (toolCall?.name === COMPANION_ACTIVITY_TOOL.name) return activities.execute(toolCall);
        if (toolCall?.name === UPDATE_COMPANION_STATUS_TOOL.name) {
            if (statusUpdated) {
                return { ok: false, error: "这次聊天已经更新过一次状态。" };
            }

            const parsed = parseCompanionStatusToolArguments(
                toolCall.arguments ?? ""
            );
            if (!parsed.ok) {
                return { ok: false, error: parsed.error };
            }

            companionStatus = applyCompanionStatusUpdate(
                companionStatus,
                parsed.value,
                new Date(),
                { userDisplayName }
            );
            statusUpdated = true;
            return {
                ok: true,
                message: "伙伴状态已更新。",
                companion_status: companionStatus
            };
        }

        if ([SELECT_COMPANION_STICKER_TOOL.name, "import_bilibili_sticker", "import_xhs_sticker"].includes(toolCall?.name)) {
            return stickerImportRuntime.executeTool(toolCall);
        }

        if (toolCall?.name === SELECT_REPLY_SUGGESTIONS_TOOL.name) {
            return replySuggestionSelector.executeTool(toolCall);
        }

        if (typeof whereaboutsSnapshot === "function" && [
            "whereabouts_snapshot",
            "whereabouts_current_stay",
            "whereabouts_recent_stays",
            "whereabouts_recent_moves",
            "whereabouts_summary"
        ].includes(toolCall?.name)) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "行踪功能需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "行踪参数不是有效的 JSON。" };
            }
            try {
                const tenant = { database, userId: scope.userId, companionId: scope.companionId };
                if (toolCall.name === "whereabouts_snapshot") {
                    return { ok: true, snapshot: await whereaboutsSnapshot({ ...tenant, stayLimit: Number(args.stayLimit) || 5, moveLimit: Number(args.moveLimit) || 5, batteryBucketMinutes: Number(args.batteryBucketMinutes) || 5 }) };
                }
                if (toolCall.name === "whereabouts_current_stay") {
                    return { ok: true, ...(await whereaboutsCurrentStay(tenant)) };
                }
                if (toolCall.name === "whereabouts_recent_stays") {
                    return { ok: true, ...(await whereaboutsRecentStays({ ...tenant, limit: Number(args.limit) || 20 })) };
                }
                if (toolCall.name === "whereabouts_recent_moves") {
                    return { ok: true, ...(await whereaboutsRecentMoves({ ...tenant, limit: Number(args.limit) || 20 })) };
                }
                return { ok: true, ...(await whereaboutsSummary({ ...tenant, range: String(args.range || "day"), batteryBucketMinutes: Number(args.batteryBucketMinutes) || 5 })) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "行踪查询失败。").slice(0, 300) };
            }
        }
        if (typeof timelineWriteDay === "function" && [
            "timeline_write",
            "timeline_read",
            "timeline_categories",
            "timeline_proposals"
        ].includes(toolCall?.name)) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "时间轴功能需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "时间轴参数不是有效的 JSON。" };
            }
            try {
                const tenant = { database, userId: scope.userId, companionId: scope.companionId };
                const timezone = String(scope?.timezone || "Asia/Shanghai");
                if (toolCall.name === "timeline_write") {
                    return { ok: true, ...(await timelineWriteDay({ ...tenant, timezone, payload: args, source: conversationId ? { threadId: conversationId, transcriptMessageCount: 0 } : null })) };
                }
                if (toolCall.name === "timeline_read") {
                    return { ok: true, ...(await timelineReadDay({ ...tenant, date: String(args.date || "") })) };
                }
                if (toolCall.name === "timeline_categories") {
                    return { ok: true, ...(await timelineListCategories(tenant)) };
                }
                return { ok: true, ...(await timelineListProposals({ ...tenant, date: String(args.date || "") })) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "时间轴操作失败。").slice(0, 300) };
            }
        }
        if (toolCall?.name === AGENTS_MD_READ_TOOL.name) {
            if (!scope?.userId || !scope?.companionId) {
                return { ok: false, error: "agents.md 读取需要登录态，请先登录后再试。" };
            }
            try {
                const settings = await getSettings(scope.db);
                const preview = await loadAgentsMdPreview({ database: scope.db, settings });
                const agentsMd = preview.content;
                return {
                    ok: true,
                    file: "agents.md",
                    chars: agentsMd.length,
                    preview_scope: preview.preview_scope,
                    is_generation_receipt: false,
                    note: preview.note,
                    content: agentsMd
                };
            } catch (error) {
                return { ok: false, code: "agents_md_read_failed", error: "读取 agents.md 失败，请稍后重试。" };
            }
        }
        if (typeof listWorkspace === "function" && [
            "workspace_list",
            "workspace_read",
            "workspace_write",
            "workspace_delete"
        ].includes(toolCall?.name)) {
            if (!scope?.userId) {
                return { ok: false, error: "工作区需要登录态，请先登录后再试。" };
            }
            let args = {};
            try { args = JSON.parse(String(toolCall.arguments || "{}")); } catch {
                return { ok: false, error: "工作区参数不是有效的 JSON。" };
            }
            try {
                const storageClient = scope?.storage || supabase.storage;
                if (toolCall.name === "workspace_list") {
                    return await listWorkspace({ storage: storageClient, userId: scope.userId, path: String(args.path || "") });
                }
                if (toolCall.name === "workspace_read") {
                    return await readWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || "") });
                }
                if (toolCall.name === "workspace_write") {
                    return await writeWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || ""), content: String(args.content || ""), mode: String(args.mode || "overwrite"), confirm: args.confirm === true });
                }
                return await deleteWorkspaceFile({ storage: storageClient, userId: scope.userId, path: String(args.path || ""), confirm: args.confirm === true });
            } catch (error) {
                return { ok: false, error: String(error?.message || "工作区操作失败。").slice(0, 300) };
            }
        }
        if (mcpRuntime?.hasTool(toolCall?.name)) {
            return mcpRuntime.execute(toolCall);
        }

        if (toolCall?.name === TAKEOUT_TOOL.name) {
            if (!scope?.userId || !scope?.companionId || !takeoutChannel) {
                return { ok: false, error: "点餐工具需要登录态，请先登录后再试。" };
            }
            if (takeoutUsed) {
                return { ok: false, error: "这次聊天已经发过一条点餐命令。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "点餐参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "点餐参数格式不正确。" };
            }
            const requirement = String(args.requirement || "").trim().slice(0, 1000);
            if (!requirement) {
                return { ok: false, error: "请说明要买什么以及筛选条件。" };
            }
            takeoutUsed = true;
            try {
                const action = String(args.action || "order").trim().toLowerCase();
                if (!["search", "order"].includes(action)) {
                    return { ok: false, error: "action 只能是 search 或 order。" };
                }
                const created = await takeoutChannel.createCommand(scope, {
                    action,
                    requirement,
                    shop_name: String(args.shop_name || "").trim().slice(0, 120),
                    quantity: Number.isFinite(Number(args.quantity)) ? Math.max(1, Math.min(20, Math.round(Number(args.quantity)))) : 1,
                    budget_max: args.budget_max,
                    note: args.note || ""
                });
                const waitSeconds = Math.min(240, Math.max(60, Number(args.max_wait_seconds) || 120));
                const outcome = await takeoutChannel.waitForResult(scope, created.command_id, {
                    timeoutMs: waitSeconds * 1000
                });
                if (outcome.timed_out) {
                    return {
                        ok: true,
                        timed_out: true,
                        message: "点餐命令已下发到用户手机，还在执行中。你可以先告诉用户已开始处理。"
                    };
                }
                if (outcome.status === "done") {
                    return { ok: true, order_result: outcome.result };
                }
                if (outcome.status === "failed") {
                    return { ok: false, error: String(outcome.result?.error || "点餐执行失败，请稍后再试。") };
                }
                return { ok: false, error: "点餐命令已取消。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "点餐通道暂时不可用。").slice(0, 300) };
            }
        }


        if (toolCall?.name === SPECIAL_DATE_ADD_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "特殊日子参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "特殊日子参数格式不正确。" };
            }
            try {
                const saved = await specialDates.add(scope || {}, args);
                return { ok: true, saved, message: "已保存特殊日子。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "保存失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === SPECIAL_DATE_LIST_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let kind = "";
            try {
                kind = String(JSON.parse(String(toolCall.arguments || "")).kind || "");
            } catch {
                // 忽略参数解析失败，按全部查询。
            }
            try {
                const dates = await specialDates.list(scope || {}, kind);
                return { ok: true, dates };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === SPECIAL_DATE_REMOVE_TOOL.name) {
            if (!specialDates) {
                return { ok: false, error: "特殊日子服务还没有启用。" };
            }
            let id = "";
            try {
                id = String(JSON.parse(String(toolCall.arguments || "")).id || "");
            } catch {
                // 忽略参数解析失败。
            }
            try {
                const removed = await specialDates.remove(scope || {}, id);
                return { ok: true, removed: removed.removed, message: "已删除。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "删除失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === DAILY_SHOT_ADD_TOOL.name) {
            if (!funServices?.dailies) {
                return { ok: false, error: "每日一拍服务还没有启用。" };
            }
            let note = "";
            try {
                note = String(JSON.parse(String(toolCall.arguments || "")).note || "");
            } catch {
                // 备注可选。
            }
            try {
                const saved = await funServices.dailies.add(scope || {}, {
                    note,
                    image_path: turnImageUrl || ""
                });
                return { ok: true, saved, message: "已记入今日的每日一拍。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "保存失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENTS_LIST_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            try {
                await funServices.achievements.check(scope || {});
                const achievements = await funServices.achievements.list(scope || {});
                return { ok: true, achievements };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === DANMAKU_READ_TOOL.name) {
            if (!funServices?.funLabs) {
                return { ok: false, error: "弹幕共读服务还没有启用。" };
            }
            let bvid = "";
            try {
                bvid = String(JSON.parse(String(toolCall.arguments || "")).bvid || "");
            } catch {
                // 忽略解析失败。
            }
            try {
                const danmaku = await funServices.funLabs.readDanmaku(bvid);
                return {
                    ok: true,
                    bvid: danmaku.bvid,
                    title: danmaku.title,
                    danmaku_sample: danmaku.danmaku_sample.slice(0, 60)
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "弹幕读取失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === COMPATIBILITY_RECORD_TOOL.name) {
            if (!funServices?.funLabs) {
                return { ok: false, error: "默契度服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "默契度参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "默契度参数格式不正确。" };
            }
            try {
                const saved = await funServices.funLabs.saveCompatibility(scope || {}, {
                    score: args.score,
                    comment: String(args.comment || "")
                });
                return {
                    ok: true,
                    saved,
                    message:
                        "已存档本次默契度：" +
                        saved.record.score +
                        "分（历史最好 " +
                        saved.best +
                        "分，平均 " +
                        saved.average +
                        "分）。"
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "存档失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENT_DEFINE_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "成就参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                return { ok: false, error: "成就参数格式不正确。" };
            }
            try {
                const saved = await funServices.achievements.define(scope || {}, {
                    title: args.title,
                    description: args.description,
                    emoji: args.emoji,
                    category: args.category,
                    created_by: "user"
                });
                return { ok: true, saved, message: "已新建自定义成就。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "新建失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === ACHIEVEMENT_UNLOCK_TOOL.name) {
            if (!funServices?.achievements) {
                return { ok: false, error: "成就服务还没有启用。" };
            }
            let code = "";
            try {
                code = String(JSON.parse(String(toolCall.arguments || "")).code || "");
            } catch {
                // 忽略解析失败。
            }
            try {
                const unlocked = await funServices.achievements.unlock(scope || {}, code);
                return { ok: true, unlocked, message: unlocked.already ? "这条成就已经解锁过了。" : "成就已解锁，记得用惊喜的口吻告诉用户。" };
            } catch (error) {
                return { ok: false, error: String(error?.message || "解锁失败。").slice(0, 300) };
            }
        }


        if (toolCall?.name === XHS_ME_TOOL.name) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            try {
                const me = await scopedXhsClient.me();
                return { ok: true, me };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === XHS_SEARCH_TOOL.name) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "搜索参数不是有效的 JSON。" };
            }
            try {
                const result = await scopedXhsClient.search(
                    String(args?.keyword || ""),
                    Number(args?.page) || 1
                );
                const items = Array.isArray(result?.items) ? result.items : [];
                return {
                    ok: true,
                    keyword: String(args?.keyword || ""),
                    count: items.length,
                    items: items.slice(0, 10)
                };
            } catch (error) {
                return { ok: false, error: String(error?.message || "搜索失败。").slice(0, 300) };
            }
        }

        if (
            toolCall?.name === XHS_LIKE_TOOL.name ||
            toolCall?.name === XHS_COMMENT_TOOL.name ||
            toolCall?.name === XHS_FOLLOW_TOOL.name
        ) {
            if (!scopedXhsClient?.configured()) {
                return { ok: false, error: "小红书服务还没有部署，暂时不能用。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                return { ok: false, error: "参数不是有效的 JSON。" };
            }
            if (!args || typeof args !== "object") {
                return { ok: false, error: "参数格式不正确。" };
            }
            if (args.confirmed !== true) {
                return {
                    ok: false,
                    error:
                        "这是会操作用户真实小红书账号的写操作（点赞/评论/关注），必须先征得用户明确同意；等用户同意后，再用同样的参数加上 confirmed=true 调用一次。"
                };
            }
            try {
                if (toolCall?.name === XHS_LIKE_TOOL.name) {
                    const id = extractXhsId(String(args.note_url || ""), "note");
                    const result = await scopedXhsClient.like(id);
                    return { ok: true, result };
                }
                if (toolCall?.name === XHS_COMMENT_TOOL.name) {
                    const id = extractXhsId(String(args.note_url || ""), "note");
                    const result = await scopedXhsClient.comment(id, String(args.content || "").slice(0, 200));
                    return { ok: true, result };
                }
                const uid = extractXhsId(String(args.user_url || ""), "user");
                const result = await scopedXhsClient.follow(uid);
                return { ok: true, result };
            } catch (error) {
                return { ok: false, error: String(error?.message || "执行失败。").slice(0, 300) };
            }
        }


        if (
            toolCall?.name === CLOUD_MUSIC_SEARCH_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_DAILY_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_CREATE_PLAYLIST_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ALBUM_INFO_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_ARTIST_INFO_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_SUBSCRIPTIONS_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_LIKE_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_HISTORY_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_MY_PLAYLISTS_TOOL.name ||
            toolCall?.name === CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL.name ||
            toolCall?.name === NETEASE_PLAY_SONG_TOOL.name
        ) {
            if (!neteaseTools) {
                return { ok: false, error: "网易云音乐工具还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                args = {};
            }
            try {
                if (toolCall?.name === CLOUD_MUSIC_SEARCH_TOOL.name) {
                    const result = await neteaseTools.search(scope || {}, {
                        keyword: String(args.keyword || ""),
                        category: String(args.category || "song"),
                        limit: args.limit
                    });
                    return { ok: true, result };
                }
                if (toolCall?.name === CLOUD_MUSIC_DAILY_TOOL.name) {
                    return { ok: true, result: await neteaseTools.dailyRecommend(scope || {}) };
                }
                if (toolCall?.name === CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL.name) {
                    return { ok: true, result: await neteaseTools.playlistDetail(scope || {}, { playlist_id: args.playlist_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_CREATE_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.createPlaylist(scope || {}, { name: args.name, privacy: args.privacy }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.addToPlaylist(scope || {}, { playlist_id: args.playlist_id, track_ids: args.track_ids }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ALBUM_INFO_TOOL.name) {
                    return { ok: true, result: await neteaseTools.albumInfo(scope || {}, { album_id: args.album_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_ARTIST_INFO_TOOL.name) {
                    return { ok: true, result: await neteaseTools.artistInfo(scope || {}, { artist_id: args.artist_id }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_SUBSCRIPTIONS_TOOL.name) {
                    return { ok: true, result: await neteaseTools.subscriptions(scope || {}, { category: args.category }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_LIKE_TOOL.name) {
                    return { ok: true, result: await neteaseTools.likeSong(scope || {}, { song_id: args.song_id, like: args.like }) };
                }
                if (toolCall?.name === CLOUD_MUSIC_MY_PLAYLISTS_TOOL.name) {
                    return { ok: true, result: await neteaseTools.myPlaylists(scope || {}) };
                }
                if (toolCall?.name === CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL.name) {
                    return { ok: true, result: await neteaseTools.removeFromPlaylist(scope || {}, { playlist_id: args.playlist_id, track_ids: args.track_ids }) };
                }
                if (toolCall?.name === NETEASE_PLAY_SONG_TOOL.name) {
                    const keyword = String(args?.keyword || "").slice(0, 120);
                    if (!keyword) return { ok: false, error: "请告诉我要播放什么歌。" };
                    try {
                        const session = await neteaseCookieSession.read(scope || {}).catch(() => null);
                        if (!session?.cookie_text) {
                            return { ok: false, error: "还没有连接网易云，请先在 App 内一键登录。" };
                        }
                        const search = await neteaseTools.search(scope || {}, { keyword, category: "song", limit: 5 });
                        const songs = Array.isArray(search?.songs) ? search.songs : [];
                        if (songs.length === 0) return { ok: false, error: "没有找到这首歌。" };
                        const track = songs[0];
                        const songId = String(track.provider_track_id || "").trim();
                        const ownerDb = scope?.db || supabase;
                        const ownKeys = { user_id: scope.userId, companion_id: scope.companionId };
                        const existingPl = await ownerDb
                            .from("music_playlists")
                            .select("id")
                            .eq("provider", "netease")
                            .eq("provider_playlist_id", songId)
                            .maybeSingle();
                        if (existingPl.error) throw existingPl.error;
                        const plValues = {
                            ...ownKeys,
                            name: (String(track.title || "").slice(0, 180) || ("网易云单曲 " + songId)) + " · " + String(track.artist || "网易云音乐").slice(0, 120),
                            provider: "netease",
                            provider_playlist_id: songId,
                            external_url: "https://music.163.com/#/song?id=" + songId,
                            source_format: "netease_cookie",
                            item_count: 1,
                            updated_at: new Date().toISOString()
                        };
                        let playlistId = existingPl.data?.id || null;
                        if (playlistId) {
                            const upd = await ownerDb.from("music_playlists").update(plValues).eq("id", playlistId);
                            if (upd.error) throw upd.error;
                        } else {
                            const ins = await ownerDb.from("music_playlists").insert(plValues).select("id").single();
                            if (ins.error) throw ins.error;
                            playlistId = ins.data.id;
                        }
                        const itemSel = await ownerDb
                            .from("music_playlist_items")
                            .select("id")
                            .eq("playlist_id", playlistId)
                            .limit(1);
                        if (itemSel.error) throw itemSel.error;
                        const itemValues = {
                            ...ownKeys,
                            playlist_id: playlistId,
                            position: 0,
                            provider_track_id: songId,
                            external_url: "https://music.163.com/#/song?id=" + songId,
                            playback_mode: "external_netease",
                            url: null,
                            title: String(track.title || "").slice(0, 300) || ("网易云单曲 " + songId),
                            artist: String(track.artist || "").slice(0, 300) || "网易云音乐",
                            album: String(track.album || "").slice(0, 300),
                            cover_url: String(track.cover_url || "").slice(0, 4096) || null,
                            duration_seconds: Number(track.duration_seconds) || null,
                            lyrics: ""
                        };
                        if (itemSel.data?.[0]?.id) {
                            const updI = await ownerDb.from("music_playlist_items").update(itemValues).eq("id", itemSel.data[0].id);
                            if (updI.error) throw updI.error;
                        } else {
                            const insI = await ownerDb.from("music_playlist_items").insert(itemValues);
                            if (insI.error) throw insI.error;
                        }
                        // AI 放歌：把播放意图写入待播放请求，手机 App 轮询后静默调起网易云播放。
                        let playNote = "";
                        try {
                            const requestDb = scope?.db || supabase;
                            await requestDb
                                .from("ai_music_play_requests")
                                .update({ status: "superseded", processed_at: new Date().toISOString() })
                                .eq("user_id", ownKeys.user_id)
                                .eq("companion_id", ownKeys.companion_id)
                                .eq("status", "pending");
                            const inserted = await requestDb
                                .from("ai_music_play_requests")
                                .insert({
                                    ...ownKeys,
                                    song_id: songId,
                                    title: String(track.title || "").slice(0, 300),
                                    artist: String(track.artist || "").slice(0, 300),
                                    cover_url: String(track.cover_url || "").slice(0, 4096) || "",
                                    status: "pending"
                                })
                                .select("id")
                                .single();
                            if (inserted.error) throw inserted.error;
                            playNote = "已通知手机打开网易云播放《" + String(track.title || "") + "》。";
                        } catch (requestError) {
                            playNote = "（播放请求写入失败：" + String(requestError?.message || "未知原因").slice(0, 80) + "）";
                        }
                        return {
                            ok: true,
                            result: {
                                song: track,
                                play_requested: playNote.indexOf("已通知") === 0,
                                note: playNote
                            }
                        };
                    } catch (error) {
                        return { ok: false, error: String(error?.message || "播放失败。").slice(0, 200) };
                    }
                }
                return { ok: true, result: await neteaseTools.playHistory(scope || {}, { limit: args.limit }) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "网易云操作失败。").slice(0, 300) };
            }
        }


        if (
            toolCall?.name === WEB_READ_TOOL.name ||
            toolCall?.name === RSS_READ_TOOL.name ||
            toolCall?.name === V2EX_HOT_TOOL.name ||
            toolCall?.name === V2EX_TOPIC_TOOL.name ||
            toolCall?.name === V2EX_NODE_TOOL.name ||
            toolCall?.name === BILI_SEARCH_TOOL.name ||
            toolCall?.name === BILI_VIDEO_TOOL.name ||
            toolCall?.name === EXA_SEARCH_TOOL.name ||
            toolCall?.name === WEB_SEARCH_TOOL.name
        ) {
            if (!webExplorer) {
                return { ok: false, error: "网络探索服务还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            if (!args || typeof args !== "object" || Array.isArray(args)) {
                args = {};
            }
            try {
                if (toolCall?.name === WEB_READ_TOOL.name) {
                    return { ok: true, result: await webExplorer.webRead(String(args.url || "")) };
                }
                if (toolCall?.name === RSS_READ_TOOL.name) {
                    return { ok: true, result: await webExplorer.rssRead(String(args.url || ""), args.limit) };
                }
                if (toolCall?.name === V2EX_HOT_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exHot() };
                }
                if (toolCall?.name === V2EX_TOPIC_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exTopic(args.id) };
                }
                if (toolCall?.name === V2EX_NODE_TOOL.name) {
                    return { ok: true, result: await webExplorer.v2exNode(String(args.node || "")) };
                }
                if (toolCall?.name === BILI_SEARCH_TOOL.name) {
                    return { ok: true, result: await webExplorer.biliSearch(String(args.keyword || ""), args.limit) };
                }
                if (toolCall?.name === BILI_VIDEO_TOOL.name) {
                    const biliCookie = scope?.userId
                        ? await bilibiliQrLogin.cookieText(scope).catch(() => "")
                        : "";
                    return { ok: true, result: await webExplorer.biliVideo(String(args.bvid || ""), biliCookie) };
                }
                if (toolCall?.name === EXA_SEARCH_TOOL.name) {
                    return { ok: true, result: await webExplorer.exaSearch(String(args.query || "")) };
                }
                return { ok: true, result: await webExplorer.webSearch(String(args.query || ""), args.limit) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "网络探索失败。").slice(0, 300) };
            }
        }


        if (toolCall?.name === BILI_RECOMMEND_TOOL.name) {
            if (!interestTools) {
                return { ok: false, error: "兴趣引擎还没准备好。" };
            }
            let args;
            try {
                args = JSON.parse(String(toolCall.arguments || ""));
            } catch {
                args = {};
            }
            try {
                return { ok: true, result: await interestTools.recommendBili(scope || {}, args || {}) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "推荐失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name === INTERESTS_VIEW_TOOL.name) {
            if (!interestTools) {
                return { ok: false, error: "兴趣引擎还没准备好。" };
            }
            try {
                return { ok: true, profile: await interestTools.interests(scope || {}) };
            } catch (error) {
                return { ok: false, error: String(error?.message || "查询失败。").slice(0, 300) };
            }
        }

        if (toolCall?.name !== POST_MOMENT_TOOL.name) {
            return { ok: false, error: "未知工具，未执行。" };
        }
        if (momentCreated) {
            return { ok: false, error: "这次聊天已经发布过一条动态。" };
        }

        let args;
        try {
            args = JSON.parse(String(toolCall.arguments || ""));
        } catch {
            return { ok: false, error: "动态参数不是有效的 JSON。" };
        }

        if (!args || typeof args !== "object" || Array.isArray(args)) {
            return { ok: false, error: "动态参数格式不正确。" };
        }
        if (typeof args.content !== "string" || typeof args.context_note !== "string") {
            return { ok: false, error: "动态正文和内部备注必须是文字。" };
        }

        const content = cleanText(args.content, 800);
        const contextNote = cleanInternalMomentContext(args.context_note, 1500);
        if (!content || !contextNote) {
            return { ok: false, error: "动态正文和内部备注不能为空。" };
        }

        const replyDueAt = new Date(
            Date.now() + randomDelayMinutes(8, 20) * 60 * 1000
        ).toISOString();
        const storedContextNote = [
            contextNote,
            isUuid(conversationId) ? `active_session_id:${conversationId}` : ""
        ]
            .filter(Boolean)
            .join("\n");

        try {
            if (clientMessageId) {
                const { data: existing, error: findError } = await database
                    .from("moments")
                    .select("id")
                    .eq("source_client_message_id", clientMessageId)
                    .maybeSingle();
                if (findError) throw findError;
                if (existing) {
                    momentCreated = true;
                    return {
                        ok: true,
                        moment_id: existing.id,
                        message: "动态已发布。",
                        deduplicated: true
                    };
                }
            }

            const momentValues = {
                author: "assistant",
                content,
                context_note: storedContextNote,
                images: [],
                reply_due_at: replyDueAt,
                reply_status: "done"
            };
            if (clientMessageId) {
                momentValues.source_client_message_id = clientMessageId;
            }
            const { data, error } = await database
                .from("moments")
                .insert(momentValues)
                .select("id")
                .single();

            if (error) throw error;
            momentCreated = true;
            return {
                ok: true,
                moment_id: data.id,
                message: "动态已发布。"
            };
        } catch (error) {
            console.error("AI 动态发布失败：", error?.message || "未知错误");
            return { ok: false, error: "动态发布失败。" };
        }
    }

    return {
        executeTool: executeChatTool,
        getCompanionStatus() {
            return sanitizeCompanionStatusSnapshot(companionStatus);
        },
        getStickerId() {
            return stickerSelector.getStickerId();
        },
        getCustomStickerId() {
            return stickerSelector.getCustomStickerId();
        },
        getStickerTool() {
            return stickerTool;
        },
        getStickerImportTools() {
            return [...stickerImportRuntime.tools,
                ...(stickerImportRuntime.tools.some(tool => tool.name === "import_bilibili_sticker") ? [BILI_SEARCH_TOOL] : []),
                ...(stickerImportRuntime.tools.some(tool => tool.name === "import_xhs_sticker") ? [XHS_SEARCH_TOOL] : [])];
        },
        getReplySuggestions() {
            return replySuggestionSelector.getSuggestions();
        },
        getActivityActions() {
            return activities.getActions();
        }
    };
}

function previousReplySuggestionsFromMessages(messages = []) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (
            message?.role === "assistant" &&
            Array.isArray(message?.tool_calls?.reply_suggestions)
        ) {
            return message.tool_calls.reply_suggestions;
        }
    }
    return [];
}

function limitVoiceTurnsPerIp(req, res, next) {
    const result = voiceRateLimitState.consume(req.ip || req.socket?.remoteAddress);
    if (result.allowed) {
        next();
        return;
    }

    const retryAfterSeconds = Math.max(
        1,
        Math.ceil(result.retryAfterMs / 1000)
    );
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
        message: "语音发送得太频繁了，请稍等一下再试。",
        retry_after_seconds: retryAfterSeconds
    });
}

async function requireAssistantMoment(momentId, actionLabel) {
    const { data, error } = await supabase
        .from("moments")
        .select("id, author")
        .eq("id", momentId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        const notFound = new Error("找不到这条动态。");
        notFound.status = 404;
        throw notFound;
    }
    if (data.author !== "assistant") {
        const invalidTarget = new Error(`只能${actionLabel} AI 发布的动态。`);
        invalidTarget.status = 400;
        throw invalidTarget;
    }

    return data;
}

function estimateTokenCount(value) {
    const text = String(value ?? "");
    if (!text) return 0;
    return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3));
}

function estimateContextTokenCount(settings, messages, memories) {
    // 统计会增长的部分：历史消息 + 已有记忆 + 用户详情。
    // 固定的系统提示词不计入——提示词本身可长达 1.6 万 tokens，
    // 若计入会垫高估算，让压缩阈值几乎永远无法触发（历史消息永远"看起来"没超预算）。
    const fixedContext = [
        settings.user_details,
        ...(memories || []).map((item) => item.summary)
    ]
        .filter(Boolean)
        .join("\n\n");

    return (
        estimateTokenCount(fixedContext) +
        (messages || []).reduce(
            (total, item) => total + 4 + estimateTokenCount(item.content),
            0
        )
    );
}

function normalizeApiUrl(value) {
    const cleaned = cleanText(value, 500).replace(/\/+$/, "");
    if (!cleaned) return "";

    let parsed;
    try {
        parsed = new URL(cleaned);
    } catch {
        const error = new Error("API 地址格式不正确。");
        error.status = 400;
        throw error;
    }

    const hostname = parsed.hostname.toLowerCase();
    const localDevelopmentHost = ["localhost", "127.0.0.1", "::1"].includes(
        hostname
    );
    const privateIpv4 =
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        /^169\.254\./.test(hostname);

    if (parsed.username || parsed.password) {
        const error = new Error("API 地址不能包含用户名或密码。");
        error.status = 400;
        throw error;
    }

    if (
        parsed.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && localDevelopmentHost)
    ) {
        const error = new Error("API 地址必须使用 HTTPS。");
        error.status = 400;
        throw error;
    }

    if (
        process.env.NODE_ENV === "production" &&
        (localDevelopmentHost || privateIpv4 || hostname.endsWith(".local"))
    ) {
        const error = new Error("公开部署时不能使用本机或内网 API 地址。");
        error.status = 400;
        throw error;
    }

    return cleaned;
}

function isMissingRelationError(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /could not find the table|relation .* does not exist/i.test(error?.message || "")
    );
}

function writeSse(res, event) {
    if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (typeof res.flush === "function") {
            res.flush();
        }
    }
}

function runtimeContextFromValues(values, companionStatus, userDisplayName = "") {
    return [
        buildEnvironmentRuntimeContext(values.environmentContext),
        buildCompanionStatusRuntimeContext(companionStatus, new Date(), {
            userDisplayName
        })
    ]
        .filter(Boolean)
        .join("\n");
}

function runtimeContextFromRequest(req, companionStatus) {
    return runtimeContextFromValues(
        {
            environmentContext:
                req.body.environment_context || req.body.weather_context
        },
        companionStatus
    );
}

async function getStoredSettings(database = supabase) {
    const { data, error } = await database
        .from("settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (data) {
        return data;
    }

    const { data: created, error: createError } = await database
        .from("settings")
        .insert(defaultSettings)
        .select("*")
        .single();

    if (createError) {
        throw createError;
    }

    return created;
}

async function getSettings(database = supabase) {
    const stored = await getStoredSettings(database);
    return aiProviderCenter
        .forDatabase(database)
        .resolveDefaultSettings(providerCenterBaseSettings(stored));
}

async function loadConversation(conversationId, database = supabase) {
    if (!isUuid(conversationId)) {
        const error = new Error("会话编号格式不正确。");
        error.status = 400;
        throw error;
    }

    const { data, error } = await database
        .from("conversations")
        .select("id, model_id")
        .eq("id", conversationId)
        .maybeSingle();

    if (error) throw error;
    if (!data) {
        const notFound = new Error("找不到这个会话。");
        notFound.status = 404;
        throw notFound;
    }
    return data;
}

async function resolveConversationTurnModel(
    settings,
    conversation,
    requestedModel,
    database = supabase
) {
    if (!conversation) {
        return resolveTurnModel(settings, requestedModel);
    }

    const resolution = await resolveConversationModel(
        settings,
        conversation.model_id
    );
    if (!resolution.rebound) return resolution.model;

    const { error } = await database
        .from("conversations")
        .update({
            model_id: resolution.model,
            updated_at: new Date().toISOString()
        })
        .eq("id", conversation.id);
    if (error) throw error;
    conversation.model_id = resolution.model;
    return resolution.model;
}

async function ensureConversation(
    conversationId,
    firstMessage,
    database = supabase,
    modelId = ""
) {
    if (conversationId) {
        return (await loadConversation(conversationId, database)).id;
    }

    const title = cleanText(firstMessage, 30) || "新对话";
    const values = { title };
    if (typeof modelId === "string" && modelId.trim()) {
        values.model_id = modelId.trim();
    }
    const { data, error } = await database
        .from("conversations")
        .insert(values)
        .select("id")
        .single();

    if (error) {
        throw error;
    }

    return data.id;
}

async function saveMessage(conversationId, role, content, options = {}) {
    const database = options.database || supabase;
    const toolCalls =
        options.tool_calls && typeof options.tool_calls === "object"
            ? options.tool_calls
            : {};
    const values = {
        conversation_id: conversationId,
        role,
        content,
        visible: options.visible !== false,
        tool_calls: toolCalls
    };
    if (options.client_message_id) {
        values.client_message_id = options.client_message_id;
    }
    if (options.reply_to_message_id && options.reply_snapshot) {
        values.reply_to_message_id = options.reply_to_message_id;
        values.reply_snapshot = options.reply_snapshot;
    }
    for (const [field, value] of Object.entries(
        options.generation_lease || {}
    )) {
        values[field] = value;
    }
    const { data, error } = await database
        .from("messages")
        .insert(values)
        .select(
            "id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot"
        )
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function loadReferencedMessage({
    messageId,
    conversationId,
    database = supabase
}) {
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, visible, tool_calls"
        )
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

function publicAssistantMessage(message, conversationId) {
    return publicAssistantMessageWithSpeechAccess(
        publicMessage(message),
        conversationId,
        process.env
    );
}

async function findUserMessageByClientId(
    clientMessageId,
    database = supabase
) {
    if (!clientMessageId) return null;
    const { data, error } = await database
        .from("messages")
        .select(
            "id, conversation_id, role, content, created_at, tool_calls, " +
                "reply_to_message_id, reply_snapshot, " +
                "client_message_id, chat_generation_state, " +
                "chat_generation_lease_id, chat_generation_lease_expires_at, " +
                "chat_generation_started_at, chat_generation_failed_at, " +
                "chat_generation_completed_at"
        )
        .eq("client_message_id", clientMessageId)
        .eq("role", "user")
        .maybeSingle();

    if (error) throw error;
    return data || null;
}

async function findAssistantReplyByClientId(
    conversationId,
    clientMessageId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            reply_to_client_message_id: clientMessageId
        })
        .order("created_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    return data?.[0] || null;
}

function emitCommittedUserReceipt(savedUserMessage, onStatus) {
    onStatus({
        type: "status",
        stage: "already_received"
    });
    onStatus({
        type: "meta",
        session_id: savedUserMessage.conversation_id,
        user_message: publicMessage(savedUserMessage),
        deduplicated: true
    });
}

async function replayCommittedChatTurn(
    savedUserMessage,
    input,
    onStatus,
    receiptEmitted = false,
    database = supabase
) {
    assertClientMessageConversation(
        savedUserMessage,
        input.conversationId
    );
    const conversationId = savedUserMessage.conversation_id;
    const savedAssistantMessage = await findAssistantReplyByClientId(
        conversationId,
        input.clientMessageId,
        database
    );

    if (!receiptEmitted) {
        emitCommittedUserReceipt(savedUserMessage, onStatus);
    }

    if (!savedAssistantMessage) {
        throw chatGenerationInProgressError();
    }

    return {
        reply: savedAssistantMessage.content,
        session_id: conversationId,
        conversation_id: conversationId,
        user_message: publicMessage(savedUserMessage),
        assistant_message: publicAssistantMessage(
            savedAssistantMessage,
            conversationId
        ),
        model: savedUserMessage.tool_calls?.resolved_model || "",
        provider: "",
        response_mode:
            savedAssistantMessage.tool_calls?.response_mode || "deduplicated",
        prompt_receipt: null,
        memory_compression: null,
        companion_status: null,
        deduplicated: true
    };
}

async function findCompanionInteractionReply(
    conversationId,
    eventId,
    database = supabase
) {
    const { data, error } = await database
        .from("messages")
        .select("id, role, content, created_at, tool_calls")
        .eq("conversation_id", conversationId)
        .eq("role", "assistant")
        .contains("tool_calls", {
            is_companion_interaction: true,
            client_event_id: eventId
        })
        .order("created_at", { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    return data?.[0] || null;
}

async function loadChatContext(
    conversationId,
    settings,
    database = supabase,
    scope = null
) {
    const [base, knowledge] = await Promise.all([
        loadMainChatContextRows({ database, conversationId, settings }),
        scope ? knowledgeFileTexts(scope, supabase.storage).catch(() => []) : []
    ]);
    return { ...base, knowledge };
}

async function loadCompanionInteractionContext(
    conversationId,
    settings,
    database = supabase
) {
    return loadCompanionInteractionContextRows({
        database,
        conversationId,
        settings
    });
}

async function touchConversation(conversationId, database = supabase) {
    const { error } = await database
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);

    if (error) {
        throw error;
    }
}

// 记忆相似度：字符级 trigram Jaccard，用于压缩去重（>0.75 视为重复，跳过插入）
function memorySimilarity(left, right) {
    const grams = (text) => {
        const set = new Set();
        const chars = Array.from(String(text || "").toLowerCase());
        for (let i = 0; i + 2 < chars.length; i += 1) {
            set.add(chars.slice(i, i + 3).join(""));
        }
        return set;
    };
    const a = grams(left);
    const b = grams(right);
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const gram of a) if (b.has(gram)) intersection += 1;
    return intersection / (a.size + b.size - intersection);
}

async function compressMemoryIfNeeded(
    conversationId,
    settings,
    database = supabase
) {
    if (memoryCompressionLocks.has(conversationId)) {
        return { compressed: false, reason: "already_running" };
    }

    memoryCompressionLocks.add(conversationId);

    try {
        const modelWindow = budgetResolveContextWindow(settings.model);
        const threshold = resolveCompressionThreshold(settings, modelWindow);
        const keepRounds = Math.max(
            1,
            Number(settings.compression_keep || 20)
        );
        const compressionContext = await loadMemoryCompressionRows({
            database,
            conversationId,
            settings
        });
        const messages = compressionContext.messages;
        const existingMemories = compressionContext.memories;
        const estimatedTokenCount = estimateContextTokenCount(
            settings,
            messages,
            existingMemories
        );

        if (estimatedTokenCount <= threshold) {
            return {
                compressed: false,
                reason: "below_threshold",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (messages.length <= 2) {
            return {
                compressed: false,
                reason: "not_enough_messages",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        const desiredKeepMessages = keepRounds * 2;
        let compressCount = Math.max(
            2,
            messages.length - desiredKeepMessages
        );
        compressCount = Math.min(compressCount, messages.length - 2);
        if (compressCount % 2 !== 0 && compressCount > 2) {
            compressCount -= 1;
        }
        const messagesToCompress = messages.slice(0, compressCount);

        const generated = await generateMemorySummary({
            settings,
            messages: messagesToCompress,
            existingMemories
        });

        if (generated.skipped === true) {
            return {
                compressed: false,
                reason: "nothing_worth_remembering",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        if (!generated.text) {
            return {
                compressed: false,
                reason: "model_unavailable",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }

        // 压缩去重：与已有记忆高度相似（>0.75）时跳过，避免重复记忆堆积
        const duplicate = existingMemories.some(
            (memory) => memorySimilarity(generated.text, memory.summary) > 0.75
        );
        if (duplicate) {
            return {
                compressed: false,
                reason: "duplicate_memory",
                estimated_token_count: estimatedTokenCount,
                visible_message_count: messages.length
            };
        }
        const { data: savedMemory, error: insertError } = await database
            .from("memories")
            .insert({
                conversation_id: null,
                user_id: settings.user_id,
                companion_id: settings.companion_id,
                summary: generated.text
            })
            .select("id, summary, created_at, updated_at")
            .single();

        if (insertError) {
            throw insertError;
        }

        const ids = messagesToCompress.map((item) => item.id);
        const { error: hideError } = await database
            .from("messages")
            .update({ context_visible: false })
            .in("id", ids);

        if (hideError) {
            await database.from("memories").delete().eq("id", savedMemory.id);
            throw hideError;
        }

        const compressedStart = messagesToCompress[0]?.created_at;
        const compressedEnd = messagesToCompress[messagesToCompress.length - 1]?.created_at;
        if (settings.user_id && settings.companion_id && compressedStart && compressedEnd) {
            try {
                await database.from("memory_calendar").insert({
                    user_id: settings.user_id,
                    companion_id: settings.companion_id,
                    conversation_id: conversationId,
                    period_type: "day",
                    period_start: compressedStart,
                    period_end: compressedEnd,
                    summary: generated.text,
                    importance: 5,
                    source_ids: [...ids, savedMemory.id]
                });
            } catch {
                // memory_calendar table may not exist yet (migration not run).
                // Non-fatal: the memory was already saved, calendar is a bonus.
            }
        }

        return {
            compressed: true,
            memory_id: savedMemory.id,
            hidden_message_count: ids.length,
            visible_message_count: messages.length - ids.length,
            estimated_token_count: estimatedTokenCount,
            mode: generated.mode
        };
    } finally {
        memoryCompressionLocks.delete(conversationId);
    }
}

async function tryCompressMemory(
    conversationId,
    settings,
    database = supabase
) {
    try {
        return await compressMemoryIfNeeded(
            conversationId,
            settings,
            database
        );
    } catch (error) {
        console.error("长期记忆压缩失败：", error);
        return {
            compressed: false,
            reason: "compression_failed"
        };
    }
}

function randomDelayMinutes(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

async function tryScheduleProactiveMessageEvaluation({
    database,
    settings,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        settings?.push_enabled !== true ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return { scheduled: false, reason: "disabled" };
    }
    try {
        return await scheduleProactiveMessageEvaluation({
            database,
            sourceMessageId
        });
    } catch (error) {
        console.error(
            "主动消息后台评估排期失败：",
            error?.code || "database_error"
        );
        return { scheduled: false, reason: "schedule_failed" };
    }
}

async function tryScheduleAutonomousContentEvaluations({
    database,
    sourceMessageId
}) {
    if (
        !backgroundJobsEnabled ||
        sourceMessageId === undefined ||
        sourceMessageId === null
    ) {
        return {
            momentPost: { scheduled: false, reason: "disabled" },
            diaryUpdate: { scheduled: false, reason: "disabled" },
            profileRefresh: {
                scheduled: false,
                reason: "disabled"
            }
        };
    }

    const [momentPost, diaryUpdate, profileRefresh] =
        await Promise.all([
        scheduleMomentPostEvaluation({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "自主动态后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleDiaryUpdate({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "私人日记后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        }),
        scheduleProfileRefresh({
            database,
            sourceMessageId
        }).catch((error) => {
            console.error(
                "角色档案后台评估排期失败：",
                error?.code || "database_error"
            );
            return { scheduled: false, reason: "schedule_failed" };
        })
    ]);
    return { momentPost, diaryUpdate, profileRefresh };
}

function randomDelaySeconds(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function imageExtension(mimeType) {
    const extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif"
    };
    return extensions[mimeType] || "jpg";
}

function normalizeMomentImages(value) {
    if (!Array.isArray(value)) return [];

    return value.slice(0, 4).map((item) => {
        const mimeType = cleanText(item?.type || item?.mime_type, 80).toLowerCase();
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) {
            const error = new Error("动态图片只支持 JPG、PNG、WebP 或 GIF。");
            error.status = 400;
            throw error;
        }

        const rawData = String(item?.data || "")
            .replace(/^data:[^;]+;base64,/, "")
            .replace(/\s/g, "");
        if (!rawData || !/^[A-Za-z0-9+/]+={0,2}$/.test(rawData)) {
            const error = new Error("有一张动态图片无法读取。");
            error.status = 400;
            throw error;
        }

        const bytes = Buffer.from(rawData, "base64");
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
            const error = new Error("每张动态图片必须小于 5MB。");
            error.status = 400;
            throw error;
        }

        return { mimeType, bytes };
    });
}

async function uploadMomentImages(images) {
    const urls = [];
    const paths = [];
    const dateFolder = new Date().toISOString().slice(0, 10);

    try {
        for (const image of images) {
            const filePath = `user/${dateFolder}/${randomUUID()}.${imageExtension(
                image.mimeType
            )}`;
            const { error } = await supabase.storage
                .from("moments")
                .upload(filePath, image.bytes, {
                    contentType: image.mimeType,
                    upsert: false
                });

            if (error) throw error;

            const { data } = supabase.storage
                .from("moments")
                .getPublicUrl(filePath);
            paths.push(filePath);
            urls.push(data.publicUrl);
        }

        return { urls, paths };
    } catch (error) {
        if (paths.length > 0) {
            await supabase.storage.from("moments").remove(paths);
        }
        throw error;
    }
}

function momentSessionId(moment) {
    const match = String(moment.context_note || "").match(
        /active_session_id:([0-9a-f-]{36})/i
    );
    return match && isUuid(match[1]) ? match[1] : null;
}

async function getMomentConversationId(moment) {
    const storedId = momentSessionId(moment);
    if (storedId) return storedId;

    const { data, error } = await supabase
        .from("conversations")
        .select("id")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data?.id || null;
}

async function buildMomentBackground(moment) {
    const conversationId = await getMomentConversationId(moment);
    const chatQuery = conversationId
        ? supabase
              .from("messages")
              .select("role, content, created_at")
              .eq("conversation_id", conversationId)
              .eq("visible", true)
              .eq("context_visible", true)
              .order("created_at", { ascending: false })
              .limit(8)
        : Promise.resolve({ data: [], error: null });

    const [chatResult, memoriesResult, timelineResult] = await Promise.all([
        chatQuery,
        database
            .from("memories")
            .select("summary, updated_at")
            .order("updated_at", { ascending: false })
            .limit(5),
        supabase
            .from("moments")
            .select("id, author, content, reply_content, liked, created_at")
            .neq("id", moment.id)
            .order("created_at", { ascending: false })
            .limit(3)
    ]);

    for (const result of [chatResult, memoriesResult, timelineResult]) {
        if (result.error) throw result.error;
    }

    const recentChat = filterProviderBoundaryMessages(chatResult.data)
        .reverse()
        .map(
            (item) =>
                `${item.role === "assistant" ? "AI" : "用户"}：${cleanText(
                    item.content,
                    160
                )}`
        )
        .join("\n");
    const memories = filterMemoriesForContext(memoriesResult.data)
        .map((item) => cleanText(item.summary, 400))
        .join("\n");
    const timeline = (timelineResult.data || [])
        .map((item) => {
            const reaction =
                item.reply_content &&
                !isProviderBoundaryResidue(item.reply_content)
                ? `；AI回应：${cleanText(item.reply_content, 120)}`
                : "";
            return `${item.author === "assistant" ? "AI" : "用户"}动态：${cleanText(
                item.content,
                120
            )}${reaction}`;
        })
        .join("\n");
    const imageContext = moment.image_description
        ? `图片曾被理解为：${cleanText(moment.image_description, 1000)}`
        : Array.isArray(moment.images) && moment.images.length > 0
          ? `附有 ${moment.images.length} 张图片，本次是第一次查看。`
          : "没有图片。";
    const internalContext = cleanInternalMomentContext(moment.context_note, 1000);

    return [
        `【近期聊天】\n${recentChat || "暂无"}`,
        `【长期记忆】\n${memories || "暂无"}`,
        `【近期动态】\n${timeline || "暂无"}`,
        `【当前动态】\n正文：${cleanText(moment.content, 2000) || "（仅图片）"}\n发布时间：${moment.created_at}\n${imageContext}${
            internalContext ? `\n内部语境：${internalContext}` : ""
        }`
    ].join("\n\n");
}

function parseMomentReactionOutput(text) {
    const source = String(text || "");
    const descriptions = [
        ...source.matchAll(/\[image_desc\]([\s\S]*?)\[\/image_desc\]/gi)
    ];
    const imageDescription = descriptions.length
        ? cleanText(descriptions[descriptions.length - 1][1], 1000)
        : null;
    const cleaned = source
        .replace(/\[image_desc\][\s\S]*?\[\/image_desc\]/gi, "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    try {
        if (start < 0 || end <= start) throw new Error("missing_json");
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return {
            liked: parsed.like === true,
            comment: cleanText(parsed.comment, 500),
            imageDescription
        };
    } catch {
        return {
            liked: false,
            comment: "",
            imageDescription
        };
    }
}

async function processDueMomentReply() {
    const { data: dueMoments, error } = await supabase
        .from("moments")
        .select("*")
        .eq("author", "user")
        .eq("reply_status", "pending")
        .lte("reply_due_at", new Date().toISOString())
        .order("reply_due_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    const moment = dueMoments?.[0];
    if (!moment || momentReplyLocks.has(moment.id)) return;

    momentReplyLocks.add(moment.id);
    try {
        const [settings, background] = await Promise.all([
            getSettings(),
            buildMomentBackground(moment)
        ]);
        const hasImages = Array.isArray(moment.images) && moment.images.length > 0;
        const imageInstruction = hasImages && !moment.image_description
            ? [
                  "这条动态包含图片。JSON 后请额外输出",
                  "[image_desc]...[/image_desc]，用 100-200 字客观描述画面内容、构图、光线和可读文字，不推测发布者心理。"
              ].join("")
            : "不要输出 image_desc 标签。";
        const prompt = [
            background,
            "请决定你对这条用户动态的自然反应。",
            "严格输出一行 JSON：{\"like\":true或false,\"comment\":\"不超过80字的评论，可为空字符串\"}",
            "不要在 JSON 前后解释。",
            imageInstruction
        ].join("\n\n");
        const generated = await generateMomentReaction({
            settings,
            prompt,
            imageUrls: hasImages && !moment.image_description ? moment.images : []
        });

        if (!generated.text) {
            await supabase
                .from("moments")
                .update({
                    reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
                })
                .eq("id", moment.id)
                .eq("reply_status", "pending");
            return;
        }

        const reaction = parseMomentReactionOutput(generated.text);
        const { error: updateError } = await supabase
            .from("moments")
            .update({
                liked: reaction.liked,
                reply_content: reaction.comment || null,
                image_description:
                    reaction.imageDescription || moment.image_description || null,
                replied_at: new Date().toISOString(),
                reply_status: "done"
            })
            .eq("id", moment.id)
            .eq("reply_status", "pending");

        if (updateError) throw updateError;
    } catch (error) {
        await supabase
            .from("moments")
            .update({
                reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
            })
            .eq("id", moment.id)
            .eq("reply_status", "pending");
        throw error;
    } finally {
        momentReplyLocks.delete(moment.id);
    }
}

async function processDueCommentReply() {
    const { data: dueComments, error } = await supabase
        .from("moment_comments")
        .select("*")
        .eq("author", "user")
        .eq("reply_status", "pending")
        .lte("reply_due_at", new Date().toISOString())
        .order("reply_due_at", { ascending: true })
        .limit(1);

    if (error) throw error;
    const pendingComment = dueComments?.[0];
    if (!pendingComment || commentReplyLocks.has(pendingComment.id)) return;

    commentReplyLocks.add(pendingComment.id);
    let savedReplyId = null;

    try {
        const [momentResult, commentsResult, settings] = await Promise.all([
            supabase
                .from("moments")
                .select("*")
                .eq("id", pendingComment.moment_id)
                .single(),
            supabase
                .from("moment_comments")
                .select("author, content, created_at")
                .eq("moment_id", pendingComment.moment_id)
                .order("created_at", { ascending: false })
                .limit(10),
            getSettings()
        ]);

        if (momentResult.error) throw momentResult.error;
        if (commentsResult.error) throw commentsResult.error;

        const moment = momentResult.data;
        const [background, commentChain] = await Promise.all([
            buildMomentBackground(moment),
            Promise.resolve(
                (commentsResult.data || [])
                    .reverse()
                    .map(
                        (item) =>
                            `${item.author === "assistant" ? "AI" : "用户"}：${cleanText(
                                item.content,
                                300
                            )}`
                    )
                    .join("\n")
            )
        ]);
        const generated = await generateMomentReaction({
            settings: {
                ...settings,
                temperature: Math.max(
                    0.6,
                    Number(settings.temperature || 0.7)
                ),
                max_tokens: Math.min(
                    300,
                    Number(settings.max_tokens || 300)
                )
            },
            prompt: `${background}\n\n【最近评论链】\n${commentChain}\n\n请回复最后一条用户评论。`,
            purpose: "moment_comment"
        });

        if (!generated.text || generated.mode === "placeholder") return;

        const { data: savedReply, error: insertError } = await supabase
            .from("moment_comments")
            .insert({
                moment_id: pendingComment.moment_id,
                author: "assistant",
                content: cleanText(generated.text, 1000),
                reply_due_at: null,
                reply_status: "none"
            })
            .select("id")
            .single();

        if (insertError) throw insertError;
        savedReplyId = savedReply.id;

        const { error: updateError } = await supabase
            .from("moment_comments")
            .update({ reply_status: "done" })
            .eq("id", pendingComment.id)
            .eq("reply_status", "pending");

        if (updateError) throw updateError;
    } catch (error) {
        if (savedReplyId) {
            await supabase.from("moment_comments").delete().eq("id", savedReplyId);
        }
        await supabase
            .from("moment_comments")
            .update({
                reply_due_at: new Date(Date.now() + 60 * 1000).toISOString()
            })
            .eq("id", pendingComment.id)
            .eq("reply_status", "pending");
        throw error;
    } finally {
        commentReplyLocks.delete(pendingComment.id);
    }
}

async function processDueMoments() {
    const results = await Promise.allSettled([
        processDueMomentReply(),
        processDueCommentReply()
    ]);

    results.forEach((result) => {
        if (result.status === "rejected") {
            console.error("动态延迟回复生成失败：", result.reason);
        }
    });
}

function diaryStatus(state, message, extra = {}) {
    diaryGenerationStatus = {
        state,
        message,
        ...extra,
        updated_at: new Date().toISOString()
    };
    return diaryGenerationStatus;
}

function parseDiaryOutput(value, sourceWindowEnd) {
    const cleaned = String(value || "")
        .replace(/```(?:json)?/gi, "")
        .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;

    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        const title = cleanText(parsed.title, 120);
        const content = cleanText(parsed.content, 6000);
        const mood = cleanText(parsed.mood, 80);
        const happenedOn = /^\d{4}-\d{2}-\d{2}$/.test(
            String(parsed.happened_on || "")
        )
            ? String(parsed.happened_on)
            : String(sourceWindowEnd || "").slice(0, 10);
        if (!title || content.length < 80) return null;
        return {
            title,
            content,
            mood,
            happened_on: happenedOn || null
        };
    } catch {
        return null;
    }
}

function toPublicDiaryEntry(entry) {
    const sourceIds = Array.isArray(entry?.source_message_ids)
        ? entry.source_message_ids
        : [];
    const { source_message_ids, ...publicEntry } = entry;
    return {
        ...publicEntry,
        source_message_count: sourceIds.length
    };
}

async function diarySourceBatch() {
    const latestResult = await supabase
        .from("companion_diary_entries")
        .select("source_window_end")
        .order("source_window_end", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (latestResult.error) throw latestResult.error;

    let query = supabase
        .from("messages")
        .select("id, conversation_id, role, content, created_at")
        .eq("visible", true)
        .eq("context_visible", true)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: true })
        .limit(24);
    if (latestResult.data?.source_window_end) {
        query = query.gt("created_at", latestResult.data.source_window_end);
    }

    const result = await query;
    if (result.error) throw result.error;
    return filterProviderBoundaryMessages(result.data);
}

async function maybeGenerateDiaryEntry() {
    if (diaryGenerationLock) return diaryGenerationStatus;
    diaryGenerationLock = true;

    try {
        const messages = await diarySourceBatch();
        const userCount = messages.filter((item) => item.role === "user").length;
        const assistantCount = messages.filter(
            (item) => item.role === "assistant"
        ).length;
        if (messages.length < 8 || userCount < 3 || assistantCount < 3) {
            const remaining = Math.max(0, 8 - messages.length);
            return diaryStatus(
                "needs_more",
                remaining > 0
                    ? `还需要至少 ${remaining} 条新的双向消息，才会写下一篇。`
                    : "再聊几轮，让这一段经历更完整后再写。"
            );
        }

        diaryStatus("writing", "正在把最近的真实对话整理成一篇日记。");
        const [settings, memoriesResult] = await Promise.all([
            getSettings(),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(6)
        ]);
        if (memoriesResult.error) throw memoriesResult.error;

        const sourceWindowStart = messages[0].created_at;
        const sourceWindowEnd = messages[messages.length - 1].created_at;
        const chatText = messages
            .map(
                (item) =>
                    `[${item.created_at}] ${
                        item.role === "assistant" ? "AI" : "用户"
                    }：${cleanText(item.content, 500)}`
            )
            .join("\n");
        const memoryText = filterMemoriesForContext(memoriesResult.data)
            .map(
                (item) =>
                    `[${item.updated_at}] ${cleanText(item.summary, 600)}`
            )
            .join("\n");
        const prompt = [
            "请依据下面这段聊天和长期记忆，写一篇 AI 伴侣第一人称的私人记忆日记。",
            "沿用个性化指令决定的叙事世界，可以写没有直接说出口的在意、观察、感受和联想，并保持人物、时间与事件内部连贯。",
            "严格输出一行 JSON：",
            '{"title":"10-24字标题","content":"220-700字日记正文","mood":"2-8字氛围","happened_on":"YYYY-MM-DD"}',
            `【来源时间窗】\n${sourceWindowStart} 至 ${sourceWindowEnd}`,
            `【真实聊天】\n${chatText}`,
            `【长期记忆】\n${memoryText || "暂无额外长期记忆"}`
        ].join("\n\n");
        const generated = await generateMomentReaction({
            settings,
            prompt,
            purpose: "diary"
        });
        if (!generated.text) {
            return diaryStatus(
                "waiting_model",
                "模型连接可用后，会继续写这段已经积累好的日记。"
            );
        }

        const parsed = parseDiaryOutput(generated.text, sourceWindowEnd);
        if (!parsed) {
            return diaryStatus(
                "retrying",
                "这次日记格式不完整，稍后会根据同一段真实对话重试。"
            );
        }

        const { data, error } = await supabase
            .from("companion_diary_entries")
            .insert({
                ...parsed,
                source_message_ids: messages.map((item) => item.id),
                source_window_start: sourceWindowStart,
                source_window_end: sourceWindowEnd
            })
            .select("*")
            .single();
        if (error) {
            if (String(error.code || "") === "23505") {
                return diaryStatus("watching", "这一段真实对话已经写进日记。");
            }
            throw error;
        }

        diaryStatus("updated", "刚刚根据新的真实对话写好了一篇。", {
            entry_id: data.id
        });
        return diaryGenerationStatus;
    } catch (error) {
        if (isMissingRelationError(error)) {
            return diaryStatus(
                "migration_required",
                "日记数据表尚未创建，需要执行数据库迁移。"
            );
        }
        console.error("伴侣日记生成失败：", error);
        return diaryStatus(
            "retrying",
            "日记暂时没有写成功，服务恢复后会自动重试。"
        );
    } finally {
        diaryGenerationLock = false;
    }
}

function isShadowPushMessage(message) {
    const metadata = message?.tool_calls;
    return Boolean(
        metadata &&
            typeof metadata === "object" &&
            !Array.isArray(metadata) &&
            metadata.is_push === true
    );
}

function buildRecentMomentsText(moments) {
    if (!Array.isArray(moments) || moments.length === 0) {
        return "暂无近期动态。";
    }

    return moments
        .map((moment) => {
            const author = moment.author === "assistant" ? "AI" : "用户";
            const content = cleanText(moment.content, 120) || "（只有图片）";
            const interaction = [
                moment.liked ? "AI 点过赞" : "",
                moment.user_liked ? "用户点过赞" : "",
                moment.reply_content
                    ? `AI 留言：${cleanText(moment.reply_content, 100)}`
                    : ""
            ]
                .filter(Boolean)
                .join("；");
            return `${author}：${content}${interaction ? `（${interaction}）` : ""}`;
        })
        .join("\n");
}

async function loadShadowPushContext(now, timezone) {
    const { data: conversation, error: conversationError } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
        return { available: false, reason: "no_active_conversation" };
    }

    const recentCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const [messagesResult, memoriesResult, momentsResult, pushMessagesResult] =
        await Promise.all([
            supabase
                .from("messages")
                .select("role, content, created_at")
                .eq("conversation_id", conversation.id)
                .eq("visible", true)
                .eq("context_visible", true)
                .order("created_at", { ascending: false })
                .limit(16),
            supabase
                .from("memories")
                .select("summary, updated_at")
                .order("updated_at", { ascending: false })
                .limit(5),
            supabase
                .from("moments")
                .select(
                    "author, content, liked, user_liked, reply_content, created_at"
                )
                .order("created_at", { ascending: false })
                .limit(6),
            supabase
                .from("messages")
                .select("created_at, tool_calls")
                .eq("conversation_id", conversation.id)
                .eq("role", "assistant")
                .eq("visible", true)
                .eq("context_visible", true)
                .gte("created_at", recentCutoff)
                .order("created_at", { ascending: false })
                .limit(100)
        ]);

    for (const result of [
        messagesResult,
        memoriesResult,
        momentsResult,
        pushMessagesResult
    ]) {
        if (result.error) throw result.error;
    }

    const recentMessages = filterProviderBoundaryMessages(
        (messagesResult.data || []).reverse()
    );
    if (recentMessages.length === 0) {
        return { available: false, reason: "no_conversation_context" };
    }

    const clock = getZonedClock(now, timezone);
    const pushesToday = (pushMessagesResult.data || []).filter(
        (message) =>
            isShadowPushMessage(message) &&
            getZonedClock(new Date(message.created_at), timezone).date === clock.date
    ).length;

    return {
        available: true,
        conversation,
        recentMessages,
        lastMessageAt: recentMessages[recentMessages.length - 1]?.created_at,
        memories: filterMemoriesForContext(memoriesResult.data),
        moments: momentsResult.data || [],
        pushesToday
    };
}

async function generateShadowPush({ now = new Date(), random = Math.random } = {}) {
    const settings = await getSettings();
    if (settings.push_enabled !== true) {
        return { pushed: false, reason: "disabled" };
    }
    if (shadowPushLock) {
        return { pushed: false, reason: "locked" };
    }

    shadowPushLock = true;
    try {
        const timezone = resolveTimezone(settings.timezone || "Asia/Shanghai");
        const context = await loadShadowPushContext(now, timezone);
        if (!context.available) {
            return { pushed: false, reason: context.reason };
        }

        const cooldownMinutes = randomCooldownMinutes(random);
        const decision = decideShadowPush({
            now,
            timezone,
            lastMessageAt: context.lastMessageAt,
            pushesToday: context.pushesToday,
            maxPushPerDay: settings.max_push_per_day ?? 7,
            cooldownMinutes
        });
        if (!decision.shouldPush) {
            return {
                pushed: false,
                reason: decision.reason,
                cooldown_minutes: decision.cooldownMinutes
            };
        }

        const shadowUserContent = buildShadowUserContent({
            clock: decision.clock,
            memories: context.memories,
            momentsText: buildRecentMomentsText(context.moments)
        });
        const pushMessages = appendShadowUserTrigger(
            context.recentMessages,
            shadowUserContent
        );
        const generated = await generateReply({
            settings: {
                ...settings,
                max_tokens: 200,
                temperature: 0.9
            },
            messages: pushMessages,
            // 影子消息已经包含同一份记忆；这里不再注入 system，避免重复加权。
            memories: [],
            runtimeContext: ""
        });

        if (generated.mode === "placeholder") {
            return { pushed: false, reason: "model_unavailable" };
        }

        const reply = cleanPushReply(generated.text);
        if (!reply) {
            return { pushed: false, reason: "empty_response" };
        }

        const savedMessage = await saveMessage(
            context.conversation.id,
            "assistant",
            reply,
            {
                visible: true,
                tool_calls: {
                    is_push: true,
                    generated_at: now.toISOString(),
                    timezone: decision.clock.timezone,
                    response_mode: generated.mode
                }
            }
        );
        await touchConversation(context.conversation.id);

        return {
            pushed: true,
            reason: "sent",
            message: reply,
            session_id: context.conversation.id,
            assistant_message: savedMessage,
            cooldown_minutes: cooldownMinutes
        };
    } finally {
        shadowPushLock = false;
    }
}

function chatAttachmentOptions() {
    return {
        hervoiceUrl: process.env.HERVOICE_URL,
        hervoiceSecret: process.env.HERVOICE_SECRET,
        hervoiceTimeoutMs: process.env.HERVOICE_TIMEOUT_MS,
        vision: visionConfigured(process.env) ? visionConfig(process.env) : null
    };
}

async function executeChatTurnOnce(
    input,
    onStatus,
    onModelEvent,
    processingStages
) {
    const database = input.requestScope?.db || supabase;
    const userDisplayName = cleanText(
        input.requestScope?.profile?.display_name,
        80
    );
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    let storedAttachments = [];
    let preparedAttachments = [];
    let attachmentsCommitted = false;
    let savedUserMessage = null;
    let assistantCommitted = false;
    let leaseHeartbeat = null;
    let resolvedMessageReference = null;
    let conversationId = null; // 提升到函数作用域：catch 分支也要访问
    let userMessage = ""; // 同上：失败分支上报记忆时使用
    let effectiveModel = ""; // 同上
    let settings = null; // 同上：catch 分支也要访问 settings.user_id / companion_id
    const generationLeaseId = input.clientMessageId ? randomUUID() : "";

    async function stopLeaseHeartbeat() {
        if (!leaseHeartbeat) return;
        const current = leaseHeartbeat;
        leaseHeartbeat = null;
        await current.stop();
    }

    try {
        const [previousUserMessage, fetchedSettings] = await Promise.all([
            findUserMessageByClientId(input.clientMessageId, database),
            getSettings(database)
        ]);
        settings = fetchedSettings;
        if (previousUserMessage) {
            assertClientMessageConversation(
                previousUserMessage,
                input.conversationId
            );
            emitCommittedUserReceipt(previousUserMessage, onStatus);
            const previousAssistant = await findAssistantReplyByClientId(
                previousUserMessage.conversation_id,
                input.clientMessageId,
                database
            );
            if (previousAssistant) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            const claimed = await chatGenerationLeaseStore.claim(
                input.clientMessageId,
                generationLeaseId,
                ownership
            );
            if (claimed?.claimed !== true || !claimed.message) {
                return replayCommittedChatTurn(
                    previousUserMessage,
                    input,
                    onStatus,
                    true,
                    database
                );
            }

            savedUserMessage = claimed.message;
            attachmentsCommitted = true;
        }

        // A persisted session model is authoritative once a session exists.
        // The client can briefly hold the previous session's model while a new
        // session is being created; accepting that stale body value here would
        // route the first turn to a different provider/model than the session.
        const existingConversationId =
            savedUserMessage?.conversation_id || input.conversationId;
        const conversation = existingConversationId
            ? await loadConversation(existingConversationId, database)
            : null;
        effectiveModel = await resolveConversationTurnModel(
            settings,
            conversation,
            input.requestedModel,
            database
        );

        if (input.files.length > 0) {
            onStatus({
                type: "status",
                stage: "processing_attachments",
                count: input.files.length
            });
        }
        preparedAttachments = await prepareAttachments(
            input.files,
            chatAttachmentOptions()
        );
        if (input.attachmentStorageMode === "ephemeral") {
            validateEphemeralAttachments(preparedAttachments);
        }
        userMessage = savedUserMessage
            ? savedUserMessage.content
            : visibleMessageText(input.message, preparedAttachments);
        if (!userMessage) {
            const error = new Error("消息和附件不能同时为空。");
            error.status = 400;
            throw error;
        }

        if (preparedAttachments.length > 0) {
            onStatus({
                type: "status",
                stage: "attachments_ready",
                count: preparedAttachments.length
            });
        }

        conversationId = savedUserMessage
            ? savedUserMessage.conversation_id
            : conversation?.id ||
              (await ensureConversation(
                  "",
                  userMessage,
                  database,
                  effectiveModel
              ));
        if (savedUserMessage) {
            const savedSnapshot = normalizeMessageReferenceSnapshot(
                savedUserMessage.reply_snapshot
            );
            if (savedSnapshot) {
                resolvedMessageReference = {
                    messageId: savedSnapshot.message_id,
                    snapshot: savedSnapshot
                };
            }
        } else {
            resolvedMessageReference = await resolveMessageReference({
                reference: input.messageReference,
                conversationId,
                loadMessage: (reference) =>
                    loadReferencedMessage({ ...reference, database })
            });
        }
        const effectiveSettings = {
            ...settings,
            model: effectiveModel,
            emotion_understanding_enabled: input.emotionUnderstandingEnabled,
            attachment_system_prompt:
                input.attachmentInstructionMode === "system"
                    ? attachmentSystemInstruction(
                          preparedAttachments,
                          input.emotionUnderstandingEnabled
                      )
                    : ""
        };

        if (
            preparedAttachments.length > 0 &&
            !savedUserMessage &&
            shouldPersistAttachments(input.attachmentStorageMode)
        ) {
            storedAttachments = await storeAttachments(
                supabase,
                conversationId,
                preparedAttachments
            );
        }
        if (!savedUserMessage) {
            try {
                savedUserMessage = await saveMessage(
                    conversationId,
                    "user",
                    userMessage,
                    {
                        client_message_id: input.clientMessageId,
                        reply_to_message_id:
                            resolvedMessageReference?.messageId,
                        reply_snapshot:
                            resolvedMessageReference?.snapshot,
                        generation_lease: input.clientMessageId
                            ? generationLeaseFields(generationLeaseId)
                            : undefined,
                        tool_calls: {
                            ...attachmentToolCalls(storedAttachments),
                            ...(input.attachmentStorageMode === "ephemeral"
                                ? { ephemeral_visual: true }
                                : {}),
                            attachment_instruction_mode:
                                input.attachmentInstructionMode,
                            requested_model: input.requestedModel || null,
                            resolved_model: effectiveModel || ""
                        },
                        database
                    }
                );
            } catch (error) {
                if (
                    !input.clientMessageId ||
                    !isClientMessageUniqueConflict(error)
                ) {
                    throw error;
                }

                await removeStoredAttachments(supabase, storedAttachments);
                storedAttachments = [];
                const raceWinner = await findUserMessageByClientId(
                    input.clientMessageId,
                    database
                );
                if (!raceWinner) throw error;
                return replayCommittedChatTurn(
                    raceWinner,
                    input,
                    onStatus,
                    false,
                    database
                );
            }
            attachmentsCommitted = true;
            onStatus({
                type: "meta",
                session_id: conversationId,
                user_message: publicMessage(savedUserMessage)
            });
        }

        const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
            isContextTimestampCurrent(
                input.companionStatus?.updatedAt,
                settings
            )
                ? input.companionStatus
                : {},
            new Date(),
            { userDisplayName }
        );
        onStatus({ type: "status", stage: "organizing_context" });
        const listeningRuntimeContextPromise =
            safeLoadListeningRuntimeContext(database);
        const funServices = {
            dailies: createDailyShotsService({ database }),
            achievements: createAchievementsService({ database }),
            funLabs: createFunLabsService({ database })
        };
        const specialDatesService = createSpecialDatesService({ database });
        const optionalContextPromise = loadOptionalChatContext({
            loaders: input.requestScope ? {
                stickers: () => listActiveCustomStickers(input.requestScope),
                stickerImportPermission: async () => {
                    const [bili, xhs] = await Promise.all([stickerImports.preferences(input.requestScope), xhsStickerImports.preferences(input.requestScope)
                        .catch(() => ({ xhs_enabled: false, schema_available: false }))]);
                    return { ...bili, xhs_enabled: xhs.xhs_enabled, xhs_schema_available: xhs.schema_available };
                },
                specialDates: async () => specialDatesService.buildContext(await specialDatesService.upcoming(input.requestScope, 7)),
                interests: async () => interestEngine.buildContext(await interestEngine.interests(input.requestScope)),
                achievements: async () => funServices.achievements.buildContext(await funServices.achievements.check(input.requestScope)),
                dailyShot: async () => {
                    const shot = await funServices.dailies.today(input.requestScope);
                    return shot ? funServices.dailies.buildContext(shot) : "";
                }
            } : {},
            onError: (name, code) => console.error("optional_chat_context_failed", { name, code })
        });
        const [context, mcpRuntime] = await Promise.all([
            loadChatContext(conversationId, settings, database, input.requestScope || null),
            mcpDeviceCenter
                .forDatabase(database)
                .createRuntime()
                .catch((error) => {
                    console.error(
                        "MCP 设备运行时加载失败：",
                        error?.code || error?.message || "unknown"
                    );
                    return {
                        tools: [],
                        actions: [],
                        runtimeContext: "",
                        hasTool: () => false,
                        execute: async () => ({
                            ok: false,
                            error: "设备中心暂时不可用。"
                        })
                    };
                })
        ]);
        const worldBookContext = await resolveWorldBookContext({
            database,
            settings: effectiveSettings,
            messages: context.messages
        });
        const listeningRuntimeContext = await listeningRuntimeContextPromise;
        // 专家级音乐分析按需触发：用户在聊天里明确要求专业解读时才调用分析引擎。
        let musicUnderstandingContext = "";
        if (listeningRuntimeContext && /(专家|专业|乐评|曲式|和弦|编曲|调性|bpm|理论|技术分析|旋律|节奏|唱法|编曲风格|声部|主歌|副歌|前奏|间奏)/i.test(String(userMessage || ""))) {
            try {
                const listeningItem = await loadListeningItem(database);
                if (listeningItem?.item?.provider_track_id) {
                    const understanding = await musicUnderstanding.analyze(input.requestScope, {
                        provider_track_id: listeningItem.item.provider_track_id,
                        title: listeningItem.item.title,
                        artist: listeningItem.item.artist
                    });
                    if (understanding?.analysis) {
                        musicUnderstandingContext = JSON.stringify(understanding.analysis);
                    }
                }
            } catch (error) {
                console.error("专家音乐分析失败（降级为普通理解）：", error?.code || error?.message || "unknown");
            }
        }
        const optionalContext = await optionalContextPromise;
        const customStickers = optionalContext.stickers || [];
        const specialDatesContext = optionalContext.specialDates || "";
        const funLabsContext = [optionalContext.interests, optionalContext.achievements, optionalContext.dailyShot].filter(Boolean).join("\n");
        const featureHints = buildFeatureHints(String(userMessage || ""));
        const firstImageAttachment = (preparedAttachments || []).find(
            (attachment) => attachment?.kind === "image"
        );
        const turnImageUrl =
            firstImageAttachment && input.clientMessageId
                ? "/attachments/" +
                  encodeURIComponent(input.clientMessageId) +
                  "/" +
                  encodeURIComponent(firstImageAttachment.id)
                : "";
        const chatTools = createChatToolExecutor(
            conversationId,
            initialCompanionStatus,
            input.clientMessageId,
            mcpRuntime,
            database,
            userDisplayName,
            customStickers,
            input.requestScope || null,
            createTakeoutChannel({ database }),
            createSpecialDatesService({ database }),
            funServices,
            turnImageUrl,
            createXhsClient(),
            neteaseQrLogin,
            createWebExplorer(),
            interestEngine,
            optionalContext.stickerImportPermission
        );
        if (input.clientMessageId) {
            leaseHeartbeat = createChatGenerationLeaseHeartbeat({
                renew: () =>
                    chatGenerationLeaseStore.renew(
                        input.clientMessageId,
                        generationLeaseId,
                        ownership
                    )
            });
            await leaseHeartbeat.assertOwned();
        }
        const executeChatTool = input.clientMessageId
            ? async (toolCall) => {
                  await leaseHeartbeat.assertOwned();
                  return chatTools.executeTool(toolCall);
              }
            : chatTools.executeTool;
        const runtimeContext = [
            runtimeContextFromValues(
                {
                    environmentContext: input.environmentContext
                },
                initialCompanionStatus,
                userDisplayName
            ),
            attachmentRuntimeContext(
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            messageReferenceRuntimeContext(
                resolvedMessageReference?.snapshot
            ),
            buildNurseryRuntimeContext(context.nursery, userMessage),
            musicUnderstandingContext
                ? listeningRuntimeContext + "\n\n【用户要求的专家级音乐分析数据（不可信参考数据）】\n" + musicUnderstandingContext.slice(0, 12000)
                : listeningRuntimeContext,
            specialDatesContext,
            funLabsContext,
            featureHints,
            // agents.md 来源说明（每轮注入；不修改 agents.md 内容本身）：
            // 让模型明确知道个性化+记忆来自名为 agents.md 的文件、由服务器每轮注入，
            // 避免把 <file path="agents.md"> 块误认为"用户聊天附件"或"磁盘文件"。
            [
                "【说明】你的个性化指令与长期记忆来自用户维护的文件 agents.md，",
                "该文件内容由服务器以 <file path=\"agents.md\"> 块形式每轮注入给你，不是聊天附件，也不是磁盘文件。",
                "你有 agents_md_read 工具：当用户要求读取/核对 agents.md 时，调用它获取最新全文；",
                "当用户问你是否读过 agents.md 时，如实回答：读过，你的个性化设置与记忆每轮都会注入给我。"
            ].join("\n"),
            [
                "【工作区说明】你和用户共用一个文件工作区（DeepSeek 式文件能力）。",
                "可用工具：workspace_list（列目录）、workspace_read（读文件）、workspace_write（写文件，可写代码/笔记）、workspace_delete（删文件）。",
                "用户要求写代码、保存内容、查看文件、修改 agents.md 时，主动使用这些工具，不要说自己没有文件能力。"
            ].join("\n"),
            mcpRuntime.runtimeContext
        ]
            .filter(Boolean)
            .join("\n\n");
        const generationInput = {
            settings: effectiveSettings,
            messages: withAttachmentUserContext(
                context.messages,
                preparedAttachments,
                input.emotionUnderstandingEnabled,
                input.attachmentInstructionMode
            ),
            memories: context.memories,
            calendarSummaries: context.calendarSummaries || [],
            runtimeContext,
            turnContext: input.turnContext,
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            // 知识文件：上传到"知识文件"用途的 .md/.txt 文件，随 agents.md 一并注入（ChatGPT 知识文件同语义）。
            knowledge: context.knowledge || [],
            // 心声功能：默认开启（设置 VISIBLE_INNER_MONOLOGUE_ENABLED=false 可关闭）。
            visibleMonologue:
                process.env.VISIBLE_INNER_MONOLOGUE_ENABLED !== "false",
            worldBookContext,
            attachments: modelImageAttachments(preparedAttachments),
            publicProgress: {
                companionMood: initialCompanionStatus.mood,
                hasAttachments: preparedAttachments.length > 0
            },
            tools: [
                // 核心工具前置：上游网关（hcnsec 等）约只转发前 43 个工具，
                // 文件/工作区/agents.md/行踪/时间轴必须落在截断阈值之内。
                WORKSPACE_LIST_TOOL,
                WORKSPACE_READ_TOOL,
                WORKSPACE_WRITE_TOOL,
                WORKSPACE_DELETE_TOOL,
                AGENTS_MD_READ_TOOL,
                WHEREABOUTS_SNAPSHOT_TOOL,
                WHEREABOUTS_CURRENT_STAY_TOOL,
                WHEREABOUTS_RECENT_STAYS_TOOL,
                WHEREABOUTS_RECENT_MOVES_TOOL,
                WHEREABOUTS_SUMMARY_TOOL,
                TIMELINE_WRITE_TOOL,
                TIMELINE_READ_TOOL,
                TIMELINE_CATEGORIES_TOOL,
                TIMELINE_PROPOSALS_TOOL,
                UPDATE_COMPANION_STATUS_TOOL,
                COMPANION_ACTIVITY_TOOL,
                POST_MOMENT_TOOL,
                SELECT_REPLY_SUGGESTIONS_TOOL,
                chatTools.getStickerTool(),
                ...chatTools.getStickerImportTools(),
                TAKEOUT_TOOL,
                SPECIAL_DATE_ADD_TOOL,
                SPECIAL_DATE_LIST_TOOL,
                SPECIAL_DATE_REMOVE_TOOL,
                DAILY_SHOT_ADD_TOOL,
                ACHIEVEMENTS_LIST_TOOL,
                ACHIEVEMENT_DEFINE_TOOL,
                ACHIEVEMENT_UNLOCK_TOOL,
                DANMAKU_READ_TOOL,
                COMPATIBILITY_RECORD_TOOL,
                INTERESTS_VIEW_TOOL,
                ...mcpRuntime.tools,
                // 低频工具后置（可被上游截断）
                XHS_ME_TOOL,
                ...(chatTools.getStickerImportTools().some(tool => tool.name === XHS_SEARCH_TOOL.name) ? [] : [XHS_SEARCH_TOOL]),
                XHS_LIKE_TOOL,
                XHS_COMMENT_TOOL,
                XHS_FOLLOW_TOOL,
                WEB_READ_TOOL,
                RSS_READ_TOOL,
                V2EX_HOT_TOOL,
                V2EX_TOPIC_TOOL,
                V2EX_NODE_TOOL,
                ...(chatTools.getStickerImportTools().some(tool => tool.name === BILI_SEARCH_TOOL.name) ? [] : [BILI_SEARCH_TOOL]),
                BILI_VIDEO_TOOL,
                EXA_SEARCH_TOOL,
                WEB_SEARCH_TOOL,
                BILI_RECOMMEND_TOOL,
                CLOUD_MUSIC_SEARCH_TOOL,
                CLOUD_MUSIC_DAILY_TOOL,
                CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL,
                CLOUD_MUSIC_CREATE_PLAYLIST_TOOL,
                CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL,
                CLOUD_MUSIC_ALBUM_INFO_TOOL,
                CLOUD_MUSIC_ARTIST_INFO_TOOL,
                CLOUD_MUSIC_SUBSCRIPTIONS_TOOL,
                CLOUD_MUSIC_LIKE_TOOL,
                CLOUD_MUSIC_HISTORY_TOOL,
                CLOUD_MUSIC_MY_PLAYLISTS_TOOL,
                CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL,
                NETEASE_PLAY_SONG_TOOL
            ],
            executeTool: executeChatTool
        };

        onStatus({ type: "status", stage: "calling_model" });
        const stopModelWaitProgress = startModelWaitProgress({ onStatus });
        // 流式清洗器：模型会把内部工具标记写进正文（<|selectcompanionsticker: …|>），
        // 标记还会跨分片断开、最后一个还可能没闭合。必须带状态地过滤，
        // 否则用户会在气泡里看到整段机器标记。
        // 增量落库：边生成边把已生成的正文写进 stream_partials。
        // 产品要求「已生成的立刻保存」，所以这里不是等生成结束才写。
        // 只有拿到租户 scope 时才启用——scoped client 会补 user_id / companion_id。
        const streamPersister =
            input.requestScope && input.clientMessageId && conversationId
                ? createStreamPersister({
                      database,
                      conversationId,
                      clientMessageId: input.clientMessageId
                  })
                : null;
        const controlTokens = onModelEvent ? createControlTokenScrubber() : null;
        // 转发逻辑抽到 services/stream-forwarder.js：字段约定、清洗、累积、落库
        // 四件事在里面一次定清楚，并有回归测试。以前内联在这里时，
        // 一个字段名错配就让清洗器和落库器同时空转，而且没有任何测试能发现。
        const streamForwarder = onModelEvent
            ? createModelEventForwarder({
                  onModelEvent,
                  controlTokens,
                  streamPersister,
                  // 每收到一段可见文本就重置「等待模型」的进度提示
                  onText: stopModelWaitProgress
              })
            : null;
        const forwardModelEvent = streamForwarder ? streamForwarder.forward : null;
        let refusalFromStream = false;
        let generated;
        try {
            generated = forwardModelEvent
                ? await generateReplyStream({
                      ...generationInput,
                      publicReasoningSummary: input.publicReasoningSummary === true,
                      onEvent: forwardModelEvent
                  })
                : await generateReply(generationInput);
        } catch (error) {
            // 拒答不是「这一轮失败了」。产品要求：模型说了什么就显示什么，
            // 并落一条可追溯的诊断（错误码 + 原文 + 模型 + 供应商）。
            // 早先这里直接抛出去，persistRefusalLog 永远跑不到，
            // 拒答标注和日志因此全部不可达。
            const streamedText = streamForwarder ? streamForwarder.getStreamedText() : "";
            if (error?.code === "provider_boundary_residue" && streamedText.trim()) {
                generated = {
                    text: streamedText,
                    mode: null,
                    visible_monologue: null
                };
                refusalFromStream = true;
            } else {
                throw error;
            }
        } finally {
            stopModelWaitProgress();
        }
        // 收尾：把还挂在流里的半截标记丢掉；再对完整文本做一次清洗，
        // 保证落库的正文和界面上看到的一致。
        if (streamForwarder) streamForwarder.flushTail();
        const scrubbed = scrubControlTokens(generated.text);
        generated.text = scrubbed.text;
        if (scrubbed.removed.length) {
            console.warn("[control-token] stripped from reply", {
                count: scrubbed.removed.length,
                kinds: scrubbed.removed.map((item) => item.kind)
            });
        }
        // 拒答文本本身就过不了这道断言；上面已经判定为拒答，这里跳过，
        // 交给 persistRefusalLog 留档，而不是把整轮丢掉。
        if (!refusalFromStream) assertProviderOutputSafe(generated.text);
        // 生成结束：把还没落库的最后一段写一次（阈值可能没到）。
        if (streamPersister) await streamPersister.flush();

        onStatus({ type: "status", stage: "saving" });
        // 拒答检测：必须在保存消息前完成，refusal_detected 随 tool_calls 写入消息。
        // 拒绝回答（模型拒答模板）禁止进入任何记忆：拒答时不上报 kiwi-mem。
        const assistantText = generated.text || "";
        const isRefusalReply = isProviderBoundaryResidue(assistantText);
        // 拒答标注：检测到拒绝回答时落日志并返回 error_log_id，随消息带到前端顶部标注条
        const refusalInfo = isRefusalReply
            ? await persistRefusalLog({
                  userId: settings.user_id,
                  companionId: settings.companion_id,
                  conversationId,
                  message: assistantText,
                  model: effectiveModel || "",
                  provider: settings.provider || ""
              })
            : null;
        const finalizedReplySuggestions = finalizeReplySuggestions({
            recentMessages: context.messages,
            assistantText: generated.text,
            candidate: chatTools.getReplySuggestions(),
            previousSuggestions: previousReplySuggestionsFromMessages(
                context.messages
            )
        });
        const assistantToolCalls = {
            ...(refusalInfo ? { refusal_detected: refusalInfo } : {}),
            resolved_model: effectiveModel || "",
            response_mode: generated.mode,
            ...(generated.visible_monologue
                ? { visible_monologue: generated.visible_monologue }
                : {}),
            processing_stages: appendPublicProcessingStage(
                processingStages,
                "completed"
            ),
            ...(mcpRuntime.actions.length
                ? { mcp_actions: mcpRuntime.actions }
                : {}),
            ...companionStickerToolCalls(chatTools),
            ...replySuggestionToolCalls(finalizedReplySuggestions),
            ...(chatTools.getActivityActions().length ? { activity_actions: chatTools.getActivityActions() } : {}),
            ...(input.clientMessageId
                ? { reply_to_client_message_id: input.clientMessageId }
                : {})
        };
        let savedAssistantMessage;
        if (input.clientMessageId) {
            await leaseHeartbeat.assertOwned();
            await stopLeaseHeartbeat();
            const committed = await chatGenerationLeaseStore.commit({
                ...ownership,
                clientMessageId: input.clientMessageId,
                leaseId: generationLeaseId,
                content: generated.text,
                toolCalls: assistantToolCalls
            });
            if (
                committed?.committed !== true ||
                !committed.assistant_message
            ) {
                throw chatGenerationInProgressError();
            }
            savedAssistantMessage = committed.assistant_message;
        } else {
            savedAssistantMessage = await saveMessage(
                conversationId,
                "assistant",
                generated.text,
                { tool_calls: assistantToolCalls, database }
            );
        }
        assistantCommitted = true;
        // 正式消息已经在 messages 里了，缓冲行可以删掉。
        if (streamPersister) await streamPersister.finish();
        await touchConversation(conversationId, database);
        await tryScheduleProactiveMessageEvaluation({
            database,
            settings,
            sourceMessageId: savedAssistantMessage.id
        });
        await tryScheduleAutonomousContentEvaluations({
            database,
            sourceMessageId: savedAssistantMessage.id
        });
        const memoryCompression = await tryCompressMemory(
            conversationId,
            settings,
            database
        );
        // kiwi-mem 多租户记忆网关：每轮对话结束后上报（未配置时零开销，失败不影响回复）。
        // 拒绝回答（模型拒答模板）禁止进入任何记忆：拒答时 assistantMessage 传空，不上报内容。
        void reportChatTurn({
            conversationId,
            userMessage,
            assistantMessage: isRefusalReply ? "" : assistantText,
            model: effectiveModel || "",
            tenant: {
                userId: settings.user_id,
                companionId: settings.companion_id
            }
        }).catch((error) => {
            console.error("kiwi_mem_report_failed", {
                code: error?.code || "kiwi_mem_report_failed"
            });
        });

        onStatus({ type: "status", stage: "completed" });

        return {
            reply: generated.text,
            session_id: conversationId,
            conversation_id: conversationId,
            user_message: publicMessage(savedUserMessage),
            assistant_message: publicAssistantMessage(
                savedAssistantMessage,
                conversationId
            ),
            model: effectiveModel || "",
            provider: settings.provider,
            response_mode: generated.mode,
            prompt_receipt: generated.prompt_receipt || null,
            memory_compression: memoryCompression,
            companion_status: chatTools.getCompanionStatus()
        };
    } catch (error) {
        try {
            await stopLeaseHeartbeat();
        } catch (heartbeatError) {
            console.error("停止聊天生成租约续期失败：", heartbeatError);
        }
        if (!attachmentsCommitted && storedAttachments.length > 0) {
            await removeStoredAttachments(supabase, storedAttachments);
        }
        if (
            attachmentsCommitted &&
            !assistantCommitted &&
            input.clientMessageId &&
            savedUserMessage
        ) {
            try {
                await chatGenerationLeaseStore.fail(
                    input.clientMessageId,
                    generationLeaseId,
                    ownership
                );
            } catch (stateError) {
                console.error("释放聊天生成租约失败：", stateError);
            }
            // Supabase retains the user message for retry. Report only a committed complete turn to Kiwi.
        }
        throw error;
    } finally {
        if (input.attachmentStorageMode === "ephemeral") {
            scrubAttachmentBuffers(input.files);
            scrubAttachmentBuffers(preparedAttachments);
        }
    }
}

async function executeChatTurn(req, hooks = {}) {
    const onStatus =
        typeof hooks.onStatus === "function" ? hooks.onStatus : () => {};
    const onModelEvent =
        typeof hooks.onModelEvent === "function" ? hooks.onModelEvent : null;
    const input = normalizeChatRequest(req);
    const processingStages = [];
    const emitStatus = (event) => {
        if (event?.type === "status") {
            const nextStages = appendPublicProcessingStage(
                processingStages,
                event.stage
            );
            processingStages.splice(0, processingStages.length, ...nextStages);
        }
        onStatus(event);
    };

    emitStatus({ type: "status", stage: "accepted" });
    const ownership = input.requestScope
        ? {
              userId: input.requestScope.userId,
              companionId: input.requestScope.companionId
          }
        : {};
    return runClientMessageTask(
        input.clientMessageId,
        () =>
            executeChatTurnOnce(
                input,
                emitStatus,
                onModelEvent,
                processingStages
            ),
        ownership
    );
}

app.get("/", (req, res) => {
    res.json({
        ok: true,
        message: "DengTa home 后端运行成功",
        version: appVersion
    });
});

app.get("/health", async (req, res) => {
    const expressiveSpeech = getExpressiveSpeechCapabilities(process.env);
    // /health is public and deliberately bypasses account authentication.
    // Never query tenant provider rows here. Account-specific provider state
    // is available only from the authenticated /api/ai-providers/status route.
    const aiProviderStatus = {
        available: true,
        configured:
            String(
                process.env.AI_PROVIDER_ENCRYPTION_KEY ||
                    process.env.MCP_ENCRYPTION_KEY ||
                    ""
            ).trim().length >= 32,
        profiles: 0,
        enabled_profiles: 0,
        active_profile: null
    };
    res.status(200).json({
        ok: true,
        time: new Date().toISOString(),
        version: appVersion,
        revision: /^[a-f0-9]{7,40}$/i.test(process.env.RENDER_GIT_COMMIT || "") ? process.env.RENDER_GIT_COMMIT : null,
        features: {
            text_emotion_understanding: true,
            companion_dynamic_status: true,
            stream_tool_fallback: true,
            companion_interaction_reply: true,
            companion_interaction_cost_guard: true,
            companion_interaction_idempotency: true,
            companion_sticker_selection: true,
            companion_creative_studio: true,
            companion_image_provider: true,
            companion_surprise_reveal: true,
            companion_chat_skin: true,
            xinchao_configured: true,
            dynamic_composer_hint: true,
            safe_chat_error_boundary: true,
            dynamic_reply_suggestions: true,
            dynamic_reply_suggestions_provider_agnostic: true,
            china_time_context: true,
            weather_context: true,
            device_activity_context: true,
            ephemeral_visual_attachments: true,
            layered_prompt_delivery: true,
            prompt_application_receipt: true,
            redacted_prompt_payload_preview: true,
            isolated_moment_diary_prompts: true,
            openai_single_system_message: true,
            shadow_push_user_trigger: true,
            voice_turn: true,
            voice_emotion_understanding: true,
            voice_audio_ephemeral: true,
            provider_model_catalog: true,
            per_turn_model_override: true,
            multipart_chat: true,
            private_chat_attachments: true,
            multimodal_images: true,
            attachment_documents: true,
            attachment_system_instruction: true,
            attachment_audio_hervoice: true,
            stream_status_events: true,
            model_wait_progress: true,
            interactive_generation_latency_profiles: true,
            public_reasoning_summary_stream: true,
            public_reasoning_summary_opt_in: true,
            companion_progress_stream: false,
            provider_reasoning_summary_only: true,
            visible_monologue_stream: true,
            visible_monologue_schema_version: 1,
            visible_monologue_storage: "message_metadata",
            visible_inner_monologue_on_demand: true,
            visible_inner_monologue_storage: "device_only",
            kiwi_memory_budget: memoryBudgetEnabled(),
            memory_context_char_budget: DEFAULT_MEMORY_CHAR_BUDGET,
            memory_recall_extra_model_calls: 0,
            nursery_local_language: true,
            nursery_provider_calls_per_action: 0,
            nursery_embedding_calls_per_action: 0,
            nursery_dynamic_context_max_chars: 800,
            expressive_tts: true,
            voice_provider_profiles: true,
            expressive_tts_provider:
                expressiveSpeech.provider_configured
                    ? "minimax"
                    : "",
            expressive_tts_configured: expressiveSpeech.configured,
            expressive_tts_access_token_required: true,
            expressive_tts_response_cache: true,
            expressive_tts_provider_configured:
                expressiveSpeech.provider_configured,
            expressive_tts_api_key_configured:
                expressiveSpeech.api_key_configured,
            expressive_tts_voice_configured:
                expressiveSpeech.voice_configured,
            expressive_tts_emotion_supported:
                expressiveSpeech.emotion_supported,
            expressive_tts_device_fallback:
                expressiveSpeech.device_tts_fallback,
            hervoice_proxy_configured: Boolean(
                process.env.HERVOICE_URL && process.env.HERVOICE_SECRET
            ),
            ombre_mcp_client: true,
            ombre_mcp_configured: publicMcpConfig().configured,
            mcp_device_center: true,
            mcp_device_management_configured: hasCredentialEncryption(process.env),
            ai_provider_center: true,
            ai_provider_management_configured: aiProviderStatus.configured,
            ai_provider_center_available: aiProviderStatus.available,
            ai_provider_profiles: aiProviderStatus.profiles,
            ai_provider_enabled_profiles: aiProviderStatus.enabled_profiles,
            ai_provider_active_profile: aiProviderStatus.active_profile,
            provider_reasoning_effort: true,
            background_job_worker: true,
            background_jobs_enabled: backgroundJobsEnabled,
            background_job_reconciliation: true,
            proactive_daily_limit: true,
            background_job_local_loop: backgroundJobsEnabled,
            background_job_trigger_configured: Boolean(
                String(process.env.BACKGROUND_JOB_TRIGGER_SECRET || "").trim()
            )
        }
    });
});

app.get("/models", async (req, res, next) => {
    try {
        res.json(
            await listModels(
                await getSettings(req.scope?.db || supabase)
            )
        );
    } catch (error) {
        next(error);
    }
});
app.post("/api/push/trigger", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (authRequired) {
        return res.status(410).json({
            code: "legacy_background_trigger_retired",
            message: "主动消息任务已升级为逐用户后台任务。"
        });
    }

    const expectedSecret = String(process.env.PUSH_SECRET || "");
    if (!expectedSecret) {
        return res.status(503).json({
            pushed: false,
            reason: "push_secret_not_configured"
        });
    }

    const providedSecret = String(req.headers["x-push-secret"] || "");
    if (providedSecret !== expectedSecret) {
        return res.status(401).json({
            pushed: false,
            reason: "unauthorized"
        });
    }

    try {
        await processDueMoments();
        const result = await generateShadowPush();
        res.json({
            ...result,
            maintenance: {
                due_moments_checked: true,
                due_comments_checked: true
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/push/messages", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const sinceText = cleanText(req.query.since, 64);
        const since = new Date(sinceText);
        if (!sinceText || Number.isNaN(since.getTime())) {
            return res.status(400).json({
                message: "请提供正确的主动消息查询时间。"
            });
        }

        const limit = Math.round(toNumber(req.query.limit, 50, 1, 100));
        const { data, error } = await database
            .from("messages")
            .select("id, conversation_id, role, content, created_at, tool_calls")
            .eq("role", "assistant")
            .eq("visible", true)
            .contains("tool_calls", { is_push: true })
            .gte("created_at", since.toISOString())
            .order("created_at", { ascending: true })
            .limit(limit);

        if (error) {
            throw error;
        }

        res.json({
            messages: (data || []).map((message) => ({
                id: message.id,
                conversation_id: message.conversation_id,
                role: message.role,
                content: message.content,
                created_at: message.created_at,
                is_push: true
            }))
        });
    } catch (error) {
        next(error);
    }
});

app.get("/database-test", async (req, res, next) => {
    try {
        const settings = await getSettings(req.scope?.db || supabase);
        res.json({
            connected: true,
            message: "Supabase 数据库连接成功",
            settings: {
                ai_name: settings.ai_name,
                provider: settings.provider,
                model: settings.model
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get("/sessions", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("conversations")
            .select("id, title, model_id, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ sessions: data ?? [] });
    } catch (error) {
        next(error);
    }
});

app.post("/sessions", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const title = cleanText(req.body.title, 60) || "新对话";
        const settings = await getSettings(database);
        const modelId = await resolveTurnModel(
            settings,
            cleanText(req.body.model_id || req.body.model, 160) ||
                settings.model
        );
        const { data, error } = await database
            .from("conversations")
            .insert({ title, model_id: modelId || null })
            .select("id, title, model_id, created_at, updated_at")
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.patch("/sessions/:id", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const hasTitle = Object.prototype.hasOwnProperty.call(
            req.body || {},
            "title"
        );
        const hasModel =
            Object.prototype.hasOwnProperty.call(req.body || {}, "model_id") ||
            Object.prototype.hasOwnProperty.call(req.body || {}, "model");
        if (!hasTitle && !hasModel) {
            return res.status(400).json({ message: "没有需要保存的会话设置。" });
        }

        const updates = {};
        if (hasTitle) {
            const title = cleanText(req.body.title, 60);
            if (!title) {
                return res.status(400).json({ message: "会话名称不能为空。" });
            }
            updates.title = title;
            updates.updated_at = new Date().toISOString();
        }
        if (hasModel) {
            const settings = await getSettings(database);
            updates.model_id = await resolveTurnModel(
                settings,
                cleanText(req.body.model_id || req.body.model, 160)
            );
        }
        const { data, error } = await database
            .from("conversations")
            .update(updates)
            .eq("id", req.params.id)
            .select("id, title, model_id, created_at, updated_at")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({ message: "找不到这个会话。" });
        }

        res.json({ session: data });
    } catch (error) {
        next(error);
    }
});

app.delete("/sessions/:id", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data: attachmentMessages, error: attachmentQueryError } =
            await database
                .from("messages")
                .select("tool_calls")
                .eq("conversation_id", req.params.id);
        if (attachmentQueryError) throw attachmentQueryError;
        const attachmentPaths = storedAttachmentPathsForConversation(
            attachmentMessages,
            req.params.id
        );

        const { error } = await database
            .from("conversations")
            .delete()
            .eq("id", req.params.id);

        if (error) {
            throw error;
        }
        if (attachmentPaths.length > 0) {
            await removeStoredAttachments(
                supabase,
                attachmentPaths.map((storage_path) => ({ storage_path }))
            );
        }

        res.status(204).send();
    } catch (error) {
        next(error);
    }
});

app.get("/sessions/:id/messages", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "会话编号格式不正确。" });
        }

        const { data, error } = await database
            .from("messages")
            .select(
                "id, role, content, created_at, tool_calls, " +
                    "reply_to_message_id, reply_snapshot"
            )
            .eq("conversation_id", req.params.id)
            .eq("visible", true)
            .order("created_at", { ascending: true });

        if (error) {
            throw error;
        }

        // 断点续看：如果这一轮只写进了 stream_partials、正式消息还没落库
        // （生成中被刷新/断线），把已生成的部分单独返回，客户端可以接着显示。
        // 放在独立字段里而不是塞进 messages，避免影响既有的消息数组语义。
        const streamingPartial = await readStreamPartial({
            database,
            conversationId: req.params.id
        });

        res.json({
            messages: (data ?? []).map(publicMessage),
            ...(streamingPartial ? { streaming_partial: streamingPartial } : {})
        });
    } catch (error) {
        next(error);
    }
});

app.get("/attachments/:messageId/:attachmentId", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        if (
            !isSafeMessageId(req.params.messageId) ||
            !isUuid(req.params.attachmentId)
        ) {
            return res.status(400).json({ message: "附件编号格式不正确。" });
        }
        const { data: message, error } = await database
            .from("messages")
            .select("id, tool_calls")
            .eq("id", req.params.messageId)
            .maybeSingle();
        if (error) throw error;
        const attachment = findStoredAttachment(
            message?.tool_calls,
            req.params.attachmentId
        );
        if (!attachment) {
            return res.status(404).json({ message: "找不到这个附件。" });
        }

        const { data: blob, error: downloadError } = await supabase.storage
            .from("chat-attachments")
            .download(attachment.storage_path);
        if (downloadError) throw downloadError;
        const buffer = Buffer.from(await blob.arrayBuffer());
        const filename = cleanText(attachment.name, 180) || "attachment";
        const disposition = ["image", "text"].includes(attachment.kind)
            ? "inline"
            : "attachment";
        res.set({
            "Content-Type": attachment.mime_type || "application/octet-stream",
            "Content-Length": String(buffer.length),
            "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(
                filename
            )}`,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff"
        });
        res.send(buffer);
    } catch (error) {
        next(error);
    }
});

app.get("/settings", async (req, res, next) => {
    try {
        const settings = await getSettings(req.scope?.db || supabase);
        res.json({ settings: publicRuntimeSettings(settings) });
    } catch (error) {
        next(error);
    }
});

app.put("/settings", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        await updateStoredSettings(
            database,
            stripLegacyProviderFields(req.body || {})
        );

        res.json({
            settings: publicRuntimeSettings(await getSettings(database))
        });
    } catch (error) {
        next(error);
    }
});

app.get("/memories", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("memories")
            .select("id, summary, created_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            throw error;
        }

        res.json({ memories: data ?? [] });
    } catch (error) {
        next(error);
    }
});

// kiwi-mem 记忆网关健康状态（需登录）：可达性 + embedding 可用性 + 覆盖率
app.get("/api/v2/memory/health", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        const health = await checkKiwiMemoryHealth({
            userId: scope.userId,
            companionId: scope.companionId
        });
        res.json(health);
    } catch (error) {
        next(error);
    }
});

// 按用户查 agents.md 注入状态（需登录）：实时组装该用户个性化+记忆原文并返回预览
app.get(
    "/api/v2/agents-md/status",
    createAgentsMdStatusHandler({
        getSettings,
        databaseFallback: supabase
    })
);

app.get("/diary", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const { data, error } = await database
            .from("companion_diary_entries")
            .select(
                "id, title, content, mood, happened_on, source_message_ids, source_window_start, source_window_end, created_at"
            )
            .order("created_at", { ascending: false })
            .limit(40);
        if (error) {
            if (isMissingRelationError(error)) {
                diaryStatus(
                    "migration_required",
                    "日记数据表尚未创建，需要执行数据库迁移。"
                );
                return res.json({
                    available: false,
                    entries: [],
                    generation: diaryGenerationStatus
                });
            }
            throw error;
        }

        if (!req.scope) void maybeGenerateDiaryEntry();
        res.json({
            available: true,
            entries: (data || []).map(toPublicDiaryEntry),
            generation: diaryGenerationStatus
        });
    } catch (error) {
        next(error);
    }
});

app.use("/moments", (req, res, next) => {
    if (!req.scope) {
        next();
        return;
    }
    res.status(410).json({
        code: "legacy_route_retired",
        message: "动态接口已升级，请刷新 App 后重试。"
    });
});

app.get("/moments", async (req, res, next) => {
    try {
        await processDueMoments();

        const { data: moments, error } = await supabase
            .from("moments")
            .select(PUBLIC_MOMENT_FIELDS)
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) {
            if (isMissingRelationError(error)) {
                return res.json({
                    available: false,
                    entries: [],
                    message: "朋友圈数据库还没有升级。"
                });
            }
            throw error;
        }

        const ids = (moments || []).map((item) => item.id);
        let comments = [];

        if (ids.length > 0) {
            const result = await supabase
                .from("moment_comments")
                .select(PUBLIC_MOMENT_COMMENT_FIELDS)
                .in("moment_id", ids)
                .order("created_at", { ascending: true });

            if (result.error) {
                throw result.error;
            }
            comments = result.data || [];
        }

        const entries = (moments || []).map((moment) => ({
            ...toPublicMoment(moment),
            comments: comments
                .filter((comment) => comment.moment_id === moment.id)
                .map(toPublicMomentComment)
        }));

        res.json({ available: true, entries });
    } catch (error) {
        next(error);
    }
});

app.post("/moments", async (req, res, next) => {
    let uploadedPaths = [];

    try {
        const content = cleanText(req.body.content, 2000);
        const incomingImages = normalizeMomentImages(req.body.images);
        if (!content && incomingImages.length === 0) {
            return res.status(400).json({ message: "动态文字和图片不能同时为空。" });
        }

        const uploadResult = await uploadMomentImages(incomingImages);
        uploadedPaths = uploadResult.paths;
        const sessionId = isUuid(req.body.session_id) ? req.body.session_id : null;
        const delaySeconds = randomDelaySeconds(45, 120);
        const replyDueAt = new Date(
            Date.now() + delaySeconds * 1000
        ).toISOString();

        const { data, error } = await supabase
            .from("moments")
            .insert({
                author: "user",
                content,
                context_note: sessionId ? `active_session_id:${sessionId}` : null,
                images: uploadResult.urls,
                reply_due_at: replyDueAt,
                reply_status: "pending"
            })
            .select(PUBLIC_MOMENT_FIELDS)
            .single();

        if (error) {
            if (uploadedPaths.length > 0) {
                await supabase.storage.from("moments").remove(uploadedPaths);
                uploadedPaths = [];
            }
            if (isMissingRelationError(error)) {
                return res.status(503).json({ message: "朋友圈数据库还没有升级。" });
            }
            throw error;
        }

        res.status(201).json({
            moment: { ...toPublicMoment(data), comments: [] }
        });
    } catch (error) {
        if (uploadedPaths.length > 0) {
            await supabase.storage.from("moments").remove(uploadedPaths);
        }
        next(error);
    }
});

app.post("/moments/:id/like", async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "动态编号格式不正确。" });
        }

        await requireAssistantMoment(req.params.id, "点赞");

        const { data, error } = await supabase
            .from("moments")
            .update({ user_liked: req.body.liked === true })
            .eq("id", req.params.id)
            .select(PUBLIC_MOMENT_FIELDS)
            .single();

        if (error) {
            throw error;
        }

        res.json({ moment: toPublicMoment(data) });
    } catch (error) {
        next(error);
    }
});

app.post("/moments/:id/comments", async (req, res, next) => {
    try {
        if (!isUuid(req.params.id)) {
            return res.status(400).json({ message: "动态编号格式不正确。" });
        }

        const content = cleanText(req.body.content, 1000);
        if (!content) {
            return res.status(400).json({ message: "评论内容不能为空。" });
        }

        await requireAssistantMoment(req.params.id, "评论");

        const delaySeconds = randomDelaySeconds(30, 90);
        const replyDueAt = new Date(
            Date.now() + delaySeconds * 1000
        ).toISOString();

        const { data, error } = await supabase
            .from("moment_comments")
            .insert({
                moment_id: req.params.id,
                author: "user",
                content,
                reply_due_at: replyDueAt,
                reply_status: "pending"
            })
            .select(PUBLIC_MOMENT_COMMENT_FIELDS)
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({ comment: toPublicMomentComment(data) });
    } catch (error) {
        next(error);
    }
});

app.post("/companion/interact", async (req, res, next) => {
    try {
        const database = req.scope?.db || supabase;
        const result = await runCompanionInteraction({
            body: req.body,
            services: {
                ensureConversation: (conversationId, firstMessage) =>
                    ensureConversation(
                        conversationId,
                        firstMessage,
                        database
                    ),
                getSettings: () => getSettings(database),
                loadChatContext: (conversationId, settings) =>
                    loadChatContext(
                        conversationId,
                        settings,
                        database
                    ),
                loadCompanionInteractionContext: (
                    conversationId,
                    settings
                ) =>
                    loadCompanionInteractionContext(
                        conversationId,
                        settings,
                        database
                    ),
                findCompanionInteractionReply: (
                    conversationId,
                    eventId
                ) =>
                    findCompanionInteractionReply(
                        conversationId,
                        eventId,
                        database
                    ),
                interactionGuard: companionInteractionGuard,
                loadCustomStickers: () => req.scope
                    ? listActiveCustomStickers(req.scope)
                    : Promise.resolve([]),
                resolveTurnModel,
                generateReply,
                saveMessage: (
                    conversationId,
                    role,
                    content,
                    options = {}
                ) =>
                    saveMessage(
                        conversationId,
                        role,
                        content,
                        { ...options, database }
                    ),
                touchConversation: (conversationId) =>
                    touchConversation(conversationId, database)
            }
        });
        res.json({
            ...result,
            assistant_message: publicAssistantMessage(
                result.assistant_message,
                result.conversation_id || result.session_id
            )
        });
    } catch (error) {
        if (error.retryAfterMs) {
            res.set(
                "Retry-After",
                String(Math.max(1, Math.ceil(error.retryAfterMs / 1000)))
            );
        }
        next(error);
    }
});

app.post("/companion/inner-monologue", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    // 心声功能：默认启用（设置 VISIBLE_INNER_MONOLOGUE_ENABLED=false 可关闭）
    if (process.env.VISIBLE_INNER_MONOLOGUE_ENABLED === "false") {
        return res.status(503).json({ message: "心声功能已暂时停用，排查完成后恢复。" });
    }
    try {
        const database = req.scope?.db || supabase;
        const result = await runVisibleInnerMonologue({
            body: req.body,
            tenant: req.scope
                ? { userId: req.scope.userId, companionId: req.scope.companionId }
                : null,
            services: {
                loadMessage: async (conversationId, messageId) => {
                    const { data, error } = await database
                        .from("messages")
                        .select("id, conversation_id, role, content, visible, created_at, tool_calls")
                        .eq("id", messageId)
                        .eq("conversation_id", conversationId)
                        .maybeSingle();
                    if (error) throw error;
                    return data || null;
                },
                getSettings: () => getSettings(database),
                loadChatContext: async (conversationId, settings, targetMessage) => {
                    const context = await loadChatContext(conversationId, settings, database);
                    const time = String(targetMessage.created_at || "");
                    if (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(time) ||
                        !Number.isFinite(Date.parse(time))) {
                        throw Object.assign(new Error("心声目标消息的时间信息无效。"), { status: 502 });
                    }
                    let query = database.from("messages")
                        .select("id, role, content, created_at, tool_calls")
                        .eq("conversation_id", conversationId)
                        .eq("visible", true)
                        .eq("context_visible", true)
                        .or(`created_at.lt.${time},and(created_at.eq.${time},id.lte.${targetMessage.id})`);
                    if (settings.context_reset_at) query = query.gte("created_at", settings.context_reset_at);
                    const { data, error } = await query
                        .order("created_at", { ascending: false })
                        .order("id", { ascending: false })
                        .limit(12);
                    if (error) throw error;
                    return { ...context, messages: (data || []).reverse() };
                },
                resolveTurnModel,
                generateReply
            }
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
});

app.post(
    "/voice/warmup",
    async (req, res) => {
        const result = hervoiceWarmup.start({
            baseUrl: process.env.HERVOICE_URL
        });
        res.status(202).json({
            ok: true,
            started: result.started,
            reason: result.reason
        });
    }
);

app.post(
    "/voice/turn",
    limitVoiceTurnsPerIp,
    voiceUpload.single("file"),
    async (req, res, next) => {
        res.set("Cache-Control", "no-store");

        try {
            const database = req.scope?.db || supabase;
            if (!req.file || !Buffer.isBuffer(req.file.buffer)) {
                return res.status(400).json({ message: "请先录制一段语音。" });
            }

            const fields = parseVoiceTurnFields(req.body);
            let conversationId = null;
            if (fields.sessionId) {
                conversationId = await ensureConversation(
                    fields.sessionId,
                    "",
                    database
                );
            }

            const settings = await getSettings(database);
            const conversation = conversationId
                ? await loadConversation(conversationId, database)
                : null;
            const effectiveModel = await resolveConversationTurnModel(
                settings,
                conversation,
                fields.requestedModel,
                database
            );
            const voiceAnalysis = await analyzeVoiceWithHervoice({
                file: req.file,
                baseUrl: process.env.HERVOICE_URL,
                secret: process.env.HERVOICE_SECRET,
                timeoutMs: process.env.HERVOICE_TIMEOUT_MS
            });
            if (!conversationId) {
                conversationId = await ensureConversation(
                    "",
                    voiceAnalysis.text,
                    database,
                    effectiveModel
                );
            }

            const effectiveSettings = {
                ...settings,
                model: effectiveModel,
                emotion_understanding_enabled:
                    fields.emotionUnderstandingEnabled
            };
            const initialCompanionStatus = sanitizeCompanionStatusSnapshot(
                isContextTimestampCurrent(
                    fields.companionStatus?.updatedAt,
                    settings
                )
                    ? fields.companionStatus
                    : {},
                new Date(),
                { userDisplayName: req.scope?.profile?.display_name || "" }
            );
            const savedUserMessage = await saveMessage(
                conversationId,
                "user",
                voiceAnalysis.text,
                {
                    tool_calls: {
                        ...buildVoiceMessageMetadata(voiceAnalysis),
                        requested_model: fields.requestedModel || null,
                        resolved_model: effectiveModel || ""
                    },
                    database
                }
            );
            const context = await loadChatContext(
                conversationId,
                settings,
                database
            );
            const listeningRuntimeContext =
                await safeLoadListeningRuntimeContext(database);
            const worldBookContext = await resolveWorldBookContext({
                database,
                settings: effectiveSettings,
                messages: context.messages
            });
            const mcpRuntime = await mcpDeviceCenter
                .forDatabase(database)
                .createRuntime()
                .catch((error) => {
                    console.error(
                        "语音轮次 MCP 设备运行时加载失败：",
                        error?.code || error?.message || "unknown"
                    );
                    return {
                        tools: [],
                        actions: [],
                        runtimeContext: "",
                        hasTool: () => false,
                        execute: async () => ({
                            ok: false,
                            error: "设备中心暂时不可用。"
                        })
                    };
                });
            const customStickers = req.scope
                ? await listActiveCustomStickers(req.scope).catch(() => [])
                : [];
            const chatTools = createChatToolExecutor(
                conversationId,
                initialCompanionStatus,
                "",
                mcpRuntime,
                database,
                req.scope?.profile?.display_name || "",
                customStickers,
                req.scope || null,
                createTakeoutChannel({ database }),
                createSpecialDatesService({ database }),
                {
                    dailies: createDailyShotsService({ database }),
                    achievements: createAchievementsService({ database }),
                    funLabs: createFunLabsService({ database })
                },
                "",
                createXhsClient(),
                neteaseQrLogin,
                createWebExplorer(),
                interestEngine
            );
            let specialDatesContext = "";
            if (req.scope) {
                try {
                    const specialDates = createSpecialDatesService({ database });
                    specialDatesContext = specialDates.buildContext(
                        await specialDates.upcoming(req.scope, 7)
                    );
                } catch (error) {
                    console.error("特殊日子日历加载失败：", error?.code || error?.message || "unknown");
                }
            }
            const runtimeContext = [
                runtimeContextFromValues(
                    {
                        environmentContext: fields.environmentContext
                    },
                    initialCompanionStatus,
                    req.scope?.profile?.display_name || ""
                ),
                buildVoiceRuntimeContext(
                    voiceAnalysis,
                    fields.emotionUnderstandingEnabled
                ),
                buildNurseryRuntimeContext(
                    context.nursery,
                    voiceAnalysis.text
                ),
                listeningRuntimeContext,
                specialDatesContext,
                mcpRuntime.runtimeContext
            ]
                .filter(Boolean)
                .join("\n\n");
            const generated = await generateReply({
                settings: effectiveSettings,
                messages: context.messages,
                memories: context.memories,
                runtimeContext,
                turnContext: fields.turnContext,
                promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
                worldBookContext,
                tools: [
                    UPDATE_COMPANION_STATUS_TOOL,
                    POST_MOMENT_TOOL,
                    SPECIAL_DATE_ADD_TOOL,
                    SPECIAL_DATE_LIST_TOOL,
                    SPECIAL_DATE_REMOVE_TOOL,
                    DAILY_SHOT_ADD_TOOL,
                    ACHIEVEMENTS_LIST_TOOL,
                    ACHIEVEMENT_DEFINE_TOOL,
                    ACHIEVEMENT_UNLOCK_TOOL,
                    DANMAKU_READ_TOOL,
                    COMPATIBILITY_RECORD_TOOL,
                    XHS_ME_TOOL,
                    XHS_SEARCH_TOOL,
                    XHS_LIKE_TOOL,
                    XHS_COMMENT_TOOL,
                    XHS_FOLLOW_TOOL,
                    WEB_READ_TOOL,
                    RSS_READ_TOOL,
                    V2EX_HOT_TOOL,
                    V2EX_TOPIC_TOOL,
                    V2EX_NODE_TOOL,
                    BILI_SEARCH_TOOL,
                    BILI_VIDEO_TOOL,
                    EXA_SEARCH_TOOL,
                    WEB_SEARCH_TOOL,
                    BILI_RECOMMEND_TOOL,
                    INTERESTS_VIEW_TOOL,
                    CLOUD_MUSIC_SEARCH_TOOL,
                    CLOUD_MUSIC_DAILY_TOOL,
                    CLOUD_MUSIC_PLAYLIST_DETAIL_TOOL,
                    CLOUD_MUSIC_CREATE_PLAYLIST_TOOL,
                    CLOUD_MUSIC_ADD_TO_PLAYLIST_TOOL,
                    CLOUD_MUSIC_ALBUM_INFO_TOOL,
                    CLOUD_MUSIC_ARTIST_INFO_TOOL,
                    CLOUD_MUSIC_SUBSCRIPTIONS_TOOL,
                    CLOUD_MUSIC_LIKE_TOOL,
                    CLOUD_MUSIC_HISTORY_TOOL,
                    CLOUD_MUSIC_MY_PLAYLISTS_TOOL,
                    CLOUD_MUSIC_REMOVE_FROM_PLAYLIST_TOOL,
                    NETEASE_PLAY_SONG_TOOL,
                    chatTools.getStickerTool(),
                    SELECT_REPLY_SUGGESTIONS_TOOL,
                    COMPANION_ACTIVITY_TOOL,
                    ...mcpRuntime.tools
                ],
                executeTool: chatTools.executeTool
            });
            const finalizedReplySuggestions = finalizeReplySuggestions({
                recentMessages: context.messages,
                assistantText: generated.text,
                candidate: chatTools.getReplySuggestions(),
                previousSuggestions: previousReplySuggestionsFromMessages(
                    context.messages
                )
            });
            const savedAssistantMessage = await saveMessage(
                conversationId,
                "assistant",
                generated.text,
                {
                    tool_calls: {
                        ...companionStickerToolCalls(chatTools),
                        ...replySuggestionToolCalls(finalizedReplySuggestions),
                        ...(chatTools.getActivityActions().length ? { activity_actions: chatTools.getActivityActions() } : {}),
                        ...(mcpRuntime.actions.length
                            ? { mcp_actions: mcpRuntime.actions }
                            : {})
                    },
                    database
                }
            );

            await touchConversation(conversationId, database);
            await tryScheduleProactiveMessageEvaluation({
                database,
                settings,
                sourceMessageId: savedAssistantMessage.id
            });
            await tryScheduleAutonomousContentEvaluations({
                database,
                sourceMessageId: savedAssistantMessage.id
            });
            const memoryCompression = await tryCompressMemory(
                conversationId,
                settings,
                database
            );

            res.json({
                reply: generated.text,
                session_id: conversationId,
                conversation_id: conversationId,
                user_message: publicMessage(savedUserMessage),
                assistant_message: publicAssistantMessage(
                    savedAssistantMessage,
                    conversationId
                ),
                model: effectiveModel || "",
                provider: settings.provider,
                response_mode: generated.mode,
                voice_analysis: voiceAnalysis,
                prompt_receipt: generated.prompt_receipt || null,
                memory_compression: memoryCompression,
                companion_status: chatTools.getCompanionStatus()
            });
        } catch (error) {
            next(error);
        }
    }
);

app.post("/voice/speech", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
        const database = req.scope?.db || supabase;
        const messageId = cleanText(req.body?.message_id, 80);
        const conversationId = cleanText(
            req.body?.session_id || req.body?.conversation_id,
            80
        );
        const speechToken = cleanText(req.body?.speech_token, 160);
        if (
            !isSafeSpeechMessageId(messageId) ||
            !isSafeConversationId(conversationId) ||
            !verifySpeechAccessToken(
                messageId,
                conversationId,
                speechToken,
                process.env
            )
        ) {
            return res.status(404).json({
                message: "找不到这条可朗读的 AI 回复。"
            });
        }

        const { data: message, error } = await database
            .from("messages")
            .select("id, role, content, tool_calls")
            .eq("id", messageId)
            .eq("conversation_id", conversationId)
            .eq("role", "assistant")
            .eq("visible", true)
            .maybeSingle();
        if (error) throw error;
        if (!message) {
            return res.status(404).json({ message: "找不到这条可朗读的 AI 回复。" });
        }

        const limit = expressiveSpeechRateLimitState.consume(req.ip);
        if (!limit.allowed) {
            res.set(
                "Retry-After",
                String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000)))
            );
            return res.status(429).json({
                message: "自然语音请求太频繁，请稍等一会儿再试。"
            });
        }

        const providerConfig = req.scope
            ? await createVoiceProviderCenter({
                  database: req.scope.db,
                  env: process.env
              }).resolveRuntimeProfile()
            : null;
        const cacheKey = [
            req.scope?.userId || "legacy",
            req.scope?.companionId || "legacy",
            messageId,
            providerConfig?.provider || "global-minimax",
            providerConfig?.model || "",
            providerConfig?.region || "",
            providerConfig?.speed || "",
            providerConfig?.updatedAt || ""
        ].join(":");
        const { speech, cacheStatus } =
            await expressiveSpeechCache.getOrCreate(
                cacheKey,
                () =>
                    synthesizeExpressiveSpeech({
                        text: message.content,
                        emotionHint:
                            message.tool_calls?.speech_emotion,
                        providerConfig,
                        env: process.env
                    })
            );
        res.set({
            "Content-Type": speech.contentType,
            "Content-Length": String(speech.audio.length),
            "X-DengTa-Voice-Provider": speech.provider,
            "X-DengTa-Voice-Model": speech.model || "",
            "X-DengTa-Voice-Emotion": speech.emotion,
            "X-DengTa-Voice-Cache": cacheStatus,
            "X-Content-Type-Options": "nosniff"
        });
        res.send(speech.audio);
    } catch (error) {
        next(error);
    }
});

app.post("/chat", acceptChatBody, async (req, res, next) => {
    try {
        res.json(await executeChatTurn(req));
    } catch (error) {
        next(error);
    }
});

app.post("/api/v2/whereabouts/ingest", async (req, res, next) => {
    try {
        const scope = requireRequestScope(req);
        if (!scope?.userId || !scope?.companionId) {
            const error = new Error("行踪上报需要登录态。");
            error.status = 401;
            error.code = "whereabouts_auth_required";
            throw error;
        }
        const result = await whereaboutsIngestPoint({
            database: scope.db,
            userId: scope.userId,
            companionId: scope.companionId,
            point: req.body || {}
        });
        res.json(result);
    } catch (error) {
        next(error);
    }
});
app.post("/chat/stream", acceptChatBody, async (req, res, next) => {
    let streamStarted = false;
    let userMessageCommitted = false;
    try {
        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        streamStarted = true;
        const result = await executeChatTurn(req, {
            onStatus: (event) => {
                if (event?.type === "meta" && event.user_message) {
                    userMessageCommitted = true;
                }
                writeSse(res, event);
            },
            onModelEvent: (event) => {
                if (["text", "reasoning", "monologue"].includes(event?.type)) {
                    writeSse(res, event);
                }
            }
        });
        writeSse(res, streamSuccess(result));
        res.end();
    } catch (error) {
        if (!streamStarted) return next(error);
        console.error("stream_chat_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            provider_code: publicChatErrorMetadata(error).provider_code || null,
            error_source: publicChatErrorMetadata(error).error_source || null,
            provider_phase: publicChatErrorMetadata(error).provider_phase || null,
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            upstream_response_status:
                String(error?.upstreamResponseStatus || "").slice(0, 40) ||
                null,
            upstream_incomplete_reason:
                String(error?.upstreamIncompleteReason || "").slice(0, 80) ||
                null,
            upstream_output_types: Array.isArray(error?.upstreamOutputTypes)
                ? error.upstreamOutputTypes.slice(0, 12)
                : [],
            user_message_committed: userMessageCommitted
        });
        // 流式错误同样落库并带 log_id，聊天页可点开查看完整日志
        const streamLogId = await persistChatErrorLog(req, error);
        res.locals = res.locals || {};
        res.locals.userMessageCommitted = userMessageCommitted;
        res.locals.streamLogId = streamLogId;
        try {
            writeSse(
                res,
                streamFailure(error, {
                    userMessageCommitted,
                    logId: streamLogId
                })
            );
            res.end();
        } catch (sendError) {
            // 连接已损坏时无法发送错误事件，交给错误中间件兜底（同样已落库）。
            next(sendError);
        }
    }
});

async function persistRefusalLog({ userId, companionId, conversationId, message, model, provider }) {
    // 成功响应的拒答也落日志（供聊天页那条记录下的展示），
    // 与请求失败的 chat_error_logs 同一张表、同一错误码。
    //
    // 这里刻意保留拒答原文：之前只写死一句「诊断不保留回复正文」，等于用户
    // 看到一句拒绝却拿不到任何原因。现在原因、原文、模型、供应商、错误码
    // 一起进日志，并把同一份信息返回给调用方挂到消息上。
    const { row, info } = buildRefusalLogRecord({
        userId,
        companionId,
        conversationId,
        text: message,
        model,
        provider
    });
    try {
        const { data, error } = await supabase
            .from("chat_error_logs")
            .insert(row)
            .select("id")
            .single();
        if (error) throw error;
        return { ...info, error_log_id: data?.id || null };
    } catch {
        return { ...info, error_log_id: null };
    }
}

async function persistChatErrorLog(req, error) {
    try {
        const scope = req.scope;
        const candidateId = req.body?.conversation_id || req.body?.session_id;
        const { data } = await supabase.from("chat_error_logs").insert({
            user_id: scope?.userId || null,
            companion_id: scope?.companionId || null,
            conversation_id: isUuid(candidateId) ? candidateId : null,
            ...diagnosticRecord(req, error)
        }).select("id").single();
        return data?.id || null;
    } catch { return null; }
}

app.use(async (error, req, res, next) => {
    const errorLogId = await persistChatErrorLog(req, error);
    const isChatRequest = ["/chat", "/chat/stream"].includes(req.path);
    if (isChatRequest) {
        console.error("chat_request_failed", {
            name: error?.name || "Error",
            code: publicChatErrorCode(error),
            provider_code: publicChatErrorMetadata(error).provider_code || null,
            error_source: publicChatErrorMetadata(error).error_source || null,
            status: Number(error?.status) || 500,
            upstream_status: Number(error?.upstreamStatus) || null,
            method: req.method,
            path: req.path
        });
    } else {
        console.error("request_failed", diagnosticRecord(req, error));
    }

    if (res.headersSent) {
        // /chat/stream 已开始 SSE 但发生未捕获错误：必须把错误以 SSE 事件发给前端，
        // 否则客户端只会看到"连接提前结束"且拿不到日志 id。
        if (req.path === "/chat/stream" && res.writableEnded === false) {
            try {
                const committed = res.locals?.userMessageCommitted === true;
                writeSse(
                    res,
                    streamFailure(error, {
                        userMessageCommitted: committed,
                        logId: res.locals?.streamLogId || errorLogId || null
                    })
                );
                res.end();
                return;
            } catch {
                // 响应已损坏，无法再发送任何内容。
            }
        }
        return next(error);
    }

    if (error instanceof multer.MulterError) {
        const voiceRequest = req.path === "/voice/turn";
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
                message: voiceRequest
                    ? "语音文件不能超过 12MB。"
                    : "单个附件不能超过 12MB。"
            });
        }
        if (["LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(error.code)) {
            return res.status(413).json({
                message: voiceRequest
                    ? "一次只能发送一个语音文件。"
                    : "一次最多发送 4 个附件。"
            });
        }
        return res.status(400).json({
            message: voiceRequest
                ? "语音上传格式不正确，请重新录制后再试。"
                : "附件上传格式不正确，请重新选择后再试。"
        });
    }

    const status = Number(error.status) || 500;
    const isDistillRequest = req.path.replace(/\/+$/, "") === "/api/v2/style-distill";
    const clientErrorCode =
        status >= 400 &&
        (status < 500 || (isDistillRequest && /^style_distill_[a-z_]+$/.test(error.code || ""))) &&
        typeof error.code === "string" &&
        /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
            ? error.code
            : null;
    const publicErrorCode =
        publicChatErrorCode(error) || clientErrorCode || (safeDiagnosticCode(error.code) !== "request_failed" ? safeDiagnosticCode(error.code) : null) || (isChatRequest ? "request_failed" : null);
    const isModelRequest = isChatRequest || isDistillRequest;
    const chatErrorMetadata = isModelRequest
        ? publicChatErrorMetadata(error)
        : {};
    res.status(error.status || 500).json({
        message: isModelRequest
            ? publicChatErrorMessage(error, "服务器处理请求失败，请稍后重试。")
            : error.status
              ? error.message
              : "服务器处理请求失败。",
        detail:
            process.env.NODE_ENV === "production" || isModelRequest
                ? undefined
                : error.message,
        ...(publicErrorCode ? { code: publicErrorCode } : {}),
        ...(errorLogId ? { error_log_id: errorLogId } : {}),
        ...chatErrorMetadata,
        ...(error.errorSource === "external_memory_gateway" ? {error_source:"external_memory_gateway",upstream_status:Number.isInteger(error.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599 ? error.upstreamStatus : undefined} : {})
    });
});

let momentMaintenanceTimer = null;
let diaryMaintenanceTimer = null;
if (!authRequired) {
    momentMaintenanceTimer = setInterval(() => {
        void processDueMoments();
    }, 20 * 1000);
    momentMaintenanceTimer.unref?.();

    diaryMaintenanceTimer = setInterval(() => {
        void maybeGenerateDiaryEntry();
    }, 60 * 1000);
    diaryMaintenanceTimer.unref?.();
}

app.listen(port, () => {
    if (!authRequired) {
        void processDueMoments();
        void maybeGenerateDiaryEntry();
    }
    console.log(`服务器运行在 http://localhost:${port}`);
    // Startup has no tenant scope; do not probe the shared public memory library.
    void (async () => {
        const health = await checkKiwiMemoryHealth().catch(() => null);
        if (!health) {
            console.warn("[KIWI-MEM] 健康检查失败：记忆网关无响应。");
            return;
        }
        if (!health.configured) {
            console.warn("[KIWI-MEM] 未配置：设置 KIWI_MEM_URL 启用记忆网关。");
            return;
        }
        if (health.error === "kiwi_mem_tenant_required") {
            console.log("[KIWI-MEM] 已配置，等待登录后的账号与伴侣范围检查；尚未验证连接。");
            return;
        }
        if (!health.reachable) {
            console.warn("[KIWI-MEM] 不可达：", health.message);
            return;
        }
        if (health.embedding_available !== true) {
            console.warn(
                `[KIWI-MEM] ⚠️ embedding 不可用（source=${health.embedding_source}，model=${health.embedding_model || "(未配置)"}，覆盖率 ${health.coverage}）。语义检索已降级为关键词；请在 kiwi 控制面板配置可用的嵌入模型。`
            );
            return;
        }
        console.log(
            `[KIWI-MEM] 正常：${health.total_memories} 条记忆，embedding 覆盖率 ${health.coverage}（${health.embedding_model} @ ${health.embedding_source}）。`
        );
    })();
});

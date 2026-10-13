const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createAiProviderCenter,
    isExpired,
    normalizeBaseUrl,
    providerErrorDiagnostic,
    providerProbeError,
    protocolProvider,
    publicProviderError,
    publicProfile,
    publicRuntimeSettings,
    safeStoredProviderError,
    runtimeSettings
} = require("../services/ai-provider-center");
const {
    buildOpenAiResponsesInput,
    buildPromptReceipt,
    ensureOpenAiResponsesEndpoint,
    openAiResponsesText
} = require("../services/ai-service");
const {
    decryptCredential,
    encryptCredential
} = require("../services/mcp-device-center");
const {
    normalizeReasoningEffort,
    reasoningEffortField,
    reasoningProtocolForProvider
} = require("../services/provider-reasoning-effort");
const {
    DEFAULT_SETTINGS,
    buildSettingsChanges,
    stripLegacyProviderFields
} = require("../services/settings-store");

const env = {
    MCP_ENCRYPTION_KEY: "a-very-long-provider-encryption-secret-value"
};

assert.deepEqual(
    stripLegacyProviderFields(
        {
            provider: "custom",
            api_url: "https://legacy.example/v1",
            model: "legacy-model",
            reasoning_effort: "none",
            ai_name: "保留"
        },
        { provider_profile_id: "profile-1" }
    ),
    { ai_name: "保留" },
    "an active provider profile must ignore legacy single-interface fields"
);
assert.deepEqual(
    stripLegacyProviderFields(
        { provider: "custom", api_url: "https://legacy.example/v1" },
        { provider: "custom" }
    ),
    {},
    "legacy provider fields must be ignored even when no profile is configured"
);

const encrypted = encryptCredential("gateway-key-value", env);
assert.notEqual(encrypted, "gateway-key-value");
assert.equal(decryptCredential(encrypted, env), "gateway-key-value");

const publicValue = publicProfile({
    id: "provider-1",
    name: "Main gateway",
    slug: "main-gateway",
    protocol: "openai-responses",
    base_url: "https://gateway.example.com/v1",
    auth_type: "bearer",
    secret_ciphertext: encrypted,
    default_model: "gpt-test",
    reasoning_effort: "xhigh",
    enabled: true,
    is_default: true,
    priority: 10,
    billing_url: "https://gateway.example.com/billing",
    notes: "monthly",
    discovered_models: ["gpt-test"],
    last_status: "connected"
});
assert.equal(publicValue.auth_configured, true);
assert.equal(publicValue.reasoning_effort, "xhigh");
assert.equal(JSON.stringify(publicValue).includes("gateway-key-value"), false);
assert.equal(JSON.stringify(publicValue).includes("secret_ciphertext"), false);
assert.equal(publicValue.health.state, "catalog_ok");
assert.equal(publicValue.health.summary, "模型目录可读取");
assert.match(publicValue.health.detail, /不代表聊天生成请求一定成功/);
assert.equal(protocolProvider("openai-responses"), "openai-responses");
assert.equal(isExpired({ expires_at: "2020-01-01T00:00:00.000Z" }), true);
assert.equal(isExpired({ expires_at: "2099-01-01T00:00:00.000Z" }), false);
assert.equal(
    normalizeReasoningEffort("XHIGH", "openai-responses", { strict: true }),
    "xhigh"
);
assert.equal(
    reasoningEffortField("openai-responses", "xhigh"),
    "reasoning.effort"
);
assert.equal(
    reasoningEffortField("openai-chat", "none"),
    "reasoning_effort"
);
assert.equal(reasoningProtocolForProvider("custom"), "openai-chat");
assert.equal(
    reasoningProtocolForProvider("openai-compatible"),
    "openai-chat"
);
assert.throws(
    () => normalizeReasoningEffort("xhigh", "openai-chat", { strict: true }),
    (error) =>
        error.code ===
        "AI_PROVIDER_REASONING_EFFORT_CHAT_TOOLS_UNSUPPORTED"
);
assert.throws(
    () => normalizeReasoningEffort("high", "anthropic", { strict: true }),
    (error) =>
        error.code === "AI_PROVIDER_REASONING_EFFORT_PROTOCOL_UNSUPPORTED"
);

const legacyResponsesSettings = buildSettingsChanges(
    {
        ...DEFAULT_SETTINGS,
        provider: "openai-responses"
    },
    { reasoning_effort: "XHIGH" },
    { NODE_ENV: "test" }
);
assert.equal(legacyResponsesSettings.reasoning_effort, "");
assert.equal(
    buildSettingsChanges(
        { ...DEFAULT_SETTINGS, provider: "openai-compatible" },
        { reasoning_effort: "xhigh" },
        { NODE_ENV: "test" }
    ).reasoning_effort,
    ""
);
const legacyChatSettings = buildSettingsChanges(
    {
        ...DEFAULT_SETTINGS,
        provider: "openai-responses",
        reasoning_effort: "xhigh"
    },
    { provider: "openai-compatible" },
    { NODE_ENV: "test" }
);
assert.equal(legacyChatSettings.reasoning_effort, "xhigh");

const rawSensitiveMarker = "raw-sensitive-marker-123";
const sanitizedProbeError = providerProbeError(
    Object.assign(new Error(rawSensitiveMarker), { upstreamStatus: 429 })
);
assert.equal(sanitizedProbeError.code, "AI_PROVIDER_UPSTREAM_RATE_LIMITED");
assert.equal(sanitizedProbeError.upstream_status, 429);
assert.equal(sanitizedProbeError.message.includes(rawSensitiveMarker), false);
assert.equal(
    providerErrorDiagnostic(sanitizedProbeError).includes(rawSensitiveMarker),
    false
);
const parsedHttpProbeError = providerProbeError(
    new Error(`model list HTTP 503 ${rawSensitiveMarker}`)
);
assert.equal(parsedHttpProbeError.code, "AI_PROVIDER_UPSTREAM_UNAVAILABLE");
assert.equal(parsedHttpProbeError.upstream_status, 503);
assert.equal(parsedHttpProbeError.message.includes(rawSensitiveMarker), false);
assert.equal(
    safeStoredProviderError(rawSensitiveMarker).includes(rawSensitiveMarker),
    false
);
const unknownPublicError = publicProviderError(new Error(rawSensitiveMarker));
assert.equal(unknownPublicError.status, 500);
assert.equal(unknownPublicError.code, "AI_PROVIDER_CENTER_ERROR");
assert.equal(unknownPublicError.message.includes(rawSensitiveMarker), false);
const legacyErrorProfile = publicProfile({
    ...publicValue,
    id: "provider-legacy",
    last_status: "error",
    last_error: rawSensitiveMarker
});
assert.equal(
    JSON.stringify(legacyErrorProfile).includes(rawSensitiveMarker),
    false
);
assert.equal(legacyErrorProfile.health.state, "catalog_error");

const resolved = runtimeSettings(
    {
        id: "provider-1",
        name: "Main gateway",
        protocol: "openai-responses",
        base_url: "https://gateway.example.com/v1",
        default_model: "gpt-test",
        reasoning_effort: "xhigh"
    },
    { system_prompt: "highest priority", model: "legacy" },
    "gateway-key-value"
);
assert.equal(resolved.provider, "openai-responses");
assert.equal(resolved.api_url, "https://gateway.example.com/v1");
assert.equal(resolved.model, "gpt-test");
assert.equal(resolved.reasoning_effort, "xhigh");
assert.equal(resolved.runtime_api_key, "gateway-key-value");
assert.equal(resolved.system_prompt, "highest priority");
const publicResolved = publicRuntimeSettings(resolved);
assert.equal(Object.hasOwn(publicResolved, "runtime_api_key"), false);
assert.equal(JSON.stringify(publicResolved).includes("gateway-key-value"), false);
assert.equal(publicResolved.system_prompt, "highest priority");

assert.equal(
    ensureOpenAiResponsesEndpoint("https://gateway.example.com"),
    "https://gateway.example.com/v1/responses"
);
assert.equal(
    ensureOpenAiResponsesEndpoint("https://gateway.example.com/v1"),
    "https://gateway.example.com/v1/responses"
);
assert.equal(
    ensureOpenAiResponsesEndpoint("https://gateway.example.com/v1/responses"),
    "https://gateway.example.com/v1/responses"
);

const responsesInput = buildOpenAiResponsesInput(
    [{ role: "user", content: "hello" }],
    [{ mimeType: "image/png", data: "ZmFrZQ==" }]
);
assert.equal(responsesInput[0].content[0].type, "input_text");
assert.equal(responsesInput[0].content[1].type, "input_image");
assert.equal(openAiResponsesText({ output_text: "direct" }), "direct");
assert.equal(
    openAiResponsesText({
        output: [{ content: [{ type: "output_text", text: "nested" }] }]
    }),
    "nested"
);

const receipt = buildPromptReceipt(
    {
        provider: "openai-responses",
        model: "gpt-test",
        reasoning_effort: "xhigh",
        system_prompt: "system",
        additional_prompt: "additional",
        personality: "persona"
    },
    {
        provider: "openai-responses",
        systemInstructions: ["system", "additional", "persona"],
        messages: [{ role: "user", content: "hello" }],
        attachments: []
    }
);
assert.equal(receipt.transport, "openai-responses");
assert.equal(receipt.system_message_count, 1);
assert.equal(receipt.request_message_count, 1);
assert.equal(receipt.reasoning_effort_requested, "xhigh");
assert.equal(receipt.reasoning_effort_applied, "xhigh");
assert.equal(receipt.reasoning_effort_field, "reasoning.effort");

(async () => {
    const normalized = await normalizeBaseUrl(
        "https://gateway.example.com/v1/?temporary=1",
        {
            production: true,
            lookup: async () => [{ address: "203.0.113.12", family: 4 }]
        }
    );
    assert.equal(normalized, "https://gateway.example.com/v1");
    await assert.rejects(
        () => normalizeBaseUrl("http://127.0.0.1:8080/v1", { production: true }),
        (error) => /AI_PROVIDER_/.test(error.code)
    );

    const migration = fs.readFileSync(
        path.join(__dirname, "..", "supabase", "008_ai_provider_profiles.sql"),
        "utf8"
    );
    const reasoningMigration = fs.readFileSync(
        path.join(
            __dirname,
            "..",
            "supabase",
            "020_provider_reasoning_effort.sql"
        ),
        "utf8"
    );
    const route = fs.readFileSync(
        path.join(__dirname, "..", "routes", "ai-providers.js"),
        "utf8"
    );
    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(migration, /enable row level security/i);
    assert.match(migration, /service_role/i);
    assert.match(reasoningMigration, /reasoning_effort/i);
    assert.match(reasoningMigration, /public\.settings/i);
    assert.match(reasoningMigration, /settings_reasoning_effort_check/i);
    assert.match(reasoningMigration, /xhigh/);
    assert.match(reasoningMigration, /max/);
    assert.match(route, /requireRequestScope/);
    assert.match(route, /center\.forDatabase\(scope\.db\)/);
    assert.doesNotMatch(route, /assertProviderAdminSecret/);
    assert.match(route, /publicProviderError/);
    assert.doesNotMatch(
        route,
        /error\?\.code\s*\|\|\s*error\?\.message/
    );
    assert.match(route, /\/manage\/:id\/default/);
    assert.match(server, /resolveDefaultSettings/);
    assert.match(server, /ai_provider_center/);

    function probeSupabase(healthError = null) {
        const writes = [];
        const row = {
            id: "provider-probe",
            name: "Probe provider",
            slug: "probe-provider",
            protocol: "openai-chat",
            base_url: "https://gateway.example.com/v1",
            auth_type: "bearer",
            secret_ciphertext: encrypted,
            default_model: "gpt-test",
            enabled: true,
            is_default: true,
            priority: 10,
            billing_url: "",
            expires_at: null,
            notes: "",
            discovered_models: [],
            last_status: "untested",
            last_error: null,
            last_checked_at: null
        };
        return {
            writes,
            client: {
                from() {
                    let operation = "";
                    return {
                        select() {
                            if (!operation) operation = "select";
                            return this;
                        },
                        update(values) {
                            operation = "update";
                            writes.push(values);
                            return this;
                        },
                        eq() {
                            return this;
                        },
                        maybeSingle() {
                            return Promise.resolve({ data: row, error: null });
                        },
                        single() {
                            return Promise.resolve({
                                data: {
                                    ...row,
                                    ...(writes[writes.length - 1] || {})
                                },
                                error: null
                            });
                        },
                        then(resolve, reject) {
                            return Promise.resolve({
                                data: null,
                                error:
                                    operation === "update"
                                        ? healthError
                                        : null
                            }).then(resolve, reject);
                        }
                    };
                }
            }
        };
    }

    const persistedFailure = probeSupabase();
    const persistedFailureCenter = createAiProviderCenter({
        supabase: persistedFailure.client,
        env,
        fetchImpl: async () => {
            throw new Error(rawSensitiveMarker);
        },
        lookup: async () => [{ address: "203.0.113.12", family: 4 }]
    });
    await assert.rejects(
        () => persistedFailureCenter.testProfile("provider-probe"),
        (error) =>
            error.code === "AI_PROVIDER_UPSTREAM_UNAVAILABLE" &&
            !error.message.includes(rawSensitiveMarker)
    );
    assert.equal(persistedFailure.writes.length, 1);
    assert.equal(
        JSON.stringify(persistedFailure.writes[0]).includes(rawSensitiveMarker),
        false
    );
    assert.match(
        persistedFailure.writes[0].last_error,
        /^AI_PROVIDER_UPSTREAM_UNAVAILABLE/
    );

    const successfulProbe = probeSupabase();
    const successfulProbeCenter = createAiProviderCenter({
        supabase: successfulProbe.client,
        env,
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: "gpt-test" }] })
        }),
        lookup: async () => [{ address: "203.0.113.12", family: 4 }]
    });
    const successfulProbeResult = await successfulProbeCenter.testProfile(
        "provider-probe"
    );
    assert.deepEqual(successfulProbeResult.models, ["gpt-test"]);
    assert.equal(successfulProbeResult.profile.last_status, "connected");
    assert.equal(successfulProbeResult.profile.last_error, null);
    assert.equal(successfulProbeResult.profile.health.state, "catalog_ok");
    assert.equal(successfulProbe.writes.length, 1);

    const statusRows = [
        {
            ...successfulProbeResult.profile,
            secret_ciphertext: encrypted,
            id: "provider-routable",
            name: "Routable provider",
            enabled: true,
            is_default: true,
            expires_at: "2099-01-01T00:00:00.000Z"
        },
        {
            ...successfulProbeResult.profile,
            secret_ciphertext: encrypted,
            id: "provider-expired",
            name: "Expired provider",
            enabled: true,
            is_default: false,
            expires_at: "2020-01-01T00:00:00.000Z"
        },
        {
            ...successfulProbeResult.profile,
            secret_ciphertext: encrypted,
            id: "provider-disabled",
            name: "Disabled provider",
            enabled: false,
            is_default: false,
            expires_at: null
        }
    ];
    const statusCenter = createAiProviderCenter({
        supabase: {
            from() {
                return {
                    select() {
                        return this;
                    },
                    order() {
                        return this;
                    },
                    then(resolve, reject) {
                        return Promise.resolve({
                            data: statusRows,
                            error: null
                        }).then(resolve, reject);
                    }
                };
            }
        },
        env
    });
    const providerStatus = await statusCenter.status();
    assert.equal(providerStatus.profiles, 3);
    assert.equal(providerStatus.enabled_profiles, 2);
    assert.equal(providerStatus.routable_profiles, 1);
    assert.equal(providerStatus.active_profile.id, "provider-routable");
    assert.equal(providerStatus.credential_reentry_required, false);

    const damagedBackupCiphertext = "damaged-backup-ciphertext";
    assert.throws(() => decryptCredential(damagedBackupCiphertext, env));
    const runtimeRows = [
        {
            id: "provider-healthy-default",
            name: "Healthy default",
            protocol: "openai-chat",
            base_url: "https://healthy.example.com/v1",
            auth_type: "bearer",
            secret_ciphertext: encrypted,
            default_model: "gpt-healthy",
            enabled: true,
            is_default: true,
            priority: 10,
            expires_at: null
        },
        {
            id: "provider-damaged-backup",
            name: "Damaged backup",
            protocol: "openai-chat",
            base_url: "https://backup.example.com/v1",
            auth_type: "bearer",
            secret_ciphertext: damagedBackupCiphertext,
            default_model: "gpt-backup",
            enabled: true,
            is_default: false,
            priority: 20,
            expires_at: null
        }
    ];
    const runtimeCenter = createAiProviderCenter({
        supabase: {
            from() {
                return {
                    select() {
                        return this;
                    },
                    order() {
                        return this;
                    },
                    eq() {
                        return this;
                    },
                    then(resolve, reject) {
                        return Promise.resolve({
                            data: runtimeRows,
                            error: null
                        }).then(resolve, reject);
                    }
                };
            }
        },
        env
    });
    const defaultRuntime = await runtimeCenter.resolveDefaultSettings({
        model: "legacy-model"
    });
    assert.equal(defaultRuntime.provider_profile_id, "provider-healthy-default");
    assert.equal(defaultRuntime.model, "gpt-healthy");
    assert.equal(defaultRuntime.runtime_api_key, "gateway-key-value");

    const rotatedEnv = {
        MCP_ENCRYPTION_KEY:
            "a-different-provider-encryption-secret-after-migration"
    };
    const rotatedRows = [runtimeRows[0]];
    const rotatedCenter = createAiProviderCenter({
        supabase: {
            from() {
                return {
                    select() {
                        return this;
                    },
                    order() {
                        return this;
                    },
                    eq() {
                        return this;
                    },
                    maybeSingle() {
                        return Promise.resolve({
                            data: rotatedRows[0],
                            error: null
                        });
                    },
                    then(resolve, reject) {
                        return Promise.resolve({
                            data: rotatedRows,
                            error: null
                        }).then(resolve, reject);
                    }
                };
            }
        },
        env: rotatedEnv,
        lookup: async () => [{ address: "203.0.113.12", family: 4 }]
    });
    const recoveredSettings = await rotatedCenter.resolveDefaultSettings({
        model: "legacy-model",
        ai_name: "小灯"
    });
    assert.equal(recoveredSettings.provider_profile_id, null);
    assert.equal(recoveredSettings.runtime_api_key, "");
    assert.equal(recoveredSettings.ai_name, "小灯");

    const rotatedStatus = await rotatedCenter.status();
    assert.equal(rotatedStatus.available, true);
    assert.equal(rotatedStatus.routable_profiles, 0);
    assert.equal(rotatedStatus.credentials_requiring_reentry, 1);
    assert.equal(rotatedStatus.credential_reentry_required, true);
    assert.equal(rotatedStatus.active_profile.routable, false);
    assert.equal(
        rotatedStatus.active_profile.credential_state,
        "needs_reentry"
    );

    const rotatedProfiles = await rotatedCenter.listProfiles();
    assert.equal(rotatedProfiles[0].auth_configured, false);
    assert.equal(rotatedProfiles[0].credential_reentry_required, true);
    assert.equal(rotatedProfiles[0].credential_state, "needs_reentry");
    assert.equal(
        JSON.stringify({ rotatedStatus, rotatedProfiles }).includes(
            runtimeRows[0].secret_ciphertext
        ),
        false
    );
    await assert.rejects(
        () =>
            rotatedCenter.updateProfile(rotatedRows[0].id, {
                name: "仍需重新填写的接口"
            }),
        (error) => error.code === "AI_PROVIDER_CREDENTIAL_REQUIRED"
    );

    const failedHealthWrite = probeSupabase({
        code: "DATABASE_TEST_ERROR",
        message: "database-sensitive-marker-456"
    });
    const failedHealthWriteCenter = createAiProviderCenter({
        supabase: failedHealthWrite.client,
        env,
        fetchImpl: async () => {
            throw new Error(rawSensitiveMarker);
        },
        lookup: async () => [{ address: "203.0.113.12", family: 4 }]
    });
    await assert.rejects(
        () => failedHealthWriteCenter.testProfile("provider-probe"),
        (error) =>
            error.code === "AI_PROVIDER_HEALTH_UPDATE_FAILED" &&
            !error.message.includes("database-sensitive-marker-456")
    );
    assert.equal(failedHealthWrite.writes.length, 1);

    console.log("AI provider center tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

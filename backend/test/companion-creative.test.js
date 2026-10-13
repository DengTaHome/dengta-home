const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    createCompanionCreativeCenter,
    decryptScopedSecret,
    encryptScopedSecret,
    fetchGeneratedImage,
    inspectImageProviderCredential,
    normalizeCreativeSettings,
    normalizeIdea,
    publicCreativeError,
    publicImageProvider,
    sanitizeUploadedImage
} = require("../services/companion-creative");
const {
    buildCreativeDecisionPrompt,
    parseCreativeDecision,
    publishArtworkMessage
} = require("../services/tenant-companion-creative");
const { publicMessage } = require("../services/chat-attachments");

(async () => {
const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const otherCompanionId = "33333333-3333-4333-8333-333333333333";
const identity = { userId, companionId };
const env = {
    MCP_ENCRYPTION_KEY:
        "creative-test-encryption-key-which-is-long-enough-2026"
};

assert.deepEqual(
    normalizeCreativeSettings({
        generation_mode: "autonomous",
        daily_call_limit: "",
        monthly_call_limit: 120,
        surprise_enabled: true,
        max_surprise_days: 365
    }),
    {
        generation_mode: "autonomous",
        daily_call_limit: null,
        monthly_call_limit: 120,
        surprise_enabled: true,
        max_surprise_days: 365
    }
);
assert.equal(
    normalizeCreativeSettings({
        generation_mode: "confirm",
        surprise_enabled: true
    }).surprise_enabled,
    false,
    "secret surprises must stay off outside autonomous mode"
);
assert.throws(
    () =>
        normalizeCreativeSettings({
            generation_mode: "autonomous",
            daily_call_limit: -1
        }),
    /调用上限/
);

const encrypted = encryptScopedSecret(
    "image-key-secret",
    identity,
    "image-provider",
    env
);
assert.doesNotMatch(encrypted, /image-key-secret/);
assert.equal(
    decryptScopedSecret(
        encrypted,
        identity,
        "image-provider",
        env
    ),
    "image-key-secret"
);
assert.throws(
    () =>
        decryptScopedSecret(
            encrypted,
            { userId, companionId: otherCompanionId },
            "image-provider",
            env
        ),
    /当前账号不匹配/
);

assert.deepEqual(
    normalizeIdea({
        kind: "gift",
        idea: "把雨夜聊天画成一盏暖灯。",
        prompt: "A warm lamp beside a rainy window, soft illustration",
        surprise: true,
        reveal_after_minutes: 9999999
    }),
    {
        kind: "gift",
        title: "一张没有命名的画",
        description: "把雨夜聊天画成一盏暖灯。",
        prompt: "A warm lamp beside a rainy window, soft illustration",
        reason: "想把这一刻留下来。",
        alt_text: "AI 伴侣创作的图片",
        surprise: true,
        reveal_after_minutes: 525600
    }
);

const decision = parseCreativeDecision(
    JSON.stringify({
        create: true,
        kind: "doodle",
        title: "雨窗",
        description: "来自真实聊天的雨夜构思",
        prompt: "rainy window, warm lamp",
        reason: "刚才聊到了下雨",
        alt_text: "雨窗边的一盏暖灯",
        surprise: true,
        reveal_after_minutes: 200000,
        next_check_minutes: 0
    }),
    {
        allowSurprise: true,
        maxSurpriseDays: 30,
        random: () => 0
    }
);
assert.equal(decision.create, true);
assert.equal(decision.surprise, true);
assert.equal(decision.reveal_after_minutes, 30 * 24 * 60);
assert.equal(decision.next_check_minutes, 60);
assert.equal(
    parseCreativeDecision("{\"create\":true}", {
        allowSurprise: true
    }).create,
    false,
    "incomplete image prompts must never trigger a provider call"
);

const prompt = buildCreativeDecisionPrompt({
    messages: [
        {
            role: "user",
            content: "今天下雨了",
            created_at: "2026-07-28T10:00:00.000Z"
        },
        {
            role: "assistant",
            content: "我想陪你听雨",
            created_at: "2026-07-28T10:00:02.000Z"
        }
    ],
    latestProfile: { introduction: "喜欢温暖的灯光" },
    allowSurprise: false
});
assert.match(prompt, /不得虚构共同经历/);
assert.match(prompt, /surprise 必须为 false/);
assert.match(prompt, /今天下雨了/);

const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
);
const sanitizedUpload = sanitizeUploadedImage(
    onePixelPng,
    "image/png"
);
assert.equal(sanitizedUpload.mimeType, "image/png");
assert.equal(sanitizedUpload.extension, "png");
assert.deepEqual(sanitizedUpload.bytes, onePixelPng);
const privateText = Buffer.from("Comment\0private-location-note", "latin1");
const textChunk = Buffer.alloc(12 + privateText.length);
textChunk.writeUInt32BE(privateText.length, 0);
textChunk.write("tEXt", 4, "ascii");
privateText.copy(textChunk, 8);
const pngWithMetadata = Buffer.concat([
    onePixelPng.subarray(0, -12),
    textChunk,
    onePixelPng.subarray(-12)
]);
const sanitizedMetadataUpload = sanitizeUploadedImage(
    pngWithMetadata,
    "image/png"
);
assert.equal(
    sanitizedMetadataUpload.bytes.includes(Buffer.from("tEXt")),
    false
);
assert.equal(
    sanitizedMetadataUpload.bytes.includes(Buffer.from("private-location-note")),
    false
);
assert.throws(
    () =>
        sanitizeUploadedImage(
            Buffer.concat([onePixelPng, Buffer.from([0])]),
            "image/png"
        ),
    /结构不完整或已经损坏/
);
let providerRequest;
const generated = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async (url, options) => {
        providerRequest = { url, options };
        return new Response(
            JSON.stringify({
                data: [{ b64_json: onePixelPng.toString("base64") }]
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
});
assert.equal(providerRequest.url, "https://images.example.test/v1/images/generations");
assert.equal(providerRequest.options.headers.Authorization, "Bearer hidden-key");
assert.equal(JSON.parse(providerRequest.options.body).response_format, "b64_json");
assert.equal(generated.mimeType, "image/png");
assert.deepEqual(generated.bytes, onePixelPng);

const compatibilityRequests = [];
const compatibilityFallback = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async (_url, options) => {
        compatibilityRequests.push(JSON.parse(options.body));
        if (compatibilityRequests.length === 1) {
            return new Response(
                JSON.stringify({
                    error: { message: "Unknown field: response_format" }
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }
        return new Response(
            JSON.stringify({
                data: [{ b64_json: onePixelPng.toString("base64") }]
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
});
assert.equal(compatibilityRequests.length, 2);
assert.equal(compatibilityRequests[0].response_format, "b64_json");
assert.equal(
    Object.hasOwn(compatibilityRequests[1], "response_format"),
    false
);
assert.deepEqual(compatibilityFallback.bytes, onePixelPng);

for (const payload of [
    {
        output: [
            {
                type: "image_generation_call",
                result: onePixelPng.toString("base64")
            }
        ]
    },
    {
        images: [
            {
                b64_json: onePixelPng.toString("base64")
            }
        ]
    }
]) {
    const compatible = await fetchGeneratedImage({
        provider: {
            base_url: "https://images.example.test/v1",
            auth_type: "bearer",
            model: "test-image"
        },
        credential: "hidden-key",
        production: false,
        fetchImpl: async () =>
            new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            })
    });
    assert.equal(compatible.mimeType, "image/png");
    assert.deepEqual(compatible.bytes, onePixelPng);
}

const directBinary = await fetchGeneratedImage({
    provider: {
        base_url: "https://images.example.test/v1",
        auth_type: "bearer",
        model: "test-image"
    },
    credential: "hidden-key",
    production: false,
    fetchImpl: async () =>
        new Response(onePixelPng, {
            status: 200,
            headers: { "Content-Type": "image/png" }
        })
});
assert.equal(directBinary.mimeType, "image/png");
assert.deepEqual(directBinary.bytes, onePixelPng);

const migratedEnv = {
    MCP_ENCRYPTION_KEY:
        "replacement-creative-encryption-key-long-enough-2026"
};
const legacyProvider = {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Legacy image provider",
    base_url: "https://images.example.test/v1",
    auth_type: "bearer",
    secret_ciphertext: encrypted,
    model: "test-image",
    enabled: true
};
const legacyProviderInspection = inspectImageProviderCredential(
    legacyProvider,
    identity,
    migratedEnv
);
assert.equal(legacyProviderInspection.state, "needs_reentry");
assert.equal(legacyProviderInspection.usable, false);
assert.equal(legacyProviderInspection.credential, "");
const legacyPublicProvider = publicImageProvider(
    legacyProvider,
    legacyProviderInspection
);
assert.equal(legacyPublicProvider.auth_configured, false);
assert.equal(legacyPublicProvider.routable, false);
assert.equal(legacyPublicProvider.credential_state, "needs_reentry");
assert.equal(legacyPublicProvider.credential_reentry_required, true);
assert.equal("secret_ciphertext" in legacyPublicProvider, false);

const legacyArtworkId = "66666666-6666-4666-8666-666666666666";
const legacyArtwork = {
    id: legacyArtworkId,
    kind: "gift",
    visibility: "ordinary",
    state: "ready",
    title: "旧作品仍可查看",
    description_ciphertext: encryptScopedSecret(
        "legacy description",
        identity,
        `artwork-description:${legacyArtworkId}`,
        env
    ),
    prompt_ciphertext: encryptScopedSecret(
        "legacy prompt",
        identity,
        `artwork-prompt:${legacyArtworkId}`,
        env
    ),
    generation_reason_ciphertext: encryptScopedSecret(
        "legacy reason",
        identity,
        `artwork-reason:${legacyArtworkId}`,
        env
    ),
    alt_text: "旧作品",
    storage_path: `${userId}/${companionId}/${legacyArtworkId}.png`,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z"
};
const listOnlyDatabase = {
    from(table) {
        assert.equal(table, "companion_artworks");
        const builder = {
            select() {
                return builder;
            },
            is() {
                return builder;
            },
            order() {
                return builder;
            },
            limit() {
                return builder;
            },
            then(resolve, reject) {
                return Promise.resolve({ data: [legacyArtwork], error: null }).then(
                    resolve,
                    reject
                );
            }
        };
        return builder;
    }
};
const inertStorage = {
    from() {
        throw new Error("storage should not be read while listing metadata");
    }
};
const migratedCenter = createCompanionCreativeCenter({
    database: listOnlyDatabase,
    storage: inertStorage,
    identity,
    env: migratedEnv
});
const resilientArtworkList = await migratedCenter.listArtworks();
assert.equal(resilientArtworkList.length, 1);
assert.equal(resilientArtworkList[0].description, "");
assert.equal(resilientArtworkList[0].reason, "");
assert.equal(resilientArtworkList[0].metadata_state, "needs_reentry");
assert.equal(resilientArtworkList[0].metadata_reentry_required, true);
assert.match(resilientArtworkList[0].metadata_message, /已有图片仍可查看/);
assert.match(resilientArtworkList[0].image_url, new RegExp(legacyArtworkId));
assert.equal("description_ciphertext" in resilientArtworkList[0], false);
assert.equal("prompt_ciphertext" in resilientArtworkList[0], false);
const partialMetadataArtwork = migratedCenter.publicArtwork({
    ...legacyArtwork,
    generation_reason_ciphertext: encryptScopedSecret(
        "current reason remains readable",
        identity,
        `artwork-reason:${legacyArtworkId}`,
        migratedEnv
    )
});
assert.equal(partialMetadataArtwork.description, "");
assert.equal(partialMetadataArtwork.reason, "current reason remains readable");
assert.equal(partialMetadataArtwork.metadata_state, "needs_reentry");

const insertedCreativeRows = [];
const creativeInsertDatabase = {
    from(table) {
        const query = { inserted: null };
        const builder = {
            select() {
                return builder;
            },
            limit() {
                return builder;
            },
            insert(values) {
                query.inserted = values;
                return builder;
            },
            async maybeSingle() {
                if (table === "companion_creative_settings") {
                    return {
                        data: {
                            id: "77777777-7777-4777-8777-777777777777",
                            generation_mode: "confirm",
                            daily_call_limit: null,
                            monthly_call_limit: null,
                            surprise_enabled: false,
                            max_surprise_days: 30
                        },
                        error: null
                    };
                }
                throw new Error(`unexpected maybeSingle table: ${table}`);
            },
            async single() {
                if (table !== "companion_artworks" || !query.inserted) {
                    throw new Error(`unexpected insert table: ${table}`);
                }
                insertedCreativeRows.push(query.inserted);
                return { data: query.inserted, error: null };
            }
        };
        return builder;
    }
};
const uploadedStoragePaths = [];
const writableStorage = {
    from(bucket) {
        assert.equal(bucket, "companion-artworks");
        return {
            async upload(storagePath) {
                uploadedStoragePaths.push(storagePath);
                return { data: { path: storagePath }, error: null };
            },
            async remove() {
                return { data: [], error: null };
            }
        };
    }
};
const writableCenter = createCompanionCreativeCenter({
    database: creativeInsertDatabase,
    storage: writableStorage,
    identity,
    env: migratedEnv,
    now: () => new Date("2026-08-13T06:30:00.000Z")
});
const uploadedArtwork = await writableCenter.uploadArtwork({
    bytes: onePixelPng,
    mimeType: "image/png",
    title: "迁移后手动上传"
});
assert.equal(uploadedArtwork.state, "ready");
assert.equal(uploadedStoragePaths.length, 1);
const migratedIdea = await writableCenter.createIdea({
    kind: "doodle",
    description: "迁移后仍可构思",
    prompt: "a small lighthouse",
    reason: "保留这一刻"
});
assert.equal(migratedIdea.row.state, "awaiting_confirmation");
assert.equal(insertedCreativeRows.length, 2);

const generationDatabase = {
    from(table) {
        const query = { id: null };
        const builder = {
            select() {
                return builder;
            },
            limit() {
                return builder;
            },
            eq(field, value) {
                if (field === "id") query.id = value;
                return builder;
            },
            async maybeSingle() {
                if (table === "companion_creative_settings") {
                    return {
                        data: {
                            generation_mode: "confirm",
                            daily_call_limit: null,
                            monthly_call_limit: null,
                            surprise_enabled: false,
                            max_surprise_days: 30
                        },
                        error: null
                    };
                }
                if (table === "image_provider_profiles") {
                    return { data: legacyProvider, error: null };
                }
                if (
                    table === "companion_artworks" &&
                    query.id === legacyArtworkId
                ) {
                    return {
                        data: { ...legacyArtwork, state: "awaiting_confirmation" },
                        error: null
                    };
                }
                return { data: null, error: null };
            }
        };
        return builder;
    }
};
const generationCenter = createCompanionCreativeCenter({
    database: generationDatabase,
    storage: inertStorage,
    identity,
    env: migratedEnv
});
await assert.rejects(generationCenter.generateArtwork(legacyArtworkId), (error) => {
    const safe = publicCreativeError(error);
    assert.equal(safe.status, 409);
    assert.equal(
        safe.code,
        "creative_provider_credential_reentry_required"
    );
    assert.equal(safe.credential_state, "needs_reentry");
    assert.equal(safe.credential_reentry_required, true);
    assert.equal(safe.credential_scope, "image_provider");
    assert.match(safe.message, /重新填写图片 API Key/);
    assert.match(safe.message, /Re-enter the image API key/);
    assert.doesNotMatch(JSON.stringify(safe), /secret_ciphertext|ctx1\./);
    return true;
});
const currentProvider = {
    ...legacyProvider,
    secret_ciphertext: encryptScopedSecret(
        "replacement provider key",
        identity,
        "image-provider",
        migratedEnv
    )
};
const metadataGenerationDatabase = {
    from(table) {
        const query = { id: null };
        const builder = {
            select() {
                return builder;
            },
            limit() {
                return builder;
            },
            eq(field, value) {
                if (field === "id") query.id = value;
                return builder;
            },
            async maybeSingle() {
                if (table === "companion_creative_settings") {
                    return {
                        data: {
                            generation_mode: "confirm",
                            daily_call_limit: null,
                            monthly_call_limit: null,
                            surprise_enabled: false,
                            max_surprise_days: 30
                        },
                        error: null
                    };
                }
                if (table === "image_provider_profiles") {
                    return { data: currentProvider, error: null };
                }
                if (
                    table === "companion_artworks" &&
                    query.id === legacyArtworkId
                ) {
                    return {
                        data: { ...legacyArtwork, state: "awaiting_confirmation" },
                        error: null
                    };
                }
                return { data: null, error: null };
            }
        };
        return builder;
    }
};
const metadataGenerationCenter = createCompanionCreativeCenter({
    database: metadataGenerationDatabase,
    storage: inertStorage,
    identity,
    env: migratedEnv
});
await assert.rejects(
    metadataGenerationCenter.generateArtwork(legacyArtworkId),
    (error) => {
        const safe = publicCreativeError(error);
        assert.equal(safe.status, 409);
        assert.equal(
            safe.code,
            "creative_artwork_metadata_reentry_required"
        );
        assert.equal(safe.metadata_state, "needs_reentry");
        assert.equal(safe.metadata_reentry_required, true);
        assert.equal("credential_scope" in safe, false);
        assert.match(safe.message, /重新构思/);
        assert.match(safe.message, /Create a new idea/);
        return true;
    }
);

const rejected = publicCreativeError(
    Object.assign(new Error("private upstream detail"), {
        upstream_status: 401
    })
);
assert.equal(rejected.code, "creative_request_failed");
assert.doesNotMatch(rejected.message, /private upstream detail/);

const artworkId = "44444444-4444-4444-8444-444444444444";
const visibleMessage = publicMessage({
    id: 1,
    role: "assistant",
    content: "给你",
    created_at: "2026-07-28T10:00:00.000Z",
    tool_calls: {
        artwork_id: artworkId,
        artwork_alt: "一盏暖灯",
        is_surprise_reveal: true,
        artwork_storage_path: "../../private",
        image_provider_key: "secret"
    }
});
assert.deepEqual(visibleMessage.tool_calls, {
    artwork_id: artworkId,
    artwork_alt: "一盏暖灯",
    is_surprise_reveal: true
});

const publishedRows = [];
const touchedConversations = [];
const publicationDatabase = {
    from(table) {
        const state = { operation: "", values: null };
        const builder = {
            select() {
                if (!state.operation) state.operation = "select";
                return builder;
            },
            insert(values) {
                state.operation = "insert";
                state.values = values;
                return builder;
            },
            update(values) {
                state.operation = "update";
                state.values = values;
                return builder;
            },
            eq() {
                return builder;
            },
            contains() {
                return builder;
            },
            order() {
                return builder;
            },
            limit() {
                return builder;
            },
            async maybeSingle() {
                if (table === "messages") {
                    return {
                        data: publishedRows[0]
                            ? { id: publishedRows[0].id }
                            : null,
                        error: null
                    };
                }
                return {
                    data: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
                    error: null
                };
            },
            async single() {
                const row = { id: 91, ...state.values };
                publishedRows.push(row);
                return { data: { id: row.id }, error: null };
            },
            then(resolve, reject) {
                if (table === "conversations" && state.operation === "update") {
                    touchedConversations.push(state.values);
                }
                return Promise.resolve({ data: null, error: null }).then(
                    resolve,
                    reject
                );
            }
        };
        return builder;
    }
};
const readyArtwork = {
    id: artworkId,
    visibility: "ordinary",
    state: "ready",
    storage_path: `${userId}/${companionId}/${artworkId}.png`
};
const publicationCenter = {
    publicArtwork() {
        return { reason: "A small gift", alt_text: "A warm lamp" };
    }
};
const published = await publishArtworkMessage({
    database: publicationDatabase,
    center: publicationCenter,
    artwork: readyArtwork,
    now: () => new Date("2026-07-28T11:00:00.000Z")
});
assert.equal(published.id, 91);
assert.deepEqual(publishedRows[0].tool_calls, {
    artwork_id: artworkId,
    artwork_alt: "A warm lamp",
    is_push: true,
    is_companion_creative: true
});
assert.equal(touchedConversations.length, 1);
const duplicatePublication = await publishArtworkMessage({
    database: publicationDatabase,
    center: publicationCenter,
    artwork: readyArtwork
});
assert.equal(duplicatePublication.id, 91);
assert.equal(publishedRows.length, 1);
assert.equal(
    await publishArtworkMessage({
        database: publicationDatabase,
        center: publicationCenter,
        artwork: {
            ...readyArtwork,
            visibility: "surprise",
            state: "ready_hidden"
        }
    }),
    null
);

const migration = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "supabase",
        "018_companion_creative_studio.sql"
    ),
    "utf8"
);
for (const marker of [
    "companion_creative_settings",
    "image_provider_profiles",
    "companion_artworks",
    "image_generation_calls",
    "'creative_check'",
    "'surprise_reveal'",
    "'companion-artworks'"
]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(migration, /revoke all[\s\S]*authenticated/i);
const artworkMessageMigration = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "supabase",
        "029_creative_artwork_message_idempotency.sql"
    ),
    "utf8"
);
assert.match(
    artworkMessageMigration,
    /unique index[\s\S]*messages_tenant_creative_artwork_uidx[\s\S]*artwork_id/i
);

const runtimeSource = fs.readFileSync(
    path.join(
        __dirname,
        "..",
        "services",
        "tenant-companion-creative.js"
    ),
    "utf8"
);
const creativeRouteSource = fs.readFileSync(
    path.join(__dirname, "..", "routes", "companion-creative.js"),
    "utf8"
);
assert.match(runtimeSource, /async function publishArtworkMessage/);
assert.match(creativeRouteSource, /publishArtworkMessage/);
assert.match(creativeRouteSource, /message_id/);
assert.match(
    runtimeSource,
    /artwork\.visibility === "ordinary"[\s\S]*?publishArtworkMessage/
);
assert.match(
    runtimeSource,
    /is_push:\s*true[\s\S]*?is_companion_creative:\s*true/
);
assert.match(
    runtimeSource,
    /surpriseReveal[\s\S]*?is_surprise_reveal:\s*true/
);

console.log("companion creative studio tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

"use strict";

const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createRequestScope } = require("../services/request-scope");
const {
    buildAnalysisUserMessage,
    buildTierInstruction,
    condensedAnalysis,
    createMusicUnderstandingService
} = require("../services/music-understanding");

test("buildTierInstruction splits casual and expert tiers", () => {
    const casual = buildTierInstruction("casual");
    const expert = buildTierInstruction("expert");
    assert.match(casual, /普通听歌爱好者/);
    assert.match(expert, /专家级/);
    assert.doesNotMatch(casual, /乐评人/);
});

test("condensedAnalysis trims long lists", () => {
    const condensed = condensedAnalysis({
        chord_progression: Array.from({ length: 40 }, (_, index) => ({ index })),
        structure: Array.from({ length: 30 }, (_, index) => ({ index })),
        motifs: Array.from({ length: 20 }, (_, index) => ({ index })),
        dynamics: { narrative: "n", curve: Array.from({ length: 500 }, (_, index) => index) }
    });
    assert.equal(condensed.chord_progression.length, 16);
    assert.equal(condensed.structure.length, 12);
    assert.equal(condensed.motifs.length, 6);
    assert.equal(condensed.dynamics.curve, undefined, "raw loudness curve must not be forwarded");
});

test("buildAnalysisUserMessage includes lyrics and analysis for expert tier", () => {
    const message = buildAnalysisUserMessage({
        title: "测试歌",
        artist: "测试歌手",
        tier: "expert",
        condensed: { harmony: { key: "C" } },
        lyrics: "第一句歌词"
    });
    assert.match(message, /测试歌 · 测试歌手/);
    assert.match(message, /第一句歌词/);
    assert.match(message, /"harmony"/);
    const casual = buildAnalysisUserMessage({
        title: "测试歌",
        artist: "",
        tier: "casual",
        condensed: {},
        lyrics: ""
    });
    assert.doesNotMatch(casual, /"harmony"/);
});

test("narrate rejects unknown tiers and invalid track ids", async () => {
    const service = createMusicUnderstandingService({
        database: { from: () => { throw new Error("unused"); } },
        getSettings: async () => ({}),
        qrLoginService: {}
    });
    await assert.rejects(
        () => service.narrate({ userId: "u", companionId: "c", db: {} }, { tier: "master", provider_track_id: "123" }),
        (error) => error.code === "music_tier_invalid"
    );
    await assert.rejects(
        () => service.narrate({ userId: "u", companionId: "c", db: {} }, { tier: "casual", provider_track_id: "abc" }),
        (error) => error.code === "music_track_id_invalid"
    );
});

test("analyze rejects when no playable URL is available", async () => {
    const emptyChain = {
        select: () => emptyChain,
        eq: () => emptyChain,
        maybeSingle: async () => ({ data: null, error: null })
    };
    const service = createMusicUnderstandingService({
        database: { from: () => emptyChain },
        qrLoginService: {
            songUrl: async () => ({ url: "", unavailable_reason: "vip_or_license" })
        }
    });
    await assert.rejects(
        () => service.analyze({ userId: "u", companionId: "c" }, { provider_track_id: "123" }),
        (error) => error.code === "netease_song_url_unavailable"
    );
});

const MUSIC_USER = "11111111-1111-4111-8111-111111111111";
const MUSIC_COMPANION = "22222222-2222-4222-8222-222222222222";
const MUSIC_OTHER_USER = "33333333-3333-4333-8333-333333333333";
const MUSIC_OTHER_COMPANION = "44444444-4444-4444-8444-444444444444";

function musicFixture(initialRows = [], { modelConfigured = true, generationError, audioResponse, voiceResponse, songUrlResponse, beforeRead, beforeWrite, databaseReadError, databaseWriteError } = {}) {
    const rows = initialRows.map(row => structuredClone(row));
    const operations = [];
    const network = [];
    const generations = [];
    const settingsReads = [];
    const admin = {
        from(table) {
            assert.equal(table, "music_understandings");
            const filters = [];
            let writing = null;
            const builder = {
                select() { return builder; },
                eq(column, value) { filters.push([column, value]); return builder; },
                upsert(value, options) { writing = structuredClone(value); operations.push({ writing, options: { ...options } }); return builder; },
                async maybeSingle() {
                    if (writing && beforeWrite) await beforeWrite(writing);
                    if (!writing && beforeRead) await beforeRead(filters);
                    const injectedError = writing ? databaseWriteError : databaseReadError;
                    if (injectedError) return { data: null, error: injectedError };
                    if (writing) {
                        const existing = rows.find(row => ["user_id", "companion_id", "provider_track_id"].every(key => row[key] === writing[key]));
                        if (existing) Object.assign(existing, writing);
                        else rows.push(writing);
                    }
                    const data = writing || rows.find(row => filters.every(([column, value]) => row[column] === value)) || null;
                    return { data: data && structuredClone(data), error: null };
                }
            };
            return builder;
        }
    };
    function scopeFor(userId = MUSIC_USER, companionId = MUSIC_COMPANION) {
        const companion = { id: companionId, user_id: userId, status: "active" };
        return createRequestScope({ adminSupabase: admin, user: { id: userId }, profile: { id: userId, status: "active", role: "member" }, companions: [companion], companion });
    }
    const scope = scopeFor();
    const settingsByDb = new Map();
    function settingsFor(requestScope, marker) {
        const settings = { model: modelConfigured ? marker : "", runtime_api_key: modelConfigured ? "FICTIONAL_ONLY" : "", unified_system_prompt: "FICTIONAL_PERSONALIZATION_" + marker, user_details: "FICTIONAL_DETAILS_" + marker };
        settingsByDb.set(requestScope.db, settings);
        return settings;
    }
    settingsFor(scope, "model-a");
    // Run the actual service source, replacing only external providers. No live model, database or metadata request is allowed.
    const filename = path.resolve(__dirname, "../services/music-understanding.js");
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const ordinaryRequire = loaded.require.bind(loaded);
    loaded.require = name => {
        if (name === "./ai-service") return { generateReply: async input => {
            generations.push(input);
            if (generationError) throw generationError;
            return { text: "这首虚构歌曲适合一起散步。" };
        } };
        if (name === "./netease-metadata") return {
            fetchSongMetadata: async () => { throw new Error("Unexpected metadata request"); },
            fetchSongLyrics: async () => { throw new Error("Unexpected lyrics fallback request"); }
        };
        return ordinaryRequire(name);
    };
    loaded._compile(fs.readFileSync(filename, "utf8"), filename);
    const service = loaded.exports.createMusicUnderstandingService({
        database: admin,
        env: { HERVOICE_URL: "https://fictional-voice.invalid", HERVOICE_SECRET: "FICTIONAL_ONLY" },
        getSettings: async db => { settingsReads.push(db); assert(settingsByDb.has(db), "the requesting account and companion must select their own settings"); return settingsByDb.get(db); },
        qrLoginService: {
            songUrl: async (requestScope, id) => { network.push(["songUrl", requestScope.userId, requestScope.companionId, id]); return songUrlResponse ? songUrlResponse(requestScope, id) : { url: "https://fictional-audio.invalid/song.mp3" }; },
            lyric: async (requestScope, id) => { network.push(["lyric", requestScope.userId, requestScope.companionId, id]); return { lyric: "虚构歌词" }; }
        },
        fetchImpl: async (url, options) => {
            network.push(["fetch", url]);
            assert(options.signal instanceof AbortSignal);
            if (url === "https://fictional-audio.invalid/song.mp3") return audioResponse ? audioResponse(options) : new Response(Uint8Array.from([1, 2, 3]));
            assert.equal(url, "https://fictional-voice.invalid/api/music/analyze");
            assert.equal(options.method, "POST");
            return voiceResponse ? voiceResponse(options) : Response.json({ status: "ok", analysis: { duration_sec: 42, rhythm: { bpm: 120 } } });
        }
    });
    return { service, scope, scopeFor, settingsFor, rows, operations, network, generations, settingsReads };
}

test("real RequestScope analyzes and reads without borrowing another account or companion cache", async () => {
    const foreignRows = [
        { user_id: MUSIC_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "123", title: "other companion", artist: "fictional", analysis: { rhythm: { bpm: 99 } } },
        { user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "123", title: "other account", artist: "fictional", analysis: { rhythm: { bpm: 88 } } }
    ];
    const fixture = musicFixture(foreignRows);
    const { service, scope, rows, operations, network } = fixture;
    await assert.rejects(() => service.read(scope, "123"), error => error.code === "music_understanding_not_found" && error.status === 404);
    const first = await service.analyze(scope, { provider_track_id: "123", title: "own song", artist: "own artist", user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION });
    assert.equal(first.cached, false);
    assert.equal(first.analysis.rhythm.bpm, 120);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].options.onConflict, "user_id,companion_id,provider_track_id");
    assert.equal(operations[0].writing.user_id, MUSIC_USER);
    assert.equal(operations[0].writing.companion_id, MUSIC_COMPANION);
    assert.deepEqual(rows.slice(0, 2), foreignRows);
    const networkCount = network.length;
    const second = await service.analyze(scope, { track_id: "123", title: "must not overwrite saved title" });
    assert.equal(second.cached, true);
    assert.equal(second.title, "own song");
    assert.equal(network.length, networkCount, "cache hits must not re-download or re-analyze");
    assert.equal(operations.length, 1);
    assert.equal((await service.read(fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION), "123")).analysis.rhythm.bpm, 99);
    assert.equal((await service.read(fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION), "123")).analysis.rhythm.bpm, 88);
    const contradictoryRead = await scope.db.from("music_understandings").select("*").eq("user_id", MUSIC_OTHER_USER).maybeSingle();
    assert.equal(contradictoryRead.data, null, "a caller-added filter cannot remove the enforced user ownership filter");
});

test("music upsert overwrites forged ownership and forces the tenant-track conflict key", async () => {
    const fixture = musicFixture();
    await fixture.scope.db.from("music_understandings").upsert({ user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "124", analysis: { duration_sec: 10 } }, { onConflict: "provider_track_id" }).select("*").maybeSingle();
    assert.equal(fixture.rows.length, 1);
    assert.equal(fixture.rows[0].user_id, MUSIC_USER);
    assert.equal(fixture.rows[0].companion_id, MUSIC_COMPANION);
    assert.equal(fixture.operations[0].options.onConflict, "user_id,companion_id,provider_track_id");
    await assert.rejects(() => fixture.service.read(fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION), "124"), error => error.code === "music_understanding_not_found");
    await assert.rejects(() => fixture.service.read(fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION), "124"), error => error.code === "music_understanding_not_found");
});

test("expert narration persists analysis once and uses only its requesting scope settings", async () => {
    const fixture = musicFixture();
    const settingsBefore = structuredClone(fixture.settingsFor(fixture.scope, "model-a"));
    const result = await fixture.service.narrate(fixture.scope, { provider_track_id: "125", title: "fictional song", artist: "fictional artist", tier: "expert" });
    assert.equal(result.tier, "expert");
    assert.equal(result.narration, "这首虚构歌曲适合一起散步。");
    assert.equal(result.understanding.cached, false);
    assert.equal(result.understanding.analysis.rhythm.bpm, 120);
    assert.equal(Object.hasOwn(result.understanding, "provider_track_id"), false);
    assert.equal(fixture.operations.length, 1);
    assert.equal(fixture.generations[0].settings.model, "model-a");
    assert.deepEqual(fixture.generations[0].settings, settingsBefore, "saved personalization fields must not be rewritten");
    assert.deepEqual(fixture.settingsReads, [fixture.scope.db]);
    assert.equal(fixture.generations[0].promptArchitecture, "legacy-special");
    assert.match(fixture.generations[0].systemInstructionsOverride, /专家级/);
    assert.deepEqual(fixture.generations[0].memories, []);
    assert.equal(fixture.generations[0].runtimeContext, "");
    const otherScope = fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION);
    fixture.settingsFor(otherScope, "model-b");
    const other = await fixture.service.narrate(otherScope, { provider_track_id: "125", title: "fictional second song", artist: "fictional second artist", tier: "expert" });
    assert.equal(other.understanding.cached, false);
    assert.equal(fixture.operations.length, 2);
    assert.equal(fixture.generations[1].settings.model, "model-b");
    assert.equal(fixture.operations[1].writing.user_id, MUSIC_OTHER_USER);
    assert.equal(fixture.operations[1].writing.companion_id, MUSIC_OTHER_COMPANION);
    assert.equal((await fixture.service.read(fixture.scope, "125")).title, "fictional song");
});

test("casual narration does not pretend it saved acoustic analysis", async () => {
    const fixture = musicFixture();
    const result = await fixture.service.narrate(fixture.scope, { provider_track_id: "126", title: "fictional song", artist: "fictional artist", tier: "casual" });
    assert.equal(result.understanding, null);
    assert.equal(fixture.operations.length, 0);
    assert(fixture.network.every(call => call[0] === "lyric"));
    assert.match(fixture.generations[0].systemInstructionsOverride, /普通听歌爱好者/);
    await assert.rejects(() => fixture.service.read(fixture.scope, "126"), error => error.code === "music_understanding_not_found");
});

test("expert narration failure can leave completed analysis to be recovered by a read", async () => {
    for (const options of [{ modelConfigured: false }, { generationError: Object.assign(new Error("fictional provider timeout"), { code: "provider_timeout", status: 504 }) }]) {
        const fixture = musicFixture([], options);
        await assert.rejects(() => fixture.service.narrate(fixture.scope, { provider_track_id: "127", title: "fictional song", artist: "fictional artist", tier: "expert" }), error => error.code === (options.modelConfigured === false ? "music_understanding_model_unconfigured" : "provider_timeout"));
        assert.equal(fixture.operations.length, 1);
        const saved = await fixture.service.read(fixture.scope, "127");
        assert.equal(saved.cached, true);
        assert.equal(saved.analysis.rhythm.bpm, 120);
        assert.equal(fixture.rows.length, 1);
    }
});

test("music understanding routes use real scopes for authentication, reads, analysis and tier results", async () => {
    const express = require("express");
    const { createMusicRouter } = require("../routes/v2/music");
    const fixture = musicFixture();
    const otherScope = fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION);
    fixture.settingsFor(otherScope, "model-b");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers.authorization === "Bearer fixture-a") req.scope = fixture.scope;
        if (req.headers.authorization === "Bearer fixture-b") req.scope = otherScope;
        next();
    });
    app.use("/api/v2/music", createMusicRouter({ musicUnderstanding: fixture.service }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || "request_failed", message: error.message }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/v2/music/understanding`;
        const headers = { Authorization: "Bearer fixture-a", "Content-Type": "application/json" };
        assert.equal((await fetch(base + "/tracks/128")).status, 401);
        const missing = await fetch(base + "/tracks/128", { headers });
        assert.equal(missing.status, 404);
        assert.equal((await missing.json()).code, "music_understanding_not_found");
        const analyzed = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ provider_track_id: "128", title: "fictional route song", artist: "fictional route artist", user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION }) });
        assert.equal(analyzed.status, 200);
        assert.equal((await analyzed.json()).understanding.cached, false);
        const read = await fetch(base + "/tracks/128", { headers });
        assert.equal(read.status, 200);
        assert.equal((await read.json()).understanding.analysis.rhythm.bpm, 120);
        assert.equal((await fetch(base + "/tracks/128", { headers: { Authorization: "Bearer fixture-b" } })).status, 404);
        const narrated = await fetch(base + "/narration", { method: "POST", headers, body: JSON.stringify({ provider_track_id: "128", title: "fictional route song", artist: "fictional route artist", tier: "expert" }) });
        assert.equal(narrated.status, 200);
        const result = (await narrated.json()).result;
        assert.equal(result.tier, "expert");
        assert.equal(result.understanding.cached, true);
        assert.equal(fixture.operations.length, 1, "expert narration of a saved analysis must reuse the scoped cache");
        const casual = await fetch(base + "/narration", { method: "POST", headers, body: JSON.stringify({ provider_track_id: "129", title: "fictional route casual", artist: "fictional route artist", tier: "casual" }) });
        assert.equal((await casual.json()).result.understanding, null);
        assert.equal(fixture.operations.length, 1);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

const ANALYSIS_INPUT = { provider_track_id: "170", title: "fictional quality song", artist: "fictional artist" };
const INVALID_ANALYSES = [
    ["broken JSON", () => new Response("{broken"), "music_understanding_invalid_response"],
    ["empty body", () => new Response(""), "music_understanding_invalid_response"],
    ["null envelope", () => Response.json(null), "music_understanding_invalid_response"],
    ["array envelope", () => Response.json([]), "music_understanding_invalid_response"],
    ["text analysis", () => Response.json({ analysis: "not the structured DTO" }), "music_understanding_invalid_response"],
    ["null analysis", () => Response.json({ analysis: null }), "music_understanding_invalid_response"],
    ["200 error envelope", () => Response.json({ error: { code: "fictional_failure", message: "PRIVATE_FICTIONAL_DETAIL" } }), "music_understanding_invalid_response"],
    ["failed status with analysis", () => Response.json({ status: "failed", analysis: { rhythm: { tempo_bpm: 120 } } }), "music_understanding_invalid_response"],
    ["empty object", () => Response.json({}), "music_understanding_empty_analysis"],
    ["metadata only", () => Response.json({ analysis: { file: "fictional.mp3", duration_sec: 42 } }), "music_understanding_empty_analysis"],
    ["empty DTO", () => Response.json({ analysis: condensedAnalysis({}) }), "music_understanding_empty_analysis"],
    ["blank narrative", () => Response.json({ analysis: { overall_narrative: { opening: "  ", full: "", highlights: [] } } }), "music_understanding_empty_analysis"],
    ["unknown section fields", () => Response.json({ analysis: { rhythm: { error: "PRIVATE_FICTIONAL_DETAIL" }, genre: { status: "ok" } } }), "music_understanding_empty_analysis"],
    ["non-finite metric", () => new Response('{"analysis":{"dynamics":{"rms_db":1e400}}}'), "music_understanding_empty_analysis"],
    ["zero tempo without other analysis", () => Response.json({ analysis: { rhythm: { tempo_bpm: 0 } } }), "music_understanding_empty_analysis"]
];

for (const [label, response, code] of INVALID_ANALYSES) {
    test(`real scope rejects ${label} without saving fake analysis`, async () => {
        const fixture = musicFixture([], { voiceResponse: response });
        await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === code && error.status === 502 && !error.message.includes("PRIVATE_FICTIONAL_DETAIL"));
        assert.equal(fixture.operations.length, 0);
        assert.equal(fixture.rows.length, 0);
        await assert.rejects(() => fixture.service.read(fixture.scope, "170"), error => error.code === "music_understanding_not_found");
    });
}

const PARTIAL_ANALYSES = [
    ["voice engine narrative object", { overall_narrative: { opening: "虚构歌曲的节奏平稳。", highlights: [], verdict: "", full: "" } }],
    ["compatible narrative string", { overall_narrative: "虚构歌曲的声音明亮。" }],
    ["actual tempo metric", { rhythm: { tempo_bpm: 123 } }],
    ["compatible bpm metric", { rhythm: { bpm: 123 } }],
    ["zero dynamics measurement", { dynamics: { rms_db: 0 } }],
    ["zero emotion measurement", { emotion: { valence: 0 } }],
    ["harmony only", { harmony: { key: "C", mode: "major", key_score: 0.8 } }],
    ["structure only", { structure: [{ label: "verse", start_sec: 0, end_sec: 20 }] }],
    ["style hint only", { style_hints: [{ hint: "虚构风格", reason: "平稳节奏" }] }],
    ["lyrics analysis only", { lyrics_deep: { imagery_density: 0, profile: "虚构意象" } }]
];

for (const [label, analysis] of PARTIAL_ANALYSES) {
    test(`real scope preserves useful partial analysis: ${label}`, async () => {
        const fixture = musicFixture([], { voiceResponse: () => Response.json({ status: "ok", analysis }) });
        const result = await fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
        assert.equal(result.cached, false);
        assert.equal(fixture.operations.length, 1);
        assert.deepEqual(result.analysis, condensedAnalysis(analysis));
        assert.deepEqual((await fixture.service.read(fixture.scope, "170")).analysis, result.analysis);
        assert.equal((await fixture.service.analyze(fixture.scope, ANALYSIS_INPUT)).cached, true);
        assert.equal(fixture.operations.length, 1);
    });
}

test("historical empty cached analysis reports unavailable without overwriting or deleting any tenant row", async () => {
    const saved = [
        { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", analysis: condensedAnalysis({}) },
        { user_id: MUSIC_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "170", analysis: { rhythm: { tempo_bpm: 111 } } },
        { user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "170", analysis: { overall_narrative: "虚构外国账号歌曲" } }
    ];
    const fixture = musicFixture(saved);
    for (const run of [() => fixture.service.read(fixture.scope, "170"), () => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), () => fixture.service.narrate(fixture.scope, { ...ANALYSIS_INPUT, tier: "expert" })]) {
        await assert.rejects(run, error => error.code === "music_understanding_cached_invalid" && error.status === 409);
        assert.deepEqual(fixture.rows, saved);
        assert.equal(fixture.operations.length, 0);
    }
    assert(fixture.network.every(call => call[0] === "lyric"));
    assert.equal(fixture.generations.length, 0);
    assert.equal((await fixture.service.read(fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION), "170")).analysis.rhythm.tempo_bpm, 111);
    assert.equal((await fixture.service.read(fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION), "170")).analysis.overall_narrative, saved[2].analysis.overall_narrative);
    const casual = await fixture.service.narrate(fixture.scope, { ...ANALYSIS_INPUT, tier: "casual" });
    assert.equal(casual.understanding, null);
    assert.deepEqual(fixture.rows, saved);
});

test("only explicit boolean reanalysis repairs its own invalid cache after useful completion", async () => {
    const original = [
        { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", title: "old fictional title", analysis: condensedAnalysis({}), updated_at: "2026-01-01T00:00:00.000Z" },
        { user_id: MUSIC_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "170", analysis: { rhythm: { tempo_bpm: 111 } } },
        { user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION, provider_track_id: "170", analysis: { overall_narrative: "虚构外国账号歌曲" } },
        { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "171", analysis: condensedAnalysis({}) }
    ];
    const fixture = musicFixture(original);
    for (const flag of [undefined, false, 1, "true"]) {
        await assert.rejects(() => fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, reanalyze_invalid_cache: flag }), error => error.code === "music_understanding_cached_invalid");
        assert.deepEqual(fixture.rows, original);
        assert.equal(fixture.network.length, 0);
    }
    await assert.rejects(() => fixture.service.narrate(fixture.scope, { ...ANALYSIS_INPUT, tier: "expert", reanalyze_invalid_cache: true }), error => error.code === "music_understanding_cached_invalid");
    const repaired = await fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true, user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION });
    assert.equal(repaired.cached, false);
    assert.equal(fixture.operations.length, 1);
    assert.equal(fixture.operations[0].options.onConflict, "user_id,companion_id,provider_track_id");
    assert.equal(fixture.rows.length, original.length);
    assert.deepEqual(fixture.rows.slice(1), original.slice(1), "other accounts, companions and songs must remain byte-for-byte equivalent");
    assert.equal((await fixture.service.read(fixture.scope, "170")).analysis.rhythm.bpm, 120);
    const networkCount = fixture.network.length;
    assert.equal((await fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, title: "must not replace valid title", reanalyze_invalid_cache: true })).cached, true);
    assert.equal(fixture.network.length, networkCount);
    assert.equal(fixture.operations.length, 1);
    assert.equal(fixture.rows[0].title, ANALYSIS_INPUT.title);
});

test("failed explicit reanalysis retains original invalid cache without a partial overwrite", async () => {
    const original = { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", title: "old fictional title", analysis: condensedAnalysis({}), updated_at: "2026-01-01T00:00:00.000Z" };
    for (const [response, code] of [[() => new Response("{broken"), "music_understanding_invalid_response"], [() => Response.json({ analysis: {} }), "music_understanding_empty_analysis"], [() => new Response("PRIVATE_FICTIONAL_DETAIL", { status: 503 }), "music_understanding_voice_failed"]]) {
        const fixture = musicFixture([original], { voiceResponse: response });
        const beforeBytes = JSON.stringify(fixture.rows);
        await assert.rejects(() => fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true }), error => error.code === code);
        assert.equal(JSON.stringify(fixture.rows), beforeBytes);
        assert.equal(fixture.operations.length, 0);
    }
});

function virtualAudio({ count = 1, bytes = 3, contentLength, readError, pendingRead = false } = {}) {
    const events = { reads: 0, cancellations: 0, released: 0, arrayBuffer: 0 };
    const chunk = new Uint8Array(bytes);
    let entered;
    const reading = new Promise(resolve => { entered = resolve; });
    const reader = {
        async read() {
            events.reads++;
            entered();
            if (readError) throw readError;
            if (pendingRead) return new Promise(() => {});
            return events.reads <= count ? { done: false, value: chunk } : { done: true };
        },
        cancel() { events.cancellations++; return Promise.resolve(); },
        releaseLock() { events.released++; }
    };
    return {
        events,
        reading,
        response: {
            ok: true,
            headers: new Headers(contentLength === undefined ? {} : { "Content-Length": String(contentLength) }),
            body: { getReader: () => reader, cancel: () => reader.cancel() },
            arrayBuffer: async () => { events.arrayBuffer++; return new ArrayBuffer(count * bytes); }
        }
    };
}

test("audio declared larger than 25 MiB cancels before its first body read", async () => {
    const audio = virtualAudio({ contentLength: 25 * 1024 * 1024 + 1 });
    const fixture = musicFixture([], { audioResponse: () => audio.response });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "music_audio_too_large" && error.status === 413);
    assert.equal(audio.events.reads, 0);
    assert.equal(audio.events.arrayBuffer, 0);
    assert.equal(audio.events.cancellations, 1);
    assert.equal(fixture.operations.length, 0);
    assert.equal(fixture.network.filter(call => call[0] === "fetch").length, 1);
});

for (const contentLength of [undefined, "1"]) {
    test(`audio actual chunk size overrides ${contentLength === undefined ? "missing" : "underreported"} Content-Length`, async () => {
        const audio = virtualAudio({ count: 50, bytes: 1024 * 1024, contentLength });
        const fixture = musicFixture([], { audioResponse: () => audio.response });
        await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "music_audio_too_large");
        assert.equal(audio.events.reads, 26, "stop immediately at the first over-limit chunk");
        assert.equal(audio.events.cancellations, 1);
        assert.equal(audio.events.released, 1);
        assert.equal(audio.events.arrayBuffer, 0);
        assert.equal(fixture.operations.length, 0);
        assert.equal(fixture.network.filter(call => call[0] === "fetch").length, 1);
    });
}

test("exactly 25 MiB is accepted from chunks without full-body arrayBuffer", async () => {
    const audio = virtualAudio({ count: 25, bytes: 1024 * 1024, contentLength: 25 * 1024 * 1024 });
    const fixture = musicFixture([], { audioResponse: () => audio.response });
    assert.equal((await fixture.service.analyze(fixture.scope, ANALYSIS_INPUT)).cached, false);
    assert.equal(audio.events.reads, 26);
    assert.equal(audio.events.arrayBuffer, 0);
    assert.equal(audio.events.cancellations, 0);
    assert.equal(fixture.operations.length, 1);
});

test("empty audio stream is never sent to analysis or saved", async () => {
    const audio = virtualAudio({ count: 0 });
    const fixture = musicFixture([], { audioResponse: () => audio.response });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "netease_audio_download_failed");
    assert.equal(fixture.operations.length, 0);
    assert.equal(fixture.network.filter(call => call[0] === "fetch").length, 1);
});

test("audio body interruption yields a precise technical error and cancels the reader", async () => {
    const audio = virtualAudio({ readError: new DOMException("PRIVATE_FICTIONAL_DETAIL", "AbortError") });
    const fixture = musicFixture([], { audioResponse: () => audio.response });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "netease_audio_download_interrupted" && error.status === 502 && !error.message.includes("PRIVATE_FICTIONAL_DETAIL"));
    assert.equal(audio.events.cancellations, 1);
    assert.equal(fixture.operations.length, 0);
});

for (const phase of ["fetch", "body"]) {
    test(`audio deadline remains active through ${phase} and stops without persistence`, { skip: process.env.DENGTA_MUSIC_BASELINE_PROBE === "1" }, async t => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const audio = virtualAudio({ pendingRead: true });
        let entered;
        const reached = phase === "body" ? audio.reading : new Promise(resolve => { entered = resolve; });
        let signal;
        const fixture = musicFixture([], { audioResponse: options => {
            signal = options.signal;
            if (phase === "body") return audio.response;
            entered();
            return new Promise(() => {});
        } });
        const pending = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
        const rejected = assert.rejects(() => pending, error => error.code === "netease_audio_download_timeout" && error.status === 504);
        await reached;
        t.mock.timers.tick(120000);
        await rejected;
        assert.equal(signal.aborted, true);
        if (phase === "body") assert.equal(audio.events.cancellations, 1);
        assert.equal(fixture.operations.length, 0);
        assert.equal(fixture.network.filter(call => call[0] === "fetch").length, 1);
    });
}

for (const phase of ["fetch", "body"]) {
    test(`voice analysis deadline includes ${phase}, not only response headers`, { skip: process.env.DENGTA_MUSIC_BASELINE_PROBE === "1" }, async t => {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        let entered;
        const reached = new Promise(resolve => { entered = resolve; });
        let signal;
        let cancelled = 0;
        const fixture = musicFixture([], { voiceResponse: options => {
            signal = options.signal;
            if (phase === "fetch") { entered(); return new Promise(() => {}); }
            return { ok: true, body: { cancel: async () => { cancelled++; } }, json: () => { entered(); return new Promise(() => {}); } };
        } });
        const pending = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
        const rejected = assert.rejects(() => pending, error => error.code === "music_understanding_voice_timeout" && error.status === 504);
        await reached;
        t.mock.timers.tick(240000);
        await rejected;
        assert.equal(signal.aborted, true);
        if (phase === "body") assert.equal(cancelled, 1);
        assert.equal(fixture.operations.length, 0);
    });
}

test("voice aborted JSON read is distinct from malformed JSON without saving or leaking detail", async () => {
    const fixture = musicFixture([], { voiceResponse: () => ({ ok: true, json: async () => { throw new DOMException("PRIVATE_FICTIONAL_DETAIL", "AbortError"); } }) });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "music_understanding_voice_interrupted" && error.status === 502 && !error.message.includes("PRIVATE_FICTIONAL_DETAIL"));
    assert.equal(fixture.operations.length, 0);
});

test("real loopback music router exposes quality errors and preserves cross-tenant recovery", async () => {
    const express = require("express");
    const { createMusicRouter } = require("../routes/v2/music");
    let response = () => new Response("{broken");
    const fixture = musicFixture([], { voiceResponse: () => response() });
    const otherScope = fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers.authorization === "Bearer fixture-a") req.scope = fixture.scope;
        if (req.headers.authorization === "Bearer fixture-b") req.scope = otherScope;
        next();
    });
    app.use("/api/v2/music", createMusicRouter({ musicUnderstanding: fixture.service }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || "request_failed", message: error.message }));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/v2/music/understanding`;
        const headers = { Authorization: "Bearer fixture-a", "Content-Type": "application/json" };
        assert.equal((await fetch(base + "/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ANALYSIS_INPUT) })).status, 401);
        const broken = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify(ANALYSIS_INPUT) });
        assert.equal(broken.status, 502);
        assert.equal((await broken.json()).code, "music_understanding_invalid_response");
        response = () => Response.json({ status: "ok", analysis: {} });
        const empty = await fetch(base + "/narration", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, tier: "expert" }) });
        assert.equal(empty.status, 502);
        assert.equal((await empty.json()).code, "music_understanding_empty_analysis");
        assert.equal(fixture.generations.length, 0);
        assert.equal(fixture.operations.length, 0);
        assert.equal((await fetch(base + "/tracks/170", { headers })).status, 404);
        response = () => Response.json({ analysis: { overall_narrative: { full: "虚构路由摘要" } } });
        const valid = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION }) });
        assert.equal(valid.status, 200);
        assert.equal((await valid.json()).understanding.analysis.overall_narrative.full, "虚构路由摘要");
        assert.equal(fixture.operations.length, 1);
        assert.equal((await fetch(base + "/tracks/170", { headers: { Authorization: "Bearer fixture-b" } })).status, 404);
        assert.equal((await fetch(base + "/tracks/170", { headers })).status, 200);
        fixture.rows[0].analysis = condensedAnalysis({});
        const savedBefore = structuredClone(fixture.rows);
        const invalidCache = await fetch(base + "/tracks/170", { headers });
        assert.equal(invalidCache.status, 409);
        assert.equal((await invalidCache.json()).code, "music_understanding_cached_invalid");
        const blockedOverwrite = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify(ANALYSIS_INPUT) });
        assert.equal(blockedOverwrite.status, 409);
        assert.deepEqual(fixture.rows, savedBefore);
        assert.equal(fixture.operations.length, 1);
        assert.equal((await fetch(base + "/tracks/170", { headers: { Authorization: "Bearer fixture-b" } })).status, 404);
        const notBoolean = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, reanalyze_invalid_cache: "true" }) });
        assert.equal(notBoolean.status, 409);
        response = () => Response.json({ analysis: {} });
        const repairFailed = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, reanalyze_invalid_cache: true }) });
        assert.equal(repairFailed.status, 502);
        assert.equal((await repairFailed.json()).code, "music_understanding_empty_analysis");
        assert.equal(JSON.stringify(fixture.rows), JSON.stringify(savedBefore));
        response = () => Response.json({ analysis: { emotion: { valence: 0 } } });
        const repair = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, reanalyze_invalid_cache: true, user_id: MUSIC_OTHER_USER, companion_id: MUSIC_OTHER_COMPANION }) });
        assert.equal(repair.status, 200);
        assert.equal((await repair.json()).understanding.analysis.emotion.valence, 0);
        assert.equal(fixture.rows.length, 1);
        assert.equal(fixture.operations.length, 2);
        assert.equal((await fetch(base + "/tracks/170", { headers: { Authorization: "Bearer fixture-b" } })).status, 404);
        const validCached = await fetch(base + "/analyze", { method: "POST", headers, body: JSON.stringify({ ...ANALYSIS_INPUT, title: "must not overwrite", reanalyze_invalid_cache: true }) });
        assert.equal((await validCached.json()).understanding.cached, true);
        assert.equal(fixture.operations.length, 2);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

function musicDeferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test("same-instance concurrent repairs recheck the first successful cache without overwriting it", { timeout: 1500 }, async () => {
    const firstStarted = musicDeferred(), firstResponse = musicDeferred();
    let voiceCalls = 0;
    const fixture = musicFixture([
        { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", analysis: condensedAnalysis({}) }
    ], { voiceResponse: () => {
        voiceCalls++;
        if (voiceCalls === 1) { firstStarted.resolve(); return firstResponse.promise; }
        return Response.json({ analysis: { rhythm: { bpm: 222 } } });
    } });
    const input = { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true };
    const first = fixture.service.analyze(fixture.scope, input);
    await firstStarted.promise;
    const second = fixture.service.analyze(fixture.scope, { ...input, title: "later fictional request" });
    await new Promise(setImmediate);
    assert.equal(voiceCalls, 1, "the second repair must not analyze before rechecking the completed first repair");
    assert.equal(fixture.operations.length, 0);
    firstResponse.resolve(Response.json({ analysis: { rhythm: { bpm: 111 } } }));
    const [initial, queued] = await Promise.all([first, second]);
    assert.equal(initial.cached, false);
    assert.equal(queued.cached, true);
    assert.deepEqual(queued.analysis, initial.analysis);
    assert.equal(queued.title, ANALYSIS_INPUT.title);
    assert.equal(fixture.rows[0].analysis.rhythm.bpm, 111);
    assert.equal(fixture.operations.length, 1);
    assert.equal(voiceCalls, 1);
    assert.equal(fixture.network.filter(call => call[0] === "fetch").length, 2);
});

test("a failed first repair releases its queued replacement without saving partial analysis", { timeout: 1500 }, async () => {
    const firstStarted = musicDeferred(), firstResponse = musicDeferred();
    const original = { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", analysis: condensedAnalysis({}) };
    let voiceCalls = 0;
    const fixture = musicFixture([original], { voiceResponse: () => {
        voiceCalls++;
        if (voiceCalls === 1) { firstStarted.resolve(); return firstResponse.promise; }
        return Response.json({ analysis: { rhythm: { bpm: 222 } } });
    } });
    const input = { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true };
    const first = fixture.service.analyze(fixture.scope, input);
    const failed = assert.rejects(() => first, error => error.code === "music_understanding_invalid_response");
    await firstStarted.promise;
    const second = fixture.service.analyze(fixture.scope, input);
    await new Promise(setImmediate);
    assert.equal(voiceCalls, 1);
    assert.deepEqual(fixture.rows, [original]);
    assert.equal(fixture.operations.length, 0);
    firstResponse.resolve(new Response("{broken"));
    await failed;
    assert.equal((await second).cached, false);
    assert.equal(fixture.rows[0].analysis.rhythm.bpm, 222);
    assert.equal(fixture.operations.length, 1);
    assert.equal(voiceCalls, 2);
});

test("same-instance analysis queues do not block a different account, companion or song", { timeout: 1500 }, async () => {
    const firstStarted = musicDeferred(), firstResponse = musicDeferred();
    let voiceCalls = 0;
    const fixture = musicFixture([], { voiceResponse: () => {
        voiceCalls++;
        if (voiceCalls === 1) { firstStarted.resolve(); return firstResponse.promise; }
        return Response.json({ analysis: { rhythm: { bpm: 200 + voiceCalls } } });
    } });
    const first = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    await firstStarted.promise;
    const others = await Promise.all([
        fixture.service.analyze(fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_COMPANION), ANALYSIS_INPUT),
        fixture.service.analyze(fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION), ANALYSIS_INPUT),
        fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, provider_track_id: "171" })
    ]);
    assert(others.every(result => result.cached === false));
    assert.equal(voiceCalls, 4);
    assert.equal(fixture.operations.length, 3, "other keys must finish while the first key is still pending");
    assert.equal(fixture.rows.some(row => row.user_id === MUSIC_USER && row.companion_id === MUSIC_COMPANION && row.provider_track_id === "170"), false);
    assert.equal((await fixture.service.read(fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_COMPANION), "170")).analysis.rhythm.bpm, 202);
    assert.equal((await fixture.service.read(fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION), "170")).analysis.rhythm.bpm, 203);
    assert.equal((await fixture.service.read(fixture.scope, "171")).analysis.rhythm.bpm, 204);
    firstResponse.resolve(Response.json({ analysis: { rhythm: { bpm: 111 } } }));
    await first;
    assert.equal(fixture.operations.length, 4);
});

test("failed unqueued repairs release their queue for a later explicit retry", { timeout: 1500 }, async () => {
    let voiceCalls = 0;
    const fixture = musicFixture([
        { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", analysis: condensedAnalysis({}) }
    ], { voiceResponse: () => {
        voiceCalls++;
        if (voiceCalls === 1) throw new Error("PRIVATE_FICTIONAL_DETAIL");
        return Response.json({ analysis: { rhythm: { bpm: 123 } } });
    } });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT), error => error.code === "music_understanding_cached_invalid");
    const input = { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true };
    await assert.rejects(() => fixture.service.analyze(fixture.scope, input), error => error.code === "music_understanding_voice_interrupted");
    assert.equal(fixture.operations.length, 0);
    assert.equal((await fixture.service.analyze(fixture.scope, input)).cached, false);
    assert.equal(fixture.operations.length, 1);
    assert.equal(voiceCalls, 2);
    assert.equal((await fixture.service.analyze(fixture.scope, input)).cached, true);
    assert.equal(voiceCalls, 2);
});

function assertStatusReceipt(value, state, stage = null) {
    assert.deepEqual(Object.keys(value).sort(), ["provider_track_id", "state", "stage", "started_at", "updated_at", "error_code", "http_status", "understanding"].sort());
    assert.equal(value.provider_track_id, "170");
    assert.equal(value.state, state);
    assert.equal(value.stage, stage);
    for (const field of ["started_at", "updated_at"]) {
        if (value[field] !== null) assert.equal(new Date(value[field]).toISOString(), value[field]);
    }
    if (state !== "saved") assert.equal(value.understanding, null);
}

for (const [phase, stage] of [
    ["preparing", "preparing"], ["download headers", "downloading"], ["download body", "downloading"],
    ["analysis headers", "analyzing"], ["analysis body", "analyzing"], ["saving", "saving"]
]) {
    test(`read-only analysis status includes pending ${phase} and confirms saved data only after persistence`, { timeout: 1500 }, async () => {
        const reached = musicDeferred(), release = musicDeferred();
        const options = {};
        let releaseValue;
        if (phase === "preparing") {
            options.songUrlResponse = () => { reached.resolve(); return release.promise; };
            releaseValue = { url: "https://fictional-audio.invalid/song.mp3" };
        } else if (phase === "download headers") {
            options.audioResponse = () => { reached.resolve(); return release.promise; };
            releaseValue = new Response(Uint8Array.from([1, 2, 3]));
        } else if (phase === "download body") {
            options.audioResponse = () => ({ ok: true, headers: new Headers(), body: { getReader: () => {
                let reads = 0;
                return {
                    read() {
                        if (reads++) return Promise.resolve({ done: true });
                        reached.resolve();
                        return release.promise.then(() => ({ done: false, value: Uint8Array.from([1, 2, 3]) }));
                    },
                    cancel: async () => {}, releaseLock() {}
                };
            } } });
        } else if (phase === "analysis headers") {
            options.voiceResponse = () => { reached.resolve(); return release.promise; };
            releaseValue = Response.json({ analysis: { rhythm: { bpm: 120 } } });
        } else if (phase === "analysis body") {
            options.voiceResponse = () => ({ ok: true, body: { cancel: async () => {} }, json: () => {
                reached.resolve(); return release.promise.then(() => ({ analysis: { rhythm: { bpm: 120 } } }));
            } });
        } else {
            options.beforeWrite = () => { reached.resolve(); return release.promise; };
        }
        const fixture = musicFixture([], options);
        const pending = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
        await reached.promise;
        const networkBefore = structuredClone(fixture.network), operationsBefore = fixture.operations.length;
        const status = await fixture.service.readStatus(fixture.scope, "170");
        assertStatusReceipt(status, "running", stage);
        assert(status.started_at && status.updated_at);
        assert.equal(status.error_code, null);
        assert.equal(status.http_status, null);
        assert.deepEqual(await fixture.service.readStatus(fixture.scope, "170"), status, "reading status must not advance the stage or refresh metadata timestamps");
        assert.deepEqual(fixture.network, networkBefore, "status does not call song, lyrics, download, analysis or model providers");
        assert.equal(fixture.operations.length, operationsBefore, "status does not write the database");
        assert.equal(fixture.rows.length, 0, "a pending save cannot be reported as a saved result");
        assert.equal(fixture.generations.length, 0);
        assert.equal(fixture.settingsReads.length, 0);
        release.resolve(releaseValue);
        await pending;
        const saved = await fixture.service.readStatus(fixture.scope, "170");
        assertStatusReceipt(saved, "saved");
        assert.equal(saved.understanding.cached, true);
        assert.deepEqual(saved.understanding, await fixture.service.read(fixture.scope, "170"));
        assert.equal(fixture.operations.length, 1);
    });
}

test("status keeps the active same-song stage when another request queues and isolates all scope keys", { timeout: 1500 }, async () => {
    const reached = musicDeferred(), release = musicDeferred();
    let voiceCalls = 0;
    const fixture = musicFixture([], { voiceResponse: () => {
        voiceCalls++;
        if (voiceCalls === 1) { reached.resolve(); return release.promise; }
        return Response.json({ analysis: { rhythm: { bpm: 130 + voiceCalls } } });
    } });
    const first = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    await reached.promise;
    const originalStatus = await fixture.service.readStatus(fixture.scope, "170");
    const second = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    await new Promise(setImmediate);
    assert.deepEqual(await fixture.service.readStatus(fixture.scope, "170"), originalStatus, "queued work must not replace the active request stage or start time");
    for (const scope of [fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_COMPANION), fixture.scopeFor(MUSIC_USER, MUSIC_OTHER_COMPANION)]) {
        assertStatusReceipt(await fixture.service.readStatus(scope, "170"), "unknown");
        await fixture.service.analyze(scope, ANALYSIS_INPUT);
        assertStatusReceipt(await fixture.service.readStatus(scope, "170"), "saved");
        assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "running", "analyzing");
    }
    const otherSong = await fixture.service.readStatus(fixture.scope, "171");
    assert.equal(otherSong.state, "unknown");
    assert.equal(otherSong.provider_track_id, "171");
    await fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, provider_track_id: "171" });
    assert.equal((await fixture.service.readStatus(fixture.scope, "171")).state, "saved");
    release.resolve(Response.json({ analysis: { rhythm: { bpm: 120 } } }));
    const [initial, queued] = await Promise.all([first, second]);
    assert.equal(initial.cached, false);
    assert.equal(queued.cached, true);
    assert.equal(voiceCalls, 4);
    assert.equal(fixture.operations.length, 4);
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "saved");
});

test("failed repair status keeps its original invalid row and discloses only fixed technical metadata", async () => {
    const original = { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", title: "fictional old title", analysis: condensedAnalysis({}) };
    const fixture = musicFixture([original], { voiceResponse: () => new Response("{broken") });
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "invalid_cache");
    const originalBytes = JSON.stringify(fixture.rows);
    await assert.rejects(() => fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true }), error => error.code === "music_understanding_invalid_response");
    const failed = await fixture.service.readStatus(fixture.scope, "170");
    assertStatusReceipt(failed, "failed");
    assert.equal(failed.error_code, "music_understanding_invalid_response");
    assert.equal(failed.http_status, 502);
    assert.equal(JSON.stringify(fixture.rows), originalBytes);
    assert.equal(fixture.operations.length, 0);
    assert(!JSON.stringify(failed).includes(original.title));
    assert(!JSON.stringify(failed).includes("lyrics"));
    const restarted = musicFixture(fixture.rows);
    const afterRestart = await restarted.service.readStatus(restarted.scope, "170");
    assertStatusReceipt(afterRestart, "invalid_cache");
    assert.equal(afterRestart.started_at, null);
    assert.equal(restarted.network.length, 0);
    assert.equal(restarted.operations.length, 0);
});

test("a valid database row has priority over failed metadata and saved status never trusts metadata alone", async () => {
    const fixture = musicFixture([], { voiceResponse: () => new Response("{broken") });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT));
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "failed");
    fixture.rows.push({ user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", title: "fictional confirmed row", analysis: { rhythm: { bpm: 123 } } });
    const confirmed = await fixture.service.readStatus(fixture.scope, "170");
    assertStatusReceipt(confirmed, "saved");
    assert.equal(confirmed.error_code, null);
    assert.equal(confirmed.http_status, null);
    assert.equal(confirmed.understanding.analysis.rhythm.bpm, 123);
    const success = musicFixture();
    await success.service.analyze(success.scope, ANALYSIS_INPUT);
    success.rows.length = 0;
    const removed = await success.service.readStatus(success.scope, "170");
    assertStatusReceipt(removed, "unknown");
    assert.equal(removed.error_code, null);
    assert.equal(removed.http_status, null);
    assert.equal(success.operations.length, 1, "status must not recreate a removed row");
});

test("unknown analysis and database failures cannot expose private code, message, title or lyrics in status", async () => {
    const privateError = Object.assign(new Error("PRIVATE_FICTIONAL_DETAIL"), { code: "PRIVATE_FICTIONAL_CODE", status: 503 });
    for (const options of [
        { songUrlResponse: async () => { throw privateError; } },
        { databaseWriteError: privateError }
    ]) {
        const original = { user_id: MUSIC_USER, companion_id: MUSIC_COMPANION, provider_track_id: "170", title: "PRIVATE_FICTIONAL_TITLE", analysis: condensedAnalysis({}) };
        const fixture = musicFixture([original], options);
        await assert.rejects(() => fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, reanalyze_invalid_cache: true }));
        const status = await fixture.service.readStatus(fixture.scope, "170");
        assertStatusReceipt(status, "failed");
        assert.equal(status.error_code, "music_understanding_failed");
        assert.equal(status.http_status, 503);
        assert(!JSON.stringify(status).includes("PRIVATE_FICTIONAL"));
        assert.deepEqual(fixture.rows, [original]);
    }
    for (const error of [privateError, { code: "42P01", message: "PRIVATE_FICTIONAL_TABLE" }]) {
        const fixture = musicFixture([], { databaseReadError: error });
        await assert.rejects(() => fixture.service.readStatus(fixture.scope, "170"), issue => issue.code === "music_understanding_status_unavailable" && issue.status === 503 && !issue.message.includes("PRIVATE_FICTIONAL"));
        assert.equal(fixture.network.length, 0);
        assert.equal(fixture.operations.length, 0);
    }
});

test("read-only status reports a deadline failure and never promotes late successful JSON to saved", { timeout: 1500 }, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const reached = musicDeferred(), release = musicDeferred();
    const fixture = musicFixture([], { voiceResponse: () => ({ ok: true, body: { cancel: async () => {} }, json: () => {
        reached.resolve(); return release.promise;
    } }) });
    const pending = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    const failed = assert.rejects(() => pending, error => error.code === "music_understanding_voice_timeout");
    await reached.promise;
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "running", "analyzing");
    t.mock.timers.tick(240000);
    await failed;
    const status = await fixture.service.readStatus(fixture.scope, "170");
    assertStatusReceipt(status, "failed");
    assert.equal(status.error_code, "music_understanding_voice_timeout");
    assert.equal(status.http_status, 504);
    release.resolve({ analysis: { rhythm: { bpm: 120 } } });
    await new Promise(setImmediate);
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "failed");
    assert.equal(fixture.operations.length, 0);
    assert.equal(fixture.rows.length, 0);
    const restarted = musicFixture();
    const unknown = await restarted.service.readStatus(restarted.scope, "170");
    assertStatusReceipt(unknown, "unknown");
    assert.equal(unknown.error_code, null);
    assert.equal(unknown.started_at, null);
    assert.equal(restarted.network.length, 0);
});

test("status metadata expires after twenty minutes without implying absence or safe retry", async t => {
    t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
    const fixture = musicFixture([], { songUrlResponse: async () => { throw Object.assign(new Error("fictional outage"), { code: "netease_qr_not_connected", status: 400 }); } });
    await assert.rejects(() => fixture.service.analyze(fixture.scope, ANALYSIS_INPUT));
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "failed");
    t.mock.timers.tick(20 * 60 * 1000);
    const expired = await fixture.service.readStatus(fixture.scope, "170");
    assertStatusReceipt(expired, "unknown");
    assert.equal(expired.started_at, null);
    assert.equal(expired.updated_at, null);
    assert.equal(expired.error_code, null);
    assert.equal(expired.http_status, null);
    assert.equal(fixture.operations.length, 0);
    assert.equal(fixture.network.length, 1, "expiry checks must not start a replacement operation");
});

test("expired running metadata does not stop the old task or release its same-instance queue", { timeout: 1500 }, async t => {
    t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
    const reached = musicDeferred(), release = musicDeferred();
    const fixture = musicFixture([], { songUrlResponse: () => { reached.resolve(); return release.promise; } });
    const first = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    await reached.promise;
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "running", "preparing");
    t.mock.timers.tick(20 * 60 * 1000);
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "unknown");
    const second = fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
    await new Promise(setImmediate);
    assert.equal(fixture.network.length, 1, "losing status metadata cannot start a competing same-song analysis");
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "unknown");
    release.resolve({ url: "https://fictional-audio.invalid/song.mp3" });
    const [initial, queued] = await Promise.all([first, second]);
    assert.equal(initial.cached, false);
    assert.equal(queued.cached, true);
    assert.equal(fixture.operations.length, 1);
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "saved");
});

test("status metadata is bounded and evicted entries become unknown without additional requests", async () => {
    const fixture = musicFixture([], { songUrlResponse: async () => { throw Object.assign(new Error("fictional outage"), { code: "netease_qr_not_connected", status: 400 }); } });
    for (let trackId = 170; trackId < 170 + 257; trackId++) {
        await assert.rejects(() => fixture.service.analyze(fixture.scope, { ...ANALYSIS_INPUT, provider_track_id: String(trackId) }));
    }
    assertStatusReceipt(await fixture.service.readStatus(fixture.scope, "170"), "unknown");
    assert.equal((await fixture.service.readStatus(fixture.scope, "426")).state, "failed");
    assert.equal(fixture.network.length, 257);
    assert.equal(fixture.operations.length, 0);
});

test("actual loopback status route enforces scope, private caching and legacy service compatibility", async () => {
    const express = require("express");
    const { createMusicRouter } = require("../routes/v2/music");
    const fixture = musicFixture();
    const otherScope = fixture.scopeFor(MUSIC_OTHER_USER, MUSIC_OTHER_COMPANION);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        if (req.headers.authorization === "Bearer fixture-a") req.scope = fixture.scope;
        if (req.headers.authorization === "Bearer fixture-b") req.scope = otherScope;
        next();
    });
    app.use("/api/v2/music", createMusicRouter({ musicUnderstanding: fixture.service }));
    app.use("/legacy", createMusicRouter({ musicUnderstanding: { read: fixture.service.read } }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code || "request_failed", message: error.message }));
    const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const route = "/api/v2/music/understanding/tracks/170/status";
        const headers = { Authorization: "Bearer fixture-a" };
        assert.equal((await fetch(base + route)).status, 401);
        const unknown = await fetch(base + route, { headers });
        assert.equal(unknown.status, 200);
        assert.equal(unknown.headers.get("cache-control"), "private, no-store");
        assertStatusReceipt((await unknown.json()).status, "unknown");
        assert.equal(fixture.network.length, 0);
        await fixture.service.analyze(fixture.scope, ANALYSIS_INPUT);
        const saved = await fetch(base + route, { headers });
        assertStatusReceipt((await saved.json()).status, "saved");
        const foreign = await fetch(base + route, { headers: { Authorization: "Bearer fixture-b" } });
        assertStatusReceipt((await foreign.json()).status, "unknown");
        const badId = await fetch(base + route.replace("/170/", "/invalid/"), { headers });
        assert.equal(badId.status, 400);
        assert.equal((await badId.json()).code, "music_track_id_invalid");
        const legacy = await fetch(base + "/legacy/understanding/tracks/170/status", { headers });
        assert.equal(legacy.status, 503);
        assert.equal((await legacy.json()).code, "music_understanding_status_unavailable");
        assert.equal(fixture.operations.length, 1);
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});

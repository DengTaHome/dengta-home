"use strict";

// Music understanding for 一起听 (Listen Together).
// Two tiers:
//   casual — metadata + lyrics only, instant, plain-listener language;
//   expert — full acoustic analysis via the DengTa voice service
//            (song-understanding engine), music-critic language.
// The narration prompt is a standalone module passed through
// systemInstructionsOverride; it does not touch the main-chat prompt
// architecture.

const { createNeteaseQrLoginService } = require("./netease-qr-login");
const { fetchSongLyrics, fetchSongMetadata } = require("./netease-metadata");
const { generateReply } = require("./ai-service");

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_CONDENSED_CHARS = 12000;
const VOICE_ANALYZE_TIMEOUT_MS = 240000;
const AUDIO_DOWNLOAD_TIMEOUT_MS = 120000;
const STATUS_TTL_MS = 20 * 60 * 1000;
const MAX_STATUS_ENTRIES = 256;
const TIERS = new Set(["casual", "expert"]);
const DECIMAL_ID = /^\d{1,20}$/;
const PUBLIC_ANALYSIS_ERRORS = new Set([
    "music_track_id_invalid", "music_audio_too_large", "music_understanding_failed",
    "music_understanding_cached_invalid", "music_understanding_empty_analysis", "music_understanding_invalid_response",
    "music_understanding_voice_unconfigured", "music_understanding_voice_failed", "music_understanding_voice_timeout", "music_understanding_voice_interrupted",
    "netease_song_url_unavailable", "netease_audio_download_failed", "netease_audio_download_timeout", "netease_audio_download_interrupted",
    "netease_qr_storage_unavailable", "netease_qr_not_connected", "netease_qr_session_expired", "netease_qr_unavailable", "netease_qr_encryption_unconfigured"
]);

function requestError(status, code, message) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function cleanText(value, maximum) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim())
        .slice(0, maximum)
        .join("");
}

function sliceList(value, maximum) {
    return (Array.isArray(value) ? value : []).slice(0, maximum);
}

function condensedAnalysis(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const condensed = {
        file: cleanText(source.file, 200),
        duration_sec: Number(source.duration_sec) || 0,
        rhythm: source.rhythm || null,
        meter: source.meter || null,
        harmony: source.harmony || null,
        chord_progression: sliceList(source.chord_progression, 16),
        functional_harmony: source.functional_harmony
            ? {
                  functions_summary: source.functional_harmony.functions_summary || null,
                  recognized_progressions: sliceList(source.functional_harmony.recognized_progressions, 8),
                  cadences: sliceList(source.functional_harmony.cadences, 8),
                  harmonic_rhythm_chords_per_bar: source.functional_harmony.harmonic_rhythm_chords_per_bar ?? null,
                  borrowed_chords: sliceList(source.functional_harmony.borrowed_chords, 8),
                  secondary_dominants: sliceList(source.functional_harmony.secondary_dominants, 8),
                  narrative: source.functional_harmony.narrative || "",
                  borrowed_narrative: source.functional_harmony.borrowed_narrative || ""
              }
            : null,
        structure: sliceList(source.structure, 12),
        note_density: source.note_density || null,
        dynamics: source.dynamics
            ? {
                  rms_db: source.dynamics.rms_db ?? null,
                  peak_db: source.dynamics.peak_db ?? null,
                  dynamic_range_db: source.dynamics.dynamic_range_db ?? null,
                  level_hist: source.dynamics.level_hist || null,
                  crescendos: sliceList(source.dynamics.crescendos, 6),
                  diminuendos: sliceList(source.dynamics.diminuendos, 6),
                  section_levels: source.dynamics.section_levels || null,
                  chorus_verse_delta_db: source.dynamics.chorus_verse_delta_db ?? null,
                  narrative: source.dynamics.narrative || ""
              }
            : null,
        production: source.production
            ? {
                  spectral_balance: source.production.spectral_balance || null,
                  spectral_tilt_db_per_oct: source.production.spectral_tilt_db_per_oct ?? null,
                  low_end_clarity: source.production.low_end_clarity ?? null,
                  loudness_proxy_db: source.production.loudness_proxy_db ?? null,
                  stereo_width: source.production.stereo_width ?? null,
                  narrative: source.production.narrative || ""
              }
            : null,
        groove: source.groove
            ? {
                  tempo_stability: source.groove.tempo_stability || null,
                  swing: source.groove.swing || null,
                  syncopation: source.groove.syncopation || null,
                  narrative: source.groove.narrative || ""
              }
            : null,
        tempo_drift: source.tempo_drift
            ? {
                  direction: source.tempo_drift.direction || null,
                  total_bpm_change: source.tempo_drift.total_bpm_change ?? null,
                  front_bpm: source.tempo_drift.front_bpm ?? null,
                  back_bpm: source.tempo_drift.back_bpm ?? null,
                  narrative: source.tempo_drift.narrative || ""
              }
            : null,
        bass_line: source.bass_line
            ? {
                  smoothness_stepwise_ratio: source.bass_line.smoothness_stepwise_ratio ?? null,
                  avg_motion_semitones: source.bass_line.avg_motion_semitones ?? null,
                  leap_count: source.bass_line.leap_count ?? null,
                  pattern: source.bass_line.pattern || null,
                  chord_root_consistency: source.bass_line.chord_root_consistency ?? null,
                  narrative: source.bass_line.narrative || ""
              }
            : null,
        voicing: source.voicing
            ? {
                  root_position_ratio: source.voicing.root_position_ratio ?? null,
                  inversion_variety: source.voicing.inversion_variety ?? null,
                  slash_chords: sliceList(source.voicing.slash_chords, 8),
                  bass_motion_stepwise_ratio: source.voicing.bass_motion_stepwise_ratio ?? null,
                  common_tone_retention: source.voicing.common_tone_retention ?? null,
                  narrative: source.voicing.narrative || ""
              }
            : null,
        melody: source.melody || null,
        key_changes: sliceList(source.key_changes, 8),
        motifs: sliceList(source.motifs, 6),
        timbre: source.timbre || null,
        emotion: source.emotion || null,
        combined_emotion: source.combined_emotion || null,
        genre: source.genre || null,
        style_hints: sliceList(source.style_hints, 8),
        lyrics: source.lyrics || null,
        lyrics_deep: source.lyrics_deep || null,
        tension_curve: source.tension_curve
            ? {
                  peak: source.tension_curve.peak || null,
                  narrative: source.tension_curve.narrative || ""
              }
            : null,
        overall_narrative: source.overall_narrative || null
    };
    const text = JSON.stringify(condensed);
    if (Array.from(text).length <= MAX_CONDENSED_CHARS) return condensed;
    return JSON.parse(text);
}

const ANALYSIS_FIELDS = {
    rhythm: { numbers: ["tempo_bpm", "bpm", "beats_estimated"], texts: ["fast_slow"] },
    meter: { numbers: ["beats_per_bar_estimate"], texts: ["meter"] },
    harmony: { texts: ["key", "mode", "major_minor"] },
    functional_harmony: { numbers: ["harmonic_rhythm_chords_per_bar"], texts: ["narrative", "borrowed_narrative"], values: ["functions_summary", "recognized_progressions", "cadences", "borrowed_chords", "secondary_dominants"] },
    note_density: { numbers: ["onsets", "onsets_per_sec"] },
    dynamics: { numbers: ["rms_db", "peak_db", "dynamic_range_db", "chorus_verse_delta_db"], texts: ["narrative"], values: ["level_hist", "crescendos", "diminuendos", "section_levels"] },
    production: { numbers: ["spectral_tilt_db_per_oct", "low_end_clarity", "loudness_proxy_db", "stereo_width"], texts: ["narrative"], values: ["spectral_balance"] },
    groove: { texts: ["narrative"], values: ["tempo_stability", "swing", "syncopation"] },
    tempo_drift: { numbers: ["total_bpm_change", "front_bpm", "back_bpm"], texts: ["direction", "narrative"] },
    bass_line: { numbers: ["smoothness_stepwise_ratio", "avg_motion_semitones", "leap_count", "chord_root_consistency"], texts: ["pattern", "narrative"] },
    voicing: { numbers: ["root_position_ratio", "inversion_variety", "bass_motion_stepwise_ratio", "common_tone_retention"], texts: ["narrative"], values: ["slash_chords"] },
    melody: { numbers: ["voiced_ratio", "pitch_center_hz", "pitch_min_hz", "pitch_max_hz", "pitch_mean_hz", "ambitus_semitones", "pitch_stability_semitones", "vibrato_est_hz"], texts: ["pitch_center_note", "pitch_min_note", "pitch_max_note", "note"] },
    timbre: { numbers: ["spectral_centroid_mean_hz", "spectral_bandwidth_mean_hz", "spectral_rolloff_mean_hz", "zero_crossing_rate_mean", "spectral_flatness_mean"], values: ["mfcc_means"] },
    emotion: { numbers: ["valence", "arousal"], texts: ["quadrant"], values: ["tags"] },
    combined_emotion: { numbers: ["valence", "arousal"], texts: ["quadrant"], values: ["tags"] },
    genre: { texts: ["top_genre", "profile"], values: ["candidates"] },
    lyrics: { numbers: ["line_count", "hook_repeat_count"], texts: ["text"], values: ["hooks", "sentiment"] },
    lyrics_deep: { numbers: ["imagery_density"], texts: ["profile"], values: ["refrains", "sentiment_trajectory"] },
    tension_curve: { texts: ["narrative"], values: ["peak"] }
};
const ANALYSIS_METADATA_FIELDS = new Set(["status", "error", "code", "message", "detail", "success", "confidence", "file", "duration_sec"]);

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasAnalysisValue(value) {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return Boolean(value.trim());
    if (Array.isArray(value)) return value.some(hasAnalysisValue);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, item]) => !ANALYSIS_METADATA_FIELDS.has(key) && hasAnalysisValue(item));
}

function hasUsefulAnalysis(analysis) {
    if (!isRecord(analysis)) return false;
    const narrative = analysis.overall_narrative;
    if (typeof narrative === "string" && narrative.trim()) return true;
    if (isRecord(narrative) && (["opening", "full", "verdict"].some(key => typeof narrative[key] === "string" && narrative[key].trim()) || (Array.isArray(narrative.highlights) && narrative.highlights.some(value => typeof value === "string" && value.trim())))) return true;
    if (["chord_progression", "structure", "key_changes", "motifs", "style_hints"].some(key => Array.isArray(analysis[key]) && analysis[key].some(hasAnalysisValue))) return true;
    return Object.entries(ANALYSIS_FIELDS).some(([key, fields]) => {
        const section = analysis[key];
        if (!isRecord(section)) return false;
        if ((fields.numbers || []).some(field => typeof section[field] === "number" && Number.isFinite(section[field]) && (!["tempo_bpm", "bpm", "beats_per_bar_estimate"].includes(field) || section[field] > 0))) return true;
        if ((fields.texts || []).some(field => typeof section[field] === "string" && section[field].trim() && section[field].trim().toLowerCase() !== "unknown")) return true;
        return (fields.values || []).some(field => (isRecord(section[field]) || Array.isArray(section[field])) && hasAnalysisValue(section[field]));
    });
}

function cancelBody(body) {
    try { Promise.resolve(body?.cancel?.()).catch(() => {}); } catch { /* The body may already be consumed or locked. */ }
}

async function externalStage(timeoutMs, timeoutCode, interruptedCode, task) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(requestError(504, timeoutCode, "外部音乐服务等待超时，请稍后核对分析结果或重试。"));
        }, timeoutMs);
        timer.unref?.();
    });
    try {
        return await Promise.race([task(controller.signal), deadline]);
    } catch (error) {
        if (controller.signal.aborted || error?.name === "TimeoutError") throw requestError(504, timeoutCode, "外部音乐服务等待超时，请稍后核对分析结果或重试。");
        if (error?.code && error?.status) throw error;
        throw requestError(502, interruptedCode, "外部音乐服务连接或响应读取中断，请核对结果后重试。");
    } finally {
        clearTimeout(timer);
    }
}

async function limitedAudioBuffer(response, signal) {
    const length = response.headers?.get?.("content-length") || "";
    if (/^\d+$/.test(length) && BigInt(length) > BigInt(MAX_AUDIO_BYTES)) {
        cancelBody(response.body);
        throw requestError(413, "music_audio_too_large", "这首歌的音频太大，暂时不能分析。");
    }
    if (!response.body?.getReader) throw requestError(502, "netease_audio_download_failed", "音频暂时无法下载，请稍后重试。");
    const reader = response.body.getReader();
    const cancel = () => cancelBody(reader);
    signal.addEventListener("abort", cancel, { once: true });
    let total = 0;
    const chunks = [];
    try {
        if (signal.aborted) {
            cancel();
            throw new DOMException("Audio download aborted", "AbortError");
        }
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_AUDIO_BYTES) throw requestError(413, "music_audio_too_large", "这首歌的音频太大，暂时不能分析。");
            chunks.push(Buffer.from(value));
        }
        if (!total) throw requestError(502, "netease_audio_download_failed", "音频暂时无法下载，请稍后重试。");
        return Buffer.concat(chunks, total);
    } catch (error) {
        if (!signal.aborted) cancel();
        throw error;
    } finally {
        signal.removeEventListener("abort", cancel);
        try { reader.releaseLock(); } catch { /* An aborted reader can still have a pending read. */ }
    }
}

const CASUAL_TIER_INSTRUCTION = [
    "【音乐理解 · 普通听歌爱好者档】",
    "你正在和用户一起听一首歌。用普通听歌爱好者的口吻聊对这首歌的理解：",
    "说人话：好不好听、抓不抓耳、情绪是什么感觉、适合什么时候听；",
    "可以提到旋律、节奏、歌词里最打动人、最上头的点，但不要堆专业术语；",
    "如果必须提到专业名词（如 BPM、调性），要用一句大白话解释它是什么意思；",
    "结合用户的个性化指令、你的详情与当前对话自然接话，不要写成考试答案或乐评专栏；",
    "长度 2 到 5 句，口语化，像朋友分享听后感。"
].join("\n");

const EXPERT_TIER_INSTRUCTION = [
    "【音乐理解 · 专家级档】",
    "你以音乐人/乐评人的视角解读正在一起听的这首歌，把下面的结构化分析数据翻译成专业、有温度的鉴赏语言：",
    "1. 基本面：速度、拍号、调性（含置信度）、流派候选与风格气质；",
    "2. 和声与旋律：和弦进行与调内级数、功能组/经典进行/终止式/离调色彩、低音线条与声部写法；旋律音域与稳定度（数据不可靠时明确说明）；",
    "3. 曲式结构：主歌/副歌/桥段骨架与能量如何累积释放；",
    "4. 编曲与制作：动态范围、立体声宽度、亮度、律动（速度稳定性/摇摆/切分）与制作签名；",
    "5. 情绪与歌词：综合情绪、情感轨迹、意象密度与反复 hook；",
    "6. 收尾：一句话判断 + 适合场景。",
    "要求：引用数据但不罗列数字，把数字翻译成听感语言；延续个性化指令与你的详情决定的人设和语气；",
    "不虚构数据里没有的结论；总长控制在 300 到 500 字。"
].join("\n");

function buildTierInstruction(tier) {
    return tier === "expert" ? EXPERT_TIER_INSTRUCTION : CASUAL_TIER_INSTRUCTION;
}

function buildAnalysisUserMessage({ title, artist, tier, condensed, lyrics }) {
    const parts = [];
    parts.push(`用户正在听的歌：${cleanText(title, 300) || "未知曲目"}${artist ? ` · ${cleanText(artist, 300)}` : ""}`);
    if (tier === "casual") {
        if (lyrics) {
            parts.push("【歌词原文（截取前 2400 字）】\n" + cleanText(lyrics, 2400));
        } else {
            parts.push("这首歌暂时没有可读取的歌词，请结合曲名、歌手和常识感受来聊。");
        }
    } else {
        parts.push("【歌词原文（截取前 1600 字）】\n" + (cleanText(lyrics, 1600) || "（无歌词）"));
        parts.push("【声学与结构分析数据】\n" + JSON.stringify(condensed));
    }
    parts.push("请现在给出你对这首歌的理解。");
    return parts.join("\n\n");
}

function createMusicUnderstandingService({
    database,
    env = process.env,
    fetchImpl = globalThis.fetch,
    getSettings,
    qrLoginService
} = {}) {
    const qr =
        qrLoginService ||
        createNeteaseQrLoginService({ database, env, fetchImpl });
    const analysisQueues = new Map();
    const analysisProgress = new Map();

    function progressKey(scope, providerTrackId) {
        return JSON.stringify([scope.userId, scope.companionId, providerTrackId]);
    }

    function pruneProgress() {
        const now = Date.now();
        for (const [key, progress] of analysisProgress) {
            if (now - progress.updatedMs >= STATUS_TTL_MS) analysisProgress.delete(key);
        }
    }

    function storeProgress(key, progress) {
        pruneProgress();
        analysisProgress.delete(key);
        while (analysisProgress.size >= MAX_STATUS_ENTRIES) analysisProgress.delete(analysisProgress.keys().next().value);
        analysisProgress.set(key, progress);
    }

    function updateProgress(key, progress, fields) {
        if (analysisProgress.get(key) !== progress) return;
        Object.assign(progress, fields, { updated_at: new Date().toISOString(), updatedMs: Date.now() });
        storeProgress(key, progress);
    }

    function voiceEndpoint() {
        const base = String(env.HERVOICE_URL || "").trim().replace(/\/$/, "");
        if (!base) {
            throw requestError(503, "music_understanding_voice_unconfigured", "音乐理解服务还没有配置，请先部署语音分析服务。");
        }
        return base;
    }

    async function cachedUnderstanding(scope, providerTrackId, { requireSchema = false } = {}) {
        const db = scope?.db || database;
        const { data, error } = await db
            .from("music_understandings")
            .select("*")
            .eq("user_id", scope.userId)
            .eq("companion_id", scope.companionId)
            .eq("provider_track_id", providerTrackId)
            .maybeSingle();
        if (error?.code === "42P01" && !requireSchema) return null;
        if (error) throw error;
        if (!data) return null;
        if (!hasUsefulAnalysis(data.analysis)) throw requestError(409, "music_understanding_cached_invalid", "已保存的音乐分析暂时不可用，请主动重新分析并保存以替换失效结果。");
        return {
            cached: true,
            provider_track_id: providerTrackId,
            title: cleanText(data.title, 300),
            artist: cleanText(data.artist, 300),
            analysis: data.analysis && typeof data.analysis === "object" ? data.analysis : {}
        };
    }

    async function analyze(scope, input = {}) {
        const providerTrackId = String(input.provider_track_id ?? input.track_id ?? "").trim();
        if (!DECIMAL_ID.test(providerTrackId)) {
            throw requestError(400, "music_track_id_invalid", "歌曲编号格式不正确。");
        }
        const key = progressKey(scope, providerTrackId);
        const now = new Date().toISOString();
        const progress = { state: "running", stage: "queued", started_at: now, updated_at: now, updatedMs: Date.now(), error_code: null, http_status: null };
        if (!analysisQueues.has(key)) storeProgress(key, progress);
        // Recheck the cache after any earlier same-song request has finished, including failed repairs.
        const operation = (analysisQueues.get(key) || Promise.resolve())
            .catch(() => {})
            .then(async () => {
                storeProgress(key, progress);
                const stage = value => updateProgress(key, progress, { state: "running", stage: value, error_code: null, http_status: null });
                stage("preparing");
                try {
                    const result = await analyzeTrack(scope, input, providerTrackId, stage);
                    updateProgress(key, progress, { state: "saved", stage: null });
                    return result;
                } catch (error) {
                    updateProgress(key, progress, {
                        state: "failed", stage: null,
                        error_code: PUBLIC_ANALYSIS_ERRORS.has(error?.code) ? error.code : "music_understanding_failed",
                        http_status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null
                    });
                    throw error;
                }
            });
        analysisQueues.set(key, operation);
        try {
            return await operation;
        } finally {
            if (analysisQueues.get(key) === operation) analysisQueues.delete(key);
        }
    }

    async function analyzeTrack(scope, input, providerTrackId, stage) {
        const existing = await cachedUnderstanding(scope, providerTrackId).catch(error => {
            if (error?.code === "music_understanding_cached_invalid" && input.reanalyze_invalid_cache === true) return null;
            throw error;
        });
        if (existing) return existing;

        const title = cleanText(input.title, 300);
        const artist = cleanText(input.artist, 300);

        const playback = await qr.songUrl(scope, providerTrackId);
        if (!playback.url) {
            throw requestError(502, "netease_song_url_unavailable", "这首歌因为版权或会员限制暂时拿不到音频，专家级分析无法进行；普通爱好者档仍可用。");
        }
        const lyricsResult = await qr.lyric(scope, providerTrackId).catch(() => ({ lyric: "", translated_lyric: "" }));

        stage("downloading");
        const audioBuffer = await externalStage(AUDIO_DOWNLOAD_TIMEOUT_MS, "netease_audio_download_timeout", "netease_audio_download_interrupted", async signal => {
            const audioResponse = await fetchImpl(playback.url, {
                method: "GET",
                headers: {
                    Referer: "https://music.163.com/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                },
                signal
            });
            if (!audioResponse.ok) {
                cancelBody(audioResponse.body);
                throw requestError(502, "netease_audio_download_failed", "音频暂时无法下载，请稍后重试。");
            }
            return limitedAudioBuffer(audioResponse, signal);
        });

        const form = new FormData();
        form.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), `${providerTrackId}.mp3`);
        form.append("lyrics", String(lyricsResult.lyric || ""));
        form.append("translated_lyrics", String(lyricsResult.translated_lyric || ""));

        stage("analyzing");
        const condensed = await externalStage(VOICE_ANALYZE_TIMEOUT_MS, "music_understanding_voice_timeout", "music_understanding_voice_interrupted", async signal => {
            const voiceResponse = await fetchImpl(`${voiceEndpoint()}/api/music/analyze`, {
                method: "POST",
                headers: {
                    "X-Hervoice-Secret": String(env.HERVOICE_SECRET || "")
                },
                body: form,
                signal
            });
            if (!voiceResponse.ok) {
                cancelBody(voiceResponse.body);
                throw requestError(502, "music_understanding_voice_failed", `音乐理解服务暂时失败（HTTP ${voiceResponse.status}），请稍后重试。`);
            }
            const cancel = () => cancelBody(voiceResponse.body);
            signal.addEventListener("abort", cancel, { once: true });
            try {
                if (signal.aborted) {
                    cancel();
                    throw new DOMException("Music analysis aborted", "AbortError");
                }
                let raw;
                try { raw = await voiceResponse.json(); } catch (error) {
                    if (error instanceof SyntaxError) throw requestError(502, "music_understanding_invalid_response", "音乐分析服务返回的结果格式不正确，本次结果未保存。");
                    throw error;
                }
                if (!isRecord(raw) || raw.error || (raw.status !== undefined && raw.status !== "ok")) throw requestError(502, "music_understanding_invalid_response", "音乐分析服务返回的结果格式不正确，本次结果未保存。");
                const analysis = Object.hasOwn(raw, "analysis") ? raw.analysis : raw;
                if (!isRecord(analysis)) throw requestError(502, "music_understanding_invalid_response", "音乐分析服务返回的结果格式不正确，本次结果未保存。");
                const condensed = condensedAnalysis(analysis);
                if (!hasUsefulAnalysis(condensed)) throw requestError(502, "music_understanding_empty_analysis", "音乐分析服务没有返回可用指标或摘要，本次结果未保存。");
                return condensed;
            } finally {
                signal.removeEventListener("abort", cancel);
            }
        });

        const values = {
            user_id: scope.userId,
            companion_id: scope.companionId,
            provider_track_id: providerTrackId,
            title,
            artist,
            analysis: condensed,
            updated_at: new Date().toISOString()
        };
        stage("saving");
        const upsert = await (scope?.db || database)
            .from("music_understandings")
            .upsert(values, { onConflict: "user_id,companion_id,provider_track_id" })
            .select("*")
            .maybeSingle();
        if (upsert.error) throw upsert.error;

        return {
            cached: false,
            provider_track_id: providerTrackId,
            title,
            artist,
            analysis: condensed
        };
    }

    async function narrate(scope, input = {}) {
        const tier = String(input.tier || "casual").trim().toLowerCase();
        if (!TIERS.has(tier)) {
            throw requestError(400, "music_tier_invalid", "音乐理解档位只能是 casual 或 expert。");
        }
        const providerTrackId = String(input.provider_track_id ?? input.track_id ?? "").trim();
        if (!DECIMAL_ID.test(providerTrackId)) {
            throw requestError(400, "music_track_id_invalid", "歌曲编号格式不正确。");
        }
        let title = cleanText(input.title, 300);
        let artist = cleanText(input.artist, 300);

        // 元数据兜底：没传歌名/歌手时用网易云公开接口补齐（无需登录）。
        if (!title || !artist) {
            const meta = await fetchSongMetadata(providerTrackId).catch(() => null);
            if (meta) {
                title = title || meta.title;
                artist = artist || meta.artist;
            }
        }
        if (!title) title = `网易云单曲 ${providerTrackId}`;

        const lyricsResult = await qr
            .lyric(scope, providerTrackId)
            .then((result) => result.lyric)
            .catch(() => "")
            .then((lyric) =>
                lyric
                    ? lyric
                    : fetchSongLyrics(providerTrackId)
                          .then((result) => result.lyric)
                          .catch(() => "")
            );

        let understanding = null;
        if (tier === "expert") {
            understanding = await analyze(scope, {
                provider_track_id: providerTrackId,
                title,
                artist
            });
        }

        const settings = await getSettings(scope.db);
        if (!settings?.model || !settings?.runtime_api_key) {
            throw requestError(503, "music_understanding_model_unconfigured", "还没有配置可用的聊天模型，暂时无法生成音乐解读。");
        }

        const generated = await generateReply({
            settings,
            messages: [
                {
                    role: "user",
                    content: buildAnalysisUserMessage({
                        title,
                        artist,
                        tier,
                        condensed: understanding?.analysis || {},
                        lyrics: lyricsResult
                    })
                }
            ],
            memories: [],
            runtimeContext: "",
            turnContext: "",
            promptArchitecture: "legacy-special",
            systemInstructionsOverride: buildTierInstruction(tier)
        });

        return {
            tier,
            narration: String(generated?.text || "").trim(),
            understanding: understanding
                ? {
                      cached: understanding.cached,
                      title: understanding.title,
                      artist: understanding.artist,
                      analysis: understanding.analysis
                  }
                : null
        };
    }

    async function read(scope, providerTrackId) {
        if (!DECIMAL_ID.test(String(providerTrackId || ""))) {
            throw requestError(400, "music_track_id_invalid", "歌曲编号格式不正确。");
        }
        const existing = await cachedUnderstanding(scope, String(providerTrackId));
        if (!existing) {
            throw requestError(404, "music_understanding_not_found", "这首歌还没有分析结果。");
        }
        return existing;
    }

    async function readStatus(scope, trackId) {
        const providerTrackId = String(trackId ?? "").trim();
        if (!DECIMAL_ID.test(providerTrackId)) throw requestError(400, "music_track_id_invalid", "歌曲编号格式不正确。");
        let understanding = null, invalidCache = false;
        try {
            understanding = await cachedUnderstanding(scope, providerTrackId, { requireSchema: true });
        } catch (error) {
            if (error?.code === "music_understanding_cached_invalid") invalidCache = true;
            else throw requestError(503, "music_understanding_status_unavailable", "暂时无法核对音乐分析进度，请稍后重新读取状态。");
        }
        pruneProgress();
        const progress = analysisProgress.get(progressKey(scope, providerTrackId));
        const receipt = {
            provider_track_id: providerTrackId, state: "unknown", stage: null,
            started_at: progress?.started_at || null, updated_at: progress?.updated_at || null,
            error_code: null, http_status: null, understanding: null
        };
        if (understanding) return { ...receipt, state: "saved", understanding };
        if (progress?.state === "running") return { ...receipt, state: "running", stage: progress.stage };
        if (progress?.state === "failed") return { ...receipt, state: "failed", error_code: progress.error_code, http_status: progress.http_status };
        if (invalidCache) return { ...receipt, state: "invalid_cache", error_code: "music_understanding_cached_invalid", http_status: 409 };
        return receipt;
    }

    return { analyze, narrate, read, readStatus };
}

module.exports = {
    buildAnalysisUserMessage,
    buildTierInstruction,
    condensedAnalysis,
    createMusicUnderstandingService
};

import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { coWatchRequestOptions } from "./co-watch-request-scope.js";
import { assertMusicScope, captureMusicScope } from "./music-request-scope.js";

const TRACK_ID = /^\d{1,20}$/;
const LOG_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const ROOT = "/api/v2/music/understanding";
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
  tension_curve: { texts: ["narrative"], values: ["peak"] },
};
const ANALYSIS_METADATA_FIELDS = new Set(["status", "error", "code", "message", "detail", "success", "confidence", "file", "duration_sec"]);
const analysisOperations = new Map(), operationListeners = new Map();
let analysisGeneration = 0;

export const MUSIC_UNDERSTANDING_FEEDBACK = Object.freeze({
  music_track_id_invalid: { reason: "这首歌没有有效的网易云歌曲编号。", action: "从网易云单曲或歌单导入后，选择一首歌再使用音乐理解；本地曲目编号不能代替网易云编号。" },
  music_scope_changed: { reason: "账号、伴侣或页面已切换，旧操作已取消。", action: "在当前一起听页面重新选择歌曲。" },
  co_watch_scope_changed: { reason: "当前登录身份与这次操作不一致。", action: "刷新当前页面并检查账号和伴侣后重试。" },
  music_understanding_receipt_invalid: { reason: "服务器没有返回可确认的音乐分析回执。", action: "先读取已保存分析，核对这首歌的结果；不要连续重复分析。" },
  music_understanding_status_invalid: { reason: "服务器返回的分析进度格式无法确认。", action: "读取已保存分析核对；本次不会自动恢复分析或重复提交。" },
  music_understanding_status_unavailable: { reason: "当前服务器无法提供分析进度。", action: "读取已保存分析核对，或稍后再次查看进度；结果不明时不要连续重复分析。" },
  music_narration_receipt_invalid: { reason: "服务器没有返回有效的音乐解读正文或档位。", action: "可重新生成解读；已确认保存的分析仍保留。" },
  music_understanding_not_found: { reason: "本次读取没有找到这首歌的保存分析。", action: "此前服务器任务仍可能执行，读取不到不代表任务已停止。先核对服务器状态再明确恢复入口；重试可能重复耗用。没有待确认操作时可主动分析。" },
  music_understanding_timeout: { reason: "等待完整响应超时，结果尚未确认。", action: "分析请求可能仍在服务器处理，请先读取已保存分析核对；本次不会自动重复请求。" },
  music_understanding_cancelled: { reason: "本次等待已取消。", action: "取消等待不能撤回服务器已接收的分析，请先读取已保存分析核对。" },
  music_understanding_failed: { reason: "音乐理解请求未成功，具体原因尚未确认。", action: "检查网络及接口设置。分析结果不明时，先读取已保存分析核对。" },
  music_understanding_voice_unconfigured: { reason: "服务器尚未配置音乐音频分析服务。", action: "联系管理员检查语音分析服务配置；普通歌曲解读可单独尝试。" },
  music_understanding_voice_failed: { reason: "外部音频分析服务返回失败。", action: "先读取已保存分析核对，再检查分析服务是否可用。" },
  music_understanding_invalid_response: { reason: "音乐分析服务返回的格式无法读取。", action: "先读取已保存分析核对，并检查分析服务的响应格式；不会把这次响应保存为有效分析。" },
  music_understanding_empty_analysis: { reason: "音乐分析服务没有返回有效的分析内容。", action: "先读取已保存分析核对，检查音频及分析服务；无效结果不会替换已保存资料。" },
  music_understanding_cached_invalid: { reason: "这首歌已保存的分析缓存已失效，未自动改写。", action: "核对当前歌曲后，可主动“重新分析并保存”以替换失效缓存。若此前操作结果不明，先明确恢复入口；后台任务仍可能执行，重试可能重复耗用。" },
  netease_audio_download_timeout: { reason: "网易云歌曲音频下载超时。", action: "检查歌曲权限与网络，先读取已保存分析核对；本次不会自动重复分析。" },
  netease_audio_download_interrupted: { reason: "网易云歌曲音频下载连接中断。", action: "检查网络和歌曲音频是否可访问，先读取已保存分析核对，再决定是否主动重试。" },
  music_understanding_voice_timeout: { reason: "音乐分析服务响应超时。", action: "分析服务可能仍在处理，请先读取已保存分析核对；取消等待不能撤回后台请求。" },
  music_understanding_voice_interrupted: { reason: "音乐分析服务连接中断。", action: "先读取已保存分析核对，检查分析服务状态；结果不明时不要连续重复分析。" },
  music_understanding_model_unconfigured: { reason: "当前账号尚未配置可用的聊天模型。", action: "在接口与模型设置中选择可用模型；已经保存的分析不会因此删除。" },
  netease_song_url_unavailable: { reason: "网易云暂时无法提供这首歌的可分析音频，可能受版权或会员权限影响。", action: "检查网易云登录状态，或选择另一首歌；普通解读仍可单独尝试。" },
  netease_audio_download_failed: { reason: "网易云歌曲音频下载失败。", action: "检查网络与歌曲权限，再读取已保存分析核对。" },
  music_audio_too_large: { reason: "这首歌的音频超过分析服务容量。", action: "选择较短的曲目；这项容量与聊天附件容量不同。" },
  music_understanding_schema_required: { reason: "服务器数据库尚未准备好音乐分析存储。", action: "联系管理员检查音乐分析数据库迁移；不要连续重复分析。" },
  insufficient_quota: { reason: "模型接口余额或可用额度不足。", action: "检查 API 余额、额度和计费状态后再生成解读。" },
  provider_balance_insufficient: { reason: "API 账户余额不足。", action: "检查当前供应商余额，充值或切换有余额的接口后再生成解读。已保存的分析仍保留。" },
  provider_quota_exhausted: { reason: "API 可用额度或账单上限已耗尽。", action: "检查供应商用量和账单限额，恢复额度后再生成解读。" },
  provider_rate_limited: { reason: "模型接口限制了请求频率或并发。", action: "等待片刻并检查供应商并发限额，再主动生成解读。" },
  provider_authentication_failed: { reason: "模型接口未通过 API 身份验证。", action: "在接口与模型设置中检查密钥、地址及有效期。" },
  provider_permission_denied: { reason: "模型供应商拒绝了当前账号的访问权限。", action: "检查该模型的账号、区域和接口权限，再生成解读。" },
  provider_model_unavailable: { reason: "请求的模型或接口地址不可用。", action: "在接口与模型设置中选择可用模型并检查接口地址。" },
  provider_timeout: { reason: "模型供应商或中转网关响应超时。", action: "检查供应商状态，稍后主动生成解读；分析结果不明时先读取核对。" },
  provider_unavailable: { reason: "模型供应商或中转网关暂时出错。", action: "查看 HTTP 和日志，等待服务恢复或切换可用接口。" },
  invalid_api_key: { reason: "模型接口密钥未通过验证。", action: "在接口与模型设置中检查密钥。" },
  authentication_required: { reason: "当前操作需要重新登录。", action: "重新登录后在当前账号和伴侣下读取已保存分析。" },
  invalid_session: { reason: "登录会话已失效。", action: "重新登录后再操作。" },
  request_timeout: { reason: "服务器请求超时，结果尚未确认。", action: "检查网络，分析操作请先读取已保存分析核对。" },
});

function fault(code, status) {
  return Object.assign(new Error(code), { code, ...(status ? { status } : {}), error_source: "dengta" });
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const metadata = value => typeof value === "string" ? value.trim().slice(0, 300) : "";
export function validMusicTrackId(value) {
  return typeof value === "string" && TRACK_ID.test(value.trim());
}
export function musicUnderstandingScopeKey({ accountScope, companionScope } = {}) {
  return JSON.stringify([accountScope || "", companionScope || ""]);
}
export function musicUnderstandingViewKey(props = {}) {
  return JSON.stringify([props.accountScope || "", props.companionScope || "", props.sessionScope || "", props.providerTrackId || ""]);
}
// Keep only operation metadata while the application remains open, including when a track or session remounts its panel.
export function createMusicAnalysisRecovery(scope, providerTrackId) {
  const key = JSON.stringify([scope.accountScope || "", scope.companionScope || "", String(providerTrackId || "").trim()]);
  const emit = () => operationListeners.get(key)?.forEach(listener => listener());
  const matches = ticket => ticket && analysisOperations.get(key)?.generation === ticket.generation;
  return {
    getSnapshot: () => analysisOperations.get(key) || null,
    subscribe(listener) {
      const listeners = operationListeners.get(key) || new Set(); listeners.add(listener); operationListeners.set(key, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) operationListeners.delete(key); };
    },
    begin() {
      if (analysisOperations.has(key)) return null;
      const ticket = Object.freeze({ generation: ++analysisGeneration, startedAt: Date.now(), phase: "pending", canRestore: false });
      analysisOperations.set(key, ticket); emit(); return ticket;
    },
    uncertain(ticket) {
      if (!matches(ticket)) return;
      analysisOperations.set(key, Object.freeze({ ...analysisOperations.get(key), phase: "unconfirmed" })); emit();
    },
    confirm(ticket) { if (matches(ticket)) { analysisOperations.delete(key); emit(); } },
    reviewing(ticket) {
      if (!matches(ticket)) return;
      analysisOperations.set(key, Object.freeze({ ...analysisOperations.get(key), canRestore: false })); emit();
    },
    reviewedMissing(ticket) {
      if (!matches(ticket)) return;
      analysisOperations.set(key, Object.freeze({ ...analysisOperations.get(key), phase: "unconfirmed", canRestore: true })); emit();
    },
    restore(ticket) {
      if (analysisOperations.get(key) !== ticket || !ticket?.canRestore) return false;
      analysisOperations.delete(key); emit(); return true;
    },
  };
}
function hasAnalysisValue(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasAnalysisValue);
  if (!object(value)) return false;
  return Object.entries(value).some(([key, item]) => !ANALYSIS_METADATA_FIELDS.has(key) && hasAnalysisValue(item));
}
function analysisValid(value) {
  if (!object(value)) return false;
  const narrative = value.overall_narrative;
  if (typeof narrative === "string" && narrative.trim()) return true;
  if (object(narrative) && (["opening", "full", "verdict"].some(key => typeof narrative[key] === "string" && narrative[key].trim()) || (Array.isArray(narrative.highlights) && narrative.highlights.some(item => typeof item === "string" && item.trim())))) return true;
  if (["chord_progression", "structure", "key_changes", "motifs", "style_hints"].some(key => Array.isArray(value[key]) && value[key].some(hasAnalysisValue))) return true;
  return Object.entries(ANALYSIS_FIELDS).some(([key, fields]) => {
    const section = value[key];
    if (!object(section)) return false;
    if ((fields.numbers || []).some(field => typeof section[field] === "number" && Number.isFinite(section[field]) && (!["tempo_bpm", "bpm", "beats_per_bar_estimate"].includes(field) || section[field] > 0))) return true;
    if ((fields.texts || []).some(field => typeof section[field] === "string" && section[field].trim() && section[field].trim().toLowerCase() !== "unknown")) return true;
    return (fields.values || []).some(field => (object(section[field]) || Array.isArray(section[field])) && hasAnalysisValue(section[field]));
  });
}
function validateUnderstanding(value, providerTrackId, nested = false) {
  if (!object(value) || typeof value.cached !== "boolean" || typeof value.title !== "string" || typeof value.artist !== "string" || !analysisValid(value.analysis) || (!nested && value.provider_track_id !== providerTrackId)) {
    throw fault("music_understanding_receipt_invalid");
  }
  return { cached: value.cached, provider_track_id: providerTrackId, title: value.title, artist: value.artist, analysis: value.analysis };
}

export function musicUnderstandingFailure(error) {
  const code = CODE.test(error?.code || "") ? error.code : "music_understanding_failed";
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
  const logId = LOG_ID.test(error?.error_log_id || "") ? error.error_log_id : null;
  const feedback = MUSIC_UNDERSTANDING_FEEDBACK[code] || (status === 401 || status === 403 ? MUSIC_UNDERSTANDING_FEEDBACK.authentication_required : MUSIC_UNDERSTANDING_FEEDBACK.music_understanding_failed);
  return { code, status, logId, reason: feedback.reason, action: feedback.action,
    diagnostic: { error_code: code, ...(status ? { upstream_status: status } : {}), ...(error?.error_source === "dengta" ? { error_source: "dengta" } : {}) } };
}

export function musicAnalysisSummary(analysis) {
  const overall = analysis?.overall_narrative;
  if (typeof overall === "string" && overall.trim()) return overall;
  if (object(overall)) {
    if (typeof overall.full === "string" && overall.full.trim()) return overall.full;
    return [overall.opening, ...(Array.isArray(overall.highlights) ? overall.highlights : []), overall.verdict].filter(value => typeof value === "string" && value.trim()).join("\n\n");
  }
  return "分析已保存。展开下方结构与指标，或主动生成专业解读。";
}
export function musicAnalysisDetails(analysis = {}) {
  const scalar = value => typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? String(value) : "";
  return [
    ["时长（秒）", scalar(analysis.duration_sec)],
    ["速度（BPM）", scalar(analysis.rhythm?.tempo_bpm)],
    ["速度感", scalar(analysis.rhythm?.fast_slow)],
    ["拍号估计", scalar(analysis.meter?.meter)],
    ["拍号置信度", scalar(analysis.meter?.confidence)],
    ["调性", [scalar(analysis.harmony?.key), scalar(analysis.harmony?.mode)].filter(Boolean).join(" ")],
    ["调性置信度", scalar(analysis.harmony?.key_score)],
    ["流派候选", scalar(analysis.genre?.top_genre)],
    ["情绪", scalar(analysis.combined_emotion?.quadrant || analysis.emotion?.quadrant)],
    ...[["和声", "functional_harmony"], ["动态", "dynamics"], ["制作", "production"], ["律动", "groove"], ["速度变化", "tempo_drift"], ["低音", "bass_line"], ["声部", "voicing"], ["张力", "tension_curve"]].map(([label, key]) => [label, scalar(analysis[key]?.narrative)]),
  ].filter(([, value]) => value !== "");
}

// The deadline includes authentication, transport and JSON decoding; apiRequest's transport timer alone does not cover all three.
export async function withMusicUnderstandingDeadline(action, { signal, timeoutMs = 180_000 } = {}) {
  const controller = new AbortController();
  let timer, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const cancel = () => { rejectAbort(signal?.reason || fault("music_understanding_cancelled")); controller.abort(signal?.reason); };
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (controller.signal.aborted) return await aborted;
    timer = setTimeout(() => { const error = fault("music_understanding_timeout"); rejectAbort(error); controller.abort(error); }, timeoutMs);
    return await Promise.race([Promise.resolve().then(() => action(controller.signal)), aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

async function request(path, input, options, validate, timeoutMs) {
  const scope = captureMusicScope(options, authSession);
  if (!scope.accountScope || !scope.companionScope) throw fault("music_scope_changed");
  assertMusicScope(scope, authSession);
  const value = await withMusicUnderstandingDeadline(async signal => {
    const requestOptions = coWatchRequestOptions({ ...scope, signal }, authSession);
    let authFailure;
    const scopedAuth = { ...requestOptions.authSession, async getRequestContext() {
      try { return await requestOptions.authSession.getRequestContext(); }
      catch (error) { authFailure = error; throw error; }
    } };
    let data;
    try { data = await apiRequest(path, { ...input, retry: false, ...requestOptions, authSession: scopedAuth }); }
    catch (error) { assertMusicScope({ ...scope, signal }, authSession); throw authFailure || error; }
    assertMusicScope({ ...scope, signal }, authSession);
    return validate(data);
  }, { signal: scope.signal, timeoutMs });
  assertMusicScope(scope, authSession);
  return value;
}
function track(input = {}) {
  if (!validMusicTrackId(input.providerTrackId)) throw fault("music_track_id_invalid");
  return { provider_track_id: input.providerTrackId.trim(), title: metadata(input.title), artist: metadata(input.artist) };
}
export function analyzeMusicUnderstandingUi(input, options = {}) {
  const body = track(input);
  if (input.reanalyze_invalid_cache === true) body.reanalyze_invalid_cache = true;
  return request(`${ROOT}/analyze`, { method: "POST", body: JSON.stringify(body) }, options, data => validateUnderstanding(data?.understanding, body.provider_track_id), 180_000);
}
export function readMusicUnderstandingUi(providerTrackId, options = {}) {
  const body = track({ providerTrackId });
  return request(`${ROOT}/tracks/${encodeURIComponent(body.provider_track_id)}`, {}, options, data => validateUnderstanding(data?.understanding, body.provider_track_id), 12_000);
}
export async function readMusicUnderstandingStatus(providerTrackId, options = {}) {
  const body = track({ providerTrackId });
  try {
    return await request(`${ROOT}/tracks/${encodeURIComponent(body.provider_track_id)}/status`, {}, options, data => {
      const value = data?.status;
      const date = item => item === null || (typeof item === "string" && Number.isFinite(Date.parse(item)) && new Date(item).toISOString() === item);
      const running = value?.state === "running", failed = value?.state === "failed", invalidCache = value?.state === "invalid_cache";
      if (!object(value) || value.provider_track_id !== body.provider_track_id || !["running", "saved", "failed", "invalid_cache", "unknown"].includes(value.state)
        || (running ? !["queued", "preparing", "downloading", "analyzing", "saving"].includes(value.stage) : value.stage !== null)
        || !date(value.started_at) || !date(value.updated_at) || (running && (!value.started_at || !value.updated_at))
        || (invalidCache ? value.error_code !== "music_understanding_cached_invalid" || value.http_status !== 409 : failed ? !Object.hasOwn(MUSIC_UNDERSTANDING_FEEDBACK, value.error_code) : value.error_code !== null)
        || (value.http_status !== null && (!(failed || invalidCache) || !Number.isInteger(value.http_status) || value.http_status < 400 || value.http_status > 599))
        || (value.state !== "saved" && value.understanding !== null)) throw fault("music_understanding_status_invalid");
      let understanding = null;
      if (value.state === "saved") {
        try { understanding = validateUnderstanding(value.understanding, body.provider_track_id); }
        catch { throw fault("music_understanding_status_invalid"); }
        if (!understanding.cached) throw fault("music_understanding_status_invalid");
      }
      return { provider_track_id: value.provider_track_id, state: value.state, stage: value.stage, started_at: value.started_at, updated_at: value.updated_at, error_code: value.error_code, http_status: value.http_status, understanding };
    }, 12_000);
  } catch (error) {
    if (error?.status === 404) throw fault("music_understanding_status_unavailable", 404);
    throw error;
  }
}
export function narrateMusicUnderstandingUi(input, options = {}) {
  const body = track(input);
  if (!new Set(["casual", "expert"]).has(input.tier)) throw fault("music_tier_invalid");
  body.tier = input.tier;
  return request(`${ROOT}/narration`, { method: "POST", body: JSON.stringify(body) }, options, data => {
    const result = data?.result;
    if (!object(result) || result.tier !== body.tier || typeof result.narration !== "string" || !result.narration.trim() || (body.tier === "casual" && result.understanding !== null)) throw fault("music_narration_receipt_invalid");
    return { tier: body.tier, narration: result.narration, understanding: body.tier === "expert" ? validateUnderstanding(result.understanding, body.provider_track_id, true) : null };
  }, 180_000);
}
export function readMusicUnderstandingLog(logId, options = {}) {
  if (!LOG_ID.test(logId || "")) return Promise.reject(fault("music_understanding_failed"));
  return request(`/api/errors/${encodeURIComponent(logId)}`, {}, options, data => {
    if (!object(data?.log)) throw fault("music_understanding_failed", 404);
    return data.log;
  }, 12_000);
}

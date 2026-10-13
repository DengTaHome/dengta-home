import { musicErrorMessage } from "./music-operation-feedback.js";

const MAX_RECEIPTS = 100;
const MAX_AGE = 24 * 60 * 60 * 1000;
const requestId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");

export function createAiMusicConsumer({ scope, list, claim, commit, report, open, storage, onFeedback = () => {}, now = Date.now, newToken = () => globalThis.crypto.randomUUID() }) {
  const identity = scope.capture().options;
  const suffix = JSON.stringify([identity.accountScope, identity.companionScope]);
  const key = `dengta:ai-music-results:v2:${suffix}`;
  const receipts = new Map();
  let lastFeedback = "";
  try {
    for (const version of [1, 2]) {
      const saved = JSON.parse(storage?.getItem(`dengta:ai-music-results:v${version}:${suffix}`) || "[]");
      if (Array.isArray(saved)) for (const entry of saved.slice(-MAX_RECEIPTS)) {
        if (!requestId(entry?.id) || !Number.isFinite(entry.at) || now() - entry.at >= MAX_AGE) continue;
        if (version === 2 && (!requestId(entry.delivery_token) || !["claim", "commit", "opening", "result"].includes(entry.stage))) continue;
        if ((version === 1 || entry.stage === "result") && !["played", "failed"].includes(entry.status)) continue;
        receipts.set(entry.id, { id: entry.id, delivery_token: version === 2 ? entry.delivery_token : undefined,
          song_id: /^\d{1,20}$/.test(entry.song_id || "") ? entry.song_id : "", stage: version === 1 ? "result" : entry.stage,
          status: entry.status === "played" ? "played" : "failed", error: entry.error === "music_ai_open_unconfirmed" ? entry.error : "music_ai_open_failed",
          at: entry.at, acknowledged: entry.acknowledged === true });
      }
    }
  } catch { /* Storage is optional; the current instance still prevents repeated opens. */ }
  const remember = entry => {
    receipts.delete(entry.id); receipts.set(entry.id, entry);
    while (receipts.size > MAX_RECEIPTS) receipts.delete(receipts.keys().next().value);
    try { storage?.setItem(key, JSON.stringify([...receipts.values()])); } catch { /* Keep the in-memory receipt when storage is unavailable. */ }
  };
  const forget = id => { receipts.delete(id); try { storage?.setItem(key, JSON.stringify([...receipts.values()])); } catch { /* The server still owns the delivery. */ } };
  const feedback = message => { if (message !== lastFeedback) { lastFeedback = message; onFeedback(message); } };
  async function acknowledge(entry, token) {
    scope.assertCurrent(token);
    try { await report(entry.id, { status: entry.status, error: entry.error, delivery_token: entry.delivery_token }, token.options); }
    catch (error) {
      scope.assertCurrent(token);
      if (!["music_ai_request_not_found", "music_ai_request_superseded", "music_ai_result_conflict", "music_ai_claim_required", "music_ai_delivery_conflict"].includes(error?.code)) throw error;
      feedback(musicErrorMessage(error, "旧点歌请求已结束，请在一起听中查看当前歌曲。"));
    }
    scope.assertCurrent(token); remember({ ...entry, acknowledged: true });
  }
  async function deliver(entry, token) {
    scope.assertCurrent(token);
    if (entry.stage === "result") { if (!entry.acknowledged) await acknowledge(entry, token); return; }
    let uncertain = entry.stage === "opening";
    if (!uncertain) {
      const claimed = await claim(entry.id, entry.delivery_token, token.options);
      scope.assertCurrent(token);
      if (!claimed.claimed) { forget(entry.id); return; }
      uncertain = claimed.committed === true;
      if (!uncertain) {
        entry = { ...entry, stage: "commit" }; remember(entry);
        const committed = await commit(entry.id, entry.delivery_token, token.options);
        scope.assertCurrent(token);
        uncertain = committed.replayed === true;
      }
    }
    let opened = false;
    if (!uncertain) {
      entry = { ...entry, stage: "opening" }; remember(entry);
      scope.assertCurrent(token);
      if (/^\d{1,20}$/.test(entry.song_id)) {
        try { opened = (await open("song", entry.song_id))?.opened === true; } catch { uncertain = true; }
      }
    }
    entry = { ...entry, stage: "result", status: opened ? "played" : "failed", error: opened ? "" : uncertain ? "music_ai_open_unconfirmed" : "music_ai_open_failed", acknowledged: false };
    // Retain the old identity's technical result when a native call finishes after a switch.
    remember(entry); scope.assertCurrent(token);
    await acknowledge(entry, token);
    feedback(opened ? "AI 点歌已交给网易云打开，实际播放由网易云决定。" : uncertain ? "播放器交接结果无法确认，不会自动重复打开。请在一起听中检查或手动播放。（错误代码 / Code: music_ai_open_unconfirmed）" : "AI 点歌未能打开网易云，请在一起听中手动重试。（错误代码 / Code: music_ai_open_failed）");
  }
  async function processEntry(entry, token) {
    try { await deliver(entry, token); }
    catch (error) {
      scope.assertCurrent(token);
      if (!["music_ai_request_not_found", "music_ai_request_superseded", "music_ai_delivery_conflict", "music_ai_delivery_expired", "music_ai_result_conflict"].includes(error?.code)) throw error;
      forget(entry.id); feedback(musicErrorMessage(error, "这次点歌交接已结束，请在一起听中查看。"));
    }
  }
  return {
    async drain() {
      const token = scope.begin("ai-play");
      if (!token) return;
      try {
        for (const entry of [...receipts.values()]) if (!entry.acknowledged) await processEntry(entry, token);
        const requests = await list(token.options);
        scope.assertCurrent(token);
        for (const request of requests.slice(0, 3)) {
          const id = String(request?.id || ""), songId = String(request?.song_id || "");
          if (!requestId(id)) throw Object.assign(new Error("点歌请求编号无效，请刷新后重试。"), { code: "music_ai_request_invalid" });
          const previous = receipts.get(id);
          if (previous) continue;
          scope.assertCurrent(token);
          const deliveryToken = newToken();
          if (!requestId(deliveryToken)) throw Object.assign(new Error("无法创建点歌交接编号，请在一起听中手动播放。"), { code: "music_ai_delivery_id_unavailable" });
          const entry = { id, song_id: songId, delivery_token: deliveryToken, stage: "claim", at: now(), acknowledged: false };
          remember(entry); await processEntry(entry, token);
        }
      } catch (error) {
        if (scope.current(token)) feedback(musicErrorMessage(error, "AI 点歌暂时无法处理，请检查网络或在一起听中手动打开。已尝试打开的歌曲只会补传结果。"));
      } finally { scope.finish(token); }
    },
    cancel() { scope.cancelKey("ai-play"); },
  };
}

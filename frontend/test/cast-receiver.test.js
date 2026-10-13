import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  acknowledgeCastReceiver,
  clearReceiverToken,
  pairCastReceiver,
  readCastReceiverSession,
  readReceiverToken,
  RECEIVER_TOKEN_KEY,
  storeReceiverToken,
} from "../src/cast-receiver-api.js";
import {
  applyReceiverPlayback,
  detectPlannedCastProviders,
  normalizeReceiverSession,
  RECEIVER_ACK_INTERVAL_MS,
  RECEIVER_DRIFT_SECONDS,
  RECEIVER_POLL_INTERVAL_MS,
  shouldApplyReceiverRevision,
  shouldSeekReceiver,
} from "../src/receiver-playback.js";
import { normalizeCoWatchSession } from "../src/co-watch.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("receiver API pairs anonymously and keeps token out of URLs", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(
      calls.length === 1 ? { receiver_token: "secret-receiver-token" } : { ok: true },
    ), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const paired = await pairCastReceiver("session-1234567890", "123456", "客厅电视");
  assert.equal(paired.receiver_token, "secret-receiver-token");
  await readCastReceiverSession("secret-receiver-token");
  await acknowledgeCastReceiver("secret-receiver-token", {
    revision: 7, sequence: 9, playbackState: "playing", mediaPositionSeconds: 12.5, event: "seek",
  });
  assert.equal(calls[0].url.endsWith("/api/v2/cast/pair"), true);
  assert.deepEqual(JSON.parse(calls[0].options.body), { session_id: "session-1234567890", pairing_code: "123456", receiver_name: "客厅电视" });
  assert.equal(calls.every((call) => call.options.cache === "no-store"), true);
  assert.equal(calls.every((call) => !call.url.includes("secret-receiver-token")), true);
  assert.equal(calls[0].options.headers.has("Authorization"), false);
  assert.equal(calls[1].options.headers.get("Authorization"), "Bearer secret-receiver-token");
  assert.equal(calls[2].options.headers.get("Authorization"), "Bearer secret-receiver-token");
  assert.equal(calls[1].options.headers.has("X-DengTa-Receiver-Token"), false);
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    revision: 7, sequence: 9, state: "playing", position_seconds: 12.5, event: "seek",
  });
});

test("receiver API rejects failures without leaking response details", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "expired", message: "配对码已过期" }), { status: 410 });
  await assert.rejects(() => pairCastReceiver("session-1234567890", "000000", "电视"), (error) => {
    assert.equal(error.status, 410);
    assert.equal(error.code, "expired");
    assert.equal(error.message, "配对码已过期");
    return true;
  });
});

test("receiver token is session-storage scoped and removable", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  assert.equal(storeReceiverToken(storage, " token-value "), "token-value");
  assert.equal(readReceiverToken(storage), "token-value");
  assert.deepEqual([...values.keys()], [RECEIVER_TOKEN_KEY]);
  clearReceiverToken(storage);
  assert.equal(readReceiverToken(storage), "");
  assert.equal(storeReceiverToken(storage, "   "), "");
  assert.equal(readReceiverToken(null), "");
  clearReceiverToken(null);
});

test("receiver playback normalizes direct_media and preserves adult titles", () => {
  const session = normalizeReceiverSession({
    id: "session-1", title: "成人视频标题（仅标题）", status: "active",
    direct_media: { media_url: "https://media.example.com/movie.mp4" },
    playback_revision: 9, playback_state: "playing", media_position_seconds: 33,
  });
  assert.equal(session.title, "成人视频标题（仅标题）");
  assert.equal(session.mediaUrl, "https://media.example.com/movie.mp4");
  assert.equal(session.revision, 9);
  assert.equal(session.playbackState, "playing");
  assert.equal(normalizeReceiverSession({ media_url: "http://unsafe.example/a.mp4" }).mediaUrl, "");
  const ended = normalizeReceiverSession({ status: "ended", media_url: "https://media.example.com/end.mp4", revision: 3 });
  assert.equal(ended.status, "ended");
  assert.equal(ended.revision, 3);
});

test("co-watch DTO accepts the existing nested receiver shape", () => {
  const session = normalizeCoWatchSession({
    id: "session-1",
    receiver: { state: "playing", acknowledged: true, position_seconds: 7, reported_at: "2026-08-14T08:00:00.000Z" },
  });
  assert.deepEqual(session.castReceiver, {
    status: "playing", name: "", acknowledged: true, positionSeconds: 7, lastAckAt: "2026-08-14T08:00:00.000Z",
  });
});

test("revision is applied once and drift threshold avoids noisy seeks", () => {
  assert.equal(shouldApplyReceiverRevision(5, 6), true);
  assert.equal(shouldApplyReceiverRevision(6, 6), false);
  assert.equal(shouldApplyReceiverRevision(7, 6), false);
  assert.equal(RECEIVER_DRIFT_SECONDS, 1.5);
  assert.equal(shouldSeekReceiver(10, 11.5), false);
  assert.equal(shouldSeekReceiver(10, 11.51), true);
  assert.equal(RECEIVER_POLL_INTERVAL_MS, 1_000);
  assert.equal(RECEIVER_ACK_INTERVAL_MS, 5_000);
});

test("playback applies seek, play, pause and reports autoplay blocking", async () => {
  assert.deepEqual(await applyReceiverPlayback(null, null), { seeked: false, autoplayBlocked: false });
  const video = { currentTime: 1, paused: true, pauseCalls: 0, play: async () => {}, pause() { this.paused = true; this.pauseCalls += 1; } };
  const playing = await applyReceiverPlayback(video, { positionSeconds: 8, playbackState: "playing" });
  assert.deepEqual(playing, { seeked: true, autoplayBlocked: false });
  assert.equal(video.currentTime, 8);
  const paused = await applyReceiverPlayback(video, { positionSeconds: 8.5, playbackState: "paused" });
  assert.deepEqual(paused, { seeked: false, autoplayBlocked: false });
  assert.equal(video.pauseCalls, 1);
  video.play = async () => { throw Object.assign(new Error("blocked"), { name: "NotAllowedError" }); };
  assert.deepEqual(await applyReceiverPlayback(video, { positionSeconds: 20, playbackState: "playing" }), { seeked: true, autoplayBlocked: true });
  await assert.rejects(() => applyReceiverPlayback({ currentTime: 0, play: async () => { throw new Error("media failed"); } }, { positionSeconds: 0, playbackState: "playing" }), /media failed/);
});

test("providers are honest ready/planned capability detections", () => {
  const providers = detectPlannedCastProviders({ chrome: { cast: {} }, navigator: { presentation: {} } });
  assert.deepEqual(providers.map(({ id, status, detected }) => ({ id, status, detected })), [
    { id: "cast_receiver", status: "ready", detected: true },
    { id: "chromecast", status: "planned", detected: true },
    { id: "dlna", status: "planned", detected: true },
  ]);
  assert.deepEqual(detectPlannedCastProviders({ navigator: {} }).map((provider) => provider.detected), [true, false, false]);
});

test("receiver route, SW bypass, Vercel rewrite and controller contract are wired", () => {
  const main = source("../src/main.jsx");
  const receiver = source("../src/ReceiverApp.jsx");
  const together = source("../src/Together.jsx");
  const app = source("../src/App.jsx");
  const coWatch = source("../src/co-watch.js");
  const sw = source("../public/sw.js");
  const vercel = JSON.parse(source("../vercel.json"));
  assert.match(main, /window\.location\.pathname === "\/receive"/);
  assert.match(main, /isReceiverRoute \? <ReceiverApp \/> :/);
  assert.match(receiver, /globalThis\.sessionStorage/);
  assert.doesNotMatch(receiver, /localStorage|receiver_token.*location|console\./);
  assert.match(receiver, /NotAllowedError|再次确认播放|点击播放器的播放按钮/);
  assert.match(receiver, /onPlay=.*ack\("play"\)[\s\S]*onPause=.*ack\("pause"\)[\s\S]*onSeeked=.*ack\("seek"\)/);
  assert.match(receiver, /sequence: \+\+sequenceRef\.current/);
  assert.match(receiver, /pairCastReceiver\(pairingSessionId, pairingCode, receiverName, \{ signal: controller\.signal \}\)/);
  assert.match(together, /在电视上接收/);
  assert.match(together, /会话编号：\{castPairing\.sessionId\}/);
  assert.match(together, /不会显示媒体 URL 或接收端凭据/);
  assert.match(together, /成人|曲名和歌词不会在前端过滤/);
  assert.match(app, /sessionMode: pageMode \? "web_page" : "direct_media"[\s\S]*mediaUrl: options\.mediaUrl/);
  assert.match(app, /await patchCoWatchPlayback\(target\.id/);
  assert.match(coWatch, /playback_revision \?\? value\.revision/);
  assert.match(coWatch, /playlist_id \?\? value\.music_playlist_id/);
  assert.match(coWatch, /value\.session_mode === "direct" \? "direct_media"/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/v2\/cast\/"\)/);
  assert.deepEqual(vercel.rewrites, [{ source: "/receive", destination: "/index.html" }]);
});

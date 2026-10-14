import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseNowPlayingCard, createBuiltInNowPlaying } from "../src/built-in-now-playing.js";
import { createMusicRequestScope } from "../src/music-request-scope.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const song = index => ({ title: `虚构歌曲${index}`, artist: "虚构作者", url: `https://media.example.test/${index}.mp3` });
export class FakeAudio {
  constructor(url) { this.url = url; this.paused = true; this.ended = false; this.listeners = new Map(); this.plays = 0; this.loads = 0; }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(callback); }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
  play() {
    this.plays++;
    return Promise.resolve(this.playResult).then(() => { if (!this.released) { this.paused = false; this.emit("play"); } });
  }
  pause() { this.paused = true; this.emit("pause"); }
  removeAttribute(name) { assert.equal(name, "src"); this.released = true; }
  load() { this.loads++; }
}
function fixture() {
  let identity = { user: { id: "fictional-account-a" }, activeCompanionId: "fictional-companion-a" }, number = 0;
  const scope = createMusicRequestScope({ getSnapshot: () => identity }); scope.bind({});
  const audios = [], calls = [], output = [], busy = [], feedback = [], startup = [];
  const options = {
    scope, request: async (path, options) => { calls.push({ path, options }); return { playable: true, song: song(++number) }; },
    createAudio: url => { const audio = new FakeAudio(url); audios.push(audio); return audio; },
    onSong: value => output.push(value), onBusy: value => busy.push(value), onFeedback: value => feedback.push(value), onStartupFeedback: value => startup.push(value),
  };
  return { scope, audios, calls, output, busy, feedback, startup, options, switchIdentity() { identity = { user: { id: "fictional-account-b" }, activeCompanionId: "fictional-companion-b" }; scope.bind({}); } };
}

test("local card pauses/resumes real local Audio and next switches after play succeeds", async () => {
  const f = fixture(), player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const first = f.output.at(-1), old = f.audios[0];
    assert.equal(first.source, "dengta"); assert.ok(first.playbackId); assert.equal(first.packageName, undefined); assert.equal(first.isPlaying, true);
    await player.control("pause", first); assert.equal(old.paused, true); assert.equal(f.output.at(-1).isPlaying, false);
    await player.control("play", f.output.at(-1)); assert.equal(old.plays, 2); assert.equal(f.output.at(-1).isPlaying, true);
    const wait = deferred();
    const request = f.options.request;
    // The request gate lets the old track continue while the next selection loads.
    const g = fixture(); g.options.request = async (...args) => { if (g.audios.length) await wait.promise; return request(...args); };
    const other = createBuiltInNowPlaying(g.options); await other.start();
    const next = other.control("next", g.output.at(-1)); await settle(); assert.equal(g.audios[0].paused, false);
    wait.resolve(); await next; assert.equal(g.audios[0].released, true); assert.equal(g.audios[1].paused, false); assert.equal(g.audios[1].muted, false);
    other.dispose();
    await player.control("next", f.output.at(-1)); assert.equal(old.released, true); assert.notEqual(f.output.at(-1).playbackId, first.playbackId);
    const count = f.output.length; old.emit("ended"); old.emit("pause"); assert.equal(f.output.length, count);
  } finally { player.dispose(); }
});

test("same-tick next clicks start one request and a failed selection keeps the old song", async () => {
  const f = fixture(); let waiting, selections = 0;
  const real = f.options.request;
  f.options.request = (...args) => { if (waiting) { selections++; return waiting.promise; } return real(...args); };
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const first = f.output.at(-1), old = f.audios[0];
    waiting = deferred(); const requestsBefore = f.calls.length;
    const one = player.control("next", first), two = player.control("next", first);
    await settle(); assert.equal(f.scope.busy("built-in-now-playing"), true);
    waiting.reject(new Error("fictional private provider error"));
    await one; await two;
    assert.equal(selections, 2, "one next selection uses GET then its fallback POST; a second click cannot duplicate either");
    assert.equal(f.audios.length, 1); assert.equal(old.paused, false); assert.equal(f.output.at(-1), first);
    assert.equal(f.calls.length, requestsBefore, "second click cannot fall through to random fetch");
    assert.equal(f.feedback.at(-1), "下一首暂时无法播放，已保留当前歌曲。");
    assert.ok(!JSON.stringify(f.feedback).includes("provider error")); assert.equal(f.busy.at(-1), false);
  } finally { player.dispose(); }
});

test("candidate play rejection and malformed URLs preserve the current Audio", async () => {
  for (const failure of ["play", "url"]) {
    const f = fixture(); let next = false;
    const original = f.options.createAudio;
    f.options.createAudio = url => { const audio = original(url); if (next) audio.playResult = Promise.reject(Object.assign(new Error("fictional private rejection"), { name: "NotSupportedError" })); return audio; };
    if (failure === "url") f.options.request = async () => ({ playable: true, song: next ? { ...song(2), url: "javascript:fictional" } : song(1) });
    const player = createBuiltInNowPlaying(f.options);
    try {
      await player.start(); const first = f.output.at(-1); next = true; await player.control("next", first);
      assert.equal(f.audios[0].paused, false); assert.equal(f.output.at(-1), first);
      if (failure === "play") assert.equal(f.audios[1].released, true);
      assert.equal(f.feedback.at(-1), "下一首暂时无法播放，已保留当前歌曲。");
    } finally { player.dispose(); }
  }
});

test("rejected startup does not create a false playing card", async () => {
  const f = fixture(); f.options.createAudio = url => { const audio = new FakeAudio(url); audio.playResult = Promise.reject(Object.assign(new Error("fictional private policy"), { name: "NotAllowedError" })); f.audios.push(audio); return audio; };
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); assert.equal(f.output.length, 0); assert.equal(f.audios[0].released, true);
    assert.equal(f.startup.at(-1).status, "error"); assert.ok(!JSON.stringify(f.startup).includes("fictional private"));
  } finally { player.dispose(); }
});

test("a stalled candidate times out without stopping the old Audio or accepting late playback", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), pending = deferred(); let next = false;
  const original = f.options.createAudio;
  f.options.createAudio = url => { const audio = original(url); if (next) audio.playResult = pending.promise; return audio; };
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const first = f.output.at(-1); next = true;
    const work = player.control("next", first); await settle(); t.mock.timers.tick(15000); await work;
    assert.equal(f.audios[0].paused, false); assert.equal(f.audios[1].released, true); assert.equal(f.output.at(-1), first);
    assert.equal(f.feedback.at(-1), "下一首等待播放超时，已保留当前歌曲。你可以重试下一首。");
    pending.resolve(); await settle(); assert.equal(f.audios[1].paused, true); assert.equal(f.output.at(-1), first);
  } finally { player.dispose(); }
});

test("scope change/unmount aborts pending play, clears Audio, and rejects late events", async () => {
  for (const change of ["scope", "unmount"]) {
    const f = fixture(), pending = deferred(); let next = false;
    const original = f.options.createAudio;
    f.options.createAudio = url => { const audio = original(url); if (next) audio.playResult = pending.promise; return audio; };
    const player = createBuiltInNowPlaying(f.options); await player.start(); next = true;
    const work = player.control("next", f.output.at(-1)); await settle(); assert.equal(f.audios.length, 2);
    if (change === "scope") f.switchIdentity();
    player.dispose(); const count = f.output.length;
    await work; pending.resolve(); await settle();
    assert.ok(f.audios.every(audio => audio.released && audio.paused));
    f.audios.forEach(audio => { audio.emit("play"); audio.emit("ended"); }); assert.equal(f.output.length, count);
    assert.equal(f.feedback.length, 0);
  }
});

test("a stale local playbackId cannot pause or replace the displayed song", async () => {
  const f = fixture(), player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const first = f.output.at(-1); await player.control("next", first); const calls = f.calls.length;
    await player.control("pause", first); await player.control("next", first);
    assert.equal(f.calls.length, calls); assert.equal(f.audios[1].paused, false);
    f.audios[1].ended = true; f.audios[1].emit("ended"); assert.equal(f.output.at(-1), null);
  } finally { player.dispose(); }
});

test("paused or unknown system metadata cannot hide the active local controls; playing external yields once", async () => {
  const f = fixture(), pending = deferred(); let next = false;
  const original = f.options.request;
  f.options.request = (...args) => next ? pending.promise : original(...args);
  const player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const first = f.output.at(-1);
    const system = { title: "虚构系统歌曲", packageName: "fictional.music", isPlaying: false };
    assert.equal(chooseNowPlayingCard(first, system), first);
    assert.equal(chooseNowPlayingCard(first, { ...system, isPlaying: true, playbackStateKnown: false }), first);
    next = true; const work = player.control("next", first); await settle();
    player.yieldToExternal(); player.yieldToExternal();
    assert.equal(f.audios[0].paused, true); assert.equal(f.audios[0].loads, 1, "one yield releases the old local source once");
    assert.equal(chooseNowPlayingCard(first, { ...system, isPlaying: true }).packageName, "fictional.music");
    pending.resolve({ playable: true, song: song(2) }); await work;
    assert.equal(f.audios.length, 1, "external takeover cancels an in-flight local next");
    assert.equal(f.feedback.length, 0);
  } finally { player.dispose(); }
});

test("post-start Audio error pauses truthfully and permits an explicit retry", async () => {
  const f = fixture(), player = createBuiltInNowPlaying(f.options);
  try {
    await player.start(); const audio = f.audios[0]; audio.error = { message: "fictional private decoding failure" }; audio.emit("error");
    assert.equal(audio.paused, true); assert.equal(f.output.at(-1).isPlaying, false);
    assert.equal(f.feedback.at(-1), "歌曲播放中断，已暂停。你可以点播放重试。");
    await player.control("play", f.output.at(-1)); assert.equal(audio.loads, 1); assert.equal(f.output.at(-1).isPlaying, true);
    assert.ok(!JSON.stringify(f.feedback).includes("private"));
  } finally { player.dispose(); }
});

test("a stalled resume stays paused after its deadline and late playback", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), player = createBuiltInNowPlaying(f.options), pending = deferred();
  try {
    await player.start();
    const audio = f.audios[0];
    await player.control("pause", f.output.at(-1));
    audio.playResult = pending.promise;
    const work = player.control("play", f.output.at(-1));
    await settle(); t.mock.timers.tick(15000); await work;
    assert.equal(f.busy.at(-1), false);
    assert.equal(f.feedback.at(-1), "播放器响应超时，已保持暂停。点播放重试。");
    assert.equal(audio.paused, true);
    pending.resolve(); await settle();
    assert.equal(audio.paused, true, "a timed-out resume must not start playback later");
    assert.equal(f.output.at(-1).isPlaying, false);
  } finally { player.dispose(); }
});

test("a late timed-out resume cannot pause a newer confirmed play", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(), player = createBuiltInNowPlaying(f.options), pending = deferred();
  try {
    await player.start();
    const audio = f.audios[0];
    await player.control("pause", f.output.at(-1));
    audio.playResult = pending.promise;
    const old = player.control("play", f.output.at(-1));
    await settle(); t.mock.timers.tick(15000); await old;
    audio.playResult = undefined;
    await player.control("play", f.output.at(-1));
    assert.equal(audio.paused, false);
    pending.resolve(); await settle();
    assert.equal(audio.paused, false);
    assert.equal(f.output.at(-1).isPlaying, true);
  } finally { player.dispose(); }
});

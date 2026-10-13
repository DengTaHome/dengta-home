import { validateDirectMediaUrl } from "./direct-media.js";

const JOB_KEY = "built-in-now-playing";
const CANCELLED = Object.assign(new Error("music_scope_changed"), { code: "music_scope_changed" });

export function chooseNowPlayingCard(current, external) {
  return current?.source === "dengta" && (external?.isPlaying !== true || external?.playbackStateKnown === false) ? current : external;
}

export function createBuiltInNowPlaying({ scope, request, createAudio = url => new Audio(url), onSong, onBusy, onFeedback, onStartupFeedback }) {
  let alive = true, current = null, candidate = null, sequence = 0, localPlayback = null;
  const closedOwners = new WeakSet();
  const localBlocked = () => localPlayback?.phase === "pending" || localPlayback?.phase === "playing";
  const owned = token => alive && scope.current(token);
  const release = entry => {
    if (!entry) return;
    entry.listeners.forEach(([name, listener]) => entry.audio.removeEventListener(name, listener));
    entry.audio.pause();
    entry.audio.removeAttribute("src");
    entry.audio.load();
  };
  const update = entry => {
    if (!alive || current !== entry || !scope.current(entry.owner)) return;
    if (localPlayback?.phase !== "playing") onSong({ ...entry.song, isPlaying: !entry.audio.paused && !entry.audio.ended });
  };
  const makeEntry = (song, owner) => {
    const url = validateDirectMediaUrl(song?.url);
    if (!url.ok || !song?.title) throw new Error("music_random_unavailable");
    const entry = { audio: createAudio(url.url), owner, listeners: [], song: {
      title: song.title, artist: song.artist || "", cover: song.cover || "", source: "dengta",
      playbackId: `dengta-${++sequence}`, playbackStateKnown: true,
    } };
    for (const name of ["play", "pause"]) {
      const listener = () => update(entry);
      entry.listeners.push([name, listener]); entry.audio.addEventListener(name, listener);
    }
    const ended = () => {
      if (current !== entry || !alive || !scope.current(entry.owner)) return;
      current = null; release(entry); onSong(null);
    };
    entry.listeners.push(["ended", ended]); entry.audio.addEventListener("ended", ended);
    const error = () => {
      if (current !== entry || !alive || !scope.current(entry.owner)) return;
      entry.audio.pause(); update(entry);
      onFeedback("歌曲播放中断，已暂停。你可以点播放重试。");
    };
    entry.listeners.push(["error", error]); entry.audio.addEventListener("error", error);
    return entry;
  };
  const play = (audio, token) => new Promise((resolve, reject) => {
    const signal = token.options.signal;
    let timer, settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); callback(value);
    };
    const abort = () => finish(reject, CANCELLED);
    signal.addEventListener("abort", abort, { once: true });
    if (!owned(token)) { abort(); return; }
    timer = setTimeout(() => finish(reject, new Error("music_audio_timeout")), 15000);
    try { Promise.resolve(audio.play()).then(value => {
      if (!owned(token) || localBlocked()) { audio.pause(); finish(reject, CANCELLED); return; }
      finish(resolve, value);
    }, error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
  async function select(token) {
    const data = await request("/api/v2/music/providers/netease/random-playable", { ...token.options, timeoutMs: 15000 }).catch(() => null);
    if (!owned(token)) throw CANCELLED;
    if (data?.playable === true && data.song?.url) return data.song;
    const fetched = await request("/api/v2/music/providers/netease/random-fetch", {
      ...token.options, method: "POST", timeoutMs: 90000, body: JSON.stringify({}),
    });
    if (!owned(token)) throw CANCELLED;
    if (!fetched?.ok || !fetched.song?.url) throw new Error("music_random_unavailable");
    return fetched.song;
  }
  async function run(action, expectedSong, { startup = false } = {}) {
    if (!alive || (action !== "next" && !["play", "pause"].includes(action))) return;
    if (!startup && (!current || expectedSong?.source !== "dengta" || current.song.playbackId !== expectedSong.playbackId)) return;
    if (action !== "pause" && localBlocked()) return;
    const token = scope.begin(JOB_KEY);
    if (!token) return;
    const previous = current;
    let attemptCandidate = null;
    onBusy(true);
    try {
      if (action === "next") {
        const song = await select(token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        candidate = attemptCandidate = makeEntry(song, scope.capture());
        const next = candidate;
        next.audio.muted = !!previous;
        await play(next.audio, token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        current = next; candidate = null; attemptCandidate = null;
        release(previous);
        next.audio.muted = false;
        update(next);
      } else if (action === "pause") {
        previous.audio.pause(); update(previous);
      } else {
        if (previous.audio.error) previous.audio.load();
        await play(previous.audio, token);
        if (!owned(token) || current !== previous || localBlocked()) throw CANCELLED;
        update(previous);
      }
      if (!owned(token)) return;
      if (startup) onStartupFeedback({ status: "success", message: `正在播放：${current.song.title}（DengTa 内置播放）` });
      else onFeedback(action === "next" ? "已播放下一首。" : action === "pause" ? "已暂停。" : "已播放。");
    } catch (error) {
      release(attemptCandidate); if (candidate === attemptCandidate) candidate = null;
      if (owned(token) && error !== CANCELLED) {
        const message = error?.name === "NotAllowedError" ? "自动播放被浏览器拦截，请手动开始播放。"
          : action === "next" && previous ? "下一首暂时无法播放，已保留当前歌曲。" : "歌曲暂时无法播放，请稍后重试。";
        if (startup) onStartupFeedback({ status: "error", message }); else onFeedback(message);
      }
    } finally {
      scope.finish(token);
      if (owned(token)) onBusy(false);
    }
  }
  return {
    control: (action, song) => run(action, song),
    start: () => run("next", null, { startup: true }),
    localPlaybackChanged(event) {
      const stamp = scope.capture(), owner = stamp.options;
      if (!owned(stamp) || !event?.owner || typeof event.owner !== "object" || closedOwners.has(event.owner)
        || !["pending", "playing", "paused", "ended", "error", "released"].includes(event.phase)
        || event.accountScope !== owner.accountScope || event.companionScope !== owner.companionScope) return;
      if (["pending", "playing"].includes(event.phase)) {
        localPlayback = event;
        if (event.phase === "playing") {
          scope.cancelKey(JOB_KEY); release(candidate); candidate = null;
          current?.audio.pause(); onSong(null); onBusy(false);
        }
      } else {
        if (["paused", "ended", "error", "released"].includes(event.phase)) closedOwners.add(event.owner);
        if (localPlayback?.owner !== event.owner) return;
        localPlayback = null;
        if (current) update(current);
      }
    },
    yieldToExternal() {
      if (!alive || (!current && !candidate && !scope.busy(JOB_KEY))) return;
      scope.cancelKey(JOB_KEY); release(candidate); release(current); candidate = null; current = null;
      onBusy(false);
    },
    dispose() {
      if (!alive) return;
      alive = false; scope.cancelKey(JOB_KEY); release(candidate); release(current); candidate = null; current = null;
    },
  };
}

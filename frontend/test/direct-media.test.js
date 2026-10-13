import assert from "node:assert/strict";
import fs from "node:fs";
import {
  clearDirectMediaSession,
  DIRECT_MEDIA_SESSION_KEY,
  readDirectMediaSession,
  storeDirectMediaSession,
  validateDirectMediaUrl,
} from "../src/direct-media.js";

const source = (path) =>
  fs.readFileSync(new URL(path, import.meta.url), "utf8");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const valid = validateDirectMediaUrl(
  "https://media.example.com/movie.mp4?token=temporary#t=12",
);
assert.equal(valid.ok, true);
assert.equal(valid.url.startsWith("https://media.example.com/movie.mp4"), true);

for (const input of [
  "http://example.com/movie.mp4",
  "javascript:alert(1)",
  "data:video/mp4;base64,AAAA",
  "file:///sdcard/movie.mp4",
  "blob:https://example.com/id",
]) {
  assert.equal(
    validateDirectMediaUrl(input).ok,
    false,
    `${input} must not be accepted as a remote media URL`,
  );
}

assert.equal(
  validateDirectMediaUrl("https://user:secret@example.com/movie.mp4").code,
  "userinfo",
);

for (const input of [
  "https://localhost/movie.mp4",
  "https://player.local/movie.mp4",
  "https://127.0.0.1/movie.mp4",
  "https://127.1/movie.mp4",
  "https://10.0.0.8/movie.mp4",
  "https://100.64.0.1/movie.mp4",
  "https://169.254.10.4/movie.mp4",
  "https://172.16.0.2/movie.mp4",
  "https://172.31.255.255/movie.mp4",
  "https://192.168.1.2/movie.mp4",
  "https://198.18.0.1/movie.mp4",
  "https://[::1]/movie.mp4",
  "https://[fd00::1]/movie.mp4",
  "https://[fe80::1]/movie.mp4",
  "https://[::ffff:7f00:1]/movie.mp4",
]) {
  assert.equal(
    validateDirectMediaUrl(input).code,
    "private_host",
    `${input} must not reach a local/private network`,
  );
}

for (const input of [
  "https://www.bilibili.com/video/BV1example",
  "https://www.bilibili.com/bangumi/play/ep123",
  "https://b23.tv/abc123",
  "https://www.iqiyi.com/v_example.html",
  "https://v.iqiyi.com/v_example.html",
  "https://www.iq.com/play/example",
]) {
  assert.equal(
    validateDirectMediaUrl(input).code,
    "provider_page",
    `${input} is a provider webpage, not a direct media file`,
  );
}
assert.equal(
  validateDirectMediaUrl(
    "https://upos-sz-mirror.example.bilivideo.com/path/video.m4s?token=x",
  ).ok,
  true,
  "a HTTPS CDN media URL must remain eligible for browser playback",
);

const sessionStorage = new MemoryStorage();
const stored = storeDirectMediaSession(sessionStorage, "account-a", {
  url: "https://media.example.com/a.mp4?token=one",
  title: "测试影片",
  positionSeconds: 42.8,
  durationSeconds: 180,
}, "companion-a");
assert.equal(stored.ok, true);
assert.equal(readDirectMediaSession(sessionStorage, "account-b", "companion-a"), null);
assert.deepEqual(readDirectMediaSession(sessionStorage, "account-a", "companion-a"), {
  url: "https://media.example.com/a.mp4?token=one",
  title: "测试影片",
  positionSeconds: 42.8,
  durationSeconds: 180,
});
assert.equal(
  [...sessionStorage.values.keys()].some((key) => key.startsWith(DIRECT_MEDIA_SESSION_KEY)),
  true,
);
assert.equal(readDirectMediaSession(sessionStorage, "account-a", "companion-b"), null);
assert.equal(readDirectMediaSession(sessionStorage, "account-a"), null);
assert.equal(storeDirectMediaSession(sessionStorage, "account-a", {url:"https://media.example.test/b.mp4"}).code, "scope_required");
sessionStorage.setItem("dengta.together.direct-media.v1:account-a", JSON.stringify({url:"https://media.example.test/legacy.mp4"}));
assert.equal(readDirectMediaSession(sessionStorage, "account-a", "companion-b"), null);
assert.ok(sessionStorage.getItem("dengta.together.direct-media.v1:account-a"));
clearDirectMediaSession(sessionStorage, "account-a", "companion-a");
assert.equal(readDirectMediaSession(sessionStorage, "account-a", "companion-a"), null);

const together = source("../src/Together.jsx");
assert.match(together, /globalThis\.sessionStorage/);
assert.doesNotMatch(together, /globalThis\.localStorage/);
assert.match(together, /<video[\s\S]*?controls[\s\S]*?playsInline/);
assert.match(together, /onLoadedMetadata=\{\(event\) => \{/);
assert.match(together, /restoredResume\?\.url === directMediaUrl/);
assert.match(together, /restoredResumeRef\.current = null/);
const loadedMetadata = together.slice(
  together.indexOf("onLoadedMetadata={(event) =>"),
  together.indexOf("onDurationChange={(event) =>"),
);
assert.doesNotMatch(
  loadedMetadata,
  /restoredDirectMedia\?\.positionSeconds/,
  "loading a different URL must not reuse the first restored video's position",
);
assert.match(together, /onTimeUpdate=\{\(event\) => reportDirectPlayback/);
assert.match(
  together,
  /onPlaybackChange\?\.\(\{[\s\S]*?sessionId:[\s\S]*?mediaPositionSeconds:[\s\S]*?mediaDurationSeconds:/,
  "player metadata and time updates must update the in-memory co-watch session",
);
assert.match(together, /clearDirectMediaSession\(globalThis\.sessionStorage/);
assert.match(together, /const startDirect = async \(\) =>/);
assert.match(together, /const stopDirect = async \(\) =>/);
const stopDirect = together.slice(
  together.indexOf("const stopDirect = async"),
  together.indexOf("const submitReply"),
);
assert.match(
  stopDirect,
  /runMediaOperation\([\s\S]*?clearDirectMediaSession/,
  "a failed backend end request must retain the local URL and playback state for retry",
);
assert.match(together, /AI 不会抓取或自动观看视频/);
assert.match(together, /AI 只能根据你填写的标题、播放进度和你主动发送的文字陪聊/);
assert.match(together, /普通爱奇艺、哔哩哔哩网页链接不是视频直链/);

const app = source("../src/App.jsx");
const directStart = app.slice(
  app.indexOf("async function startDirectMediaCoWatchSession"),
  app.indexOf("function updateDirectMediaCoWatchPlayback"),
);
assert.match(
  directStart,
  /const sourceApp = pageMode \? WEB_PAGE_SOURCE_APP : DIRECT_MEDIA_SOURCE_APP;[\s\S]*?sourceApp,/,
  "the direct/web media session must pass the right source app constant",
);
assert.match(directStart, /sessionMode: pageMode \? "web_page" : "direct_media"/);
assert.match(directStart, /mediaUrl:\s*options\.mediaUrl/);
assert.match(app, /clearDirectMediaSession\(globalThis\.sessionStorage, accountStorageScope, companionScope\)/);
assert.match(
  app,
  /playbackPositionSeconds \?\? target\.mediaPositionSeconds/,
  "manual co-watch replies must carry the current player position",
);

const coWatch = source("../src/co-watch.js");
const createRequest = coWatch.slice(
  coWatch.indexOf("export async function createCoWatchSession"),
  coWatch.indexOf("export async function endCoWatchSession"),
);
assert.match(createRequest, /session_mode:[\s\S]*?"direct_media"/);
assert.match(
  createRequest,
  /media_url: \["direct_media", "web_page"\]\.includes\(input\.sessionMode\) \? cleanText\(input\.mediaUrl, 4096\) : ""/,
  "the direct/web session must carry its media URL",
);

console.log("Together direct HTTPS media URL safety and playback tests passed");

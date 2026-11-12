import test from "node:test";
import assert from "node:assert/strict";
import {
  neteasePlaybackPluginAvailable,
  openNeteasePlayback,
  playNeteaseSilent,
} from "../src/netease-playback.js";
import {
  buildVoiceTurnFormData,
  selectRecorderMimeType,
  voiceCaptureErrorMessage,
} from "../src/voice.js";

test("NetEase native playback requires the Android plugin, and iOS uses a validated HTTPS resource", async () => {
  for (const [platform, available, expected] of [
    ["ios", true, false], ["ios", false, false], ["web", true, false],
    ["android", false, false], ["android", true, true],
  ]) {
    assert.equal(neteasePlaybackPluginAvailable({ getPlatform: () => platform, isPluginAvailable: () => available }), expected);
  }
  const opened = [];
  const capacitor = { getPlatform: () => "ios", isPluginAvailable: () => true };
  const options = { capacitor, browser: { open: async value => opened.push(value) }, nativePlayback: {
    open: () => assert.fail("Android playback cannot be called on iOS"),
    playSilent: () => assert.fail("Android playback cannot be called on iOS"),
  } };
  assert.deepEqual(await openNeteasePlayback("playlist", "123", options), { opened: true, target: "web" });
  assert.equal(opened[0].url, "https://music.163.com/#/playlist?id=123");
  await assert.rejects(playNeteaseSilent("song", "456", options), { code: "music_silent_playback_unavailable" });
  await assert.rejects(openNeteasePlayback("song", "123&redirect=evil", options));
  await assert.rejects(playNeteaseSilent("playlist", "123", options));
  assert.equal(opened.length, 1, "AI playback cannot automatically open a browser on iOS");
  await assert.rejects(openNeteasePlayback("song", "123", {
    ...options, browser: { open: async () => { throw Error("Browser failed"); } },
  }), /Browser failed/);
});

test("iOS AAC recording is selected and uploaded as M4A while microphone failures explain iOS permissions", () => {
  class SafariRecorder {
    static isTypeSupported(type) { return type === "audio/mp4"; }
  }
  assert.equal(selectRecorderMimeType(SafariRecorder), "audio/mp4");
  const body = buildVoiceTurnFormData({ blob: new Blob(["fictional recording"], { type: "audio/mp4" }), timestamp: 1 });
  assert.equal(body.get("file").name, "dengta-voice-1.m4a");
  assert.equal(body.get("file").type, "audio/mp4");
  for (const name of ["NotAllowedError", "SecurityError"]) {
    const native = voiceCaptureErrorMessage({ name }, { platform: "ios" });
    assert.match(native, /隐私与安全性 → 麦克风/);
    assert.doesNotMatch(native, /设置 → 应用.*权限/);
    const safari = voiceCaptureErrorMessage({ name }, { platform: "web", userAgent: "iPhone" });
    assert.match(safari, /当前网站设置/);
  }
});

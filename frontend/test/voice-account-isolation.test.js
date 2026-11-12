import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceTurnRequest, requestExpressiveSpeech, speakVoiceText, stopVoiceSpeech, VOICE_PLAYBACK_MODES } from "../src/voice.js";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function authFixture() {
  let scope = { accountId: "voice-fixture-a", companionId: "companion", revision: 1 };
  return { getRequestScope: () => scope, getRequestContext: async () => ({ accessToken: "fictional-token", companionId: scope.companionId }),
    switchAccount() { scope = { ...scope, accountId: "voice-fixture-b", revision: scope.revision + 1 }; } };
}

test("a voice upload waiting for credentials cannot dispatch after its account changes", async () => {
  const auth = authFixture(), token = deferred();
  auth.getRequestContext = () => token.promise;
  let sent = 0, opened = 0;
  class FakeXhr {
    upload = { addEventListener() {} };
    addEventListener() {}
    open() { opened++; }
    setRequestHeader() {}
    send() { sent++; }
    abort() {}
  }
  const request = createVoiceTurnRequest(new FormData(), { authSession: auth, XMLHttpRequestImpl: FakeXhr });
  auth.switchAccount();
  token.resolve({ accessToken: "fictional-old-token" });
  await assert.rejects(request.promise, { name: "AbortError", code: "voice_scope_changed" });
  assert.equal(opened, 0);
  assert.equal(sent, 0);
});

test("a voice response arriving after an account change never exposes its private audio blob", async () => {
  const auth = authFixture(), response = deferred(), dispatched = deferred();
  let blobReads = 0;
  const request = requestExpressiveSpeech("message", { sessionId: "session", speechToken: "fictional-speech-ticket", authSession: auth,
    fetchImpl: async () => { dispatched.resolve(); return response.promise; } });
  await dispatched.promise;
  auth.switchAccount();
  response.resolve({ ok: true, blob: async () => { blobReads++; return new Blob(["fictional-private-audio"]); } });
  await assert.rejects(request, { name: "AbortError", code: "voice_scope_changed" });
  assert.equal(blobReads, 0);
});

test("logout stops a pending speech generation before it can create or play an audio element", async () => {
  const speech = deferred(), auth = authFixture();
  let audioElements = 0, objectUrls = 0;
  const request = speakVoiceText("fictional speech", { mode: VOICE_PLAYBACK_MODES.expressive, messageId: "message", authSession: auth,
    requestSpeech: () => speech.promise, AudioImpl: class { constructor() { audioElements++; } },
    URLImpl: { createObjectURL() { objectUrls++; return "blob:fictional"; } } });
  await stopVoiceSpeech();
  speech.resolve({ blob: new Blob(["fictional-private-audio"]) });
  await assert.rejects(request, { name: "AbortError", code: "voice_scope_changed" });
  assert.equal(audioElements, 0);
  assert.equal(objectUrls, 0);
});

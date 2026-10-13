import assert from "node:assert/strict";
import fs from "node:fs";
import { createMusicRequestScope } from "../src/music-request-scope.js";
import { createAiMusicConsumer } from "../src/ai-music-consumer.js";
import { launchExternalMusic, externalMusicFeedback } from "../src/music-external-launch.js";
import { openNeteasePlayback, playNeteaseSilent } from "../src/netease-playback.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const createConsumer = options => createAiMusicConsumer({ claim: async () => ({ claimed: true, committed: false }), commit: async () => ({ replayed: false }), ...options });
let identity = { accountScope: "account-a", companionScope: "companion-a" };
const auth = { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }) };
const scope = createMusicRequestScope(auth); scope.bind(identity);
const store = new Map(), storage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
const notices = [], requests = [{ id: "11111111-1111-4111-8111-111111111111", song_id: "123", title: "Fictional song" }];
let opens = 0, reports = [], failReport = true;
const consumer = () => createConsumer({ scope, storage, list: async options => { assert.equal(options.accountScope, identity.accountScope); return requests; }, open: async () => { opens++; return { opened: true }; }, report: async (id, result, options) => { reports.push({ id, result, options }); if (failReport) throw Object.assign(Error("Authorization: Bearer fictional-private-secret"), { code: "fixture_result_failed", status: 503 }); }, onFeedback: value => notices.push(value) });
let current = consumer(); await current.drain(); assert.equal(opens, 1); assert.equal(reports.length, 1); assert.match(notices.at(-1), /fixture_result_failed/); assert.doesNotMatch(notices.at(-1), /fictional-private/);
failReport = false; await current.drain(); assert.equal(opens, 1, "a lost result retries reporting without opening again");
current = consumer(); await current.drain(); assert.equal(opens, 1, "a scoped stored receipt survives recreation");
assert.ok([...store.values()].every(value => !value.includes("Fictional song") && !value.includes("fictional-private")), "journal stores technical ids and outcomes only");

const listing = deferred(); let listCalls = 0;
current = createConsumer({ scope, list: () => { listCalls++; return listing.promise; }, report: async () => {}, open: async () => { opens++; }, onFeedback: value => notices.push(value) });
const first = current.drain(); await current.drain(); assert.equal(listCalls, 1, "polling cannot overlap");
identity = { accountScope: "account-b", companionScope: "companion-b" }; scope.bind(identity); listing.resolve(requests); await first; assert.equal(opens, 1, "old account pending requests cannot open after switch");
current = consumer(); await current.drain(); assert.equal(opens, 2, "another account does not share receipts");

const native = deferred(); let lateReports = 0;
current = createConsumer({ scope, storage, list: async () => [{ id: "22222222-2222-4222-8222-222222222222", song_id: "234" }], report: async () => lateReports++, open: () => native.promise });
const opening = current.drain(); await new Promise(resolve => setTimeout(resolve, 0)); scope.invalidate(); native.resolve({ opened: true }); await opening; assert.equal(lateReports, 0, "late native result cannot write through a new identity");
scope.bind(identity); current = createConsumer({ scope, storage, list: async () => [{ id: "22222222-2222-4222-8222-222222222222", song_id: "234" }], report: async () => lateReports++, open: async () => { throw Error("must not open twice"); } });
await current.drain(); assert.ok(lateReports > 0, "old native result resumes reporting in the original scope");
let nextOpened = 0;
current = createConsumer({ scope, storage, list: async () => [requests[0], { id: "33333333-3333-4333-8333-333333333333", song_id: "345" }], report: async request => { if (request === requests[0].id) throw Object.assign(Error("replaced"), { code: "music_ai_request_superseded" }); }, open: async () => { nextOpened++; return { opened: true }; } });
await current.drain(); assert.equal(nextOpened, 1, "a terminal old result must not block the next song");

let metadata = 0;
// Separate device journals share one server claim, with commit persisted before the OS call.
{
 let committed = false, owner = "", finished = false, launches = 0, resultCalls = 0, loseCommit = false, loseClaim = false;
 const fixtureId = "99999999-9999-4999-8999-999999999999";
 const fixtures = [{ id: fixtureId, song_id: "567" }];
 const bridge = {
  list: async () => committed || finished ? [] : fixtures,
  claim: async (_id, delivery) => {
   if (owner && owner !== delivery) return { claimed: false, committed };
   owner = delivery;
   if (loseClaim) { loseClaim = false; throw Object.assign(Error("lost claim acknowledgement"), { code: "fixture_claim_lost" }); }
   return { claimed: true, committed };
  },
  commit: async (_id, delivery) => {
   assert.equal(owner, delivery); const replayed = committed; committed = true;
   if (loseCommit) { loseCommit = false; throw Object.assign(Error("lost commit acknowledgement"), { code: "fixture_commit_lost" }); }
   return { replayed };
  },
  report: async (_id, result) => { assert.equal(result.delivery_token, owner); assert.equal(committed, true); resultCalls++; finished = true; },
  open: async () => { assert.equal(committed, true); launches++; return { opened: true }; },
 };
 const device = () => { const journal = new Map(); const deviceScope = createMusicRequestScope(auth); deviceScope.bind(identity); return { scope: deviceScope, storage: { getItem: key => journal.get(key), setItem: (key, value) => journal.set(key, value) } }; };
 const a = device(), b = device();
 await Promise.all([createAiMusicConsumer({ ...a, ...bridge }).drain(), createAiMusicConsumer({ ...b, ...bridge }).drain()]);
 assert.equal(launches, 1, "two devices must not both open one request");
 owner = ""; committed = finished = false; loseClaim = true;
 const c = device(); await createAiMusicConsumer({ ...c, ...bridge }).drain(); assert.equal(launches, 1);
 await createAiMusicConsumer({ ...c, ...bridge }).drain(); assert.equal(launches, 2, "claim retries keep their original delivery id");
 owner = ""; committed = finished = false; loseCommit = true;
 const d = device(); await createAiMusicConsumer({ ...d, ...bridge }).drain(); assert.equal(launches, 2);
 let uncertainResult;
 await createAiMusicConsumer({ ...d, ...bridge, report: async (_id, result) => { uncertainResult = result; } }).drain();
 assert.equal(launches, 2, "lost commit receipt must never authorize another open"); assert.equal(uncertainResult.error, "music_ai_open_unconfirmed");
 await createAiMusicConsumer({ ...device(), ...bridge }).drain(); assert.equal(launches, 2, "committed request must not be handed to a new device");
 assert.ok(resultCalls >= 2);
 // A process recreated while its OS call was pending retains an ambiguous result, without repeating the call.
 owner = ""; committed = finished = false;
 const e = device(), waiting = deferred();
 const pendingOpen = createAiMusicConsumer({ ...e, ...bridge, open: () => waiting.promise }).drain();
 await new Promise(resolve => setTimeout(resolve, 0)); e.scope.invalidate();
 e.scope.bind(identity);
 await createAiMusicConsumer({ ...e, ...bridge, report: async (_id, result) => { uncertainResult = result; } }).drain();
 assert.equal(uncertainResult.error, "music_ai_open_unconfirmed"); assert.equal(launches, 2);
 waiting.resolve({ opened: true }); await pendingOpen;
 // An expired or superseded lease must not permanently block newer requests.
 let checked = 0;
 await createAiMusicConsumer({ ...device(), ...bridge, list: async () => [{ ...fixtures[0], id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, fixtures[0]], claim: async () => { if (++checked === 1) throw Object.assign(Error("expired"), { code: "music_ai_delivery_expired" }); return { claimed: false }; } }).drain();
 assert.equal(checked, 2);
}
const token = scope.begin("external");
const input = { scope, token, resourceType: "song", resourceId: "123", request: async () => metadata++ };
assert.deepEqual(await launchExternalMusic({ ...input, open: async () => ({ opened: false }) }), { opened: false }); assert.equal(metadata, 0, "cancelled native dialog must not confirm a launch");
await assert.rejects(launchExternalMusic({ ...input, open: async () => ({}) }), { code: "music_external_receipt_invalid" });
const opened = await launchExternalMusic({ ...input, open: async () => ({ opened: true }), request: async () => { throw Object.assign(Error("fixture server unavailable"), { code: "fixture_metadata_failed", status: 503 }); } });
assert.equal(opened.opened, true); assert.match(externalMusicFeedback(opened), /已交给网易云打开/); assert.match(externalMusicFeedback(opened), /fixture_metadata_failed/); assert.match(externalMusicFeedback(opened), /不会自动重复打开/);
scope.cancel(token); let staleOpens = 0; await assert.rejects(launchExternalMusic({ ...input, open: async () => staleOpens++ }), { code: "music_scope_changed" }); assert.equal(staleOpens, 0);

globalThis.window = { open: () => null };
await assert.rejects(openNeteasePlayback("song", "123"), { code: "music_popup_blocked" }); await assert.rejects(playNeteaseSilent("song", "123"), { code: "music_popup_blocked" });
const popup = { opener: {}, location: {}, close() {} }; window.open = () => popup;
assert.equal((await openNeteasePlayback("playlist", "123")).opened, true); assert.equal(popup.opener, null); assert.equal(popup.location.href, "https://music.163.com/#/playlist?id=123");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.doesNotMatch(app, /drainAiPlayRequests|nowPlayingPollRef/);
assert.match(app, /createAiMusicConsumer[\s\S]*consumer\.drain\(\)[\s\S]*consumer\.cancel\(\)/);
assert.match(app, /notificationAccess\.granted\s*[,\]]/, "notification recognition resumes after permission changes");
console.log("Music delivery: scoped polling, serial consumption, result-only retry/recovery, cancellation, truthful external receipts and blocked popup passed");

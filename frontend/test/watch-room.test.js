import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
function fixture(fetcher) {
  const calls = [], fetches = [], timers = [], warnings = [];
  const context = { AbortController, TextDecoder, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    console: { warn: (...args) => warnings.push(args) },
    apiRequest: async (path, options = {}) => { calls.push({ path, options }); return { room: { id: 'synthetic-room' }, message: { id: 'synthetic-message' } }; },
    apiFetch: async (path, options) => { fetches.push({ path, options }); return fetcher(path, options); } };
  const source = fs.readFileSync(new URL('../src/watch-room.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  vm.runInNewContext(source + '\nglobalThis.api = { createWatchRoom, joinWatchRoom, updateRoomPlayback, sendRoomMessage, sendRoomAiMessage, subscribeRoomEvents };', context);
  return { api: context.api, calls, fetches, timers, warnings };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 15));
test('room operations send JSON bodies with the selected code protected from overrides', async () => {
  const { api, calls } = fixture(() => { throw new Error('not used'); });
  await api.createWatchRoom({ title: 'synthetic' });
  await api.joinWatchRoom(' abc123 ', { displayName: 'fixture', join_code: 'wrong' });
  await api.updateRoomPlayback('a/b', { position: 17 });
  await api.sendRoomMessage('a/b', 'synthetic', 12);
  await api.sendRoomAiMessage('a/b', 'synthetic', 12, 'fixture');
  calls.forEach(call => { assert.equal(typeof call.options.body, 'string'); assert.doesNotThrow(() => JSON.parse(call.options.body)); });
  assert.equal(JSON.parse(calls[1].options.body).join_code, 'ABC123');
  assert.equal(JSON.parse(calls[1].options.body).display_name, 'fixture');
  assert.ok(calls[2].path.includes('a%2Fb'));
});
test('room stream uses the configured authenticated API and handles CRLF fragmented events', async () => {
  const events = [], frames = ['event:message\r\ndata:{"content":"syn', 'thetic"}\r\n\r\nevent:room_ended\r\ndata:{"roomId":"fixture"}\r\n\r\n'];
  let connected = 0;
  const { api, fetches, timers } = fixture(() => new Response(new ReadableStream({ start(c) { for (const frame of frames) c.enqueue(new TextEncoder().encode(frame)); c.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const stop = api.subscribeRoomEvents('fixture', { onConnected: () => connected++, onMessage: value => events.push(value), onRoomEnded: value => events.push(value) });
  await settle(); stop();
  assert.equal(fetches.length, 1); assert.equal(fetches[0].options.retry, false);
  assert.equal(events[0].content, 'synthetic'); assert.equal(events[1].roomId, 'fixture'); assert.equal(timers.length, 0);
  assert.equal(connected, 1);
});

test('network failures expose safe causes and allow reconnection without treating a transport abort as user cancellation', async () => {
  const errors = [];
  const f = fixture(() => { throw Object.assign(new Error('private-endpoint-token-fixture'), { name: 'AbortError' }); });
  const stop = f.api.subscribeRoomEvents('fixture', { onError: error => errors.push(error) });
  await settle();
  assert.equal(errors[0].code, 'room_stream_network_error');
  assert.doesNotMatch(errors[0].message, /private-endpoint-token-fixture/);
  assert.equal(f.timers.length, 1); stop();
});
test('permanent HTTP failure does not reconnect; invalid protocol is reported precisely', async () => {
  for (const status of [401, 403, 404, 410, 200]) {
    const errors = [];
    const { api, timers } = fixture(() => new Response('{}', { status, headers: { 'Content-Type': 'application/json' } }));
    const stop = api.subscribeRoomEvents('fixture', { onError: e => errors.push(e) });
    await settle(); stop();
    assert.equal(errors.length, 1); assert.equal(timers.length, 0);
    assert.equal(errors[0].code, status === 200 ? 'room_stream_invalid_response' : `room_stream_http_${status}`);
  }
});
test('stopped subscription cannot deliver late data or print private malformed frames', async () => {
  let complete;
  const errors = [], delivered = [];
  const f = fixture(() => new Promise(resolve => { complete = resolve; }));
  const stop = f.api.subscribeRoomEvents('fixture', { onMessage: m => delivered.push(m), onError: e => errors.push(e) });
  stop(); complete(new Response('event:message\ndata:{"content":"fixture"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  await settle(); assert.equal(delivered.length, 0); assert.equal(errors.length, 0);
  const bad = fixture(() => new Response('event:message\ndata:private-invalid-fixture\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  const stopBad = bad.api.subscribeRoomEvents('fixture'); await settle(); stopBad();
  assert.equal(bad.warnings.length, 1); assert.doesNotMatch(JSON.stringify(bad.warnings), /private-invalid-fixture/);
});

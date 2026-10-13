const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCoWatchRoomRouter, createJoinInfoHandler } = require('../routes/co-watch-rooms');
const { createRequestScope } = require('../services/request-scope');
const rooms = require('../services/co-watch-rooms');

function fixture() {
    const tables = {
        co_watch_rooms: [{ id: 'fixture-room', join_code: 'FIXTUREA', host_user_id: 'fixture-user', host_companion_id: 'fixture-companion', status: 'active', media_url: 'https://example.test/movie.mp4', playback_revision: 2, media_position_seconds: 37 }],
        co_watch_room_participants: [{ id: 'member-1', room_id: 'fixture-room', user_id: 'fixture-user', companion_id: 'fixture-companion', role: 'host', display_name: 'Fixture member', left_at: null }],
        co_watch_room_messages: [], user_display_ids: [{ user_id: 'fixture-user', display_id: 'user-display' }],
        companions: [{ id: 'fixture-companion', user_id: 'fixture-user', display_id: 'selected-display', name: 'selected' }, { id: 'other-companion', user_id: 'fixture-user', display_id: 'wrong-display' }],
    };
    const calls = [];
    const database = { from(table) {
        const filters = []; let values, inserted; const call = { table, filters }; calls.push(call);
        const execute = () => {
            if (inserted) { const row = { id: String(tables[table].length + 1), ...inserted }; tables[table].push(row); return { data: row, error: null }; }
            const matches = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
            if (values) matches.forEach(row => Object.assign(row, values));
            return { data: matches, error: null };
        };
        const query = {
            select(fields) { call.fields = fields; return query; },
            eq(key, value) { filters.push([key, value]); return query; },
            is(key, value) { filters.push([key, value]); return query; },
            order() { return query; }, limit() { return query; },
            update(input) { values = input; call.update = input; return query; },
            insert(input) { inserted = input; return query; },
            maybeSingle: async () => { const result = execute(); return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data }; },
            single: async () => { const result = execute(); return { ...result, data: Array.isArray(result.data) ? result.data[0] || null : result.data }; },
            then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
        };
        return query;
    } };
    const scope = (userId = 'fixture-user', companionId = 'fixture-companion') => {
        const companion = { id: companionId, user_id: userId, status: 'active' };
        return createRequestScope({ adminSupabase: database, user: { id: userId }, profile: { id: userId, status: 'active', role: 'member' }, companion, companions: [companion] });
    };
    return { tables, calls, database, scope };
}

test('room DTO preserves media source; member-only HTTP routes require account and companion membership', async () => {
    const f = fixture();
    const app = express(); app.use(express.json());
    app.get('/api/v2/co-watch/public-preview', createJoinInfoHandler(f.database));
    app.use((req, _res, next) => { req.scope = f.scope(req.headers['x-user'] || 'fixture-user', req.headers['x-companion'] || 'fixture-companion'); next(); });
    app.use('/api/v2/co-watch', createCoWatchRoomRouter({ database: f.database }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v2/co-watch`;
    try {
        let response = await fetch(base + '/rooms/fixture-room');
        assert.equal(response.status, 200); assert.equal((await response.json()).room.mediaUrl, 'https://example.test/movie.mp4');
        response = await fetch(base + '/public-preview?code=FIXTUREA');
        assert.equal(response.status, 200); assert.equal((await response.json()).room.mediaUrl, undefined, 'signed media sources are only returned after joining, not in public previews');
        for (const headers of [{ 'x-user': 'outsider' }, { 'x-companion': 'other-companion' }]) {
            for (const suffix of ['', '/messages', '/events']) {
                response = await fetch(base + '/rooms/fixture-room' + suffix, { headers });
                assert.equal(response.status, 403); assert.equal((await response.json()).code, 'not_participant');
                assert.notEqual(response.headers.get('content-type'), 'text/event-stream');
            }
            response = await fetch(base + '/rooms/fixture-room/ai-messages', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic reply' }) });
            assert.equal(response.status, 403); await response.arrayBuffer();
        }
        assert.equal(f.tables.co_watch_room_messages.length, 0);
        response = await fetch(base + '/display-id');
        assert.equal((await response.json()).companion_display_id, 'selected-display');
        response = await fetch(base + '/rooms/fixture-room/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic user message' }) });
        assert.equal(response.status, 201); assert.equal((await response.json()).message.senderName, 'Fixture member');
        response = await fetch(base + '/rooms/fixture-room/ai-messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'synthetic AI message' }) });
        assert.equal(response.status, 201); await response.arrayBuffer();
        response = await fetch(base + '/rooms/fixture-room/messages');
        assert.equal((await response.json()).messages.length, 2);
        const stream = await fetch(base + '/rooms/fixture-room/events');
        assert.equal(stream.status, 200);
        const reader = stream.body.getReader(); await reader.read();
        response = await fetch(base + '/rooms/fixture-room/leave', { method: 'POST' });
        assert.equal(response.status, 200); await response.arrayBuffer();
        assert.equal((await reader.read()).done, true, 'HTTP leave terminates the active SSE response');
        reader.releaseLock();
        f.tables.co_watch_room_participants[0].left_at = null;
        f.tables.co_watch_rooms[0].status = 'ended';
        response = await fetch(base + '/rooms/fixture-room/events');
        assert.equal(response.status, 410); assert.equal((await response.json()).code, 'room_ended');
        f.tables.co_watch_room_participants[0].left_at = 'fixture-date';
        response = await fetch(base + '/rooms/fixture-room/messages');
        assert.equal(response.status, 403); await response.arrayBuffer();
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('playback preserves position on pause, rejects ended rooms and scopes optimistic update', async () => {
    const f = fixture();
    const result = await rooms.updateRoomPlayback(f.database, f.scope(), 'fixture-room', { revision: 2, playback_state: 'paused' });
    assert.equal(result.mediaPositionSeconds, 37); assert.equal(result.playbackRevision, 3);
    assert.ok(f.calls.find(call => call.update)?.filters.some(([key, value]) => key === 'status' && value === 'active'));
    f.tables.co_watch_rooms[0].status = 'ended';
    await assert.rejects(rooms.updateRoomPlayback(f.database, f.scope(), 'fixture-room', { revision: 3 }), { code: 'room_ended' });
    assert.equal(f.tables.co_watch_rooms[0].playback_revision, 3);
});

test('production route registration exposes only invitation summary before global authentication', async () => {
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const begin = source.indexOf('app.use(express.json({ limit: "30mb" }));');
    const end = source.indexOf('app.use("/api/account",', begin);
    assert.ok(begin >= 0 && end > begin);
    const f = fixture(), app = express();
    vm.runInNewContext(source.slice(begin, end), { app, express, supabase: f.database, castReceiver: {}, createJoinInfoHandler,
        createCastReceiverRouter: () => express.Router(), authRequired: true, process: { env: {} },
        createAuthContextMiddleware: () => (_req, res) => res.status(401).json({ code: 'authentication_required' }),
        require: name => name.endsWith('public-bilibili') ? { createPublicBilibiliRouter: () => express.Router() } : { validateDirectMediaUrl() {} },
    });
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v2/co-watch/rooms`;
    try {
        let response = await fetch(base + '/join-info?code=FIXTUREA');
        assert.equal(response.status, 200); assert.equal((await response.json()).room.mediaUrl, undefined);
        response = await fetch(base + '/join-info?code=INVALIDA');
        assert.equal(response.status, 404); assert.equal((await response.json()).code, 'room_not_found');
        for (const suffix of ['/fixture-room', '/fixture-room/messages', '/fixture-room/events']) {
            response = await fetch(base + suffix); assert.equal(response.status, 401); await response.arrayBuffer();
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});

class ResponseFixture extends EventEmitter {
    constructor() { super(); this.frames = []; this.writableEnded = false; }
    writeHead() {}
    write(value) { this.frames.push(value); return true; }
    end() { this.writableEnded = true; this.emit('finish'); }
}
test('leaving closes only that account/companion streams; ending delivers terminal event and closes remaining streams', async () => {
    const f = fixture(); const a = new ResponseFixture(), b = new ResponseFixture();
    const scope = f.scope();
    rooms.subscribeRoomEvents('fixture-room', a, scope);
    rooms.subscribeRoomEvents('fixture-room', b, f.scope('fixture-user', 'other-companion'));
    try {
        await rooms.leaveRoom(f.database, scope, 'fixture-room');
        assert.equal(a.writableEnded, true); assert.equal(b.writableEnded, false);
        assert.ok(b.frames.some(frame => frame.includes('participant_leave')));
        await rooms.endRoom(f.database, scope, 'fixture-room');
        assert.equal(b.writableEnded, true); assert.ok(b.frames.some(frame => frame.includes('room_ended')));
        const delivered = a.frames.length;
        await rooms.endRoom(f.database, scope, 'fixture-room');
        assert.equal(a.frames.length, delivered);
    } finally { a.end(); b.end(); }
});

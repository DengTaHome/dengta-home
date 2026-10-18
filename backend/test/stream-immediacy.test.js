const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const { generateReplyStream, MAIN_CHAT_PROMPT_ARCHITECTURE } = require('../services/ai-service');
const { streamFailure, streamSuccess } = require('../services/chat-stream-contract');

async function main() {
    delete process.env.PROVIDER_OUTPUT_GUARD_DISABLED;
    let receivedFirst, providerRequest;
    const first = new Promise(resolve => { receivedFirst = resolve; });
    const events = [];
    const server = http.createServer(async (request, response) => {
        let input = '';
        for await (const chunk of request) input += chunk;
        providerRequest = JSON.parse(input);
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = content => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        delta('First answer.');
        // Withholding the rest proves the first body event does not await completion.
        await first;
        delta('[monologue]Public thought without punctuation[/monologuel');
        delta(']');
        response.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const deadline = setTimeout(() => { receivedFirst(); server.closeAllConnections(); }, 4000);
    try {
        const savedPersona = 'Synthetic personalization, unchanged.';
        const result = await generateReplyStream({
            settings: { provider: 'custom', api_url: `http://127.0.0.1:${server.address().port}/v1`, runtime_api_key: 'test-only', model: 'mock', prompt_mode: 'unified', unified_system_prompt: savedPersona },
            messages: [{ role: 'user', content: 'Hello' }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
            visibleMonologue: true,
            worldBookContext: { beforeMemoryInstruction: 'Synthetic world-book system entry.', dynamicContext: 'Synthetic world-book turn entry.' },
            onEvent(event) { events.push(event); if (event.type === 'text') receivedFirst(); }
        });
        assert.equal(result.text, 'First answer.');
        assert.equal(result.visible_monologue.text, 'Public thought without punctuation');
        assert.equal(events.find(event => event.type === 'text').content, 'First answer.');
        assert.ok(JSON.stringify(providerRequest).includes(savedPersona));
        assert.ok(JSON.stringify(providerRequest).includes('First write one [monologue]'));
        assert.ok(JSON.stringify(providerRequest).includes('Synthetic world-book system entry.'), 'streaming must deliver the selected world-book system entry');
        assert.ok(JSON.stringify(providerRequest).includes('Synthetic world-book turn entry.'), 'streaming must deliver the selected world-book turn entry');
        assert.equal(result.visible_monologue.state, 'complete');
    } finally {
        clearTimeout(deadline);
        await new Promise(resolve => server.close(resolve));
    }

    let releaseBody;
    const beforeBody = new Promise(resolve => { releaseBody = resolve; });
    const orderedEvents = [];
    const prefixServer = http.createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume request */ }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = content => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        delta('[mono');
        delta('logue]Visible character self-report.');
        await beforeBody;
        delta('[/monologue]Immediate answer.');
        response.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => prefixServer.listen(0, '127.0.0.1', resolve));
    const prefixDeadline = setTimeout(() => { releaseBody(); prefixServer.closeAllConnections(); }, 4000);
    try {
        const result = await generateReplyStream({
            settings: { provider: 'custom', api_url: `http://127.0.0.1:${prefixServer.address().port}/v1`, runtime_api_key: 'test-only', model: 'mock' },
            messages: [{ role: 'user', content: 'Synthetic hello.' }],
            promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE, visibleMonologue: true,
            onEvent(event) {
                orderedEvents.push(event);
                if (event.type === 'monologue' && event.phase === 'delta') releaseBody();
            }
        });
        const mono = orderedEvents.findIndex(event => event.type === 'monologue' && event.phase === 'delta');
        const answer = orderedEvents.findIndex(event => event.type === 'text');
        assert.ok(mono >= 0 && answer > mono, 'visible monologue reaches the client before the provider even sends body');
        assert.equal(result.text, 'Immediate answer.');
        assert.equal(result.visible_monologue.text, 'Visible character self-report.');
        assert.equal(result.visible_monologue.state, 'complete');
    } finally {
        clearTimeout(prefixDeadline);
        await new Promise(resolve => prefixServer.close(resolve));
    }

    // Execute the actual route with a suspended turn, not a copied queue implementation.
    const source = fs.readFileSync(require.resolve('../server'), 'utf8');
    const start = source.indexOf('app.post("/chat/stream"');
    const end = source.indexOf('\nasync function persistRefusalLog', start);
    let handler, completeTurn;
    const writes = [];
    const pending = new Promise(resolve => { completeTurn = resolve; });
    vm.runInNewContext(source.slice(start, end), {
        app: { post(_path, _body, fn) { handler = fn; } }, acceptChatBody() {},
        async executeChatTurn(_req, { onModelEvent }) {
            onModelEvent({ type: 'monologue', phase: 'delta', content: 'Thought.'.repeat(100) });
            onModelEvent({ type: 'text', content: 'Immediate body' });
            await pending;
            return { assistant_message: { content: 'Immediate body' } };
        },
        writeSse(_res, event) { writes.push(event); }, streamSuccess, streamFailure,
    });
    const response = { writeHead() {}, flushHeaders() {}, end() {} };
    const task = handler({}, response, error => { throw error; });
    assert.equal(writes.length, 2, 'both deltas must leave the route before completion');
    assert.equal(writes[1].content, 'Immediate body', 'monologue must not hold up body');
    completeTurn();
    await task;
    assert.equal(writes.at(-1).type, 'done');
    console.log('stream immediacy tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

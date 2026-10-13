const assert = require('node:assert/strict');
const { createVisibleMonologueSplitter, createVisibleMonologueOutput, emptyReplyBodyError } = require('../services/visible-monologue-stream');
const { streamFailure } = require('../services/chat-stream-contract');

function parse(chunks) {
    const parser = createVisibleMonologueSplitter();
    let text = '', monologue = '';
    for (const chunk of chunks) {
        const result = parser.push(chunk);
        text += result.textDelta;
        monologue += result.monologueDelta;
    }
    const tail = parser.finish();
    return { text: text + tail.textDelta, monologue: monologue + tail.monologueDelta, state: tail.state };
}

for (const [source, text, monologue] of [
    ['[monologue]A thought.[/monologuel]Actual answer.', 'Actual answer.', 'A thought.'],
    ['[MONOLOGUE ]A thought.[/MONOLOGUE ]Actual answer.', 'Actual answer.', 'A thought.'],
    ['Actual answer.[monologue]A thought.[/monologue]', 'Actual answer.', 'A thought.'],
    ['Answer [link](https://example.test).', 'Answer [link](https://example.test).', ''],
    ['Hi 😀.[monologue]Hello 🌈.[/monologue]', 'Hi 😀.', 'Hello 🌈.'],
]) {
    const expected = { text, monologue, state: monologue ? 'complete' : 'missing' };
    for (let cut = 1; cut < source.length; cut++) {
        assert.deepEqual(parse([source.slice(0, cut), source.slice(cut)]), expected, `split at ${cut}`);
    }
    assert.deepEqual(parse(source.split('')), expected, 'one UTF-16 code unit per delta');
}
const events = [];
const custom = createVisibleMonologueSplitter({ openMarker: '<note>', closeMarker: '</note>' });
assert.equal(custom.push('Answer<no').textDelta, 'Answer');
assert.equal(custom.push('te>Thought</no').monologueDelta, 'Thought');
assert.equal(custom.push('te>').justClosed, true);
assert.equal(custom.finish().state, 'complete');
const onlyMonologue = createVisibleMonologueOutput({ enabled: true, onEvent: event => events.push(event) });
onlyMonologue.pushText('[monologue]Only a thought.[/monologue]');
assert.equal(onlyMonologue.finish().visible_monologue, null, 'no success snapshot without a body');
assert.equal(events.at(-1).state, 'failed');
const error = streamFailure(emptyReplyBodyError(), { userMessageCommitted: true });
assert.equal(error.code, 'reply_body_missing');
assert.equal(error.error_source, 'dengta_stream_parser');
assert.equal(error.provider_phase, 'output_parse');
const unclosed = createVisibleMonologueOutput({ enabled: true });
unclosed.pushText('Answer first.[monologue]Optional fragment');
assert.equal(unclosed.finish().text, 'Answer first.');
assert.equal(unclosed.finish().visible_monologue.state, 'truncated');
console.log('monologue boundary tests passed');

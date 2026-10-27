const assert = require("node:assert/strict");
const {
    createControlTokenScrubber,
    scrubControlTokens
} = require("../services/control-token-guard");

// 生产截图里真实出现的三种标记
const STICKER = "<|selectcompanionsticker: bear-hug|>";
const SUGGESTIONS = "<|selectreplysuggestions: 抱紧点，今天哪里都不去。|把腿盘上来，让我靠一会儿。|>";
const STATUS =
    '<|updatecompanionstatus: {"mood":"温柔又带点掌控欲","place":"卧室床边",' +
    '"focus":"回应奶油的撒娇和称呼","note":"她叫了主人，我顺势回应，给了个温柔的吻。",' +
    '"energyLevel":48,"pulseBpm":102,"hotZones":["heart","hand"]}|>';

// --- 完整文本清洗 ---

{
    const result = scrubControlTokens(`我抱紧你。${STICKER}然后就不说话了。`);
    assert.equal(result.text, "我抱紧你。然后就不说话了。", "a sticker token is removed and the prose around it survives");
    assert.equal(result.removed.length, 1, "the removal is recorded");
    assert.equal(result.removed[0].kind, "control_token", "the removal is classified");
}

{
    // 截图里最刺眼的就是这个：带换行的 JSON 标记
    const result = scrubControlTokens(`晚安。${STATUS}`);
    assert.equal(result.text, "晚安。", "a JSON status token with commas and quotes is removed");
    assert.equal(result.removed.length, 1, "one token recorded");
}

{
    const result = scrubControlTokens(`${STICKER}${SUGGESTIONS}${STATUS}`);
    assert.equal(result.text, "", "three back-to-back tokens leave no visible text");
    assert.equal(result.removed.length, 3, "each token is recorded");
}

{
    // 未闭合的尾巴——截图底部那半截
    const result = scrubControlTokens('晚安。<|updatecompanionstatus: {"mood":"温柔');
    assert.equal(result.text, "晚安。", "an unterminated trailing token is dropped, not shown");
    assert.equal(result.removed.length, 1, "the dropped tail is recorded");
    assert.equal(result.removed[0].kind, "truncated_tail", "the tail is classified separately");
}

{
    // 正常文本不能被误伤
    const plain = "3 < 5，而且 a|b 这种写法也正常，C++ 里的 a<b 也是。";
    const result = scrubControlTokens(plain);
    assert.equal(result.text, plain, "ordinary angle brackets and pipes are untouched");
    assert.equal(result.removed.length, 0, "nothing is recorded for plain text");
}

{
    // 标记后面还有正文时，正文必须保留
    const result = scrubControlTokens(`${STICKER}我还在。`);
    assert.equal(result.text, "我还在。", "text after a token is preserved");
}

{
    const result = scrubControlTokens("");
    assert.equal(result.text, "", "empty input stays empty");
}

{
    const result = scrubControlTokens(null);
    assert.equal(result.text, "", "null input degrades to an empty string");
}

// --- 流式清洗：跨分片 ---

{
    const scrubber = createControlTokenScrubber();
    // 刻意在标记中间切开
    const a = scrubber.push("我抱紧你。<|selectcomp");
    const b = scrubber.push("anionsticker: bear-hug|>然后就不说");
    const c = scrubber.push("话了。");
    const tail = scrubber.flush();

    assert.equal(a, "我抱紧你。", "text before the token is emitted immediately");
    assert.equal(b, "然后就不说", "the token is dropped even when split across chunks");
    assert.equal(c, "话了。", "the remainder flows through");
    assert.equal(tail, "", "nothing is left over");
    assert.equal(scrubber.removed.length, 1, "the split token is still recorded exactly once");
}

{
    // 分片边界正好落在 "<" 上
    const scrubber = createControlTokenScrubber();
    const a = scrubber.push("abc");
    const b = scrubber.push("<");
    const c = scrubber.push("|x:y|>def");
    assert.equal(a, "abc", "plain text is emitted");
    assert.equal(b, "", "a trailing '<' is held back because it may start a token");
    assert.equal(c, "def", "the held '<' recombines with the rest and the token is dropped");
    assert.equal(scrubber.flush(), "", "flush has nothing left");
}

{
    // 流式场景下未闭合尾巴也必须在收尾时丢掉
    const scrubber = createControlTokenScrubber();
    const visible = scrubber.push("晚安。<|updatecompanionstatus: {");
    assert.equal(visible, "晚安。", "text before the open token is shown");
    assert.equal(scrubber.flush(), "", "the open token is discarded at flush time");
}

{
    // 一个孤立的 "<|" 不该吞掉后面的正文
    const scrubber = createControlTokenScrubber({ maxTokenLength: 50 });
    const chunk = `<|${"x".repeat(200)}`;
    const visible = scrubber.push(chunk);
    assert.ok(visible.startsWith("<|"), "an over-long opener is treated as prose, not swallowed");
    assert.equal(scrubber.removed[0].kind, "unterminated", "the over-long case is classified");
}

console.log(
    "Control token guard: closed tokens, multiline JSON, back-to-back tokens, unterminated tails, plain-text safety, chunk-split tokens and over-long openers passed"
);

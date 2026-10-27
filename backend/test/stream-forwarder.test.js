const assert = require("node:assert/strict");
const { createModelEventForwarder } = require("../services/stream-forwarder");
const { createControlTokenScrubber } = require("../services/control-token-guard");

// 记录前端收到的每一个事件、落库器收到的每一段文本。
function harness({ withScrubber = true } = {}) {
    const events = [];
    const persisted = [];
    const forwarder = createModelEventForwarder({
        onModelEvent: (event) => events.push(event),
        controlTokens: withScrubber ? createControlTokenScrubber() : null,
        streamPersister: { push: async (text) => { persisted.push(text); } }
    });
    return { forwarder, events, persisted };
}

(async () => {
    // --- 回归：聊天流用的是 content，不是 text ---
    // 这条就是 B-1：转发器曾经只看 event.text，导致清洗器和落库器全程空转。
    {
        const { forwarder, events, persisted } = harness();
        forwarder.forward({ type: "text", content: "我抱紧你" });
        assert.equal(events.length, 1, "a content-only delta must reach the client");
        assert.equal(events[0].content, "我抱紧你", "the delta is forwarded as content");
        assert.equal(persisted.length, 1, "the same delta must be handed to the persister");
        assert.equal(persisted[0], "我抱紧你", "the persister receives the cleaned text");
        assert.equal(forwarder.getStreamedText(), "我抱紧你", "streamed text is accumulated for later use");
    }

    // --- 兼容旧字段 text ---
    {
        const { forwarder, events } = harness();
        forwarder.forward({ type: "text", text: "旧字段" });
        assert.equal(events[0].content, "旧字段", "a text-field delta is normalised to content");
        assert.equal(events[0].text, undefined, "the legacy field is cleared so it cannot render twice");
    }

    // --- 控制标记必须从转发和落库两条路都消掉 ---
    {
        const { forwarder, events, persisted } = harness();
        forwarder.forward({ type: "text", content: "你好<|selectcompanionsticker: bear-hug|>呀" });
        const visible = events.map((e) => e.content).join("");
        assert.equal(visible, "你好呀", "leaked markup never reaches the client");
        assert.equal(persisted.join(""), "你好呀", "leaked markup never reaches the database either");
        assert.equal(forwarder.getStreamedText(), "你好呀", "the accumulated text is already clean");
    }

    // --- 非文本事件原样透传 ---
    {
        const { forwarder, events, persisted } = harness();
        forwarder.forward({ type: "status", stage: "generating" });
        forwarder.forward({ type: "reasoning", content: "思考中" });
        assert.equal(events.length, 2, "non-text events pass through");
        assert.equal(events[1].content, "思考中", "non-text events keep their payload untouched");
        assert.equal(persisted.length, 0, "non-text events are not persisted as reply text");
        assert.equal(forwarder.getStreamedText(), "", "non-text events do not pollute the reply body");
    }

    // --- 没有清洗器时也要落库（否则又是同一种空转）---
    {
        const { forwarder, events, persisted } = harness({ withScrubber: false });
        forwarder.forward({ type: "text", content: "裸文本" });
        assert.equal(events[0].content, "裸文本");
        assert.equal(persisted[0], "裸文本", "persistence must not depend on having a scrubber");
    }

    // --- 结尾半截标记：丢弃，不是放出来 ---
    // 契约来源：一次性清洗 scrubControlTokens 对未闭合标记返回 kind "truncated_tail"
    // 并把它从正文里删掉；流式清洗器的 flush() 同样返回空串。所以结尾的半截标记
    // 既不该显示，也不该落库——它只可能是模型写坏的协议片段。
    {
        const { forwarder, events, persisted } = harness();
        forwarder.forward({ type: "text", content: "前面的话<|selectcompanionsticker: be" });
        const visible = events.map((e) => e.content).join("");
        assert.equal(visible, "前面的话", "an unterminated marker never reaches the client");
        forwarder.flushTail();
        assert.equal(
            events.map((e) => e.content).join(""),
            "前面的话",
            "flushTail must not resurrect the discarded half-marker"
        );
        assert.equal(persisted.join(""), "前面的话", "the persisted text equals what the user saw");
    }

    // --- 构造校验 ---
    {
        assert.throws(() => createModelEventForwarder({}), /requires onModelEvent/);
    }

    console.log(
        "Stream forwarder: content field, legacy text field, markup scrubbing on both paths, non-text passthrough, persistence without a scrubber, flush tail and constructor guard passed"
    );
})();

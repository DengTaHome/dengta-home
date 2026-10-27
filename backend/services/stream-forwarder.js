/**
 * 模型流式事件的转发器。
 *
 * 从 server.js 里抽出来的原因：这段逻辑以前内联在 executeChatTurnOnce 里，
 * 完全没有测试覆盖——结果出现过一个致命错配：日志说「已过滤控制标记、已增量落库」，
 * 实际上转发器检查的是 event.text，而聊天流发出的是 { type: "text", content }，
 * 于是清洗器和落库器一次都没被调用过。
 *
 * 现在把它做成纯模块，明确约定：
 *   - 文本增量只认 content（同时兼容 text，早期 provider 适配器用过）；
 *   - 转发给前端的事件一律把清洗后的文本写进 content，客户端只读 content；
 *   - 累积的正文（streamedText）由调用方取用，用于「拒答也要保留」等场景；
 *   - 落库器收到的和前端看到的必须是同一份清洗后文本。
 */

/**
 * @param {object} options
 * @param {(event: object) => void} options.onModelEvent 把事件推给前端
 * @param {{push: Function, flush: Function}} [options.controlTokens] 控制标记清洗器
 * @param {{push: Function}} [options.streamPersister] 增量落库器
 * @param {() => void} [options.onText] 每收到一段可见文本时调用（用于停止等待进度等）
 * @returns {{ forward: (event: object) => void, flushTail: () => void, getStreamedText: () => string }}
 */
function createModelEventForwarder({
    onModelEvent,
    controlTokens = null,
    streamPersister = null,
    onText = null
} = {}) {
    if (typeof onModelEvent !== "function") {
        throw new Error("createModelEventForwarder requires onModelEvent.");
    }

    let streamedText = "";

    function emitClean(clean, originalEvent) {
        streamedText += clean;
        if (onText) onText(clean);
        // 不 await：落库是保险，不能让它的延迟拖慢逐字显示。
        if (streamPersister) void streamPersister.push(clean);
        // 客户端只读 content：统一写进 content，并清掉旧字段避免重复渲染。
        onModelEvent({ ...originalEvent, content: clean, text: undefined });
    }

    function forward(event) {
        // 只处理文本增量；其余事件原样透传。
        if (event?.type !== "text") {
            onModelEvent(event);
            return;
        }
        const delta =
            typeof event.content === "string"
                ? event.content
                : typeof event.text === "string"
                  ? event.text
                  : null;
        if (delta === null) {
            onModelEvent(event);
            return;
        }
        // 没有清洗器时也要走「累积 + 落库」，否则落库器同样会被跳过。
        const clean = controlTokens ? controlTokens.push(delta) : delta;
        if (!clean) return;
        emitClean(clean, event);
    }

    /** 生成结束时把清洗器里还挂着的半句放出来（同样要落库）。 */
    function flushTail() {
        if (!controlTokens) return;
        const tail = controlTokens.flush();
        if (!tail) return;
        emitClean(tail, { type: "text" });
    }

    return {
        forward,
        flushTail,
        getStreamedText: () => streamedText
    };
}

module.exports = { createModelEventForwarder };

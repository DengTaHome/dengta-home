/**
 * 模型控制标记清洗器。
 *
 * 问题（生产环境实测）：模型把内部工具标记直接写进正文，例如
 *
 *   <|selectcompanionsticker: bear-hug|>
 *   <|selectreplysuggestions: 抱紧点 / 把腿盘上来|>
 *   <|updatecompanionstatus: {"mood":"…","energyLevel":48,…}|>
 *
 * 这些标记本该被解析成工具调用，但没有被识别，于是原样写进消息并渲染给用户。
 * 截图里整段聊天记录都被这种标记污染，包括一个没闭合的尾片段。
 *
 * 本模块的职责很窄：**把机器标记从可见文本里拿掉**，并如实记录移除了什么，
 * 供诊断使用。它不猜工具语义——解析失败是另一个问题，泄漏是必须马上堵住的。
 *
 * 两种用法：
 *   scrubControlTokens(text)            —— 一次性，用于已经拿到的完整输出
 *   createControlTokenScrubber()        —— 流式，跨分片保持状态
 *
 * 流式场景必须用它，因为标记会跨 chunk 断开（"…见<|sel" + "ect:x|>…"），
 * 而且未闭合的尾巴也要丢掉，否则最后那半截会留在屏幕上。
 */

// 允许出现在标记体里的最大长度。超过就判定「这不是标记，是正文」，立刻原样输出。
//
// 这个值刻意很小：产品要求「生成的每个字都要立刻显示，不允许缓冲到生成结束」。
// 所以扣留窗口必须短——真正没闭合的标记最多压住 120 个字符就放行，
// 绝不会等整轮生成完（4000 那种默认值会违反上面这条要求）。
const DEFAULT_MAX_TOKEN_LENGTH = 120;

function findOpener(text, from) {
    for (let i = from; i < text.length; i += 1) {
        if (text[i] !== "<" && text[i] !== "|") continue;
        if (text.startsWith("<|", i) || text.startsWith("|<", i)) return i;
    }
    return -1;
}

function createControlTokenScrubber({ maxTokenLength = DEFAULT_MAX_TOKEN_LENGTH } = {}) {
    let pending = "";
    const removed = [];

    function record(token, kind) {
        if (removed.length < 20) removed.push({ token: token.slice(0, 200), kind });
    }

    /**
     * 输入一段新文本，返回现在可以安全显示的部分。
     * 可能是空字符串——那表示「这一段全在标记里」或「还没法判断」。
     */
    function push(chunk) {
        if (!chunk) return "";
        pending += String(chunk);
        let visible = "";

        for (;;) {
            const opener = findOpener(pending, 0);
            if (opener < 0) {
                // 没有标记起点。只扣住末尾一个可能是标记开头的字符。
                const last = pending[pending.length - 1];
                const holdBack = last === "<" || last === "|" ? 1 : 0;
                visible += pending.slice(0, pending.length - holdBack);
                pending = pending.slice(pending.length - holdBack);
                return visible;
            }

            visible += pending.slice(0, opener);

            const close = pending.indexOf("|>", opener + 2);
            if (close < 0) {
                // 还没闭合。等下一个分片；但别无限等下去。
                if (pending.length - opener > maxTokenLength) {
                    record(pending.slice(opener), "unterminated");
                    visible += pending.slice(opener);
                    pending = "";
                } else {
                    pending = pending.slice(opener);
                }
                return visible;
            }

            record(pending.slice(opener, close + 2), "control_token");
            pending = pending.slice(close + 2);
        }
    }

    /** 收尾：把还挂着的半截标记丢掉，其余原样吐出。 */
    function flush() {
        if (!pending) return "";
        const opener = findOpener(pending, 0);
        let tail;
        if (opener < 0) {
            tail = pending;
        } else {
            // 标记之后的正常文本仍要保留。
            tail = pending.slice(0, opener);
            record(pending.slice(opener), "truncated_tail");
        }
        pending = "";
        return tail;
    }

    return {
        push,
        flush,
        get removed() {
            return removed.slice();
        },
        get pendingLength() {
            return pending.length;
        }
    };
}

/** 一次性清洗完整文本。 */
function scrubControlTokens(text) {
    if (typeof text !== "string" || !text) {
        return { text: typeof text === "string" ? text : "", removed: [] };
    }
    const scrubber = createControlTokenScrubber();
    const clean = scrubber.push(text) + scrubber.flush();
    return { text: clean, removed: scrubber.removed };
}

module.exports = {
    createControlTokenScrubber,
    scrubControlTokens,
    DEFAULT_MAX_TOKEN_LENGTH
};

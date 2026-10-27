/**
 * 流式回复的增量落库。
 *
 * 产品要求（owner 决定）：生成出来的每个字立刻显示、已显示的绝不撤回、
 * 已生成的立刻落库、断连不取消上游生成。
 *
 * 因此这里做的是「边生成边写库」：每积累到一定量或过了一小段时间，就把当前
 * 已生成的全部正文 upsert 进 stream_partials。生成结束时由调用方调 finish()，
 * 正式消息写好后这一行会被删掉；如果中途崩了，这一行就是断线恢复的唯一凭据。
 *
 * 设计取舍：
 *   - 写入的是**全量文本**而不是增量：upsert 只留最新一份，读回来不需要拼接，
 *     也不会因为丢一个分片就得到残缺内容。
 *   - 写库失败只记日志、不打断生成：落库是保险，不是主链路。
 *   - 节流按「字符数或时间」双阈值：短回复不会每字一次写库，长回复也不会
 *     攒到结束才写。
 */

const DEFAULT_MIN_CHARS = 200;
const DEFAULT_MIN_INTERVAL_MS = 750;
// 超过这个时间的缓冲行视为「那一轮已经彻底死了」，不再当成进行中的回复，
// 顺手删掉，避免永久残留。
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

function createStreamPersister({
    database,
    user_id,
    companionId,
    conversationId,
    clientMessageId,
    minChars = DEFAULT_MIN_CHARS,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    now = () => Date.now(),
    logger = console
} = {}) {
    if (!database || typeof database.from !== "function") {
        throw new Error("createStreamPersister requires a database client.");
    }
    if (!conversationId || !clientMessageId) {
        throw new Error(
            "createStreamPersister requires conversationId and clientMessageId."
        );
    }

    let lastWrittenChars = 0;
    let lastWrittenAt = 0;
    let latest = "";
    let revisions = 0;
    let written = 0;
    let failed = 0;
    // 写入串行化。push 是 fire-and-forget，如果不排队，
    // flush/finish 可能在 upsert 还在飞的时候就跑完——finish 的删除会被
    // 迟到的 upsert 干掉，缓冲行又复活。所有写操作都挂在这条链上。
    let writeChain = Promise.resolve();

    function write(snapshot) {
        const task = writeChain.then(() => writeNow(snapshot));
        writeChain = task.catch(() => {});
        return task;
    }

    async function writeNow(snapshot) {
        const row = {
            content: snapshot,
            updated_at: new Date(now()).toISOString(),
            revisions
        };
        // user_id / companion_id 由调用方的 scoped database 补齐时不要覆盖，
        // 因此只在显式传入时才写。
        if (user_id) row.user_id = user_id;
        if (companionId) row.companion_id = companionId;
        row.conversation_id = conversationId;
        row.client_message_id = clientMessageId;

        try {
            const { error } = await database
                .from("stream_partials")
                .upsert(row, { onConflict: "user_id,companion_id,conversation_id,client_message_id" });
            if (error) {
                failed += 1;
                logger.warn?.("[stream-persist] upsert failed:", error.message || error);
                return false;
            }
            written += 1;
            return true;
        } catch (error) {
            failed += 1;
            logger.warn?.("[stream-persist] upsert threw:", error?.message || error);
            return false;
        }
    }

    /**
     * 收到一段新的可见文本。满足阈值才真的写库，返回是否写了。
     */
    async function push(text) {
        if (typeof text !== "string" || !text) return false;
        latest += text;
        const at = now();
        const grewEnough = latest.length - lastWrittenChars >= minChars;
        const waitedEnough = at - lastWrittenAt >= minIntervalMs;
        if (!grewEnough && !waitedEnough) return false;
        if (lastWrittenAt === 0 && latest.length < minChars) {
            // 第一次写入不要因为「时间到了」就写一个很短的片段，
            // 否则每轮开头都会多一次小写入。
            lastWrittenAt = at;
            return false;
        }
        lastWrittenChars = latest.length;
        lastWrittenAt = at;
        revisions += 1;
        return write(latest);
    }

    /** 无论阈值如何，把当前内容写一次（用于生成刚结束时）。 */
    async function flush() {
        await writeChain;
        if (!latest) return false;
        if (latest.length === lastWrittenChars) return false;
        lastWrittenChars = latest.length;
        lastWrittenAt = now();
        revisions += 1;
        return write(latest);
    }

    /** 正式消息已落库，删掉这一行缓冲。失败不影响主流程。 */
    async function finish() {
        await writeChain;
        try {
            const { error } = await database
                .from("stream_partials")
                .delete()
                .eq("conversation_id", conversationId)
                .eq("client_message_id", clientMessageId);
            if (error) {
                logger.warn?.("[stream-persist] cleanup failed:", error.message || error);
                return false;
            }
            return true;
        } catch (error) {
            logger.warn?.("[stream-persist] cleanup threw:", error?.message || error);
            return false;
        }
    }

    return {
        push,
        flush,
        finish,
        get content() {
            return latest;
        },
        get stats() {
            return { written, failed, revisions, chars: latest.length };
        }
    };
}

/** 构造校验用：把持久化器与读取器分开导出前先定义读取器。 */
async function readStreamPartial({
    database,
    conversationId,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    now = () => Date.now(),
    logger = console
} = {}) {
    if (!database || typeof database.from !== "function" || !conversationId) return null;

    try {
        const { data, error } = await database
            .from("stream_partials")
            .select("client_message_id, content, updated_at")
            .eq("conversation_id", conversationId)
            .order("updated_at", { ascending: false })
            .limit(1);
        if (error || !Array.isArray(data) || data.length === 0) return null;

        const row = data[0];
        const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : NaN;
        const age = Number.isFinite(updatedAt) ? now() - updatedAt : Infinity;

        if (!row?.content || age > maxAgeMs || age < -60_000) {
            // 空内容、太旧、或时间戳明显异常（时钟漂移）：清掉这一轮残留。
            try {
                await database
                    .from("stream_partials")
                    .delete()
                    .eq("conversation_id", conversationId);
            } catch {
                // 清理失败不影响本次读取结论。
            }
            return null;
        }

        return {
            clientMessageId: row.client_message_id,
            content: row.content,
            updatedAt: row.updated_at
        };
    } catch (error) {
        // 老部署上这张表可能还不存在；读不到就当没有，不能让历史接口 500。
        logger.warn?.("[stream-persist] read failed:", error?.message || error);
        return null;
    }
}

module.exports = {
    createStreamPersister,
    readStreamPartial,
    DEFAULT_MIN_CHARS,
    DEFAULT_MIN_INTERVAL_MS,
    DEFAULT_MAX_AGE_MS
};

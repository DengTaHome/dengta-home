const assert = require("node:assert/strict");
const { readStreamPartial } = require("../services/stream-persistence");

// 只实现读取路径用到的链式调用。
function createFakeDatabase({ rows = [], queryError = null, throws = null } = {}) {
    const calls = { deletes: 0, selects: 0 };
    const database = {
        from(table) {
            assert.equal(table, "stream_partials", "only the partial buffer table is read");
            const selectChain = {
                select() {
                    return selectChain;
                },
                eq() {
                    return selectChain;
                },
                order() {
                    return selectChain;
                },
                async limit() {
                    calls.selects += 1;
                    if (throws) throw throws;
                    return { data: rows, error: queryError };
                }
            };
            const deleteChain = {
                eq() {
                    return deleteChain;
                },
                then(resolve) {
                    calls.deletes += 1;
                    resolve({ error: null });
                }
            };
            return {
                ...selectChain,
                delete: () => deleteChain
            };
        }
    };
    return { database, calls };
}

const NOW = 1_700_000_000_000;
const fresh = new Date(NOW - 5_000).toISOString();
const stale = new Date(NOW - 20 * 60 * 1000).toISOString();

(async () => {
    // --- 新鲜缓冲：返回内容 ---
    {
        const { database, calls } = createFakeDatabase({
            rows: [{ client_message_id: "client-1", content: "我抱紧你，然后", updated_at: fresh }]
        });
        const partial = await readStreamPartial({ database, conversationId: "conv-1", now: () => NOW });
        assert.deepEqual(partial, {
            clientMessageId: "client-1",
            content: "我抱紧你，然后",
            updatedAt: fresh
        }, "a fresh partial is returned with its content and identity");
        assert.equal(calls.deletes, 0, "a fresh partial is not cleaned up");
    }

    // --- 过期缓冲：返回 null 并清理 ---
    {
        const { database, calls } = createFakeDatabase({
            rows: [{ client_message_id: "client-2", content: "旧内容", updated_at: stale }]
        });
        const partial = await readStreamPartial({ database, conversationId: "conv-1", now: () => NOW });
        assert.equal(partial, null, "a partial older than the max age is not surfaced");
        assert.equal(calls.deletes, 1, "a stale partial is cleaned up");
    }

    // --- 空内容：不当作流式中 ---
    {
        const { database } = createFakeDatabase({
            rows: [{ client_message_id: "client-3", content: "", updated_at: fresh }]
        });
        const partial = await readStreamPartial({ database, conversationId: "conv-1", now: () => NOW });
        assert.equal(partial, null, "an empty partial is ignored");
    }

    // --- 没有行 ---
    {
        const { database, calls } = createFakeDatabase({ rows: [] });
        const partial = await readStreamPartial({ database, conversationId: "conv-1", now: () => NOW });
        assert.equal(partial, null, "no rows means no streaming reply");
        assert.equal(calls.deletes, 0, "nothing to clean up");
    }

    // --- 查询返回 error：安静降级 ---
    {
        const warnings = [];
        const { database } = createFakeDatabase({ queryError: { message: "permission denied" } });
        const partial = await readStreamPartial({
            database,
            conversationId: "conv-1",
            now: () => NOW,
            logger: { warn: (...args) => warnings.push(args.join(" ")) }
        });
        assert.equal(partial, null, "a query error degrades to no partial");
    }

    // --- 表还不存在（老部署）：不能抛 ---
    {
        const warnings = [];
        const { database } = createFakeDatabase({ throws: new Error("relation does not exist") });
        const partial = await readStreamPartial({
            database,
            conversationId: "conv-1",
            now: () => NOW,
            logger: { warn: (...args) => warnings.push(args.join(" ")) }
        });
        assert.equal(partial, null, "a missing table degrades to no partial");
        assert.equal(warnings.length, 1, "the failure is logged once");
    }

    // --- 缺参数 ---
    {
        assert.equal(await readStreamPartial({ conversationId: "c" }), null, "no database means null");
        const { database } = createFakeDatabase({ rows: [] });
        assert.equal(await readStreamPartial({ database }), null, "no conversationId means null");
    }

    console.log(
        "Stream partial read: fresh row, stale cleanup, empty content, no rows, query error, missing table and missing arguments passed"
    );
})();

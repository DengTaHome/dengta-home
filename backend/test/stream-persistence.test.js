const assert = require("node:assert/strict");
const { createStreamPersister, readStreamPartial } = require("../services/stream-persistence");

// 一个够用的 supabase 替身：记录 upsert / delete 调用。
function createFakeDatabase({ failUpsert = false, failDelete = false } = {}) {
    const calls = { upserts: [], deletes: 0 };
    const database = {
        from(table) {
            assert.equal(table, "stream_partials", "only the partial buffer table is touched");
            return {
                async upsert(row, options) {
                    calls.upserts.push({ row, options });
                    if (failUpsert) return { error: { message: "boom" } };
                    return { error: null };
                },
                delete() {
                    const chain = {
                        eq() {
                            return chain;
                        },
                        async then(resolve) {
                            calls.deletes += 1;
                            resolve({ error: failDelete ? { message: "boom" } : null });
                        }
                    };
                    return chain;
                }
            };
        }
    };
    return { database, calls };
}

const base = {
    user_id: "user-1",
    companionId: "companion-1",
    conversationId: "conv-1",
    clientMessageId: "client-1"
};

(async () => {
    // --- 短回复：不该每字一写 ---
    {
        let clock = 1000;
        const { database, calls } = createFakeDatabase();
        const persister = createStreamPersister({ database, ...base, now: () => clock });

        for (const chunk of ["你", "好", "呀"]) {
            await persister.push(chunk);
            clock += 10;
        }
        assert.equal(calls.upserts.length, 0, "tiny early chunks do not hit the database");

        // 时间到了就该写一次
        clock += 1000;
        await persister.push("！");
        assert.equal(calls.upserts.length, 1, "the interval threshold forces a write");
        assert.equal(calls.upserts[0].row.content, "你好呀！", "the write carries the full accumulated text");
        assert.equal(
            calls.upserts[0].options.onConflict,
            "user_id,companion_id,conversation_id,client_message_id",
            "the upsert targets the composite key"
        );
    }

    // --- 长回复：按字符数阈值写 ---
    {
        let clock = 1000;
        const { database, calls } = createFakeDatabase();
        const persister = createStreamPersister({ database, ...base, minChars: 10, now: () => clock });
        await persister.push("0123456789");
        // 第一次：时间未到且字符刚够 —— 仍会写，因为 ≥ minChars
        assert.equal(calls.upserts.length, 1, "reaching the character threshold writes");

        await persister.push("abcdefghij");
        assert.equal(calls.upserts.length, 2, "the next full window writes again");
        assert.equal(calls.upserts[1].row.content, "0123456789abcdefghij", "each write is the full snapshot, not a delta");
    }

    // --- flush 无视阈值 ---
    {
        const clock = 1000;
        const { database, calls } = createFakeDatabase();
        const persister = createStreamPersister({ database, ...base, now: () => clock });
        await persister.push("短短一句");
        assert.equal(calls.upserts.length, 0, "nothing written yet");
        await persister.flush();
        assert.equal(calls.upserts.length, 1, "flush writes regardless of thresholds");
        await persister.flush();
        assert.equal(calls.upserts.length, 1, "flushing twice without new text does not write again");
    }

    // --- finish 清理缓冲 ---
    {
        const { database, calls } = createFakeDatabase();
        const persister = createStreamPersister({ database, ...base, now: () => 1000 });
        await persister.push("x".repeat(500));
        const ok = await persister.finish();
        assert.equal(ok, true, "cleanup reports success");
        assert.equal(calls.deletes, 1, "the partial row is deleted once the real message exists");
    }

    // --- 写库失败不打断生成 ---
    {
        const warnings = [];
        const { database } = createFakeDatabase({ failUpsert: true, failDelete: true });
        const persister = createStreamPersister({
            database,
            ...base,
            now: () => 1000,
            logger: { warn: (...args) => warnings.push(args.join(" ")) }
        });
        await persister.push("y".repeat(500));
        assert.equal(persister.stats.failed, 1, "the failure is counted");
        assert.equal(persister.content.length, 500, "the accumulated text is still available to the caller");
        assert.equal(persister.stats.written, 0, "nothing was recorded as written");
        await persister.finish();
        assert.ok(warnings.length >= 2, "both failures are logged");
    }

    // --- 构造校验 ---
    {
        assert.throws(() => createStreamPersister({}), /requires a database client/);
        const { database } = createFakeDatabase();
        assert.throws(
            () => createStreamPersister({ database, conversationId: "c" }),
            /requires conversationId and clientMessageId/
        );
    }

    console.log(
        "Stream persistence: interval and character thresholds, full-snapshot writes, flush, cleanup, failure tolerance and constructor guards passed"
    );
})();
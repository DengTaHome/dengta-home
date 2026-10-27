const assert = require("node:assert/strict");
const { createDeepHealthProbe } = require("../services/health-deep");

function createFakeDatabase({ error = null, throws = null, count = 0 } = {}) {
    const calls = { queries: 0 };
    const database = {
        from(table) {
            assert.equal(table, "settings", "the probe reads a small, always-present table");
            const query = {
                select(columns, options) {
                    assert.equal(columns, "user_id", "the probe selects one column");
                    assert.deepEqual(options, { head: true, count: "exact" }, "the probe asks for a head request");
                    return query;
                },
                async limit(rows) {
                    assert.equal(rows, 1, "the probe reads at most one row");
                    calls.queries += 1;
                    if (throws) throw throws;
                    return { error, count };
                }
            };
            return query;
        }
    };
    return { database, calls };
}

(async () => {
    // --- 健康 ---
    {
        const { database, calls } = createFakeDatabase();
        let clock = 1_000_000;
        const probe = createDeepHealthProbe({ database, cacheMs: 60_000, now: () => clock });

        const first = await probe.check();
        assert.equal(first.status, 200, "a healthy database answers 200");
        assert.equal(first.body.ok, true, "the body reports ok");
        assert.equal(first.body.database, "ok", "the database field is explicit");
        assert.equal(first.body.cached, false, "the first call is not cached");
        assert.equal(typeof first.body.latencyMs, "number", "latency is reported");
        assert.equal(calls.queries, 1, "the first call hits the database once");

        // 缓存命中：不再打库
        clock += 1_000;
        const second = await probe.check();
        assert.equal(second.status, 200, "a cached healthy answer stays 200");
        assert.equal(second.body.cached, true, "the second call reports cached");
        assert.equal(calls.queries, 1, "a cached call does not hit the database");
        assert.equal(second.body.checkedAt, first.body.checkedAt, "the timestamp is the probe time, not the call time");

        // 缓存过期：重新打库
        clock += 60_000;
        const third = await probe.check();
        assert.equal(third.body.cached, false, "the cache expires after the TTL");
        assert.equal(calls.queries, 2, "an expired cache hits the database again");
    }

    // --- 数据库返回 error ---
    {
        const { database } = createFakeDatabase({ error: { message: "relation does not exist" } });
        const probe = createDeepHealthProbe({ database, now: () => 0 });
        const result = await probe.check();
        assert.equal(result.status, 503, "a database error is 503, not 200");
        assert.equal(result.body.ok, false, "the body reports failure");
        assert.equal(result.body.database, "error", "the database field is explicit");
        assert.match(result.body.error, /relation does not exist/, "the upstream message is surfaced");
    }

    // --- 数据库抛异常（网络层）---
    {
        const { database } = createFakeDatabase({ throws: new Error("fetch failed") });
        const probe = createDeepHealthProbe({ database, now: () => 0 });
        const result = await probe.check();
        assert.equal(result.status, 503, "a thrown error is 503");
        assert.equal(result.body.ok, false, "a thrown error reports failure rather than crashing");
        assert.match(result.body.error, /fetch failed/, "the thrown message is surfaced");
    }

    // --- 构造校验 ---
    {
        assert.throws(
            () => createDeepHealthProbe({}),
            /requires a database client/,
            "the probe refuses to build without a database"
        );
    }

    console.log(
        "Deep health: healthy probe, cache hit, TTL expiry, database error, thrown error and constructor guard passed"
    );
})();

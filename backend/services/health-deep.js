/**
 * 深度健康探针：一次真实数据库往返，结果按 TTL 缓存。
 *
 * 与 /health 的分工：
 *   /health      —— 公开、纯 liveness，不查任何依赖（features 是常量表）
 *   /health/deep —— 已登录才能触发，真的打一次库
 *
 * 之所以不把探针挂在公开端点上：那等于给任何匿名调用者一个免费的 Postgres
 * 压测入口。之所以要缓存：监控按 10 秒轮询时，也不该每分钟打 6 次库。
 */
function createDeepHealthProbe({ database, cacheMs = 60_000, now = () => Date.now() } = {}) {
    if (!database || typeof database.from !== "function") {
        throw new Error("createDeepHealthProbe requires a database client.");
    }

    let cache = null; // { at, ok, latencyMs, error }

    async function probe() {
        const startedAt = now();
        try {
            const { error } = await database
                .from("settings")
                .select("user_id", { head: true, count: "exact" })
                .limit(1);
            if (error) {
                return {
                    ok: false,
                    latencyMs: now() - startedAt,
                    error: String(error.message || error).slice(0, 200)
                };
            }
            return { ok: true, latencyMs: now() - startedAt, error: null };
        } catch (error) {
            return {
                ok: false,
                latencyMs: now() - startedAt,
                error: String(error?.message || error).slice(0, 200)
            };
        }
    }

    async function check() {
        const at = now();
        const fresh = cache !== null && at - cache.at < cacheMs;
        if (!fresh) cache = { at, ...(await probe()) };

        const body = {
            ok: cache.ok,
            database: cache.ok ? "ok" : "error",
            checkedAt: new Date(cache.at).toISOString(),
            cached: fresh,
            latencyMs: cache.latencyMs
        };
        if (cache.error) body.error = cache.error;

        // 依赖故障用 503，监控可以直接按状态码告警，不必解析 body。
        return { status: cache.ok ? 200 : 503, body };
    }

    return { check };
}

module.exports = { createDeepHealthProbe };

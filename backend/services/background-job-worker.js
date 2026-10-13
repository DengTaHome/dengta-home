const { randomUUID } = require("node:crypto");

const {
    runCalendarConsolidation
} = require("./calendar-consolidation");

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CLAIM_LIMIT = 5;
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_RETRY_SECONDS = 30;
const DEFAULT_MAX_RETRY_SECONDS = 3600;
const DEFAULT_COMPANION_PAGE_SIZE = 500;
const DEFAULT_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

function integerOption(value, fallback, { min, max, name }) {
    const number = value == null ? fallback : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new TypeError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return number;
}

function normalizeWorkerId(value) {
    const workerId = String(value || "").trim();
    if (!workerId) {
        throw new TypeError("workerId must be a non-empty string.");
    }
    return workerId;
}

function createDefaultWorkerId() {
    return `dengta-${process.pid}-${randomUUID()}`;
}

function normalizeRpcScalar(data) {
    return Array.isArray(data) ? data[0] : data;
}

function safeLogMetadata(metadata = {}) {
    const safe = {};
    const stringFields = [
        "rpc",
        "jobId",
        "jobType",
        "userId",
        "companionId",
        "errorCode"
    ];
    const numberFields = [
        "companions",
        "claimed",
        "completed",
        "failed",
        "leaseLost",
        "errors",
        "unknownTypes",
        "reconciled",
        "reseeded",
        "reconcileErrors"
    ];

    for (const field of stringFields) {
        if (metadata[field] == null) continue;
        safe[field] = String(metadata[field]).slice(0, 160);
    }
    for (const field of numberFields) {
        if (!Number.isFinite(metadata[field])) continue;
        safe[field] = Number(metadata[field]);
    }
    return safe;
}

function writeLog(logger, level, event, metadata) {
    const method =
        logger && typeof logger[level] === "function"
            ? logger[level].bind(logger)
            : logger && typeof logger.log === "function"
              ? logger.log.bind(logger)
              : null;
    if (!method) return;
    try {
        method(event, safeLogMetadata(metadata));
    } catch {
        // Logging must never change job execution or expose the original error.
    }
}

function leaseNotOwnedError(code = "background_job_lease_lost") {
    const error = new Error(code);
    error.code = code;
    return error;
}

function createBackgroundJobLeaseHeartbeat({
    renew,
    intervalMs,
    onRenewError = () => {},
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
}) {
    if (typeof renew !== "function") {
        throw new TypeError("renew must be a function.");
    }

    const normalizedIntervalMs = integerOption(intervalMs, 1000, {
        min: 1,
        max: 60 * 60 * 1000,
        name: "heartbeatIntervalMs"
    });
    let stopped = false;
    let lost = false;
    let renewalErrored = false;
    let pulseQueued = false;
    let pending = Promise.resolve();

    async function pulse() {
        if (stopped || lost) return;
        try {
            if ((await renew()) !== true) {
                lost = true;
            } else {
                renewalErrored = false;
            }
        } catch {
            renewalErrored = true;
            onRenewError();
        }
    }

    function enqueuePulse() {
        if (pulseQueued) return pending;
        pulseQueued = true;
        pending = pending.then(pulse, pulse).finally(() => {
            pulseQueued = false;
        });
        return pending;
    }

    const timer = setIntervalFn(enqueuePulse, normalizedIntervalMs);
    timer?.unref?.();

    return {
        async assertOwned() {
            if (stopped) throw leaseNotOwnedError();
            await enqueuePulse();
            if (lost) throw leaseNotOwnedError();
            if (renewalErrored) {
                throw leaseNotOwnedError("background_job_lease_renew_error");
            }
        },

        isLost() {
            return lost;
        },

        async stop() {
            stopped = true;
            clearIntervalFn(timer);
            await pending;
        }
    };
}

async function mapWithConcurrency(items, concurrency, callback) {
    if (items.length === 0) return [];

    const results = new Array(items.length);
    let nextIndex = 0;
    const runners = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (nextIndex < items.length) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await callback(items[index], index);
            }
        }
    );
    await Promise.all(runners);
    return results;
}

function normalizeHandlers(handlers) {
    if (handlers instanceof Map) return new Map(handlers);
    if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) {
        throw new TypeError("handlers must be an object or Map.");
    }
    return new Map(Object.entries(handlers));
}

function createBackgroundJobWorker({
    adminSupabase,
    handlers,
    createTenantDatabase,
    workerId = createDefaultWorkerId(),
    concurrency = DEFAULT_CONCURRENCY,
    claimLimit = DEFAULT_CLAIM_LIMIT,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
    heartbeatIntervalMs,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseRetrySeconds = DEFAULT_BASE_RETRY_SECONDS,
    maxRetrySeconds = DEFAULT_MAX_RETRY_SECONDS,
    companionPageSize = DEFAULT_COMPANION_PAGE_SIZE,
    reconcileTenant = null,
    reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
    now = () => new Date(),
    logger = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
} = {}) {
    if (
        !adminSupabase ||
        typeof adminSupabase.from !== "function" ||
        typeof adminSupabase.rpc !== "function"
    ) {
        throw new TypeError("adminSupabase with from() and rpc() is required.");
    }
    if (typeof createTenantDatabase !== "function") {
        throw new TypeError("createTenantDatabase must be a function.");
    }
    if (reconcileTenant !== null && typeof reconcileTenant !== "function") {
        throw new TypeError("reconcileTenant must be a function or null.");
    }
    if (typeof now !== "function") {
        throw new TypeError("now must be a function.");
    }

    const handlerMap = normalizeHandlers(handlers);
    const databaseOwners = new WeakMap();
    const normalizedWorkerId = normalizeWorkerId(workerId);
    const normalizedConcurrency = integerOption(
        concurrency,
        DEFAULT_CONCURRENCY,
        {
            min: 1,
            max: 100,
            name: "concurrency"
        }
    );
    const normalizedClaimLimit = integerOption(
        claimLimit,
        DEFAULT_CLAIM_LIMIT,
        {
            min: 1,
            max: 100,
            name: "claimLimit"
        }
    );
    const normalizedLeaseSeconds = integerOption(
        leaseSeconds,
        DEFAULT_LEASE_SECONDS,
        {
            min: 30,
            max: 3600,
            name: "leaseSeconds"
        }
    );
    const normalizedHeartbeatIntervalMs = integerOption(
        heartbeatIntervalMs,
        Math.max(1000, Math.floor((normalizedLeaseSeconds * 1000) / 3)),
        {
            min: 1,
            max: normalizedLeaseSeconds * 1000,
            name: "heartbeatIntervalMs"
        }
    );
    const normalizedMaxAttempts = integerOption(
        maxAttempts,
        DEFAULT_MAX_ATTEMPTS,
        {
            min: 1,
            max: 100,
            name: "maxAttempts"
        }
    );
    const normalizedBaseRetrySeconds = integerOption(
        baseRetrySeconds,
        DEFAULT_BASE_RETRY_SECONDS,
        {
            min: 1,
            max: 86400,
            name: "baseRetrySeconds"
        }
    );
    const normalizedMaxRetrySeconds = integerOption(
        maxRetrySeconds,
        DEFAULT_MAX_RETRY_SECONDS,
        {
            min: normalizedBaseRetrySeconds,
            max: 604800,
            name: "maxRetrySeconds"
        }
    );
    const normalizedCompanionPageSize = integerOption(
        companionPageSize,
        DEFAULT_COMPANION_PAGE_SIZE,
        {
            min: 1,
            max: 1000,
            name: "companionPageSize"
        }
    );
    const normalizedReconcileIntervalMs = integerOption(
        reconcileIntervalMs,
        DEFAULT_RECONCILE_INTERVAL_MS,
        {
            min: 1000,
            max: 24 * 60 * 60 * 1000,
            name: "reconcileIntervalMs"
        }
    );

    async function rpc(name, params) {
        const { data, error } = await adminSupabase.rpc(name, params);
        if (error) throw error;
        return data;
    }

    async function listActiveCompanions() {
        const companions = [];
        const seen = new Set();
        let offset = 0;

        while (true) {
            const { data, error } = await adminSupabase
                .from("companions")
                .select("user_id,id")
                .eq("status", "active")
                .order("user_id", { ascending: true })
                .order("id", { ascending: true })
                .range(
                    offset,
                    offset + normalizedCompanionPageSize - 1
                );
            if (error) throw error;

            const page = Array.isArray(data) ? data : [];
            for (const companion of page) {
                const userId = String(companion?.user_id || "").trim();
                const companionId = String(companion?.id || "").trim();
                if (!userId || !companionId) continue;

                const key = `${userId}:${companionId}`;
                if (seen.has(key)) continue;
                seen.add(key);
                companions.push({ userId, companionId });
            }

            if (page.length < normalizedCompanionPageSize) break;
            offset += normalizedCompanionPageSize;
        }

        return companions;
    }

    async function claimForTenant(tenant, stats) {
        try {
            const data = await rpc("claim_background_jobs", {
                p_user_id: tenant.userId,
                p_companion_id: tenant.companionId,
                p_worker_id: normalizedWorkerId,
                p_limit: normalizedClaimLimit,
                p_lease_seconds: normalizedLeaseSeconds,
                p_max_attempts: normalizedMaxAttempts
            });
            const jobs = Array.isArray(data) ? data : data ? [data] : [];
            return jobs.map((job) => ({ job, tenant }));
        } catch {
            stats.errors += 1;
            writeLog(logger, "error", "background_job_claim_error", {
                rpc: "claim_background_jobs",
                userId: tenant.userId,
                companionId: tenant.companionId,
                errorCode: "rpc_error"
            });
            return [];
        }
    }

    async function renewLease(job, tenant) {
        return (
            normalizeRpcScalar(
                await rpc("renew_background_job_lease", {
                    p_user_id: tenant.userId,
                    p_companion_id: tenant.companionId,
                    p_job_id: job.id,
                    p_lease_id: job.lease_id,
                    p_worker_id: normalizedWorkerId,
                    p_lease_seconds: normalizedLeaseSeconds
                })
            ) === true
        );
    }

    async function completeJob(job, tenant) {
        return (
            normalizeRpcScalar(
                await rpc("complete_background_job", {
                    p_user_id: tenant.userId,
                    p_companion_id: tenant.companionId,
                    p_job_id: job.id,
                    p_lease_id: job.lease_id,
                    p_worker_id: normalizedWorkerId
                })
            ) === true
        );
    }

    async function failJob(job, tenant, errorCode, permanent = false) {
        const data = normalizeRpcScalar(
            await rpc("fail_background_job", {
                p_user_id: tenant.userId,
                p_companion_id: tenant.companionId,
                p_job_id: job.id,
                p_lease_id: job.lease_id,
                p_worker_id: normalizedWorkerId,
                p_error_code: errorCode,
                p_max_attempts: permanent ? 1 : normalizedMaxAttempts,
                p_base_retry_seconds: normalizedBaseRetrySeconds,
                p_max_retry_seconds: normalizedMaxRetrySeconds
            })
        );
        return data?.updated === true;
    }

    function jobLogMetadata(job, tenant, errorCode) {
        return {
            jobId: job?.id,
            jobType: job?.job_type,
            userId: tenant.userId,
            companionId: tenant.companionId,
            errorCode
        };
    }

    async function databaseForTenant(tenant) {
        const immutableTenant = Object.freeze({ ...tenant });
        const database = await createTenantDatabase({
            adminSupabase,
            tenant: immutableTenant
        });
        if (
            !database ||
            (typeof database !== "object" &&
                typeof database !== "function") ||
            database === adminSupabase ||
            typeof database.from !== "function"
        ) {
            throw new TypeError(
                "createTenantDatabase must return a tenant-scoped database."
            );
        }

        const tenantKey = `${tenant.userId}:${tenant.companionId}`;
        const existingOwner = databaseOwners.get(database);
        if (existingOwner && existingOwner !== tenantKey) {
            throw new TypeError(
                "A tenant-scoped database cannot be shared across tenants."
            );
        }
        databaseOwners.set(database, tenantKey);
        return { database, tenant: immutableTenant };
    }

    async function settleFailure({
        job,
        tenant,
        heartbeat,
        errorCode,
        permanent,
        stats
    }) {
        try {
            await heartbeat.assertOwned();
            if (!(await failJob(job, tenant, errorCode, permanent))) {
                stats.leaseLost += 1;
                writeLog(
                    logger,
                    "warn",
                    "background_job_failure_not_recorded",
                    jobLogMetadata(job, tenant, "background_job_lease_lost")
                );
                return;
            }

            stats.failed += 1;
            writeLog(
                logger,
                "warn",
                "background_job_failed",
                jobLogMetadata(job, tenant, errorCode)
            );
        } catch (error) {
            if (error?.code === "background_job_lease_lost") {
                stats.leaseLost += 1;
                writeLog(
                    logger,
                    "warn",
                    "background_job_lease_lost",
                    jobLogMetadata(job, tenant, "background_job_lease_lost")
                );
                return;
            }
            stats.errors += 1;
            writeLog(
                logger,
                "error",
                "background_job_settlement_error",
                jobLogMetadata(job, tenant, "rpc_error")
            );
        }
    }

    async function processClaimedJob({ job, tenant }, stats) {
        const requiredFieldsPresent =
            job &&
            String(job.id || "").trim() &&
            String(job.lease_id || "").trim() &&
            String(job.job_type || "").trim();
        if (!requiredFieldsPresent) {
            stats.errors += 1;
            writeLog(logger, "error", "background_job_invalid_claim", {
                userId: tenant.userId,
                companionId: tenant.companionId,
                errorCode: "invalid_claim"
            });
            return;
        }

        const heartbeat = createBackgroundJobLeaseHeartbeat({
            renew: () => renewLease(job, tenant),
            intervalMs: normalizedHeartbeatIntervalMs,
            onRenewError: () => {
                writeLog(
                    logger,
                    "warn",
                    "background_job_lease_renew_error",
                    jobLogMetadata(job, tenant, "rpc_error")
                );
            },
            setIntervalFn,
            clearIntervalFn
        });

        try {
            const tenantMatches =
                String(job.user_id) === tenant.userId &&
                String(job.companion_id) === tenant.companionId;
            if (!tenantMatches) {
                await settleFailure({
                    job,
                    tenant,
                    heartbeat,
                    errorCode: "tenant_mismatch",
                    permanent: true,
                    stats
                });
                return;
            }

            const handler = handlerMap.get(job.job_type);
            if (typeof handler !== "function") {
                stats.unknownTypes += 1;
                await settleFailure({
                    job,
                    tenant,
                    heartbeat,
                    errorCode: "unknown_job_type",
                    permanent: true,
                    stats
                });
                return;
            }

            let handlerScope;
            try {
                handlerScope = await databaseForTenant(tenant);
            } catch {
                await settleFailure({
                    job,
                    tenant,
                    heartbeat,
                    errorCode: "tenant_database_invalid",
                    permanent: false,
                    stats
                });
                return;
            }

            let handlerFailed = false;
            try {
                await handler({
                    job,
                    tenant: handlerScope.tenant,
                    database: handlerScope.database,
                    lease: Object.freeze({
                        assertOwned: () => heartbeat.assertOwned(),
                        isLost: () => heartbeat.isLost()
                    })
                });
            } catch {
                handlerFailed = true;
            }

            if (handlerFailed) {
                await settleFailure({
                    job,
                    tenant,
                    heartbeat,
                    errorCode: "handler_failed",
                    permanent: false,
                    stats
                });
                return;
            }

            try {
                await heartbeat.assertOwned();
                if (!(await completeJob(job, tenant))) {
                    throw leaseNotOwnedError();
                }
                stats.completed += 1;
                writeLog(
                    logger,
                    "info",
                    "background_job_completed",
                    jobLogMetadata(job, tenant)
                );
            } catch (error) {
                if (error?.code === "background_job_lease_lost") {
                    stats.leaseLost += 1;
                    writeLog(
                        logger,
                        "warn",
                        "background_job_lease_lost",
                        jobLogMetadata(
                            job,
                            tenant,
                            "background_job_lease_lost"
                        )
                    );
                    return;
                }
                stats.errors += 1;
                writeLog(
                    logger,
                    "error",
                    "background_job_settlement_error",
                    jobLogMetadata(job, tenant, "rpc_error")
                );
            }
        } finally {
            await heartbeat.stop();
        }
    }

    async function reconcileForTenant(tenant, stats) {
        try {
            const scope = await databaseForTenant(tenant);
            const result = await reconcileTenant({
                tenant: scope.tenant,
                database: scope.database
            });
            stats.reconciled += 1;
            stats.reseeded += Math.max(0, Number(result?.seeded) || 0);
        } catch {
            stats.reconcileErrors += 1;
            writeLog(logger, "error", "background_job_reconciliation_error", {
                userId: tenant.userId,
                companionId: tenant.companionId,
                errorCode: "reconciliation_failed"
            });
        }
    }

    let lastReconciliationAt = Number.NEGATIVE_INFINITY;

    async function executeRunOnce() {
        const stats = {
            companions: 0,
            claimed: 0,
            completed: 0,
            failed: 0,
            leaseLost: 0,
            errors: 0,
            unknownTypes: 0,
            reconciled: 0,
            reseeded: 0,
            reconcileErrors: 0
        };

        let companions;
        try {
            companions = await listActiveCompanions();
        } catch {
            writeLog(logger, "error", "background_job_companion_list_error", {
                errorCode: "database_error"
            });
            throw new Error("Unable to enumerate active companions.");
        }
        stats.companions = companions.length;

        const currentTime = new Date(now()).getTime();
        if (
            reconcileTenant &&
            Number.isFinite(currentTime) &&
            currentTime - lastReconciliationAt >= normalizedReconcileIntervalMs
        ) {
            lastReconciliationAt = currentTime;
            await mapWithConcurrency(
                companions,
                normalizedConcurrency,
                (tenant) => reconcileForTenant(tenant, stats)
            );
        }

        const claimedByTenant = await mapWithConcurrency(
            companions,
            normalizedConcurrency,
            (tenant) => claimForTenant(tenant, stats)
        );
        const claimed = claimedByTenant.flat();
        stats.claimed = claimed.length;

        await mapWithConcurrency(claimed, normalizedConcurrency, (item) =>
            processClaimedJob(item, stats)
        );

        try {
            const calResult = await runCalendarConsolidation({
                database: adminSupabase,
                logger,
                now: () => new Date(now()).getTime()
            });
            if (!calResult.skipped) {
                stats.calendarConsolidated = calResult.completed;
            }
        } catch {
            // Calendar consolidation is a best-effort optimization.
            // Never let it break the main job loop.
        }

        writeLog(logger, "info", "background_job_run_complete", stats);
        return stats;
    }

    let inFlightRun = null;
    function runOnce() {
        if (inFlightRun) return inFlightRun;
        inFlightRun = executeRunOnce().finally(() => {
            inFlightRun = null;
        });
        return inFlightRun;
    }

    return Object.freeze({
        workerId: normalizedWorkerId,
        runOnce
    });
}

module.exports = {
    DEFAULT_BASE_RETRY_SECONDS,
    DEFAULT_CLAIM_LIMIT,
    DEFAULT_CONCURRENCY,
    DEFAULT_LEASE_SECONDS,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_MAX_RETRY_SECONDS,
    DEFAULT_RECONCILE_INTERVAL_MS,
    createBackgroundJobLeaseHeartbeat,
    createBackgroundJobWorker
};

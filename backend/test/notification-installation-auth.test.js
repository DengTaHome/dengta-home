const assert = require("node:assert/strict");
const {
    installationRequestScope,
    installationToken,
    installationTokenHash
} = require("../services/auth-context");

const userId = "11111111-1111-4111-8111-111111111111";
const companionId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const token = "local-installation-token-0000000000000001";

function createDatabase(expiresAt = "2026-08-26T12:00:00.000Z") {
    const tables = {
        push_installations: [
            {
                id: "44444444-4444-4444-8444-444444444444",
                user_id: userId,
                companion_id: companionId,
                installation_id: deviceId,
                provider: "local_poll",
                token_hash: installationTokenHash(token),
                enabled: true,
                expires_at: expiresAt,
                revoked_at: null
            }
        ],
        user_profiles: [
            {
                id: userId,
                email: "owner@example.test",
                display_name: "桃桃",
                role: "owner",
                status: "active",
                companion_limit: 1,
                storage_used_bytes: 0,
                storage_quota_bytes: 262144000
            }
        ],
        companions: [
            {
                id: companionId,
                user_id: userId,
                name: "小灯",
                is_default: true,
                status: "active",
                created_at: "2026-07-26T00:00:00.000Z",
                updated_at: "2026-07-26T00:00:00.000Z"
            }
        ]
    };
    return {
        from(table) {
            const filters = [];
            const builder = {
                select() {
                    return builder;
                },
                eq(column, value) {
                    filters.push([column, value]);
                    return builder;
                },
                maybeSingle() {
                    const row = tables[table].find((item) =>
                        filters.every(
                            ([column, value]) =>
                                item[column] === value
                        )
                    );
                    return Promise.resolve({
                        data: row || null,
                        error: null
                    });
                }
            };
            return builder;
        }
    };
}

async function main() {
    assert.equal(installationToken(token), token);
    assert.equal(installationToken("contains spaces"), "");
    assert.match(installationTokenHash(token), /^[a-f0-9]{64}$/);
    assert.notEqual(installationTokenHash(token), token);

    const database = createDatabase();
    const scope = await installationRequestScope({
        adminSupabase: database,
        token,
        path: "/api/v2/push/messages",
        method: "GET",
        now: () => new Date("2026-07-27T12:00:00.000Z")
    });
    assert.equal(scope.userId, userId);
    assert.equal(scope.companionId, companionId);

    const coWatchScope = await installationRequestScope({
        adminSupabase: database,
        token,
        path: "/api/v2/co-watch/frame",
        method: "POST",
        now: () => new Date("2026-07-27T12:00:00.000Z")
    });
    assert.equal(coWatchScope.userId, userId);
    assert.equal(coWatchScope.companionId, companionId);

    for (const request of [
        { path: "/api/v2/co-watch/sessions", method: "POST" },
        {
            path: "/api/v2/co-watch/sessions/2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
            method: "GET"
        },
        {
            path: "/api/v2/co-watch/sessions/2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",
            method: "PATCH"
        },
        {
            path: "/api/v2/co-watch/sessions/2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50/reply",
            method: "POST"
        },
        {
            path: "/api/v2/co-watch/sessions/2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50/messages",
            method: "GET"
        }
    ]) {
        const sessionScope = await installationRequestScope({
            adminSupabase: database,
            token,
            ...request,
            now: () => new Date("2026-07-27T12:00:00.000Z")
        });
        assert.equal(sessionScope.companionId, companionId);
    }

    await assert.rejects(
        installationRequestScope({
            adminSupabase: database,
            token,
            path: "/api/v2/settings",
            method: "PUT"
        }),
        (error) =>
            error.status === 403 &&
            error.code === "installation_scope_forbidden"
    );
    await assert.rejects(
        installationRequestScope({
            adminSupabase: database,
            token,
            path: "/api/v2/sessions",
            method: "GET"
        }),
        (error) =>
            error.status === 403 &&
            error.code === "installation_scope_forbidden"
    );
    await assert.rejects(
        installationRequestScope({
            adminSupabase: createDatabase(
                "2026-07-27T11:00:00.000Z"
            ),
            token,
            path: "/api/v2/push/messages",
            method: "GET",
            now: () =>
                new Date("2026-07-27T12:00:00.000Z")
        }),
        (error) =>
            error.status === 401 &&
            error.code === "installation_token_invalid"
    );

    console.log(
        "Android installation token hashing, expiry and read-only request scope tests passed"
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

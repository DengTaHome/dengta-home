const assert = require("node:assert/strict");
const { createRequestScope } = require("../services/request-scope");
const { createVoiceProviderCenter } = require("../services/voice-provider-center");
const { decryptCredential } = require("../services/mcp-device-center");

const userA = "11111111-1111-4111-8111-111111111111";
const companionA = "22222222-2222-4222-8222-222222222221";
const companionB = "22222222-2222-4222-8222-222222222222";
const userC = "33333333-3333-4333-8333-333333333333";
const companionC = "44444444-4444-4444-8444-444444444444";
const env = {
    MCP_ENCRYPTION_KEY: "tenant-voice-isolation-encryption-secret-long-enough"
};

function createFilteringAdmin() {
    const rows = [];
    function from(table) {
        assert.equal(table, "voice_provider_profiles");
        function operation(kind, values = null) {
            const filters = [];
            let executed = null;
            const matches = (row) =>
                filters.every(([column, expected]) => row[column] === expected);
            const execute = async () => {
                if (executed) return executed;
                if (kind === "select") {
                    executed = {
                        data: rows.filter(matches).map((row) => ({ ...row })),
                        error: null
                    };
                } else if (kind === "insert") {
                    const row = { ...values };
                    rows.push(row);
                    executed = { data: [{ ...row }], error: null };
                } else if (kind === "update") {
                    const changed = [];
                    for (let index = 0; index < rows.length; index += 1) {
                        if (!matches(rows[index])) continue;
                        rows[index] = { ...rows[index], ...values };
                        changed.push({ ...rows[index] });
                    }
                    executed = { data: changed, error: null };
                } else {
                    const deleted = [];
                    for (let index = rows.length - 1; index >= 0; index -= 1) {
                        if (!matches(rows[index])) continue;
                        deleted.push(...rows.splice(index, 1));
                    }
                    executed = { data: deleted, error: null };
                }
                return executed;
            };
            const builder = {
                eq(column, value) {
                    filters.push([column, value]);
                    return builder;
                },
                select() {
                    return builder;
                },
                async maybeSingle() {
                    const result = await execute();
                    return {
                        data: result.data.length ? result.data[0] : null,
                        error: null
                    };
                },
                async single() {
                    const result = await execute();
                    return {
                        data: result.data.length ? result.data[0] : null,
                        error: result.data.length ? null : new Error("row missing")
                    };
                },
                then(resolve, reject) {
                    return execute().then(resolve, reject);
                }
            };
            return builder;
        }
        return {
            select: () => operation("select"),
            insert: (values) => operation("insert", values),
            update: (values) => operation("update", values),
            delete: () => operation("delete")
        };
    }
    return { from, rows };
}

function createScope(adminSupabase, userId, companionId, companions = null) {
    const companionRows = companions || [
        {
            id: companionId,
            user_id: userId,
            name: "Companion",
            status: "active",
            is_default: true
        }
    ];
    const companion = companionRows.find((item) => item.id === companionId);
    return createRequestScope({
        adminSupabase,
        user: { id: userId, email: `${userId.slice(0, 4)}@example.test` },
        profile: { id: userId, role: "member", status: "active" },
        companions: companionRows,
        companion
    });
}

async function run() {
    const admin = createFilteringAdmin();
    const companionsForA = [
        {
            id: companionA,
            user_id: userA,
            name: "A",
            status: "active",
            is_default: true
        },
        {
            id: companionB,
            user_id: userA,
            name: "B",
            status: "active",
            is_default: false
        }
    ];
    const scopeA = createScope(admin, userA, companionA, companionsForA);
    const scopeB = createScope(admin, userA, companionB, companionsForA);
    const scopeC = createScope(admin, userC, companionC);
    const centerA = createVoiceProviderCenter({ database: scopeA.db, env });
    const centerB = createVoiceProviderCenter({ database: scopeB.db, env });
    const centerC = createVoiceProviderCenter({ database: scopeC.db, env });

    await centerA.saveProfile({
        provider: "deepgram",
        enabled: false,
        model: "aura-2-helena-en",
        region: "eu",
        speed: 0.9,
        credential: "tenant-a-key"
    });
    assert.equal((await centerB.readProfile()).provider, "server_default");
    assert.equal((await centerC.readProfile()).provider, "server_default");

    await centerB.saveProfile({
        provider: "deepgram",
        enabled: false,
        model: "aura-2-thalia-en",
        region: "au",
        speed: 1.2,
        credential: "tenant-b-key"
    });
    assert.equal((await centerA.readProfile()).model, "aura-2-helena-en");
    assert.equal((await centerA.readProfile()).region, "eu");
    assert.equal((await centerB.readProfile()).model, "aura-2-thalia-en");
    assert.equal((await centerB.readProfile()).region, "au");
    assert.equal((await centerC.readProfile()).provider, "server_default");

    assert.equal(admin.rows.length, 2);
    const rowA = admin.rows.find(
        (row) => row.user_id === userA && row.companion_id === companionA
    );
    const rowB = admin.rows.find(
        (row) => row.user_id === userA && row.companion_id === companionB
    );
    assert.ok(rowA);
    assert.ok(rowB);
    assert.equal(decryptCredential(rowA.secret_ciphertext, env), "tenant-a-key");
    assert.equal(decryptCredential(rowB.secret_ciphertext, env), "tenant-b-key");
    assert.equal(
        admin.rows.some(
            (row) => row.user_id === userC || row.companion_id === companionC
        ),
        false
    );
}

run()
    .then(() => console.log("voice provider tenant isolation tests passed"))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });

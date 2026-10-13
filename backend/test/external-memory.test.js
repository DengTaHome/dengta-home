const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    SUPABASE_MEMORY_TABLE,
    createExternalMemoryCenter,
    fetchSupabaseMemoryRows,
    normalizeSupabaseProjectUrl,
    validateSupabasePublicCredential
} = require("../services/external-memory");
const {
    createMcpDeviceCenter,
    encryptCredential
} = require("../services/mcp-device-center");

const env = {
    NODE_ENV: "production",
    MCP_ENCRYPTION_KEY: "external-memory-test-encryption-key-long-enough"
};
const anonJwt = [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url"),
    "signature"
].join(".");
const serviceRoleJwt = [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"),
    "signature"
].join(".");

assert.equal(validateSupabasePublicCredential(anonJwt), anonJwt);
const { safeOmbreReadTools } = require('../services/external-memory');
assert.deepEqual(safeOmbreReadTools(['breath','breath_search','breath_advanced','source_read','hold','grow','trace','dream','release'].map(name=>({name}))).map(tool=>tool.name), ['breath','breath_search','breath_advanced','source_read']);
assert.throws(
    () => validateSupabasePublicCredential("sb_secret_your_fixture_key_1"),
    (error) => error.code === "EXTERNAL_MEMORY_PRIVILEGED_CREDENTIAL_REJECTED"
);
assert.throws(
    () => validateSupabasePublicCredential(serviceRoleJwt),
    (error) => error.code === "EXTERNAL_MEMORY_PRIVILEGED_CREDENTIAL_REJECTED"
);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function memoryDatabase(initialRows = [], ownership = {}) {
    let rows = clone(initialRows);
    let sequence = rows.length;
    function from(table) {
        assert.ok(
            table === "mcp_connections" || table === "memories",
            table
        );
        const state = {
            operation: "select",
            filters: [],
            values: null,
            cardinality: "many"
        };
        const builder = {
            select() {
                return builder;
            },
            insert(values) {
                state.operation = "insert";
                state.values = values;
                return builder;
            },
            upsert(values, options) {
                state.operation = "upsert";
                state.values = (Array.isArray(values) ? values : [values]).map(
                    (value) => ({ ...clone(value), ...ownership })
                );
                state.upsertOptions = options;
                return builder;
            },
            update(values) {
                state.operation = "update";
                state.values = values;
                return builder;
            },
            delete() {
                state.operation = "delete";
                return builder;
            },
            eq(column, value) {
                state.filters.push([column, value]);
                return builder;
            },
            in(column, values) {
                state.filters.push([column, new Set(values)]);
                return builder;
            },
            order() {
                return builder;
            },
            single() {
                state.cardinality = "single";
                return builder;
            },
            maybeSingle() {
                state.cardinality = "maybeSingle";
                return builder;
            },
            then(resolve, reject) {
                return Promise.resolve(execute()).then(resolve, reject);
            }
        };
        function matches(row) {
            return state.filters.every(([column, value]) =>
                value instanceof Set
                    ? value.has(row[column])
                    : row[column] === value
            );
        }
        function finish(result) {
            if (state.cardinality === "single") {
                return {
                    data: result[0] || null,
                    error:
                        result.length === 1
                            ? null
                            : new Error("Expected one row")
                };
            }
            if (state.cardinality === "maybeSingle") {
                return {
                    data: result[0] || null,
                    error:
                        result.length <= 1
                            ? null
                            : new Error("Expected at most one row")
                };
            }
            return { data: result, error: null };
        }
        function execute() {
            let selected = rows.filter(matches);
            if (state.operation === "insert") {
                sequence += 1;
                const now = "2026-08-13T10:00:00.000Z";
                const inserted = {
                    id: `connection-${sequence}`,
                    created_at: now,
                    updated_at: now,
                    ...clone(state.values)
                };
                rows.push(inserted);
                selected = [inserted];
            } else if (state.operation === "upsert") {
                const values = Array.isArray(state.values)
                    ? state.values
                    : [state.values];
                const conflictColumns = String(
                    state.upsertOptions?.onConflict || ""
                )
                    .split(",")
                    .filter(Boolean);
                selected = values.map((value) => {
                    const existing = rows.find((row) =>
                        conflictColumns.every(
                            (column) => row[column] === value[column]
                        )
                    );
                    if (existing) {
                        Object.assign(existing, clone(value));
                        return existing;
                    }
                    sequence += 1;
                    const inserted = {
                        id: `row-${sequence}`,
                        created_at: "2026-08-13T10:00:00.000Z",
                        ...clone(value)
                    };
                    rows.push(inserted);
                    return inserted;
                });
            } else if (state.operation === "update") {
                for (const row of selected) Object.assign(row, clone(state.values));
            } else if (state.operation === "delete") {
                rows = rows.filter((row) => !matches(row));
                selected = [];
            }
            return finish(selected);
        }
        return builder;
    }
    return { from, rows: () => rows };
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
    const normalized = new Map(
        Object.entries(headers).map(([key, value]) => [
            key.toLowerCase(),
            String(value)
        ])
    );
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return normalized.get(String(name).toLowerCase()) || null;
            }
        },
        async text() {
            return JSON.stringify(payload);
        }
    };
}

(async () => {
    const lookup = async () => [
        { address: "203.0.113.10", family: 4 }
    ];
    assert.equal(
        await normalizeSupabaseProjectUrl(
            "https://fixture2example.supabase.co",
            { production: true, lookup }
        ),
        "https://fixture2example.supabase.co"
    );
    await assert.rejects(
        () =>
            normalizeSupabaseProjectUrl("https://example.com", {
                production: true,
                lookup
            }),
        (error) =>
            error.code === "EXTERNAL_MEMORY_SUPABASE_HOST_NOT_ALLOWED"
    );

    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        return jsonResponse(
            [
                {
                    id: "memory-1",
                    summary: "User likes green tea.",
                    updated_at: "2026-08-13T09:00:00.000Z"
                }
            ],
            { headers: { "content-range": "0-0/1" } }
        );
    };
    const databaseA = memoryDatabase();
    const centerA = createExternalMemoryCenter({
        database: databaseA,
        env,
        fetchImpl,
        lookup
    });
    const saved = await centerA.upsertConnection("supabase_memory", {
        name: "My memory",
        project_url: "https://fixture2example.supabase.co",
        credential: anonJwt,
        table_name: SUPABASE_MEMORY_TABLE,
        enabled: true
    });
    assert.equal(saved.connection_type, "supabase_memory");
    assert.equal(saved.credential_configured, true);
    assert.equal(saved.project_url, "https://fixture2example.supabase.co");
    assert.equal(JSON.stringify(saved).includes(anonJwt), false);
    assert.equal(JSON.stringify(saved).includes("secret_ciphertext"), false);
    assert.match(calls[0].url, /\/rest\/v1\/dengta_memories/);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${anonJwt}`);

    const publishableCalls = [];
    await fetchSupabaseMemoryRows({
        projectUrl: "https://fixture2example.supabase.co",
        credential: "sb_publishable_your_fixture_key_2",
        env,
        lookup,
        fetchImpl: async (url, options) => {
            publishableCalls.push({ url, options });
            return jsonResponse([]);
        }
    });
    assert.equal(
        publishableCalls[0].options.headers.apikey,
        "sb_publishable_your_fixture_key_2"
    );
    assert.equal(
        Object.hasOwn(publishableCalls[0].options.headers, "Authorization"),
        false
    );
    await assert.rejects(
        () =>
            fetchSupabaseMemoryRows({
                projectUrl: "https://fixture2example.supabase.co",
                credential: "sb_publishable_your_fixture_key_2",
                env,
                lookup,
                fetchImpl: async () =>
                    jsonResponse([], {
                        headers: { "content-length": 1024 * 1024 + 1 }
                    })
            }),
        (error) =>
            error.code === "EXTERNAL_MEMORY_RESPONSE_TOO_LARGE" &&
            !String(error.message).includes(
                "sb_publishable_your_fixture_key_2"
            )
    );

    let chunkedCancelled = false;
    let chunkReads = 0;
    await assert.rejects(
        () =>
            fetchSupabaseMemoryRows({
                projectUrl: "https://fixture2example.supabase.co",
                credential: "sb_publishable_your_fixture_key_2",
                env,
                lookup,
                fetchImpl: async () => ({
                    ok: true,
                    status: 200,
                    headers: { get: () => null },
                    body: {
                        getReader() {
                            return {
                                async read() {
                                    chunkReads += 1;
                                    return chunkReads <= 2
                                        ? {
                                              done: false,
                                              value: Buffer.alloc(
                                                  600 * 1024,
                                                  "x"
                                              )
                                          }
                                        : { done: true };
                                },
                                async cancel() {
                                    chunkedCancelled = true;
                                },
                                releaseLock() {}
                            };
                        }
                    }
                })
            }),
        (error) => error.code === "EXTERNAL_MEMORY_RESPONSE_TOO_LARGE"
    );
    assert.equal(chunkedCancelled, true);

    const tenantARows = databaseA.rows();
    assert.equal(tenantARows.length, 1);
    assert.notEqual(tenantARows[0].secret_ciphertext, anonJwt);
    assert.equal(tenantARows[0].connection_type, "supabase_memory");

    const tenantMemoryDb = memoryDatabase(databaseA.rows(), {
        user_id: "11111111-1111-4111-8111-111111111111",
        companion_id: "22222222-2222-4222-8222-222222222222"
    });
    // This test facade shares connection and memory rows only to exercise the
    // database call shape. Production RequestScope sends the atomic upsert to
    // the real `memories` table with tenant ownership added.
    const importCenter = createExternalMemoryCenter({
        database: tenantMemoryDb,
        env,
        fetchImpl,
        lookup
    });
    const importedFirst = await importCenter.importSupabase({ limit: 20 });
    const importedAgain = await importCenter.importSupabase({ limit: 20 });
    assert.equal(importedFirst.synchronized, 1);
    assert.equal(importedAgain.synchronized, 1);
    assert.equal(importedAgain.count_mode, "synchronized");
    const importedRows = tenantMemoryDb
        .rows()
        .filter((row) => row.external_source_type === "supabase_memory");
    assert.equal(importedRows.length, 1);

    const tenantASupabaseCenter = createMcpDeviceCenter({
        supabase: databaseA,
        env,
        fetchImpl,
        lookup
    });
    const tenantASupabaseRuntime =
        await tenantASupabaseCenter.createRuntime();
    assert.equal(tenantASupabaseRuntime.tools.length, 1);
    const runtimeRead = await tenantASupabaseRuntime.execute({
        name: tenantASupabaseRuntime.tools[0].name,
        arguments: JSON.stringify({ query: "green tea", limit: 3 })
    });
    assert.equal(runtimeRead.ok, true);
    assert.match(runtimeRead.output, /green tea/i);
    assert.equal(runtimeRead.untrusted_external_result, true);

    // A different tenant-scoped database cannot observe or remove tenant A's
    // row because it only contains its own scoped table facade.
    const databaseB = memoryDatabase();
    const centerB = createExternalMemoryCenter({
        database: databaseB,
        env,
        fetchImpl,
        lookup
    });
    assert.deepEqual(await centerB.listConnections(), []);
    await assert.rejects(
        () => centerB.deleteConnection("supabase_memory"),
        (error) => error.code === "EXTERNAL_MEMORY_CONNECTION_NOT_FOUND"
    );
    assert.equal(databaseA.rows().length, 1);

    // The generic MCP manager must not list or mutate either tagged external
    // memory connection kind, while runtime may explicitly include them.
    const externalCredential = encryptCredential("token", env);
    const mixedDatabase = memoryDatabase([
        {
            id: "device-1",
            connection_type: "mcp_device",
            name: "Device",
            slug: "device",
            endpoint: "https://device.example.com/mcp",
            auth_type: "none",
            auth_header: "Authorization",
            protocol_version: "2025-03-26",
            enabled: false,
            discovered_tools: [],
            tool_policies: {}
        },
        {
            id: "ombre-1",
            connection_type: "ombre_brain_mcp",
            name: "Ombre",
            slug: "external-memory-ombre",
            endpoint: "https://ombre.example.com/mcp",
            auth_type: "bearer",
            auth_header: "Authorization",
            secret_ciphertext: externalCredential,
            protocol_version: "2025-03-26",
            enabled: true,
            discovered_tools: [],
            tool_policies: {}
        },
        ...databaseA.rows()
    ]);
    const genericCenter = createMcpDeviceCenter({
        supabase: mixedDatabase,
        env,
        fetchImpl,
        lookup
    });
    const genericConnections = await genericCenter.listConnections();
    assert.deepEqual(
        genericConnections.map((connection) => connection.id),
        ["device-1"]
    );
    await assert.rejects(
        () => genericCenter.deleteConnection("ombre-1"),
        (error) => error.code === "MCP_CONNECTION_NOT_FOUND"
    );
    assert.equal(
        mixedDatabase.rows().some((row) => row.id === "ombre-1"),
        true
    );

    const tenantAOmbreCenter = createMcpDeviceCenter({
        supabase: memoryDatabase([
            {
                id: "tenant-a-ombre",
                connection_type: "ombre_brain_mcp",
                name: "Tenant A Ombre",
                slug: "external-memory-ombre",
                endpoint: "https://ombre.example.com/mcp",
                auth_type: "bearer",
                auth_header: "Authorization",
                secret_ciphertext: externalCredential,
                protocol_version: "2025-03-26",
                enabled: true,
                discovered_tools: [
                    {
                        name: "breath_search",
                        inputSchema: {
                            type: "object",
                            properties: { query: { type: "string" } },
                            required: ["query"]
                        }
                    }
                ],
                tool_policies: { breath_search: "auto" }
            }
        ]),
        env,
        fetchImpl,
        lookup
    });
    const tenantAOmbreRuntime = await tenantAOmbreCenter.createRuntime();
    assert.equal(tenantAOmbreRuntime.tools.length, 1);

    // An empty tenant database receives no runtime tools from tenant A.
    const tenantBGenericCenter = createMcpDeviceCenter({
        supabase: memoryDatabase(),
        env,
        fetchImpl,
        lookup
    });
    assert.equal((await tenantBGenericCenter.createRuntime()).tools.length, 0);

    const emptyGenericCenter = createMcpDeviceCenter({
        supabase: memoryDatabase(),
        env,
        fetchImpl,
        lookup
    });
    const emptyRuntime = await emptyGenericCenter.createRuntime();
    assert.deepEqual(emptyRuntime.tools, []);
    assert.equal(emptyRuntime.runtimeContext, "");

    const migration = fs.readFileSync(
        path.join(
            __dirname,
            "..",
            "supabase",
            "030_external_memory_connections.sql"
        ),
        "utf8"
    );
    assert.match(migration, /add column if not exists connection_type/i);
    assert.match(migration, /create unique index if not exists mcp_connections_tenant_external_type_uidx/i);
    assert.match(migration, /add column if not exists external_source_id/i);
    assert.match(migration, /memories_tenant_external_source_uidx/i);

    console.log("External memory tests passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

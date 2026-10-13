const assert = require("node:assert/strict");
const {
    applyMusicQueueOperation: applyQueueOperation,
    readMusicQueue
} = require("../services/music-queue");
// These tests exercise RPC contracts; the real integrity preflight has its own scoped tests.
const applyMusicQueueOperation = options => applyQueueOperation({ ...options, validatePlaylists: async () => {} });

const sessionId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const queueItemId = "44444444-4444-4444-8444-444444444444";

function query(result, log) {
    const builder = {
        select(columns) { log.push(["select", columns]); return builder; },
        eq(column, value) { log.push(["eq", column, value]); return builder; },
        maybeSingle() { return Promise.resolve(result); },
        order(column, options) { log.push(["order", column, options]); return Promise.resolve(result); }
    };
    return builder;
}

function readDatabase({ session, queue, items }) {
    const log = [];
    return {
        log,
        from(table) {
            const values = { co_watch_sessions: session, music_playback_queues: queue, music_playback_queue_items: items };
            assert.ok(table in values, `unexpected table ${table}`);
            return query(values[table], log);
        }
    };
}

async function main() {
    const database = readDatabase({
        session: { data: { id: sessionId, status: "active", session_mode: "listening" }, error: null },
        queue: { data: { id: "queue-1", session_id: sessionId, revision: "4", repeat_mode: "all", shuffle_enabled: true, current_queue_item_id: queueItemId }, error: null },
        items: { data: [{ id: queueItemId, item_id: itemId, playlist_id: "playlist-1", position: "0", title: "夜航", artist: "桃桃", album: "灯塔", duration_seconds: "188", playback_mode: "external_netease", provider_track_id: "101", external_url: "https://music.163.com/#/song?id=101" }], error: null }
    });
    assert.deepEqual(await readMusicQueue({ database, sessionId }), {
        session_id: sessionId,
        revision: 4,
        repeat_mode: "all",
        shuffle_enabled: true,
        current_queue_item_id: queueItemId,
        items: [{ id: queueItemId, item_id: itemId, playlist_id: "playlist-1", position: 0, title: "夜航", artist: "桃桃", album: "灯塔", duration_seconds: 188, playback_mode: "external_netease", provider_track_id: "101", external_url: "https://music.163.com/#/song?id=101" }]
    });
    assert.deepEqual(database.log.at(-1), ["order", "position", { ascending: true }]);

    const emptyDatabase = readDatabase({
        session: { data: { id: sessionId, status: "active", session_mode: "listening" }, error: null },
        queue: { data: null, error: null },
        items: { data: [], error: null }
    });
    assert.deepEqual(await readMusicQueue({ database: emptyDatabase, sessionId }), {
        session_id: sessionId,
        revision: 0,
        repeat_mode: "off",
        shuffle_enabled: false,
        current_queue_item_id: null,
        items: []
    });

    await assert.rejects(
        () => readMusicQueue({ database, sessionId: "invalid" }),
        (error) => error?.status === 400 && error?.code === "co_watch_session_invalid"
    );
    await assert.rejects(
        () => readMusicQueue({ database: readDatabase({ session: { data: null, error: null } }), sessionId }),
        (error) => error?.status === 404 && error?.code === "co_watch_session_not_found"
    );
    await assert.rejects(
        () => readMusicQueue({ database: readDatabase({ session: { data: { id: sessionId, session_mode: "direct_media" }, error: null } }), sessionId }),
        (error) => error?.status === 409 && error?.code === "music_queue_session_invalid"
    );

    const rpcCalls = [];
    const rpcDatabase = {
        async rpc(name, parameters) {
            rpcCalls.push([name, parameters]);
            return { data: { queue: { revision: 1 }, replayed: false }, error: null };
        }
    };
    const added = await applyMusicQueueOperation({
        database: rpcDatabase,
        sessionId,
        input: { request_id: requestId, expected_revision: 0, operation: { type: "add", item_id: itemId, position: 0 } }
    });
    assert.equal(added.queue.revision, 1);
    assert.deepEqual(rpcCalls[0], ["apply_music_queue_operation", {
        p_session_id: sessionId,
        p_request_id: requestId,
        p_expected_revision: 0,
        p_operation: { type: "add", item_id: itemId, position: 0 }
    }]);

    const operationCases = [
        [{ type: "remove", queue_item_id: queueItemId }, { type: "remove", queue_item_id: queueItemId }],
        [{ type: "move", queue_item_id: queueItemId, position: 3 }, { type: "move", queue_item_id: queueItemId, position: 3 }],
        [{ type: "replace", item_ids: [itemId] }, { type: "replace", item_ids: [itemId] }],
        [{ type: "advance" }, { type: "advance" }],
        [{ type: "set_mode", repeat_mode: "one", shuffle_enabled: true }, { type: "set_mode", repeat_mode: "one", shuffle_enabled: true }]
    ];
    for (const [operation, expected] of operationCases) {
        await applyMusicQueueOperation({ database: rpcDatabase, sessionId, input: { request_id: requestId, expected_revision: 1, operation } });
        assert.deepEqual(rpcCalls.at(-1)[1].p_operation, expected);
    }

    const invalidCases = [
        [{ request_id: "bad", expected_revision: 0, operation: { type: "advance" } }, "music_queue_request_id_invalid"],
        [{ request_id: requestId, expected_revision: -1, operation: { type: "advance" } }, "music_queue_revision_invalid"],
        [{ request_id: requestId, expected_revision: 0, operation: { type: "unknown" } }, "music_queue_operation_invalid"],
        [{ request_id: requestId, expected_revision: 0, operation: { type: "move", queue_item_id: queueItemId, position: 500 } }, "music_queue_position_invalid"],
        [{ request_id: requestId, expected_revision: 0, operation: { type: "replace", item_ids: "bad" } }, "music_queue_items_invalid"]
    ];
    for (const [input, code] of invalidCases) {
        await assert.rejects(
            () => applyMusicQueueOperation({ database: rpcDatabase, sessionId, input }),
            (error) => error?.status === 400 && error?.code === code
        );
    }

    await assert.rejects(
        () => applyMusicQueueOperation({
            database: { async rpc() { return { data: { error: { code: "music_queue_revision_conflict", message: "conflict" } }, error: null }; } },
            sessionId,
            input: { request_id: requestId, expected_revision: 0, operation: { type: "advance" } }
        }),
        (error) => error?.status === 409 && error?.code === "music_queue_revision_conflict" && error?.message === "conflict"
    );

    const storageError = new Error("storage failed");
    await assert.rejects(
        () => readMusicQueue({ database: readDatabase({ session: { data: null, error: storageError } }), sessionId }),
        storageError
    );
    await assert.rejects(
        () => readMusicQueue({
            database: readDatabase({
                session: { data: { id: sessionId, session_mode: "listening" }, error: null },
                queue: { data: null, error: storageError }
            }),
            sessionId
        }),
        storageError
    );
    await assert.rejects(
        () => readMusicQueue({
            database: readDatabase({
                session: { data: { id: sessionId, session_mode: "listening" }, error: null },
                queue: { data: { id: "queue-1", session_id: sessionId }, error: null },
                items: { data: null, error: storageError }
            }),
            sessionId
        }),
        storageError
    );
    const defaultDatabase = readDatabase({
        session: { data: { id: sessionId, session_mode: "listening" }, error: null },
        queue: { data: { id: "queue-1", session_id: sessionId, revision: null, repeat_mode: "", shuffle_enabled: 0, current_queue_item_id: "" }, error: null },
        items: { data: [{ id: queueItemId, item_id: itemId, position: 0, duration_seconds: null }], error: null }
    });
    const defaultQueue = await readMusicQueue({ database: defaultDatabase, sessionId });
    assert.equal(defaultQueue.repeat_mode, "off");
    assert.equal(defaultQueue.current_queue_item_id, null);
    assert.deepEqual(defaultQueue.items[0], {
        id: queueItemId, item_id: itemId, playlist_id: undefined, position: 0,
        title: "", artist: "", album: "", duration_seconds: null,
        playback_mode: "direct_https", provider_track_id: null, external_url: null
    });

    await applyMusicQueueOperation({
        database: rpcDatabase,
        sessionId,
        input: { request_id: requestId, expected_revision: 2, operation: { type: "add", item_id: itemId } }
    });
    assert.deepEqual(rpcCalls.at(-1)[1].p_operation, { type: "add", item_id: itemId });
    await applyMusicQueueOperation({
        database: rpcDatabase,
        sessionId,
        input: { request_id: requestId, expected_revision: 2, operation: { type: "set_mode" } }
    });
    assert.deepEqual(rpcCalls.at(-1)[1].p_operation, { type: "set_mode" });
    await applyMusicQueueOperation({
        database: rpcDatabase,
        sessionId,
        input: { request_id: requestId, expected_revision: 3, type: "advance" }
    });
    assert.deepEqual(rpcCalls.at(-1)[1].p_operation, { type: "advance" });
    assert.equal(rpcCalls.at(-1)[1].p_expected_revision, 3);

    await assert.rejects(
        () => applyMusicQueueOperation({
            database: { async rpc() { return { data: null, error: storageError }; } },
            sessionId,
            input: { request_id: requestId, expected_revision: 0, operation: { type: "advance" } }
        }),
        storageError
    );
    await assert.rejects(
        () => applyMusicQueueOperation({
            database: { async rpc() { return { data: { error: {} }, error: null }; } },
            sessionId,
            input: { request_id: requestId, expected_revision: 0, operation: { type: "advance" } }
        }),
        (error) => error?.status === 400 && error?.code === "music_queue_operation_failed" && error?.message === "队列操作失败。"
    );

    console.log("music queue validation, read and RPC contract tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

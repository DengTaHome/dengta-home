const assert = require("node:assert/strict");
const { loadOptionalChatContext } = require("../services/chat-optional-context");

(async () => {
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const started = [];
    const errors = [];
    const pending = loadOptionalChatContext({
        loaders: Object.fromEntries(["interests", "achievements", "dailyShot", "stickers", "specialDates"].map((name) => [name, async () => {
            started.push(name);
            await barrier;
            if (name === "stickers") throw new Error("private upstream body");
            return name;
        }])),
        onError: (...args) => errors.push(args)
    });
    await Promise.resolve();
    assert.equal(started.length, 5, "all independent queries start before any completes");
    release();
    const result = await pending;
    assert.equal(result.interests, "interests");
    assert.equal(result.achievements, "achievements");
    assert.equal(result.dailyShot, "dailyShot");
    assert.equal(result.stickers, null);
    assert.deepEqual(errors, [["stickers", "optional_context_failed"]]);
    assert.deepEqual(await loadOptionalChatContext({ loaders: {} }), {});
    console.log("Optional context concurrency and independent failure tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });

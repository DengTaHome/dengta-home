const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    COMPANION_STICKER_IDS,
    SELECT_COMPANION_STICKER_TOOL,
    companionStickerToolCalls,
    createCompanionStickerSelector,
    parseCompanionStickerToolArguments
} = require("../services/companion-stickers");
const { publicMessage } = require("../services/chat-attachments");

assert.deepEqual(COMPANION_STICKER_IDS, [
    "bear-sleepy",
    "bear-hug",
    "bear-miss-you",
    "bear-cheer",
    "bear-shy",
    "bear-goodnight"
]);
assert.deepEqual(
    SELECT_COMPANION_STICKER_TOOL.input_schema.properties.sticker_id.enum,
    COMPANION_STICKER_IDS
);
assert.match(
    SELECT_COMPANION_STICKER_TOOL.description,
    /不是本轮新生成/
);
assert.match(
    SELECT_COMPANION_STICKER_TOOL.description,
    /不得声称.*现画|不得声称.*刚生成/
);
assert.deepEqual(
    parseCompanionStickerToolArguments('{"sticker_id":"bear-hug"}'),
    { ok: true, value: "bear-hug" }
);
for (const unsafe of [
    '{"sticker_id":"https://evil.example/sticker.png"}',
    '{"sticker_id":"../../private/key"}',
    '{"sticker_id":"bear-hug","url":"https://evil.example"}',
    "not-json"
]) {
    assert.equal(parseCompanionStickerToolArguments(unsafe).ok, false);
}

async function main() {
    const selector = createCompanionStickerSelector();
    const selected = await selector.executeTool({
        name: SELECT_COMPANION_STICKER_TOOL.name,
        arguments: '{"sticker_id":"bear-goodnight"}'
    });
    assert.equal(selected.ok, true);
    assert.deepEqual(companionStickerToolCalls(selector), {
        sticker_id: "bear-goodnight"
    });
    const duplicate = await selector.executeTool({
        name: SELECT_COMPANION_STICKER_TOOL.name,
        arguments: '{"sticker_id":"bear-hug"}'
    });
    assert.equal(duplicate.ok, false);
    assert.equal(selector.getStickerId(), "bear-goodnight");

    const visible = publicMessage({
        id: "assistant-1",
        role: "assistant",
        content: "晚安，盖好被子。",
        created_at: "2026-07-23T12:00:00.000Z",
        tool_calls: {
            sticker_id: "bear-goodnight",
            sticker_url: "https://evil.example/private.png",
            sticker_path: "../../private/key"
        }
    });
    assert.deepEqual(visible.tool_calls, {
        sticker_id: "bear-goodnight"
    });
    assert.doesNotMatch(JSON.stringify(visible), /evil|private|sticker_url|path/);
    const rejected = publicMessage({
        id: "assistant-2",
        role: "assistant",
        content: "test",
        created_at: "2026-07-23T12:00:00.000Z",
        tool_calls: { sticker_id: "custom-sticker" }
    });
    assert.equal(Object.hasOwn(rejected, "tool_calls"), false);

    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(serverSource, /SELECT_COMPANION_STICKER_TOOL/);
    assert.match(
        serverSource,
        /companionStickerToolCalls\(chatTools\)/
    );
    assert.doesNotMatch(serverSource, /companionStickerToolCalls\(chatTools\.getStickerId\(\)\)/);

    console.log("companion sticker allowlist and public metadata tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

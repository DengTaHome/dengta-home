const assert = require("node:assert/strict");
const http = require("node:http");

const {
    generateReply,
    generateReplyStream,
    MAIN_CHAT_PROMPT_ARCHITECTURE
} = require("../services/ai-service");
const {
    UPDATE_COMPANION_STATUS_TOOL
} = require("../services/companion-status");
const {
    SELECT_REPLY_SUGGESTIONS_TOOL
} = require("../services/reply-suggestions");
const {
    createReplySuggestionEnvelopeProtocol
} = require("../services/reply-suggestion-envelope");

const VISIBLE_REPLY = "听见你这么说，我一下子开心起来了。";
const STATUS_UPDATE = {
    mood: "开心",
    place: "DengTa home",
    focus: "陪桃桃聊天",
    note: "桃桃的话让我心里亮了一下。",
    energy_level: 74,
    pulse_bpm: 82,
    hot_zones: ["heart", "lamp"],
    micro_state: "忍不住弯起眼睛靠近一点"
};
const SUGGESTIONS = ["那就再开心一点", "过来让我抱抱你"];

function sendEvent(response, event) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function runTurn({ apiUrl, stream }) {
    const toolCalls = [];
    const events = [];
    const input = {
        settings: {
            provider: "openai-responses",
            api_url: apiUrl,
            runtime_api_key: "local-test-key",
            model: "mock-model",
            ai_name: "小灯",
            system_prompt: "自然地陪伴桃桃。",
            temperature: 0.2,
            max_tokens: 800
        },
        messages: [{ role: "user", content: "我今天特别想你。" }],
        promptArchitecture: MAIN_CHAT_PROMPT_ARCHITECTURE,
        tools: [
            UPDATE_COMPANION_STATUS_TOOL,
            SELECT_REPLY_SUGGESTIONS_TOOL
        ],
        async executeTool(toolCall) {
            toolCalls.push(toolCall);
            return { ok: true };
        }
    };

    const result = stream
        ? await generateReplyStream({
              ...input,
              onEvent(event) {
                  events.push(event);
              }
          })
        : await generateReply(input);
    return { result, toolCalls, events };
}

async function main() {
    const protocol = createReplySuggestionEnvelopeProtocol({
        nonce: "0123456789abcdef0123456789abcdef",
        includeReplySuggestions: true,
        includeCompanionStatus: true
    });
    const invalidStatus = {
        ...STATUS_UPDATE,
        energy_level: 101
    };
    const invalidFiltered = protocol.filterText(
        `${VISIBLE_REPLY}${protocol.openMarker}${JSON.stringify({
            companion_status: invalidStatus,
            suggestions: SUGGESTIONS
        })}${protocol.closeMarker}`
    );
    assert.equal(invalidFiltered.text, VISIBLE_REPLY);
    assert.equal(invalidFiltered.companionStatus, null);
    assert.deepEqual(invalidFiltered.suggestions, []);

    const requests = [];
    const server = http.createServer(async (request, response) => {
        let requestText = "";
        for await (const chunk of request) requestText += chunk.toString("utf8");
        const body = JSON.parse(requestText || "{}");
        requests.push(body);

        assert.match(body.instructions, /companion_status/);
        const openMarker = body.instructions.match(
            /<<<DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
        )?.[0];
        const closeMarker = body.instructions.match(
            /<<<END_DENGTA_REPLY_SUGGESTIONS_V1:[a-f0-9]{32}>>>/
        )?.[0];
        assert.ok(openMarker && closeMarker);

        const rawText = `${VISIBLE_REPLY}${openMarker}${JSON.stringify({
            companion_status: STATUS_UPDATE,
            suggestions: SUGGESTIONS
        })}${closeMarker}`;

        if (body.stream === true) {
            response.writeHead(200, {
                "Content-Type": "text/event-stream; charset=utf-8"
            });
            for (const character of rawText) {
                sendEvent(response, {
                    type: "response.output_text.delta",
                    delta: character
                });
            }
            sendEvent(response, {
                type: "response.completed",
                response: { status: "completed" }
            });
            response.end("data: [DONE]\n\n");
            return;
        }

        response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8"
        });
        response.end(JSON.stringify({ output_text: rawText }));
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const apiUrl = `http://127.0.0.1:${port}/v1`;

    try {
        for (const stream of [false, true]) {
            const turn = await runTurn({ apiUrl, stream });
            assert.equal(turn.result.text, VISIBLE_REPLY);
            assert.deepEqual(
                turn.toolCalls.map((toolCall) => toolCall.name),
                ["update_companion_status", "select_reply_suggestions"]
            );
            assert.deepEqual(
                JSON.parse(turn.toolCalls[0].arguments),
                STATUS_UPDATE
            );
            if (stream) {
                const publicText = turn.events
                    .filter((event) => event.type === "text")
                    .map((event) => event.content || "")
                    .join("");
                assert.equal(publicText, VISIBLE_REPLY);
                assert.doesNotMatch(
                    JSON.stringify(turn.events),
                    /DENGTA_REPLY_SUGGESTIONS|companion_status|energy_level/
                );
            }
        }
        assert.equal(requests.length, 2);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }

    console.log("companion status transport regression test passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

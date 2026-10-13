"use strict";

const assert = require("node:assert");
const test = require("node:test");
const {
    describeImage,
    visionConfig,
    visionConfigured
} = require("../services/vision-describe");

test("visionConfigured requires key, baseUrl and model", () => {
    assert.equal(visionConfigured({}), false);
    assert.equal(visionConfigured({ VISION_API_KEY: "k", VISION_BASE_URL: "https://x/v1", VISION_MODEL: "m" }), true);
    assert.equal(visionConfigured({ VISION_API_KEY: "k" }), true, "baseUrl and model have defaults");
});

test("describeImage returns empty when unconfigured", async () => {
    const text = await describeImage(Buffer.from("x"), "image/png", { apiKey: "", baseUrl: "", model: "" });
    assert.equal(text, "");
});

test("describeImage posts an OpenAI-style vision request and returns the reply", async () => {
    const seen = [];
    const fetchImpl = async (url, options) => {
        seen.push({ url, options });
        return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: "  一张红色测试图。 " } }] })
        };
    };
    const text = await describeImage(Buffer.from("png-bytes"), "image/png", {
        apiKey: "test-key",
        baseUrl: "https://vision.example.com/v1",
        model: "test-vision",
        maxTokens: 512,
        timeoutMs: 30000
    }, fetchImpl);
    assert.equal(text, "一张红色测试图。");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://vision.example.com/v1/chat/completions");
    const body = JSON.parse(seen[0].options.body);
    assert.equal(body.model, "test-vision");
    assert.equal(body.messages[0].content[0].type, "text");
    assert.equal(body.messages[0].content[1].type, "image_url");
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
});

test("describeImage degrades to empty on upstream failure", async () => {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    const text = await describeImage(Buffer.from("x"), "image/png", {
        apiKey: "k", baseUrl: "https://x/v1", model: "m"
    }, fetchImpl);
    assert.equal(text, "");
});

test("describeImage degrades to empty when fetch throws", async () => {
    const fetchImpl = async () => { throw new Error("network down"); };
    const text = await describeImage(Buffer.from("x"), "image/png", {
        apiKey: "k", baseUrl: "https://x/v1", model: "m"
    }, fetchImpl);
    assert.equal(text, "");
});

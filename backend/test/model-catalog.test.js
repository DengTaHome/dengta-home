const assert = require("node:assert/strict");
const {
    MODEL_CACHE_TTL_MS,
    clearModelCache,
    listModels,
    resolveConversationModel,
    resolveTurnModel
} = require("../services/model-catalog");

const settings = {
    provider: "custom",
    api_url: "https://models.example.test/v1",
    model: "model-current",
    runtime_api_key: "test-only-key"
};

async function main() {
    clearModelCache();
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        return {
            ok: true,
            async json() {
                return { data: [{ id: "model-current" }, { id: "model-next" }] };
            }
        };
    };

    const first = await listModels(settings, { now: 1000, fetchImpl });
    assert.equal(first.source, "provider");
    assert.equal(first.cached, false);
    assert.deepEqual(first.models, ["model-current", "model-next"]);
    const cached = await listModels(settings, { now: 2000, fetchImpl });
    assert.equal(cached.cached, true);
    assert.equal(calls, 1);
    const changedCurrent = await listModels(
        { ...settings, model: "model-changed" },
        { now: 2000, fetchImpl }
    );
    assert.ok(changedCurrent.models.includes("model-changed"));
    assert.equal(changedCurrent.current_model, "model-changed");
    assert.equal(calls, 2, "当前模型变化时不能复用带旧 current_model 的缓存响应");
    await listModels(settings, {
        now: 1000 + MODEL_CACHE_TTL_MS + 1,
        fetchImpl
    });
    assert.equal(calls, 3);

    const original = { ...settings };
    assert.equal(
        await resolveTurnModel(settings, "model-next", { fetchImpl }),
        "model-next"
    );
    assert.deepEqual(settings, original, "单轮模型覆盖不能改写持久设置对象");

    clearModelCache();
    const failedFetch = async () => {
        throw new Error("offline");
    };
    const fallback = await listModels(settings, { fetchImpl: failedFetch });
    assert.equal(fallback.source, "fallback");
    assert.deepEqual(fallback.models, ["model-current"]);
    await assert.rejects(
        resolveTurnModel(settings, "unknown-model", { fetchImpl: failedFetch }),
        /不在当前接口返回的可用模型列表/
    );
    assert.equal(
        await resolveTurnModel(settings, "model-current", { fetchImpl: failedFetch }),
        "model-current"
    );

    clearModelCache();
    const switchedProvider = await resolveConversationModel(
        settings,
        "qwen-old-provider-model",
        { fetchImpl }
    );
    assert.deepEqual(switchedProvider, {
        model: "model-current",
        rebound: true,
        previous_model: "qwen-old-provider-model"
    });
    await assert.rejects(
        resolveTurnModel(settings, "qwen-old-provider-model", { fetchImpl }),
        (error) => error?.code === "MODEL_NOT_AVAILABLE"
    );
    assert.deepEqual(
        await resolveConversationModel(settings, "model-next", { fetchImpl }),
        {
            model: "model-next",
            rebound: false,
            previous_model: "model-next"
        }
    );
    console.log("model catalog cache and allowlist tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

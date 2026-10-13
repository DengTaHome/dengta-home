const { openAiResponsesMaxOutputTokens } = require("./generation-output-budget");
const { allocateContextBudget, estimateRequestValue, resolveContextWindow } = require("./context-budget");

// Private planning hook: survives plan copies, but is never JSON-serialized.
const REFRESH_BUDGET_CONTEXT = Symbol("refreshBudgetContext");

function contextBudgetError(usage, stage = "planning") {
    return Object.assign(new Error("本轮上下文超过模型的估算容量，请选择更大窗口模型或减少本轮附件。预算检查不会改写已保存的人设或记忆。"), {
        code: "context_budget_exceeded", status: 400, budgetUsage: usage, budgetStage: stage
    });
}

function applyGenerationBudget(plan, { settings, systemInstructions = plan.systemInstructions, tools = [], attachments = [], estimateSerializedInput }) {
    const messages = plan.messages || [];
    const outputTokens = settings.provider === "openai-responses"
        ? openAiResponsesMaxOutputTokens(settings) : settings.max_tokens ?? 0;
    let latestUser = messages.findLastIndex((message) => message.role === "user");
    if (latestUser < 0) latestUser = Math.max(0, messages.length - 1);
    const dynamic = plan.receipt?.delivery?.dynamic_context;
    const protectedFromIndex = dynamic?.applied && Number.isInteger(dynamic.message_index)
        ? Math.min(latestUser, dynamic.message_index) : latestUser;
    const budget = allocateContextBudget({
        contextWindow: resolveContextWindow(settings.model),
        maxOutputTokens: outputTokens,
        systemPrompt: systemInstructions.join("\n\n"),
        messages,
        protectedFromIndex,
        extraTokens: 128 + estimateRequestValue(tools) + estimateRequestValue(attachments)
    });
    if (!budget.ok) {
        if (plan[REFRESH_BUDGET_CONTEXT] && dynamic?.conversation_continuity_applied) {
            // Optional time references must not crowd out persona or current input.
            plan[REFRESH_BUDGET_CONTEXT](plan, { omitContinuity: true });
            return applyGenerationBudget(plan, { settings, systemInstructions, tools, attachments, estimateSerializedInput });
        }
        throw contextBudgetError(budget.usage);
    }
    // Keep complete user turns rather than starting at a detached assistant/tool message.
    while (budget.droppedOlderMessages > 0 && budget.messages.length > messages.length - protectedFromIndex && budget.messages[0].role !== "user") {
        budget.messages.shift();
        budget.droppedOlderMessages++;
    }
    plan.messages = budget.messages;
    if (plan.receipt) {
        const history = plan.receipt.delivery?.history;
        if (history) {
            history.latest_user_message_index = budget.messages.findLastIndex((message) => message.role === "user");
            history.context_budget = {
                model_window: budget.usage.capacity,
                final_message_count: budget.messages.length,
                dropped_older: (history.context_budget?.dropped_older || 0) + budget.droppedOlderMessages,
                usage: budget.usage,
                estimated: true,
                stage: "complete_generation_prompt"
            };
        }
        if (dynamic?.applied) dynamic.message_index -= budget.droppedOlderMessages;
    }
    if (plan[REFRESH_BUDGET_CONTEXT]) {
        plan[REFRESH_BUDGET_CONTEXT](plan);
        // Refresh only removes redundant context. Report the final payload size.
        const finalBudget = allocateContextBudget({
            contextWindow: budget.usage.capacity,
            maxOutputTokens: outputTokens,
            systemPrompt: systemInstructions.join("\n\n"),
            messages: plan.messages,
            protectedFromIndex: dynamic?.applied ? dynamic.message_index : Math.max(0, plan.messages.findLastIndex((message) => message.role === "user")),
            extraTokens: budget.usage.extra
        });
        if (!finalBudget.ok || finalBudget.droppedOlderMessages) throw contextBudgetError(finalBudget.usage);
        const history = plan.receipt?.delivery?.history;
        if (history) {
            history.latest_user_message_index = plan.messages.findLastIndex((message) => message.role === "user");
            history.context_budget.final_message_count = plan.messages.length;
            history.context_budget.usage = finalBudget.usage;
        }
    }
    if (typeof estimateSerializedInput === "function") {
        const capacity = budget.usage.capacity;
        const reservedOutput = budget.usage.reservedOutput;
        let input = estimateSerializedInput(plan.messages);
        while (input + reservedOutput >= capacity) {
            const latestUser = Math.max(0, plan.messages.findLastIndex(message => message.role === "user"));
            const protectedFrom = dynamic?.applied && Number.isInteger(dynamic.message_index)
                ? Math.min(latestUser, dynamic.message_index) : latestUser;
            if (protectedFrom === 0) {
                if (plan[REFRESH_BUDGET_CONTEXT] && dynamic?.conversation_continuity_applied) {
                    plan[REFRESH_BUDGET_CONTEXT](plan, { omitContinuity: true });
                    input = estimateSerializedInput(plan.messages);
                    continue;
                }
                throw contextBudgetError({ capacity, input, reservedOutput });
            }
            const nextUser = plan.messages.findIndex((message, index) => index > 0 && message.role === "user");
            const removed = nextUser > 0 ? Math.min(nextUser, protectedFrom) : protectedFrom;
            plan.messages = plan.messages.slice(removed);
            if (dynamic?.applied) dynamic.message_index -= removed;
            const history = plan.receipt?.delivery?.history;
            if (history) history.context_budget.dropped_older += removed;
            if (plan[REFRESH_BUDGET_CONTEXT]) plan[REFRESH_BUDGET_CONTEXT](plan);
            input = estimateSerializedInput(plan.messages);
        }
        const history = plan.receipt?.delivery?.history;
        if (history) {
            history.latest_user_message_index = plan.messages.findLastIndex(message => message.role === "user");
            history.context_budget.final_message_count = plan.messages.length;
            const protectedFrom = dynamic?.applied && Number.isInteger(dynamic.message_index)
                ? Math.min(history.latest_user_message_index, dynamic.message_index) : history.latest_user_message_index;
            history.context_budget.usage.history = plan.messages.slice(0, protectedFrom)
                .reduce((sum, message) => sum + estimateRequestValue(message.content) + 24, 0);
            history.context_budget.usage.latest = plan.messages.slice(protectedFrom)
                .reduce((sum, message) => sum + estimateRequestValue(message.content) + 24, 0);
            history.context_budget.usage.serialized_input = input;
        }
    }
    return plan;
}

// Run again at the transport boundary, including tool results added after the
// first model response. Reject oversize follow-ups without replaying side effects.
function assertSerializedRequestBudget(url, options) {
    if (typeof options?.body !== "string") return;
    const body = JSON.parse(options.body);
    const model = body.model || decodeURIComponent(String(url).match(/\/models\/([^/:?]+)/)?.[1] || "");
    if (!model) return;
    const capacity = resolveContextWindow(model);
    const output = Number(body.max_tokens ?? body.max_output_tokens ?? body.generationConfig?.maxOutputTokens);
    const reserved = output > 0 ? Math.max(256, output) : Math.min(32000, Math.max(256, Math.floor(capacity * 0.1)));
    const input = Object.fromEntries(Object.entries(body).filter(([key]) => ![
        "model", "temperature", "stream", "max_tokens", "max_output_tokens", "generationConfig"
    ].includes(key)));
    const estimatedInput = estimateRequestValue(input);
    if (estimatedInput + reserved >= capacity) throw contextBudgetError({ capacity, input: estimatedInput, reservedOutput: reserved }, "transport");
}

module.exports = { applyGenerationBudget, assertSerializedRequestBudget, estimateRequestValue, REFRESH_BUDGET_CONTEXT };

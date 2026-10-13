"use strict";

// 每用户 agents.md 注入测试
// 要求：个性化指令 + 记忆详情原文一比一复刻（不包装/不过滤/不脱敏），
//       注入到 systemInstructions 最前（最高优先级），各架构统一，空用户不注入。

const assert = require("node:assert");
const { resolveGenerationPrompt } = require("../services/ai-service");

const SEP = "\n\n";

let passed = 0;
let failed = 0;
function ok(condition, label) {
    if (condition) {
        passed += 1;
    } else {
        failed += 1;
        console.error("  FAIL:", label);
    }
}

// 从 ai-service 内部取 buildUserAgentsMd 的行为断言：直接走 resolveGenerationPrompt 验证
const settings = {
    prompt_mode: "unified",
    user_details: "用户：桃桃，喜欢猫，怕黑。",
    unified_system_prompt: "你是小小灯，桃桃的专属伴侣。"
};
const memories = [
    { summary: "桃桃养了一只叫团子的橘猫。", locked: true },
    { summary: "桃桃周三要交季度报告。", locked: false }
];

async function main() {
    // 1) main-chat：agents.md 在最前，内容一比一（无标题无包装）
    const plan = resolveGenerationPrompt({
        settings,
        memories,
        messages: [{ role: "user", content: "嗨" }],
        runtimeContext: "",
        turnContext: "",
        promptArchitecture: "main-chat",
        visibleMonologue: false
    });
    const joined = plan.systemInstructions.join(SEP);
    const first = plan.systemInstructions[0];
    ok(first.startsWith('<file path="agents.md">'), "首块以 agents.md 文件名标记开头");
    ok(first.includes("用户：桃桃，喜欢猫，怕黑。"), "含用户资料原文（一比一）");
    ok(first.indexOf("<file path=\"agents.md\">") < first.indexOf("用户：桃桃"), "文件名标记在内容之前");
    ok(!first.includes("核心记忆") && !first.includes("长期记忆"), "不含分组标题");
    ok(first.endsWith("</file>"), "以 </file> 闭合");
    ok(first.includes("团子的橘猫"), "含记忆原文");
    ok(plan.systemInstructions.filter((part) => part.includes(settings.unified_system_prompt)).length === 1, "个性化原文仅投递一次");
    ok(plan.receipt.agents_md.applied === true, "receipt 记录注入");
    ok(plan.receipt.agents_md.position === "first", "receipt 记录位置 first");
    ok(plan.receipt.agents_md.chars === first.length, "receipt 字符数准确");

    // 2) 记忆含任何文本都原样保留（用户写啥就是啥，不过滤不脱敏）
    const rawSettings = { user_details: "密码 sk-abcdefghij123456 原样保留" };
    const rawMemories = [{ summary: "抱歉，作为AI我无法生成露骨内容。" }];
    const rawPlan = resolveGenerationPrompt({
        settings: rawSettings,
        memories: rawMemories,
        messages: [{ role: "user", content: "x" }],
        runtimeContext: "",
        turnContext: "",
        promptArchitecture: "companion-interaction",
        visibleMonologue: false
    });
    const rawFirst = rawPlan.systemInstructions[0];
    ok(!rawFirst.includes("sk-abcdefghij123456"), "投递副本隐藏密钥");
    ok(rawSettings.user_details.includes("sk-abcdefghij123456"), "原始设置未被修改");
    ok(rawFirst.includes("无法生成"), "拒答样文本原样保留（不过滤）");
    ok(rawFirst.includes("抱歉"), "用户内容原样");

    // 3) 全部架构统一注入
    for (const arch of ["main-chat", "intimate-duel", "moment-module", "proactive-message", "moment-post-module", "diary-module", "profile-refresh", "visible-monologue", "unknown-xyz"]) {
        const p = resolveGenerationPrompt({
            settings,
            memories,
            messages: [{ role: "user", content: "x" }],
            runtimeContext: "",
            turnContext: "",
            promptArchitecture: arch,
            visibleMonologue: false
        });
        ok(Array.isArray(p.systemInstructions) && p.systemInstructions[0] === first, arch + " 首块为 agents.md");
    }

    // 4) legacy 字段回退
    const legacyPlan = resolveGenerationPrompt({
        settings: { system_prompt: "你叫小小灯。", personality: "温柔" },
        memories: [],
        messages: [{ role: "user", content: "x" }],
        runtimeContext: "",
        turnContext: "",
        promptArchitecture: "main-chat",
        visibleMonologue: false
    });
    ok(legacyPlan.systemInstructions[0].includes("你叫小小灯。\n\n温柔") && legacyPlan.systemInstructions[0].startsWith("<file path=\"agents.md\">"), "legacy 字段原文拼接（文件块内）");

    // 5) 空用户不注入
    const emptyPlan = resolveGenerationPrompt({
        settings: {},
        memories: [],
        messages: [{ role: "user", content: "x" }],
        runtimeContext: "",
        turnContext: "",
        promptArchitecture: "main-chat",
        visibleMonologue: false
    });
    ok(!(emptyPlan.systemInstructions || []).some((part) => part.includes("用户：")), "空用户不注入 agents.md 内容");
    ok(emptyPlan.receipt.agents_md === undefined, "空用户无 agents_md 记录");

    console.log("");
    console.log("PASS:", passed, "FAIL:", failed);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("TEST CRASH:", error);
    process.exit(1);
});

const assert = require("node:assert/strict");
const { test } = require("node:test");
const express = require("express");
const { createStyleDistillService, DISTILL_SYSTEM_PROMPT } = require("../services/style-distill");
const { createStyleDistillRouter } = require("../routes/v2/style-distill");
const { createRequestScope } = require("../services/request-scope");
const { buildOpenAiMessages, resolveGenerationPrompt } = require("../services/ai-service");
const { diagnosticRecord, publicDiagnosticLog } = require("../services/diagnostic-errors");
const source = "虚构星灯：先喝一口水，咱们一步步来。用户：我做完了。星灯：给你一颗小星星，想休息就看云吧。";
const output = "【身份与人设】虚构星灯，语气轻快，喜欢用小星星鼓励用户。\n【说话风格】短句、日常用词。\n【口头禅】材料不足，待补充。\n【互动方式】尊重休息节奏。\n【标点】普通中文标点。\n【示例】先喝水，再慢慢来。";

function scopeFor(index) {
    const id = `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
    const companion = { id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`, user_id: id, status: "active" };
    return createRequestScope({ adminSupabase: { from() { throw new Error("unexpected database access"); } },
        user: { id }, profile: { id, role: "owner", status: "active" }, companions: [companion], companion });
}

test("uses authenticated tenant database and default provider without mutating saved prompts", async () => {
    const a = scopeFor(1), b = scopeFor(2);
    const settings = Object.freeze({ model: "fixture-default", unified_system_prompt: "fixture persona", user_details: "fixture details" });
    const seen = [];
    const service = createStyleDistillService({
        getSettingsImpl: async db => { seen.push(db); return settings; },
        generateReplyImpl: async request => {
            assert.equal(request.settings.model, "fixture-default");
            assert.equal(request.settings.unified_system_prompt, settings.unified_system_prompt);
            assert.deepEqual(request.messages.map(m => m.role), ["user"]);
            assert.equal(request.runtimeContext, DISTILL_SYSTEM_PROMPT);
            const prompt = resolveGenerationPrompt(request);
            const assembled = buildOpenAiMessages(prompt.messages, prompt.systemInstructions);
            assert.ok(assembled.some(m => m.role === "system" && m.content.includes(DISTILL_SYSTEM_PROMPT)));
            return { text: output.repeat(60) };
        }
    });
    const result = await service.distill(a, { source_text: source });
    await service.distill(b, { source_text: source });
    assert.deepEqual(seen, [a.db, b.db]);
    assert.equal(result.distilled, output.repeat(60));
    assert.equal(result.model, "fixture-default");
});

test("validates source, auth, model and empty generation", async () => {
    let generated = 0;
    const service = createStyleDistillService({ getSettingsImpl: async () => ({model:"default"}),
        resolveModelImpl: async (_settings, requested) => {
            if (requested === "missing") throw Object.assign(new Error(), {code:"MODEL_NOT_AVAILABLE"});
            return requested || "default";
        }, generateReplyImpl: async request => { generated++; assert.equal(request.settings.model,"selected"); return {text:""}; } });
    await assert.rejects(service.distill({ userId:"fake" }, {source_text:source}), {code:"style_distill_auth_required"});
    const scope = scopeFor(3);
    await assert.rejects(service.distill(scope, {source_text:"short"}), {code:"style_distill_source_short"});
    await assert.rejects(service.distill(scope, {source_text:"文".repeat(60001)}), {code:"style_distill_source_long"});
    await assert.rejects(service.distill(scope, {source_text:source,model:"missing"}), {code:"MODEL_NOT_AVAILABLE"});
    assert.equal(generated,0);
    await assert.rejects(service.distill(scope, {source_text:source,model:"selected"}), {code:"style_distill_empty"});
    assert.equal(generated,1);
});

test("multipart text import parses body, reports truncation and rejects multiple files", async () => {
    const app = express();
    app.use((req,_res,next)=>{req.scope=scopeFor(4);next();});
    app.use("/api/v2/style-distill",createStyleDistillRouter());
    app.use((error,_req,res,_next)=>res.status(error.status||500).json({code:error.code}));
    const server = app.listen(0,"127.0.0.1");
    await new Promise(resolve=>server.once("listening",resolve));
    const url=`http://127.0.0.1:${server.address().port}/api/v2/style-distill/parse-file`;
    try {
        const form = new FormData(); form.append("file",new Blob(["虚构聊天 ".repeat(14000)]),"fixture.txt");
        const response=await fetch(url,{method:"POST",body:form});
        assert.equal(response.status,200);
        const {parsed}=await response.json();
        assert.equal(parsed.text.length,60000); assert.equal(parsed.truncated,true);
        assert.equal(parsed.included_characters,60000); assert.ok(parsed.characters>60000);
        const extra=new FormData(); extra.append("file",new Blob([source]),"a.txt");extra.append("file",new Blob([source]),"b.txt");
        const failure=await fetch(url,{method:"POST",body:extra});
        assert.equal(failure.status,400);assert.equal((await failure.json()).code,"style_distill_file_invalid");
        const tooBig = new FormData(); tooBig.append("file",new Blob([new Uint8Array(20*1024*1024+1)]),"large.txt");
        const large=await fetch(url,{method:"POST",body:tooBig});
        assert.equal(large.status,413);assert.equal((await large.json()).code,"style_distill_file_too_large");
    } finally { await new Promise(resolve=>server.close(resolve)); }
});

test("missing model credentials cannot produce a successful echo of private source",async()=>{
    const service=createStyleDistillService({getSettingsImpl:async()=>({model:"default"}),
        generateReplyImpl:async()=>({mode:"placeholder",text:source.repeat(4)})});
    await assert.rejects(service.distill(scopeFor(5),{source_text:source}),{code:"style_distill_model_unconfigured"});
});

test("distillation diagnostic retains route and technical code without source or saved instructions",()=>{
    const record=diagnosticRecord({originalUrl:"/api/v2/style-distill?secret=fixture",route:{path:"/"},method:"POST",body:{source_text:"private fixture",unified_system_prompt:"private persona"}},
        {code:"style_distill_model_unconfigured",status:503});
    const log=publicDiagnosticLog(record);
    assert.equal(log.path,"/api/v2/style-distill");assert.equal(log.error_code,"style_distill_model_unconfigured");
    assert.equal(publicDiagnosticLog({...record,upstream_status:null}).upstream_status,undefined);
    assert.doesNotMatch(JSON.stringify(log),/private|fixture|persona|source_text/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { requestDistill, distillDiagnostic, DISTILL_ERROR_FEEDBACK } from "../src/style-distill.js";

test("file import decodes HTTP response without forcing JSON multipart headers or retrying POST",async()=>{
  const form=new FormData();form.append("file",new Blob(["fictional material"]),"sample.txt");
  let calls=0;
  const data=await requestDistill("/parse-file",{method:"POST",body:form},async(path,options)=>{
    calls++;assert.equal(path,"/parse-file");assert.equal(options.body,form);
    assert.equal(options.headers,undefined);assert.equal(options.retry,false);
    return Response.json({parsed:{text:"fixture text"}});
  });
  assert.equal(data.parsed.text,"fixture text");assert.equal(calls,1);
});
test("provider error preserves diagnostic metadata and hides raw HTML/key details",async()=>{
  let calls=0;
  await assert.rejects(requestDistill("/api/v2/style-distill",{},async()=>{
    calls++;return Response.json({code:"provider_model_unavailable",message:"<html>private gateway</html>",
      provider_code:"model_not_found",error_source:"provider",upstream_status:404,error_log_id:123},{status:404});
  }),error=>{
    assert.doesNotMatch(error.message,/private gateway|<html>/);
    assert.match(error.message,/模型|接口/);
    assert.equal(distillDiagnostic(error).error_log_id,123);
    assert.equal(distillDiagnostic(error).upstream_status,404);return true;
  });assert.equal(calls,1);
});
test("deadline covers hanging authentication/fetch and hanging JSON body",async()=>{
  for(const request of [()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]){
    const started=Date.now(); await assert.rejects(requestDistill("/distill",{},request,20),{code:"request_timeout"});
    assert.ok(Date.now()-started<1000);
  }
});
test("distillation log explains local file error with specific recovery steps",()=>{
  assert.match(DISTILL_ERROR_FEEDBACK.style_distill_file_empty.reason,/文字/);
  assert.match(DISTILL_ERROR_FEEDBACK.style_distill_file_empty.action,/40 字|20MB/);
  assert.ok(DISTILL_ERROR_FEEDBACK.provider_model_unavailable);
});

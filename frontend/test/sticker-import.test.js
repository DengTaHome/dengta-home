import test from "node:test";
import assert from "node:assert/strict";
import { bilibiliStickerId, stickerImportRequest, requestStickerImport, validateStickerImportReceipt, stickerImportError } from "../src/sticker-import.js";
const bvid = "BV1234567890", id = "11111111-1111-4111-8111-111111111111";

test("BV and official video links work; arbitrary hosts, credentials and short redirects are rejected", () => {
  assert.equal(bilibiliStickerId(` ${bvid} `), bvid);
  assert.equal(bilibiliStickerId(`https://www.bilibili.com/video/${bvid}/?share_source=copy`), bvid);
  for (const value of [`http://www.bilibili.com/video/${bvid}`, `https://www.bilibili.com.evil.test/video/${bvid}`,
    `https://a:b@example.test/video/${bvid}`, `https://b23.tv/abcd`, "~", "javascript:alert(1)"]) assert.equal(bilibiliStickerId(value), "");
});
test("reloads retry one receipt while account, companion and video changes keep requests separate", () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) };
  let count=0; const uuid=()=>{ count++; return id; };
  assert.deepEqual(stickerImportRequest("account-a:companion-a",bvid,storage,uuid), {bvid,client_request_id:id});
  stickerImportRequest("account-a:companion-a",bvid,storage,uuid); assert.equal(count,1);
  for (const scope of ["account-b:companion-a","account-a:companion-b"]) stickerImportRequest(scope,bvid,storage,uuid);
  stickerImportRequest("account-a:companion-a","BV0987654321",storage,uuid); assert.equal(count,4);
  assert.doesNotThrow(()=>stickerImportRequest("scope",bvid,{ getItem(){throw new Error();},setItem(){throw new Error();}},uuid));
});
test("only complete private sticker receipts are accepted, and external links are rebuilt from BVID", () => {
  const data={ok:true,asset:{id,purpose:"custom_sticker",status:"active"},source:{provider:"bilibili",bvid,page_url:"https://evil.test/private"}};
  assert.equal(validateStickerImportReceipt(data).source.page_url,`https://www.bilibili.com/video/${bvid}`);
  for(const invalid of [undefined,{}, {...data,ok:false}, {...data,asset:{...data.asset,id:"bad"}},
    {...data,asset:{...data.asset,purpose:"user_avatar"}}, {...data,asset:{...data.asset,status:"archived"}},
    {...data,source:{...data.source,bvid:"https://www.bilibili.com/video/"+bvid}}]) {
    assert.throws(()=>validateStickerImportReceipt(invalid),{code:"sticker_import_receipt_invalid"});
  }
});
test("errors explain safe recovery without echoing upstream bodies", () => {
  assert.match(stickerImportError({code:"sticker_import_timeout",status:504,message:"private body"}),/重试.*sticker_import_timeout.*504/);
  assert.doesNotMatch(stickerImportError({code:"secret unknown",message:"private body"}),/private body|secret unknown/);
  assert.match(stickerImportError({code:"sticker_import_schema_required"}),/现有上传和发图仍可使用/);
});
test("stalled fetch or JSON work releases its deadline and late auth callbacks cannot change sessions", async () => {
  let captured, invalidations=0;
  const session={getSnapshot:()=>({user:{id:"a"},activeCompanionId:"b"}),captureCompanionFromResponse(){invalidations++;},invalidateSession(){invalidations++;}};
  await assert.rejects(requestStickerImport((_path,options)=>{captured=options;return new Promise(()=>{});},"/fixture",{authSession:session},5),{code:"sticker_import_timeout"});
  assert.equal(captured.signal.aborted,true);assert.equal(captured.retry,false);
  captured.authSession.captureCompanionFromResponse({});captured.authSession.invalidateSession();assert.equal(invalidations,0);
});
test("scope cancellation finishes even when transport ignores abort, with no automatic replay", async () => {
  const controller=new AbortController();let calls=0;
  const pending=requestStickerImport(()=>{calls++;return new Promise(()=>{});},"/fixture",{signal:controller.signal},1000);
  const result=assert.rejects(pending,{name:"AbortError"});await Promise.resolve();controller.abort();await result;assert.equal(calls,1);
  await assert.rejects(requestStickerImport(()=>{calls++;},"/fixture",{signal:controller.signal}),{name:"AbortError"});assert.equal(calls,1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_IMPORT_MAX_BYTES,
  commitContentImport,
  getContentImport,
  listContentImports,
  previewContentImport,
  translatedImportError,
  validateImportFile,
  resolveContentImport,
  contentImportResolutionReceipt,
} from "../src/content-import-api.js";

test('pending resolution posts only explicit confirmation and accepts only a complete matching result',async()=>{
  const calls=[],client={apiRequest:async(path,options)=>{calls.push({path,options});return{};}};
  const signal=new AbortController().signal;
  await resolveContentImport('pending/id',client,{signal});
  assert.equal(calls[0].path,'/api/v2/imports/pending%2Fid/resolve');
  assert.equal(calls[0].options.signal,signal);
  assert.deepEqual(JSON.parse(calls[0].options.body),{confirm_reject_pending:true});
  const value={import:{id:'x',status:'committed',accepted_count:0,rejected_count:2,candidate_count:2},accepted_count:0,rejected_count:2,resolution:'discarded',resolution_protocol:'reject-pending-v1'};
  assert.equal(contentImportResolutionReceipt({result:value},'x'),value);
  for(const changed of [{...value,resolution:'committed'},{...value,resolution_protocol:null},{...value,import:{...value.import,id:'other'}},{...value,rejected_count:1},{...value,import:{...value.import,status:'preview'}}])
    assert.throws(()=>contentImportResolutionReceipt({result:changed},'x'),{code:'import_resolution_receipt_invalid'});
});

test("JSON preview uses apiRequest and preserves unfiltered source content", async () => {
  const calls = [];
  const adultContent = "成人内容原文：欲望与亲密描写，不得被前端过滤";
  const client = {
    async apiRequest(path, options) {
      calls.push({ path, options });
      return { id: "import-json" };
    },
  };
  const result = await previewContentImport({
    kind: "chat_history",
    format: "generic_json",
    content: adultContent,
  }, client);

  assert.equal(result.id, "import-json");
  assert.equal(calls[0].path, "/api/v2/imports/preview");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    kind: "chat_history",
    format: "generic_json",
    content: adultContent,
    source_type: "chat_history",
    media_type: "application/json",
    source_name: "import.json",
  });
});

test("file preview uses apiFetch with FormData and no manual Content-Type", async () => {
  let call;
  const client = {
    async apiFetch(path, options) {
      call = { path, options };
      return { ok: true, status: 200, json: async () => ({ id: "import-file" }) };
    },
  };
  const file = new File(["{\"entries\":[]}"], "world.json", { type: "application/json" });
  const result = await previewContentImport({ file, kind: "world_book", format: "sillytavern" }, client);

  assert.equal(result.id, "import-file");
  assert.equal(call.path, "/api/v2/imports/preview");
  assert.ok(call.options.body instanceof FormData);
  assert.equal(call.options.headers, undefined, "browser must generate multipart boundary and Content-Type");
  assert.equal(call.options.body.get("kind"), "world_book");
  assert.equal(call.options.body.get("format"), "sillytavern");
  assert.equal(call.options.body.get("source_type"), "world_book");
  assert.equal(call.options.body.get("file").name, "world.json");
});

test("list, detail and commit use exact import endpoints and decision payload", async () => {
  const calls = [];
  const client = {
    async apiRequest(path, options) {
      calls.push({ path, options });
      return { ok: true };
    },
  };
  const decisions = [{ id: "candidate-1", decision: "accepted", title: "灯塔", content: "保留原文", target: "memory" }];
  await listContentImports(client);
  await getContentImport("import / one", client);
  await commitContentImport("import / one", decisions, client);

  assert.equal(calls[0].path, "/api/v2/imports/");
  assert.equal(calls[1].path, "/api/v2/imports/import%20%2F%20one");
  assert.equal(calls[2].path, "/api/v2/imports/import%20%2F%20one/commit");
  assert.equal(calls[2].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].options.body), { decisions });
});

test("file validation and backend failures have explicit translated errors", async () => {
  assert.throws(
    () => validateImportFile({ name: "archive.exe", size: 2 }),
    /此入口不支持该格式/,
  );
  assert.throws(
    () => validateImportFile({ name: "large.json", size: CONTENT_IMPORT_MAX_BYTES + 1 }),
    /超过 100MB/,
  );
  assert.equal(translatedImportError({ code: "invalid_json" }), "JSON 内容无法解析，请检查格式是否完整。");
  assert.equal(translatedImportError({ message: "后端明确原因" }, "fallback"), "后端明确原因");
  assert.equal(translatedImportError({}, "fallback"), "fallback");

  await assert.rejects(
    previewContentImport(
      { file: new File(["x"], "book.txt"), kind: "world_book" },
      { apiFetch: async () => ({ ok: false, status: 413, json: async () => ({ code: "payload_too_large" }) }) },
    ),
    (error) => error.status === 413 && /100MB/.test(error.message),
  );
  await assert.rejects(
    listContentImports({ apiRequest: async () => { throw Object.assign(new Error("expired"), { code: "import_not_found" }); } }),
    /预览已失效/,
  );
});

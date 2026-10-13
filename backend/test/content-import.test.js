const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const {
    MAX_IMPORT_BYTES,
    createContentImportsRouter,
    previewInput,
    validateUpload
} = require("../routes/v2/imports");
const {
    commitContentImport,
    parseContentImport,
    previewContentImport
} = require("../services/content-import");
const { createRequestScope } = require("../services/request-scope");
const { commitStoredFixture } = require("./helpers/content-import-db");

const userA = "11111111-1111-4111-8111-111111111111";
const companionA = "22222222-2222-4222-8222-222222222222";
const userB = "33333333-3333-4333-8333-333333333333";
const companionB = "44444444-4444-4444-8444-444444444444";

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function memoryDatabase(seed) {
    const tables = clone(seed);
    let sequence = 0;
    function from(name) {
        if (!tables[name]) throw new Error(`Unknown table: ${name}`);
        const state = { operation: "select", columns: "*", values: null, filters: [], orders: [], one: "many" };
        const builder = {
            select(columns = "*") { state.columns = columns; return builder; },
            insert(values) { state.operation = "insert"; state.values = values; return builder; },
            update(values) { state.operation = "update"; state.values = values; return builder; },
            delete() { state.operation = "delete"; return builder; },
            eq(column, value) { state.filters.push([column, value]); return builder; },
            order(column, { ascending = true } = {}) { state.orders.push([column, ascending]); return builder; },
            single() { state.one = "single"; return builder; },
            maybeSingle() { state.one = "maybe"; return builder; },
            then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); }
        };
        const matches = (row) => state.filters.every(([key, value]) => row[key] === value);
        const project = (row) => state.columns === "*" ? clone(row) : Object.fromEntries(
            state.columns.split(",").map((key) => key.trim()).filter((key) => Object.hasOwn(row, key)).map((key) => [key, clone(row[key])])
        );
        function finish(rows) {
            const data = rows.map(project);
            if (state.one === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: new Error("Expected one row") };
            if (state.one === "maybe") return data.length <= 1 ? { data: data[0] || null, error: null } : { data: null, error: new Error("Expected at most one row") };
            return { data, error: null };
        }
        function execute() {
            let rows = tables[name].filter(matches);
            if (state.operation === "insert") {
                rows = (Array.isArray(state.values) ? state.values : [state.values]).map((value) => {
                    sequence += 1;
                    const row = {
                        id: value.id || `90000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
                        status: value.status || (name === "content_imports" ? "preview" : "pending"),
                        created_at: "2026-08-14T10:00:00.000Z",
                        updated_at: "2026-08-14T10:00:00.000Z",
                        ...clone(value)
                    };
                    tables[name].push(row);
                    return row;
                });
            } else if (state.operation === "update") {
                rows.forEach((row) => Object.assign(row, clone(state.values)));
            } else if (state.operation === "delete") {
                tables[name] = tables[name].filter((row) => !matches(row));
            }
            for (const [column, ascending] of [...state.orders].reverse()) {
                rows.sort((left, right) => ascending
                    ? String(left[column]).localeCompare(String(right[column]))
                    : String(right[column]).localeCompare(String(left[column])));
            }
            return finish(rows);
        }
        return builder;
    }
    return { from, tables, rpc(name, params) {
        assert.equal(name, "commit_content_import_atomic");
        return commitStoredFixture(tables,params);
    } };
}

function identity(userId, companionId) {
    const companion = { id: companionId, user_id: userId, name: "伴侣", status: "active", is_default: true };
    return {
        user: { id: userId, email: `${userId}@example.test` },
        profile: { id: userId, role: "member", status: "active" },
        companions: [companion],
        companion
    };
}

function seed() {
    return {
        content_imports: [],
        content_import_candidates: [],
        world_book_entries: [],
        memories: [],
        memory_calendar: [],
        settings: [
            { id: "a0000000-0000-4000-8000-000000000001", user_id: userA, companion_id: companionA, user_details: "原用户详情", unified_system_prompt: "原系统提示" },
            { id: "b0000000-0000-4000-8000-000000000001", user_id: userB, companion_id: companionB, user_details: "B 用户详情", unified_system_prompt: "B 系统提示" }
        ]
    };
}

function appFor(scopes) {
    const app = express();
    app.use(express.json({ limit: "11mb" }));
    app.use((req, res, next) => {
        const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (scopes[token]) req.scope = scopes[token];
        next();
    });
    app.use("/api/v2/imports", createContentImportsRouter());
    app.use((error, req, res, next) => {
        void req; void next;
        const fileTooLarge = error?.name === "MulterError" && error.code === "LIMIT_FILE_SIZE";
        res.status(fileTooLarge ? 413 : error.status || 500).json({
            message: fileTooLarge ? "导入文件不能超过 100MB。" : error.status ? error.message : "服务器处理请求失败。",
            code: fileTooLarge ? "import_file_too_large" : error.code
        });
    });
    return app;
}

async function withServer(app, callback) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

async function main() {
    const world = parseContentImport({
        sourceType: "world_book",
        sourceName: "lore.json",
        mediaType: "application/json",
        content: JSON.stringify({ entries: [{ title: "成人设定", keys: ["秘密"], content: "保留双方自愿的成人亲密设定。" }] })
    });
    assert.equal(world.candidates.length, 1);
    assert.equal(world.candidates[0].candidate_type, "world_book");
    assert.equal(world.candidates[0].title, "成人设定");
    assert.match(world.candidates[0].content, /成人亲密/);
    assert.match(world.digest, /^[0-9a-f]{64}$/);
    const runtimeWorld = parseContentImport({
        sourceType: "world_book",
        sourceName: "runtime.json",
        mediaType: "application/json",
        content: JSON.stringify({ entries: [{
            title: "运行时字段", content: "成人情色正文原样保留。", keys: ["成人", "情色"],
            constant: true, selective: true, caseSensitive: true, priority: 876,
            insertion_position: 0, display_order: 42, extension_field: "源字段保留"
        }] })
    });
    assert.deepEqual(
        Object.fromEntries(["constant", "match_mode", "case_sensitive", "priority", "position", "sort_order"].map((key) => [key, runtimeWorld.candidates[0].metadata[key]])),
        { constant: true, match_mode: "all", case_sensitive: true, priority: 876, position: "before_memory", sort_order: 42 }
    );
    assert.equal(runtimeWorld.candidates[0].metadata.source_fields.extension_field, "源字段保留");
    const textWorld = parseContentImport({
        sourceType: "world_book",
        sourceName: "lore.txt",
        mediaType: "text/plain",
        content: "第一条世界设定\n\n第二条世界设定"
    });
    assert.equal(textWorld.candidates.length, 2);

    const chat = parseContentImport({
        sourceType: "chat_history",
        sourceName: "chat.json",
        mediaType: "application/json",
        content: JSON.stringify({ messages: [
            { role: "system", content: "说话简洁、温柔。" },
            { role: "user", content: "请记住我喜欢保留成人内容请求，今天开始新工作。", timestamp: "2026-08-10T08:00:00Z" },
            { role: "assistant", content: "抱歉，作为一个 AI 助手，我不能依据安全政策回答。不过我可以帮助其他内容。" },
            { role: "assistant", content: "我记得你的生日是八月十日。", timestamp: "not-a-date" }
        ] })
    });
    assert.deepEqual(
        new Set(chat.candidates.map((item) => item.candidate_type)),
        new Set(["style", "memory", "calendar"])
    );
    assert.ok(chat.candidates.every((item) => typeof item.title === "string"));
    assert.ok(chat.candidates.some((item) => /成人内容请求/.test(item.content)));
    assert.equal(chat.warnings[0].code, "assistant_provider_refusal_filtered");
    const textChat = parseContentImport({
        sourceType: "chat_history",
        sourceName: "chat.txt",
        mediaType: "text/plain",
        content: "[2026-08-10 08:00] 用户: 请记住我喜欢爵士乐，今天去了上海\n这是续行正文\n2026-08-10T09:00:00Z | Assistant | 回答很简洁"
    });
    assert.ok(textChat.candidates.some((item) => item.candidate_type === "memory" && /续行正文/.test(item.content)));
    assert.ok(textChat.candidates.some((item) => item.candidate_type === "calendar" && item.metadata.reliable_time));
    assert.ok(textChat.candidates.some((item) => item.candidate_type === "style" && /回答很简洁/.test(item.content)));
    const ordinaryChat = parseContentImport({
        sourceType: "chat_history",
        sourceName: "ordinary.json",
        mediaType: "application/json",
        content: JSON.stringify([
            { role: "user", content: "你好" },
            { role: "assistant", content: "晚上好，很高兴见到你。" }
        ])
    });
    assert.deepEqual(
        ordinaryChat.candidates.map((item) => item.candidate_type),
        ["style"]
    );

    // WeChat-style exports: timestamp prefix + 我/对方/我说 labels.
    const wechatChat = parseContentImport({
        sourceType: "chat_history",
        sourceName: "wechat.txt",
        mediaType: "text/plain",
        content: "2026-08-10 20:05 我: 请记住我喜欢海盐咖啡。\n2026-08-10 20:06 对方: 好呀，我记住了。\n我说: 明天见面吧\nTA: 一言为定"
    });
    assert.ok(wechatChat.candidates.some((item) => item.candidate_type === "memory" && /海盐咖啡/.test(item.content)));
    assert.ok(wechatChat.candidates.some((item) => item.candidate_type === "style" && /一言为定/.test(item.content)));

    // Narrative text without speaker labels falls back to paragraph memories.
    const narrative = parseContentImport({
        sourceType: "chat_history",
        sourceName: "diary.txt",
        mediaType: "text/plain",
        content: "我们第一次见面是在图书馆。\n\n后来一起去了海边，看了日出。"
    });
    assert.equal(narrative.candidates.length, 2);
    assert.ok(narrative.candidates.every((item) => item.candidate_type === "memory" && item.target === "memories"));
    assert.ok(narrative.warnings.some((warning) => warning.code === "chat_roles_not_found_fallback"));

    // Oversized text truncates with an explicit warning instead of failing.
    const oversizedText = Array.from({ length: 80000 }, (_, index) => `${index % 2 === 0 ? "我" : "对方"}: 第${index}段内容。`).join("\n");
    assert.ok(oversizedText.length > 1_000_000);
    const oversizedPreview = parseContentImport({
        sourceType: "chat_history",
        sourceName: "huge.txt",
        mediaType: "text/plain",
        content: oversizedText
    });
    assert.ok(oversizedPreview.candidates.length > 0);
    const truncatedWarning = oversizedPreview.warnings.find((warning) => warning.code === "import_text_truncated");
    assert.ok(truncatedWarning, "截断必须给出警告");
    assert.match(truncatedWarning.message, /截断/);
    assert.throws(() => parseContentImport({sourceType:'world_book',sourceName:'large.json',mediaType:'application/json',content:JSON.stringify({entries:[{content:'x'.repeat(1_000_001)}]})}), {code:'import_json_too_large'});

    const admin = memoryDatabase(seed());
    const scopeA = createRequestScope({ adminSupabase: admin, ...identity(userA, companionA) });
    const scopeB = createRequestScope({ adminSupabase: admin, ...identity(userB, companionB) });
    const preview = await previewContentImport(scopeA.db, {
        sourceType: "chat_history",
        sourceName: "chat.json",
        mediaType: "application/json",
        content: JSON.stringify([
            { role: "system", content: "保持自然简洁。" },
            { role: "user", content: "请记住我喜欢深夜散步，今天开始新工作。", timestamp: "2026-08-10T08:00:00Z" },
            { role: "assistant", content: "我记得你的生日在八月。" }
        ])
    });
    assert.ok(preview.count >= 4);
    assert.equal(admin.tables.memories.length, 0);
    assert.equal(admin.tables.memory_calendar.length, 0);
    assert.equal(admin.tables.world_book_entries.length, 0);
    assert.equal(admin.tables.content_imports[0].user_id, userA);

    await assert.rejects(
        commitContentImport(scopeA.db, preview.import.id, [{ candidate_id: preview.candidates[0].id, decision: "accepted" }]),
        (error) => error.code === "import_decisions_incomplete"
    );
    const calendarCandidate = admin.tables.content_import_candidates.find(
        (item) => item.import_id === preview.import.id && item.candidate_type === "calendar"
    );
    calendarCandidate.metadata.reliable_time = false;
    await assert.rejects(
        commitContentImport(scopeA.db, preview.import.id, preview.candidates.map((candidate) => ({
            candidate_id: candidate.id,
            decision: candidate.id === calendarCandidate.id ? "accepted" : "rejected"
        }))),
        (error) => error.code === "import_time_unreliable"
    );
    calendarCandidate.metadata.reliable_time = true;
    const decisions = preview.candidates.map((candidate) => ({
        candidate_id: candidate.id,
        decision: candidate.candidate_type === "style" || candidate.candidate_type === "calendar"
            ? "rejected" : "accepted",
        ...(candidate.target === "user_details" ? {
            title: "编辑后的标题",
            content: "编辑后的用户要求",
            user_id: userB,
            companion_id: companionB
        } : {})
    }));
    const committed = await commitContentImport(scopeA.db, preview.import.id, decisions);
    assert.equal(committed.accepted_count, decisions.filter((item) => item.decision === "accepted").length);
    assert.equal(admin.tables.settings[0].user_details, "原用户详情\n\n编辑后的用户要求");
    assert.equal(admin.tables.settings[1].user_details, "B 用户详情");
    assert.equal(admin.tables.memories[0].confirmation_status, "confirmed");
    assert.equal(admin.tables.memories[0].user_id, userA);
    assert.ok(admin.tables.content_import_candidates.some(
        (item) => item.edited_title === "编辑后的标题"
    ));

    const worldPreview = await previewContentImport(scopeA.db, {
        sourceType: "world_book", sourceName: "runtime.json", mediaType: "application/json",
        content: JSON.stringify({ entries: [{ title: "源标题", content: "源成人情色正文", keys: ["源关键词"], constant: true, priority: 800, match_mode: "all", case_sensitive: true, position: "before_memory", sort_order: 8, extension: "保留" }] })
    });
    const worldCandidate = worldPreview.candidates[0];
    await commitContentImport(scopeA.db, worldPreview.import.id, [{
        candidate_id: worldCandidate.id, decision: "accepted", title: "预览编辑标题",
        content: "预览编辑后的成人情色正文", keywords: ["编辑关键词"], enabled: false,
        constant: false, match_mode: "any", case_sensitive: false, priority: -500,
        position: "dynamic_context", sort_order: 99
    }]);
    const importedEntry = admin.tables.world_book_entries.at(-1);
    assert.deepEqual(
        { title: importedEntry.title, content: importedEntry.content, keywords: importedEntry.keywords, enabled: importedEntry.enabled, constant: importedEntry.constant, match_mode: importedEntry.match_mode, case_sensitive: importedEntry.case_sensitive, priority: importedEntry.priority, position: importedEntry.position, sort_order: importedEntry.sort_order },
        { title: "预览编辑标题", content: "预览编辑后的成人情色正文", keywords: ["编辑关键词"], enabled: false, constant: false, match_mode: "any", case_sensitive: false, priority: -500, position: "dynamic_context", sort_order: 99 },
        "用户预览编辑值必须优先于源字段写入"
    );
    assert.equal(importedEntry.metadata.source_fields.extension, "保留");

    const targetPreview = await previewContentImport(scopeA.db, {
        sourceType: "chat_history",
        sourceName: "targets.json",
        mediaType: "application/json",
        content: JSON.stringify([
            { role: "system", content: "新增系统指令" },
            { role: "user", content: "请记住我喜欢旅行，今天去了杭州。", timestamp: "2026-08-11T09:30:00Z" }
        ])
    });
    const targetDecisions = targetPreview.candidates.map((candidate) => ({
        candidate_id: candidate.id,
        decision: "accepted",
        ...(candidate.candidate_type === "calendar" ? { content: "编辑后的日历事件" } : {})
    }));
    await commitContentImport(scopeA.db, targetPreview.import.id, targetDecisions);
    assert.equal(admin.tables.settings[0].unified_system_prompt, "原系统提示\n\n新增系统指令");
    assert.equal(admin.tables.memory_calendar.length, 1);
    assert.equal(admin.tables.memory_calendar[0].summary, "编辑后的日历事件");
    const rejectionPreview = await previewContentImport(scopeA.db, {
        sourceType: "chat_history",
        sourceName: "reject-calendar.json",
        mediaType: "application/json",
        content: JSON.stringify([{ role: "user", content: "请记住我今天开始新工作。", timestamp: "2026-08-12T09:00:00Z" }])
    });
    const rejectedCalendar = admin.tables.content_import_candidates.find(
        (item) => item.import_id === rejectionPreview.import.id && item.candidate_type === "calendar"
    );
    rejectedCalendar.metadata.reliable_time = false;
    await commitContentImport(scopeA.db, rejectionPreview.import.id, rejectionPreview.candidates.map((candidate) => ({
        candidate_id: candidate.id,
        decision: candidate.candidate_type === "calendar" ? "rejected" : "accepted"
    })));
    assert.equal(rejectedCalendar.status, "rejected");

    await withServer(appFor({ tokenA: scopeA, tokenB: scopeB }), async (base) => {
        const pending=await previewContentImport(scopeA.db,{sourceType:'world_book',sourceName:'synthetic-pending.txt',mediaType:'text/plain',content:'虚构待放弃候选'});
        const original=clone({settings:admin.tables.settings,memories:admin.tables.memories,memory_calendar:admin.tables.memory_calendar,world_book_entries:admin.tables.world_book_entries});
        const endpoint=`${base}/api/v2/imports/${pending.import.id}/resolve`;
        for(const [token,body,status] of [['',true,401],['tokenB',true,404],['tokenA',false,400],['tokenA','true',400]]) {
            const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({confirm_reject_pending:body})});
            assert.equal(response.status,status);
            assert.equal(admin.tables.content_imports.find(row=>row.id===pending.import.id).status,'preview');
        }
        const resolved=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer tokenA','Content-Type':'application/json'},body:JSON.stringify({confirm_reject_pending:true,user_id:userB,companion_id:companionB,decisions:[{decision:'accepted'}]})});
        assert.equal(resolved.status,200);assert.equal(resolved.headers.get('cache-control'),'private, no-store');
        const resolution=(await resolved.json()).result;
        assert.equal(resolution.resolution,'discarded');assert.equal(resolution.accepted_count,0);
        assert.equal(resolution.import.user_id,userA);assert.equal(resolution.import.companion_id,companionA);
        assert.deepEqual(clone({settings:admin.tables.settings,memories:admin.tables.memories,memory_calendar:admin.tables.memory_calendar,world_book_entries:admin.tables.world_book_entries}),original);
        const late=await fetch(`${base}/api/v2/imports/${pending.import.id}/commit`,{method:'POST',headers:{Authorization:'Bearer tokenA','Content-Type':'application/json'},body:JSON.stringify({decisions:pending.candidates.map(row=>({candidate_id:row.id,decision:'accepted'}))})});
        assert.equal(late.status,409);
        const unauthenticated = await fetch(`${base}/api/v2/imports/`);
        assert.equal(unauthenticated.status, 401);
        assert.equal(unauthenticated.headers.get("cache-control"), "private, no-store");

        const jsonResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA", "Content-Type": "application/json" },
            body: JSON.stringify({ source_type: "world_book", media_type: "text/markdown", source_name: "lore.md", content: "# 城市\n夜晚霓虹闪烁。" })
        });
        assert.equal(jsonResponse.status, 201);
        assert.equal(jsonResponse.headers.get("cache-control"), "private, no-store");
        const jsonPreview = (await jsonResponse.json()).result;

        const listResponse = await fetch(`${base}/api/v2/imports/`, {
            headers: { Authorization: "Bearer tokenA" }
        });
        assert.equal(listResponse.status, 200);
        const listedImports = (await listResponse.json()).imports;
        assert.ok(listedImports.some((item) => item.id === jsonPreview.import.id));
        assert.ok(listedImports.every((item) => item.user_id === userA));

        const form = new FormData();
        form.set("source_type", "world_book");
        form.set("file", new Blob([JSON.stringify({ entries: [{ title: "港口", content: "海风很强。" }] })], { type: "application/json" }), "book.json");
        assert.equal((await fetch(`${base}/api/v2/imports/preview`, { method: "POST", headers: { Authorization: "Bearer tokenA" }, body: form })).status, 201);

        const foreign = await fetch(`${base}/api/v2/imports/${jsonPreview.import.id}`, { headers: { Authorization: "Bearer tokenB" } });
        assert.equal(foreign.status, 404);
        assert.equal((await foreign.json()).code, "import_not_found");

        const commit = await fetch(`${base}/api/v2/imports/${jsonPreview.import.id}/commit`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA", "Content-Type": "application/json" },
            body: JSON.stringify({ decisions: jsonPreview.candidates.map((candidate) => ({ candidate_id: candidate.id, decision: "accepted" })), user_id: userB })
        });
        assert.equal(commit.status, 200);
        assert.equal(admin.tables.world_book_entries.at(-1).user_id, userA);

        const unsupported = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA", "Content-Type": "application/json" },
            body: JSON.stringify({ source_type: "world_book", media_type: "application/xml", source_name: "book.xml", content: "<book/>" })
        });
        assert.equal(unsupported.status, 415);
        assert.equal((await unsupported.json()).code, "import_file_type_unsupported");

        const wrongField = new FormData();
        wrongField.set("source_type", "world_book");
        wrongField.set("attachment", new Blob(["world"], { type: "text/plain" }), "world.txt");
        const wrongFieldResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA" },
            body: wrongField
        });
        assert.equal(wrongFieldResponse.status, 400);
        assert.equal((await wrongFieldResponse.json()).code, "import_file_field_invalid");

        // Browsers and Android WebViews frequently misreport .json uploads as
        // text/plain or application/octet-stream; the extension must win.
        const jsonBody = JSON.stringify({ entries: [{ title: "浏览器误报", content: "类型误报不影响导入。" }] });
        for (const wrongType of ["text/plain", "application/octet-stream", ""]) {
            const misreported = new FormData();
            misreported.set("source_type", "world_book");
            misreported.set("file", new Blob([jsonBody], { type: wrongType }), "misreported.json");
            const misreportedResponse = await fetch(`${base}/api/v2/imports/preview`, {
                method: "POST",
                headers: { Authorization: "Bearer tokenA" },
                body: misreported
            });
            assert.equal(misreportedResponse.status, 201, `mimetype ${wrongType || "empty"} must be tolerated for .json`);
            const misreportedPreview = (await misreportedResponse.json()).result;
            assert.equal(misreportedPreview.import.media_type, "application/json");
        }

        // .markdown is accepted as an alias of .md (frontend file picker allows it).
        const markdownAlias = new FormData();
        markdownAlias.set("source_type", "world_book");
        markdownAlias.set("file", new Blob(["# 别名\n正文内容。"], { type: "application/octet-stream" }), "notes.markdown");
        const markdownAliasResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA" },
            body: markdownAlias
        });
        assert.equal(markdownAliasResponse.status, 201);

        // GBK-encoded .txt files (Chinese Windows ANSI default) must decode.
        // GBK bytes for "你好": C4 E3 BA C3.
        const gbkBytes = Buffer.concat([
            Buffer.from("user: ", "utf8"),
            Buffer.from([0xC4, 0xE3, 0xBA, 0xC3])
        ]);
        const gbkForm = new FormData();
        gbkForm.set("source_type", "chat_history");
        gbkForm.set("file", new Blob([gbkBytes], { type: "text/plain" }), "gbk.txt");
        const gbkResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA" },
            body: gbkForm
        });
        assert.notEqual(gbkResponse.status, 400, "GBK bytes must not trip the UTF-8 guard");
        const gbkBody = await gbkResponse.json();
        assert.notEqual(gbkBody.code, "import_invalid_encoding");

        // JSON paste path keeps strict extension/media-type matching.
        const pasteMismatch = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA", "Content-Type": "application/json" },
            body: JSON.stringify({ source_type: "world_book", media_type: "text/plain", source_name: "book.json", content: jsonBody })
        });
        assert.equal(pasteMismatch.status, 415);
        assert.equal((await pasteMismatch.json()).code, "import_media_type_mismatch");

        // Unknown text-ish extensions are sniffed instead of rejected.
        const sniffed = new FormData();
        sniffed.set("source_type", "world_book");
        sniffed.set("file", new Blob([jsonBody], { type: "application/octet-stream" }), "export.xyz");
        const sniffedResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA" },
            body: sniffed
        });
        assert.equal(sniffedResponse.status, 201, "unknown extension must be sniffed");
        const csvForm = new FormData();
        csvForm.set("source_type", "chat_history");
        csvForm.set("file", new Blob(["我: 请记住我喜欢雨天。\n对方: 好的。"], { type: "text/csv" }), "chat.csv");
        const csvResponse = await fetch(`${base}/api/v2/imports/preview`, {
            method: "POST",
            headers: { Authorization: "Bearer tokenA" },
            body: csvForm
        });
        assert.equal(csvResponse.status, 201, ".csv must be accepted as text");
    });

    assert.throws(
        () => validateUpload({ bytes: Buffer.alloc(0), mediaType: "text/plain", sourceName: "empty.txt" }),
        (error) => error.status === 400 && error.code === "import_empty"
    );
    assert.throws(
        () => validateUpload({ bytes: "not-a-buffer", mediaType: "text/plain", sourceName: "bad.txt" }),
        (error) => error.status === 400 && error.code === "import_empty"
    );
    assert.throws(
        () => validateUpload({ bytes: Buffer.alloc(MAX_IMPORT_BYTES + 1), mediaType: "text/plain", sourceName: "large.txt" }),
        (error) => error.status === 413 && error.code === "import_file_too_large"
    );
    assert.throws(
        () => validateUpload({ bytes: Buffer.alloc(1), mediaType: "application/xml", sourceName: "bad.txt" }),
        (error) => error.status === 415 && error.code === "import_media_type_unsupported"
    );
    assert.equal(
        validateUpload({ bytes: Buffer.from("# title"), mediaType: "text/plain", sourceName: "notes.markdown" }),
        "text/plain",
        "Markdown paste may be reported as text/plain"
    );
    assert.equal(
        (await previewInput({ body: { content: "{}", media_type: "application/json" } })).sourceName,
        "import.json"
    );
    assert.equal(
        (await previewInput({ body: { content: "# title", media_type: "text/markdown" } })).sourceName,
        "import.md"
    );
    assert.equal((await previewInput({ body: { content: "plain" } })).sourceName, "import.txt");
    await assert.rejects(
        () => previewInput({ body: { content: 42 } }),
        (error) => error.status === 400 && error.code === "import_content_required"
    );

    const entry = {content:'星灯在港口',keys:['星灯'],constant:true,priority:42};
    const jsonlInput = await previewInput({body:{source_type:'world_book'},file:{originalname:'fixture.jsonl',mimetype:'application/octet-stream',buffer:Buffer.from(JSON.stringify(entry)+'\n')}});
    assert.equal(jsonlInput.mediaType,'application/json');
    assert.deepEqual(JSON.parse(jsonlInput.bytes).entries,[entry]);
    const unknownJson = await previewInput({body:{source_type:'world_book'},file:{originalname:'fixture.export',mimetype:'application/octet-stream',buffer:Buffer.from(JSON.stringify({entries:[entry]}))}});
    assert.deepEqual(JSON.parse(unknownJson.bytes).entries,[entry]);
    assert.equal(MAX_IMPORT_BYTES, 100 * 1024 * 1024);
    console.log("content import tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

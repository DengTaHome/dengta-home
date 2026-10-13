const { publicDiagnosticLog } = require("./diagnostic-errors");

function diagnosticLogId(value) {
    const id = String(value ?? "").trim();
    // Production uses bigint identities; older installations may use UUIDs.
    if (/^[1-9][0-9]{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n) return id;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
    return null;
}

async function readDiagnosticLog(scopedDb, value) {
    const id = diagnosticLogId(value);
    if (!id) throw Object.assign(new Error("日志编号格式不正确。"), { status: 400, code: "diagnostic_log_id_invalid" });
    const { data, error } = await scopedDb.from("chat_error_logs")
        .select("id, created_at, path, method, error_code, message, error_source, provider_phase, provider_code, upstream_status, stack_trace, conversation_id, request_summary")
        .eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw Object.assign(new Error("找不到这条错误日志。"), { status: 404, code: "diagnostic_log_not_found" });
    return publicDiagnosticLog(data);
}

module.exports = { diagnosticLogId, readDiagnosticLog };

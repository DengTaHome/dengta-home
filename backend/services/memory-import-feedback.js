function memoryImportFeedback(result = {}) {
    if (result.ok && result.data?.ok === true) return { status: 200, body: { ...result.data,
        coverage_notice: result.data.mode === "ai"
            ? "旧记忆网关 AI 整理最多读取前 3 万字；需要完整审查大记录时，请使用数据导入分段预览。"
            : "旧记忆网关按段保存最多 200 段、每段 2000 字；需要完整审查大记录时，请使用数据导入分段预览。" } };
    const upstream = Number.isInteger(result.status) ? result.status : undefined;
    let code = "memory_import_gateway_failed", status = 502,
        message = "记忆网关未完成导入。请检查记忆服务状态和错误代码；已保存的部分需要先核对，避免重复导入。";
    if (result.error === "kiwi_mem_disabled") { code = "memory_import_unconfigured"; status = 503; message = "记忆网关尚未配置，请在服务端配置 KIWI_MEM_URL 后重试。"; }
    else if (result.error === "kiwi_mem_tenant_required") { code = "memory_import_scope_missing"; status = 409; message = "账号或伴侣范围不完整，本次未提交记忆导入；请重新登录并选择伴侣后重试。"; }
    else if (result.error === "kiwi_mem_tenant_unverified") { code = "memory_import_scope_unverified"; message = "网关没有返回匹配的账号/伴侣回执，导入结果不能确认。请检查网关版本和租户回执，并核对记忆库后再操作，避免重复导入。"; }
    else if (result.error === "kiwi_mem_network_error") { code = "memory_import_network_error"; message = "服务器无法连接记忆网关，导入是否保存尚未确认。请检查网络并核对记忆库后再重试。"; }
    else if (result.error === "timeout") { code = "memory_import_timeout"; status = 504; message = "记忆网关响应超时，保存状态尚未确认。请先查看记忆库再重试，避免重复导入。"; }
    else if (result.error === "kiwi_mem_memory_disabled" || result.data?.error === "memory_disabled") { code = "memory_import_disabled"; status = 503; message = "外部记忆网关关闭了记忆功能，请开启后重试。"; }
    else if ([401,403].includes(upstream)) { code = "memory_import_auth_failed"; message = "记忆网关拒绝了凭据，请检查服务端访问令牌和租户权限。"; }
    else if (upstream === 404) { code = "memory_import_endpoint_not_found"; message = "记忆网关导入地址返回 404，请检查网关地址与版本是否支持当前导入方式：记录使用 /memory/import，文件与聊天历史使用 /memory/import-file。"; }
    else if (upstream === 413) { code = "memory_import_file_too_large"; status = 413; message = "外部记忆网关认为文件过大，请使用数据导入的分段预览。"; }
    else if (upstream === 429) { code = "memory_import_rate_limited"; status = 429; message = "外部记忆网关暂时限制请求，请稍后重试。"; }
    else if (upstream === 400) { code = "memory_import_unreadable"; status = 400; message = "记忆网关未能读取文件。扫描 PDF 请先 OCR；旧 DOC 请转 DOCX；压缩包请确认内含可读文本。"; }
    return {status,body:{ok:false,code,message,error_source:["memory_import_unconfigured", "memory_import_scope_missing"].includes(code) ? "dengta" : "external_memory_gateway",upstream_status:upstream}};
}
module.exports = { memoryImportFeedback };

import { apiFetch, apiRequest } from "./api.js";
import { readTextFileBatches } from "./large-text-file.js";

export const CONTENT_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const CONTENT_IMPORT_PAGED_MAX_BYTES = 1024 ** 3;
export const CONTENT_IMPORT_PAGED_EXTENSIONS = /\.(txt|text|md|markdown|log|csv|tsv|jsonl|ndjson)$/i;

const IMPORT_ERROR_MESSAGES = Object.freeze({
  payload_too_large: "导入文件超过 100MB，请拆分后重试。",
  file_too_large: "导入文件超过 100MB，请拆分后重试。",
  import_paged_file_too_large: "文本文件超过 1GB，请拆分后重试。",
  import_paged_preview_required: "此文件需要在数据导入面板分段预览，不能整份上传。",
  import_record_too_large: "单条聊天消息、CSV 或 JSONL 记录超过分段读取容量，请拆分该记录后重试；本段尚未上传或推进。",
  import_file_too_large: "导入文件超过 100MB，请拆分后重试。",
  unsupported_file_type: "此入口不支持该格式，请选择 TXT、Markdown、JSON、CSV、TSV、JSONL、HTML、字幕、邮件、PDF 或 DOCX。",
  import_file_type_unsupported: "此格式不能作为文本读取；旧 DOC 请另存为 DOCX，表格或压缩包请先导出文本。",
  import_media_type_unsupported: "仅支持 JSON、TXT 或 Markdown 文件。",
  import_media_type_mismatch: "文件扩展名与内容格式不匹配，请检查后重试。",
  unsupported_format: "无法识别所选格式，请更换格式后重试。",
  invalid_json: "JSON 内容无法解析，请检查格式是否完整。",
  import_json_invalid: "JSON 内容无法解析，请检查格式是否完整。",
  import_json_too_large: "JSON 结构超过单次解析容量，请导出为 JSONL 或拆成完整的 JSON 文件；系统没有截断或保存这份文件。",
  import_document_too_large: "PDF、DOCX 和邮件直传最多 20MB，请拆分或导出文本后重试。",
  import_csv_invalid: "CSV 的引号未闭合，请检查导出是否完整。",
  import_pdf_no_text: "扫描版 PDF 没有可提取的文字，请先进行 OCR 再导入。",
  invalid_import: "导入内容无法生成候选项，请检查文件或粘贴文本。",
  import_no_candidates: "本次内容没有生成可导入的候选项，尚未写入。分段文件可以确认本段后继续读取。",
  import_chat_boundary_invalid: "旧分段进度位于聊天消息续文，无法完整恢复该消息；本段尚未上传或推进。请保留原文件与进度，核对已保存内容后从完整消息起点重新预览。",
  import_chat_message_too_large: "单条聊天消息超过现有 200,000 字符候选保存容量，请拆分该消息后重新预览；本段尚未上传或推进，正文没有被截短。",
  import_empty: "导入内容不能为空。",
  import_content_required: "请粘贴要导入的文本。",
  import_source_type_invalid: "请选择世界书或聊天记录后重试。",
  import_invalid_encoding: "无法识别文本编码，支持 UTF-8、带 BOM 的 UTF-16 和 GB18030；请另存为 UTF-8 后重试。",
  import_not_found: "这次导入预览已失效，请重新预览。",
  decisions_required: "每个候选项都必须明确选择接受或拒绝。",
  import_decision_invalid: "每个候选项都必须明确选择接受或拒绝。",
  import_decisions_incomplete: "必须为全部候选项选择接受或拒绝。",
  import_candidate_invalid: "提交决策与当前候选不匹配，请重新核对预览。",
  import_content_invalid: "候选标题或正文超过导入容量，请缩短该候选后重试。",
  import_content_empty: "接受的候选内容不能为空，请补充内容或选择拒绝。",
  import_world_book_keywords_invalid: "世界书关键词格式无效，请重新填写关键词。",
  import_world_book_enabled_invalid: "世界书启用状态无效，请重新选择开关。",
  import_world_book_constant_invalid: "世界书常驻状态无效，请重新选择开关。",
  import_world_book_case_sensitive_invalid: "世界书大小写匹配设置无效，请重新选择开关。",
  import_world_book_priority_invalid: "世界书优先级必须是 -100000 到 100000 的整数，请修改后重试。",
  import_world_book_sort_order_invalid: "世界书排序必须是整数，请修改后重试。",
  import_world_book_match_mode_invalid: "世界书匹配模式无效，请重新选择任一匹配或全部匹配。",
  import_world_book_position_invalid: "世界书注入位置无效，请重新选择位置。",
  import_target_invalid: "候选项的写入位置无效，请重新选择。",
  import_time_unreliable: "这条日历线索缺少可靠时间，暂时不能接受。",
  import_already_committed: "这次导入已经提交，无需重复操作。",
  import_commit_conflict: "这次导入已经以另一组决策提交，请检查已保存结果，不要重复追加。",
  import_legacy_preview: "这是旧版导入预览，可能已有部分写入。请核对已保存结果，重新预览时拒绝已经导入的内容。",
  import_partial_legacy: "这份预览已有部分处理记录，不能直接再次提交。请核对已保存结果后重新预览。",
  import_transaction_unavailable: "服务器的原子导入尚未就绪，本次没有开始写入，请稍后重试。",
  import_settings_missing: "当前伴侣的设置记录缺失，本轮写入已回滚。请重新打开设置，确认保存成功后重试。",
  import_commit_rolled_back: "数据库未完成提交，本轮写入已全部回滚。请核对候选内容后重试。",
  import_commit_unconfirmed: "未能确认服务器是否已提交，请先检查提交结果，暂勿重复导入。",
  import_commit_pending: "服务器仍未标记这次导入完成，暂时无法确定是否正在提交。请稍后再次核对，暂勿重复导入。",
  import_receipt_missing: "服务器已找不到这次导入预览，无法确认旧结果。请核对已保存的记忆与世界书，再重新预览。",
  import_resolution_confirmation_required: "请明确确认放弃尚未提交的旧候选，已经保存的内容会保留。",
  import_resolution_receipt_invalid: "没有收到可靠的旧候选处理结果，请保留编号并再次核对，暂勿重复导入。",
  validation_error: "导入内容未通过校验，请检查候选项后重试。",
  authentication_required: "登录状态已失效，请重新登录后再导入。",
  import_scope_changed: "账号或伴侣已切换，旧导入操作已取消，请在当前面板重新选择文件。",
  import_commit_receipt_invalid: "提交结果尚未确认，请先检查提交结果，暂勿重复提交。",
  import_preview_receipt_invalid: "服务器返回的预览与本段不匹配，请保留进度并查看错误日志。",
  import_read_failed: "文件读取失败，请确认原文件仍可访问，再重新选择后重试。",
  import_cancelled: "读取已取消，可以重新选择原文件继续。",
  request_timeout: "请求超时。提交操作请先检查提交结果；预览或日志读取可检查网络后重试。",
  import_binary_disguised: "文件实际是二进制文档，无法按文本分段读取。请使用真实扩展名或导出为文本。",
});

export function importCommitRecovery(code) {
  if (["import_legacy_preview", "import_partial_legacy", "import_receipt_missing"].includes(code)) return "legacy";
  if (["import_commit_rolled_back", "import_transaction_unavailable", "import_settings_missing",
    "import_decisions_incomplete", "import_candidate_invalid", "import_decision_invalid", "import_target_invalid",
    "import_content_invalid", "import_content_empty", "import_time_unreliable", "import_title_too_long",
    "import_world_book_keywords_invalid", "import_world_book_priority_invalid", "import_world_book_sort_order_invalid",
    "import_world_book_enabled_invalid", "import_world_book_constant_invalid", "import_world_book_case_sensitive_invalid",
    "import_world_book_match_mode_invalid", "import_world_book_position_invalid"].includes(code)) return "retry";
  return "check";
}

export const CONTENT_IMPORT_ERROR_FEEDBACK = Object.freeze(Object.fromEntries(
  Object.entries(IMPORT_ERROR_MESSAGES).map(([code, reason]) => [code, {
    reason,
    action: importCommitRecovery(code) === "retry" ? "本轮未写入；核对候选或服务器状态后，可以再次确认提交。"
      : importCommitRecovery(code) === "legacy" ? "先核对记忆与世界书的已保存内容，再重新预览；已经导入的候选请选择拒绝。"
        : "预览失败可以修正文件后重试。提交回执未确认时，先检查提交结果，避免重复写入。",
  }]),
));

export function translatedImportError(source, fallback) {
  const code = String(source?.code || "").toLowerCase();
  if (IMPORT_ERROR_MESSAGES[code]) return IMPORT_ERROR_MESSAGES[code];
  const detail = String(source?.message || source?.detail || "").trim();
  return detail || fallback;
}

function importError(source, fallback, status) {
  const error = new Error(translatedImportError(source, fallback), {
    cause: source instanceof Error ? source : undefined,
  });
  error.code = source?.code || "content_import_failed";
  error.status = status ?? source?.status;
  error.error_log_id = source?.error_log_id;
  return error;
}

async function jsonImportRequest(path, options, client) {
  try {
    return await client.apiRequest(path, options);
  } catch (error) {
    throw importError(error, "导入请求失败，请稍后重试。");
  }
}

async function formImportRequest(formData, client) {
  let response;
  try {
    response = await client.apiFetch("/api/v2/imports/preview", {
      method: "POST",
      body: formData,
      retry: false,
    });
  } catch (error) {
    throw importError(error, "无法上传文件，请检查网络后重试。");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw importError(data, `文件预览失败（HTTP ${response.status}）。`, response.status);
  }
  return data;
}

const defaultClient = { apiFetch, apiRequest };

// Keep the same speaker labels as the backend's text-chat parser.
const CHAT_SPEAKER_LINE = /^(?:(?:\[[^\]\r\n]+\][^\S\r\n]*)?(?:\d{4}-\d{2}-\d{2}[ \t]\d{2}:\d{2}(?::\d{2})?[ \t]+)?(?:我说|user|human|用户|我|对方说|对方|ta|他|她|assistant|ai|bot|助手|char|character|system|系统)[^\S\r\n]*(?:说)?[^\S\r\n]*[:：]|\d{4}-\d{2}-\d{2}T[^|\r\n]+[^\S\r\n]*\|[^\S\r\n]*(?:我说|user|human|用户|我|对方说|对方|ta|他|她|assistant|ai|bot|助手|char|character|system|系统)[^\S\r\n]*(?:说)?[^\S\r\n]*\|)/gim;

function validateChatMessageCapacity(text) {
  const speakers=chatSpeakerMatches(text);
  for(let index=0;index<speakers.length;index++) {
    const start=speakers[index].index+speakers[index][0].length;
    const end=speakers[index+1]?.index??text.length;
    if(text.slice(start,end).trim().length>200_000)throw importError({code:'import_chat_message_too_large'});
  }
}

function chatSpeakerMatches(text) {
  return [...text.matchAll(CHAT_SPEAKER_LINE)].filter(match=>!match.index||/[\r\n]/.test(text[match.index-1]));
}

function mediaTypeFor(format, content = "") {
  if (["sillytavern", "generic_json"].includes(format)) return "application/json";
  if (format === "plain_text") return "text/plain";
  return /^\s*[[{]/.test(content) ? "application/json" : "text/plain";
}

export function validateImportFile(file) {
  if (!file) throw importError({}, "请选择要导入的文件。");
  const limit = CONTENT_IMPORT_PAGED_EXTENSIONS.test(file.name) ? CONTENT_IMPORT_PAGED_MAX_BYTES : CONTENT_IMPORT_MAX_BYTES;
  if (Number(file.size) > limit) {
    throw importError({ code: limit === CONTENT_IMPORT_PAGED_MAX_BYTES ? "import_paged_file_too_large" : "file_too_large" });
  }
  if (!/\.(json|txt|text|md|markdown|log|csv|tsv|jsonl|ndjson|html|htm|srt|vtt|eml|pdf|docx|xml|yaml|yml|ini|conf)$/i.test(String(file.name || ""))) {
    throw importError({ code: "unsupported_file_type" });
  }
  return file;
}

export async function previewContentImportPage({ file, kind, startByte = 0, signal }, client = defaultClient) {
  validateImportFile(file);
  if (!CONTENT_IMPORT_PAGED_EXTENSIONS.test(file.name)) throw importError({code:'unsupported_file_type'});
  let text = '';
  const suffix = file.name.split('.').pop().toLowerCase();
  const chatText = kind === 'chat_history' && ['txt','text','md','markdown','log'].includes(suffix);
  const lineBytes = new Map();
  let speakerPaging;
  if(chatText&&startByte>0) {
    for await(const head of readTextFileBatches(file,{chunkBytes:64*1024,signal})) {
      speakerPaging=chatSpeakerMatches(head.text).length>0;
      break;
    }
  }
  for await (const batch of readTextFileBatches(file, { startByte, chunkBytes: 64 * 1024, signal, includeLineOffsets: chatText })) {
    const prefixLength=text.length;
    text += batch.text;
    let endByte=batch.endByte;
    if(chatText) {
      for(const line of batch.lineStarts) {
        const offset=prefixLength+line.characterOffset;
        if(!offset||/[\r\n]/.test(text[offset-1]))lineBytes.set(offset,line.byteOffset);
      }
      const speakers=chatSpeakerMatches(text).map(match=>({offset:match.index,byteOffset:lineBytes.get(match.index)}))
        .filter(item=>Number.isSafeInteger(item.byteOffset));
      speakerPaging=speakerPaging||speakers.length>0;
      if(speakerPaging) {
        if(startByte>0&&speakers[0]?.offset!==0)throw importError({code:'import_chat_boundary_invalid'});
        const boundaries=speakers.slice(1);
        if(boundaries.length&&(batch.endByte<file.size||batch.endByte-startByte>64*1024)) {
          const boundary=boundaries.filter(item=>item.byteOffset-startByte<=64*1024).at(-1)||boundaries[0];
          text=text.slice(0,boundary.offset);endByte=boundary.byteOffset;
        } else if(batch.endByte<file.size) {
          validateChatMessageCapacity(text);
          if(text.length>1024*1024)throw importError({code:'import_record_too_large'});
          continue;
        }
        validateChatMessageCapacity(text);
      }
    }
    if (text.length > 1024 * 1024) throw importError({code:'import_record_too_large'});
    if (batch.endByte < file.size) {
      if (['jsonl','ndjson'].includes(suffix) && !/\r?\n$/.test(text)) continue;
      if (['csv','tsv'].includes(suffix)) {
        let quoted = false;
        for (let index=0;index<text.length;index++) if (text[index] === '"') {
          if (quoted && text[index+1] === '"') index++; else quoted = !quoted;
        }
        if (quoted || !/\r?\n$/.test(text)) continue;
      }
    }
    const part = new File([text], `part-${startByte}-${endByte}.${suffix}`, { type: 'text/plain' });
    signal?.throwIfAborted();
    const page = { startByte, endByte, totalBytes: file.size };
    try {
      const data = await previewContentImport({ file: part, kind, signal }, client);
      return { data, page };
    } catch (error) {
      if (error?.code === 'import_no_candidates' && error.status === 422) error.page = page;
      throw error;
    }
  }
  throw importError({code:'import_empty'});
}

export function listContentImports(client = defaultClient) {
  return jsonImportRequest("/api/v2/imports/", undefined, client);
}

export function getContentImport(importId, client = defaultClient) {
  return jsonImportRequest(`/api/v2/imports/${encodeURIComponent(importId)}`, undefined, client);
}

export function contentImportResolutionReceipt(data, importId) {
  const value = data?.result, task = value?.import;
  const accepted = value?.accepted_count, rejected = value?.rejected_count;
  if (value?.resolution_protocol !== "reject-pending-v1" || task?.id !== importId || task.status !== "committed"
      || !Number.isSafeInteger(accepted) || accepted < 0 || !Number.isSafeInteger(rejected) || rejected < 0
      || !Number.isSafeInteger(task.candidate_count) || task.candidate_count < 0
      || accepted !== task.accepted_count || rejected !== task.rejected_count || accepted + rejected !== task.candidate_count
      || value.resolution !== (accepted === 0 ? "discarded" : "committed")) {
    throw importError({code:"import_resolution_receipt_invalid"});
  }
  return value;
}

export function resolveContentImport(importId, client = defaultClient, options = {}) {
  return jsonImportRequest(`/api/v2/imports/${encodeURIComponent(importId)}/resolve`, {
    method:"POST", ...(options.signal ? {signal:options.signal} : {}),
    body:JSON.stringify({confirm_reject_pending:true})
  }, client);
}

export function previewContentImport(
  { file, kind, format = "auto", content = "", signal },
  client = defaultClient,
) {
  if (file) {
    validateImportFile(file);
    if (file.size > CONTENT_IMPORT_MAX_BYTES) throw importError({code:'import_paged_preview_required'});
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("kind", kind);
    formData.append("format", format);
    formData.append("source_type", kind);
    return formImportRequest(formData, signal ? { apiFetch: (path,options) => client.apiFetch(path,{...options,signal}), apiRequest:client.apiRequest } : client);
  }
  const mediaType = mediaTypeFor(format, content);
  return jsonImportRequest(
    "/api/v2/imports/preview",
    {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        kind,
        format,
        content,
        source_type: kind,
        media_type: mediaType,
        source_name: mediaType === "application/json" ? "import.json" : "import.txt",
      }),
    },
    client,
  );
}

export function commitContentImport(importId, decisions, client = defaultClient, options = {}) {
  return jsonImportRequest(
    `/api/v2/imports/${encodeURIComponent(importId)}/commit`,
    { ...options, method: "POST", body: JSON.stringify({ decisions }) },
    client,
  );
}

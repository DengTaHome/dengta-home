import { LARGE_TEXT_FILE_MAX_BYTES } from "./large-text-file.js";

export function importCheckpointKey(account, companion, kind, fingerprint) {
  if (!account || !companion || !["world_book", "chat_history"].includes(kind) || !/^[a-f0-9]{64}$/.test(fingerprint || "")) return null;
  return `dengta_import_checkpoint_v1.${encodeURIComponent(account)}.${encodeURIComponent(companion)}.${kind}.${fingerprint}`;
}
function validOffset(value, total) { return Number.isSafeInteger(value) && value >= 0 && value <= total; }
function normalize(value) {
  if (value?.version !== 1 || !Number.isSafeInteger(value.totalBytes) || value.totalBytes <= 0 || value.totalBytes > LARGE_TEXT_FILE_MAX_BYTES || !validOffset(value.nextByte, value.totalBytes)) return null;
  let pending = null;
  if (value.pending) {
    const p = value.pending;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(p.importId || "") || !validOffset(p.startByte,value.totalBytes) || !validOffset(p.endByte,value.totalBytes) || p.startByte !== value.nextByte || p.endByte <= p.startByte) return null;
    pending = { importId:p.importId,startByte:p.startByte,endByte:p.endByte,commitAttempted:p.commitAttempted === true };
  }
  return { version:1,totalBytes:value.totalBytes,nextByte:value.nextByte,pending };
}
export function readImportCheckpoint(key, totalBytes, storage) {
  try { const target=storage===undefined ? globalThis.localStorage : storage; const value=normalize(JSON.parse(target?.getItem(key) || "null")); return key && value?.totalBytes === totalBytes ? value : null; } catch { return null; }
}
export function saveImportCheckpoint(key, record, storage) {
  const value=normalize(record);
  if (!key || !value) return false;
  try { const target=storage===undefined ? globalThis.localStorage : storage; target?.setItem(key,JSON.stringify(value)); return Boolean(target); } catch { return false; }
}
export function clearImportCheckpoint(key, storage) {
  if (!key) return false; try { const target=storage===undefined ? globalThis.localStorage : storage; target?.removeItem(key); return Boolean(target); } catch { return false; }
}
export function importCommitReceipt(data, importId) {
  const value=data?.result || data;
  const row=value?.import;
  if (!row || row.id !== importId || row.status !== "committed") throw Object.assign(new Error("没有收到匹配的完整提交回执，请先检查提交结果，暂勿重复提交。"), { code:"import_commit_receipt_invalid" });
  return value;
}

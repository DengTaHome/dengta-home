"use strict";

// 用户工作区（DeepSeek 式文件能力）：每个用户在 Supabase Storage 的 user-workspace 桶
// 拥有独立目录（user-workspace/<userId>/...），模型通过工具读写文件。
// 路径安全：强制 userId 前缀、拒绝 ../ 与绝对路径、限制长度与大小。

const WORKSPACE_BUCKET = "user-workspace";
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 与桶限制一致
const MAX_TEXT_CHARS = 200000; // 单文件文本读取上限
const MAX_PATH_SEGMENTS = 16;
const MAX_PATH_CHARS = 500;

// 规范化工作区内相对路径：只允许 a-z0-9-_./ 与中文等常规字符，拒绝逃逸
function normalizeWorkspacePath(rawPath) {
    const value = String(rawPath || "").trim();
    if (!value) return { ok: false, error: "路径不能为空。" };
    const segments = value.split("/").filter((seg) => seg.length > 0);
    if (segments.length === 0) return { ok: false, error: "路径不能为空。" };
    if (segments.length > MAX_PATH_SEGMENTS) {
        return { ok: false, error: `路径层级不能超过 ${MAX_PATH_SEGMENTS} 层。` };
    }
    if (value.length > MAX_PATH_CHARS) {
        return { ok: false, error: "路径过长。" };
    }
    for (const segment of segments) {
        if (segment === ".." || segment === ".") {
            return { ok: false, error: "路径不允许包含 .. 或 . 段。" };
        }
        if (segment.includes("\\") || segment.includes("\0")) {
            return { ok: false, error: "路径包含非法字符。" };
        }
        if (segment.length > 120) {
            return { ok: false, error: "单段路径过长。" };
        }
    }
    return { ok: true, path: segments.join("/") };
}

function tenantPrefix(userId) {
    return String(userId || "").trim();
}

function scopedPath(userId, relative) {
    return [tenantPrefix(userId), relative].filter(Boolean).join("/");
}

function isWorkspaceFolder(item) {
    return item.id === null || (item.metadata == null && !item.id) || String(item.name || "").endsWith("/");
}

// 列出目录（返回名称/类型/大小/更新时间；按名称排序）
async function listWorkspace({ storage, userId, path = "" }) {
    const raw = String(path || "").trim();
    const normalized = raw ? normalizeWorkspacePath(raw) : { ok: true, path: "" };
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const prefix = normalized.path ? scopedPath(userId, normalized.path) : tenantPrefix(userId);
    const { data, error } = await storage
        .from(WORKSPACE_BUCKET)
        .list(prefix, { limit: 200, sortBy: { column: "name", order: "asc" } });
    if (error) return { ok: false, error: String(error?.message || "列出失败。").slice(0, 200) };
    return {
        ok: true,
        path: normalized.path || "/",
        entries: (data || []).map((item) => ({
            name: item.name,
            type: isWorkspaceFolder(item) ? "dir" : "file",
            size: Number(item.metadata?.size || 0),
            updatedAt: item.updated_at || ""
        }))
    };
}

// 读文件（文本，截断到 MAX_TEXT_CHARS）
async function readWorkspaceFile({ storage, userId, path }) {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const full = scopedPath(userId, normalized.path);
    const { data, error } = await storage.from(WORKSPACE_BUCKET).download(full);
    if (error) return { ok: false, error: String(error?.message || "读取失败。").slice(0, 200) };
    if (!data) return { ok: false, error: "文件不存在或为空。" };
    const bytes = Buffer.from(await data.arrayBuffer());
    const fullText = bytes.toString("utf8");
    const text = fullText.slice(0, MAX_TEXT_CHARS);
    return {
        ok: true,
        path: normalized.path,
        chars: text.length,
        truncated: fullText.length > MAX_TEXT_CHARS,
        content: text
    };
}

// 写文件（覆盖或追加；父目录自动创建）。
// mode=append 时先读取旧内容再拼接，避免模型用不完整内容覆盖原文件。
async function writeWorkspaceFile({ storage, userId, path, content = "", mode = "overwrite", confirm = false }) {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const text = String(content ?? "");
    const appendMode = String(mode || "").trim().toLowerCase() === "append";
    let finalText = text;
    if (appendMode) {
        const previous = await readWorkspaceFile({ storage, userId, path: normalized.path });
        if (previous.ok) {
            if (previous.truncated) return { ok: false, code: "workspace_append_truncated", error: "文件较长，不能用截取的预览追加；请下载完整文件后合并上传。" };
            finalText = previous.content + "\n" + text;
        } else if (previous.error && !/不存在|not found/i.test(previous.error)) {
            return { ok: false, error: previous.error };
        }
    }
    if (Buffer.byteLength(finalText, "utf8") > MAX_FILE_BYTES) {
        return { ok: false, error: `文件超过 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB 上限。` };
    }
    const full = scopedPath(userId, normalized.path);
    // HITL：覆盖已存在文件前需要用户确认（append 模式天然安全，跳过）
    if (!appendMode && confirm !== true) {
        const previous = await readWorkspaceFile({ storage, userId, path: normalized.path });
        if (previous.ok) {
            return {
                ok: false,
                code: "confirmation_required",
                message: `文件 ${normalized.path} 已存在（${previous.chars} 字符），确认要覆盖吗？请先向用户确认，用户同意后携带 confirm=true 再次调用。`
            };
        }
    }
    const buffer = Buffer.from(finalText, "utf8");
    const { error } = await storage
        .from(WORKSPACE_BUCKET)
        .upload(full, buffer, { contentType: "text/plain; charset=utf-8", upsert: true });
    if (error) return { ok: false, error: String(error?.message || "写入失败。").slice(0, 200) };
    return { ok: true, path: normalized.path, mode: appendMode ? "append" : "overwrite", chars: buffer.length };
}

// 删除文件（HITL：删除前必须用户确认 confirm=true，防止误删）
async function deleteWorkspaceFile({ storage, userId, path, confirm = false }) {
    const normalized = normalizeWorkspacePath(path);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    const full = scopedPath(userId, normalized.path);
    if (confirm !== true) {
        return {
            ok: false,
            code: "confirmation_required",
            message: `确认要删除工作区文件 ${normalized.path} 吗？请先向用户确认，用户同意后携带 confirm=true 再次调用。`
        };
    }
    const { error } = await storage.from(WORKSPACE_BUCKET).remove([full]);
    if (error) return { ok: false, error: String(error?.message || "删除失败。").slice(0, 200) };
    return { ok: true, path: normalized.path };
}

module.exports = {
    isWorkspaceFolder,
    deleteWorkspaceFile,
    listWorkspace,
    normalizeWorkspacePath,
    readWorkspaceFile,
    writeWorkspaceFile
};

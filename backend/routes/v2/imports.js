const express = require("express");
const multer = require("multer");
const { requireRequestScope } = require("../../services/request-scope");
const { extractText, decodeText } = require("../../services/adaptive-file-parser");
const {
    commitContentImport,
    contentImportError,
    getContentImport,
    listContentImports,
    previewContentImport,
    resolveContentImport
} = require("../../services/content-import");

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MEDIA_TYPES = new Set([
    "text/plain",
    "text/markdown",
    "application/json"
]);
// Extensions the user can pick. Anything else that looks like text is
// sniffed by content (JSON / markdown / plain text) instead of rejected.
const KNOWN_EXTENSIONS = new Set([".txt", ".text", ".md", ".markdown", ".json", ".log", ".csv"]);
// Browsers and Android WebViews frequently report wrong or empty media types
// for .json and .md files (text/plain, application/octet-stream, ""), so the
// file extension is treated as the source of truth for uploads.

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 1,
        fields: 4,
        parts: 5,
        fileSize: MAX_IMPORT_BYTES,
        fieldSize: 256 * 1024
    }
});

function extensionOf(name) {
    const match = String(name || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
    return match ? match[1] : "";
}

function normalizedMediaType(value) {
    const mediaType = String(value || "").split(";", 1)[0].trim().toLowerCase();
    return mediaType === "text/x-markdown" ? "text/markdown"
        : mediaType === "text/json" ? "application/json" : mediaType;
}

function coercedMediaTypeForUpload(mediaType, sourceName, bytes) {
    const extension = extensionOf(sourceName);
    if (extension === ".json") {
        // text/plain / octet-stream / empty are common browser misreports.
        return "application/json";
    }
    if (extension === ".md" || extension === ".markdown") {
        return "text/markdown";
    }
    if (extension === ".txt" || extension === ".text" || extension === ".log") {
        if (mediaType === "text/markdown") return "text/markdown";
        if (mediaType === "application/json") return "application/json";
        return "text/plain";
    }
    if (extension === ".csv") {
        return "text/plain";
    }
    // Unknown extension: sniff the decoded content head.
    const head = bytes.slice(0, 256).toString("utf8");
    if (/^\s*[[{]/.test(head)) return "application/json";
    if (/^#{1,6}\s+/m.test(head)) return "text/markdown";
    return "text/plain";
}

function validateUpload({ bytes, mediaType, sourceName, trustExtension = false }) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
        throw contentImportError(400, "import_empty", "导入内容不能为空。");
    }
    if (bytes.length > MAX_IMPORT_BYTES) {
        throw contentImportError(413, "import_file_too_large", "导入文件不能超过 100MB。");
    }
    const extension = extensionOf(sourceName);
    let effectiveMediaType = mediaType;
    if (trustExtension) {
        // File uploads tolerate unknown extensions and browser misreports:
        // known extensions map by name, everything else is sniffed.
        effectiveMediaType = coercedMediaTypeForUpload(mediaType, sourceName, bytes);
    } else if (!KNOWN_EXTENSIONS.has(extension)) {
        throw contentImportError(415, "import_file_type_unsupported", "文件扩展名必须是 .txt、.md 或 .json。");
    }
    if (!MEDIA_TYPES.has(effectiveMediaType)) {
        throw contentImportError(415, "import_media_type_unsupported", "仅支持 TXT、Markdown 和 JSON。");
    }
    if (!trustExtension) {
        const expected = extension === ".json" ? "application/json"
            : extension === ".md" || extension === ".markdown" ? "text/markdown" : "text/plain";
        if (effectiveMediaType !== expected && !(expected === "text/markdown" && effectiveMediaType === "text/plain")) {
            throw contentImportError(415, "import_media_type_mismatch", "文件扩展名与媒体类型不匹配。");
        }
    }
    return effectiveMediaType;
}

function uploadOne(req, res, next) {
    if (!req.is("multipart/form-data")) return next();
    upload.single("file")(req, res, (error) => {
        if (!error) return next();
        if (error.code === "LIMIT_FILE_SIZE") {
            return next(contentImportError(
                413,
                "import_file_too_large",
                "导入文件不能超过 100MB。"
            ));
        }
        if (["LIMIT_FILE_COUNT", "LIMIT_PART_COUNT"].includes(error.code)) {
            return next(contentImportError(
                400,
                "import_multipart_invalid",
                "导入请求只能包含一个文件。"
            ));
        }
        if (error.code === "LIMIT_UNEXPECTED_FILE") {
            return next(contentImportError(
                400,
                "import_file_field_invalid",
                "导入文件字段必须命名为 file。"
            ));
        }
        return next(contentImportError(
            400,
            "import_multipart_invalid",
            "导入 multipart 请求格式无效。"
        ));
    });
}

async function previewInput(req) {
    if (req.file) {
        const reportedMediaType = normalizedMediaType(req.file.mimetype);
        const sourceName = req.file.originalname;
        const mediaType = validateUpload({
            bytes: req.file.buffer,
            mediaType: reportedMediaType,
            sourceName,
            trustExtension: true
        });
        if (!/\.(json|txt|text|md|markdown|log)$/i.test(sourceName) && !(mediaType === "application/json" && !/\.(jsonl|ndjson)$/i.test(sourceName))) {
            if (/\.(jsonl|ndjson)$/i.test(sourceName)) {
                let rows;
                try { rows = decodeText(req.file.buffer).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line)); }
                catch (error) { if (error.code) throw error; throw contentImportError(400, "import_json_invalid", "JSONL 有无效行，请检查文件是否完整。"); }
                const content = req.body?.source_type === "world_book" ? {entries:rows} : rows;
                return { sourceType: req.body?.source_type, sourceName, mediaType: "application/json", bytes: Buffer.from(JSON.stringify(content)) };
            }
            if (/\.(pdf|docx|eml)$/i.test(sourceName) && req.file.buffer.length > 20 * 1024 * 1024) throw contentImportError(413, "import_document_too_large", "PDF、DOCX 和邮件最大支持 20MB，请拆分或导出文本。");
            const parsed = await extractText(sourceName, req.file.buffer);
            return { sourceType: req.body?.source_type, sourceName, mediaType: "text/plain", bytes: Buffer.from(parsed.text, "utf8") };
        }
        return {
            sourceType: req.body?.source_type,
            sourceName,
            mediaType,
            bytes: req.file.buffer
        };
    }
    const body = req.body || {};
    if (typeof body.content !== "string") {
        throw contentImportError(400, "import_content_required", "JSON 请求必须提供 content 字符串。");
    }
    const bytes = Buffer.from(body.content, "utf8");
    const mediaType = normalizedMediaType(body.media_type || "text/plain");
    const sourceName = String(
        body.source_name || (mediaType === "application/json" ? "import.json"
            : mediaType === "text/markdown" ? "import.md" : "import.txt")
    );
    validateUpload({ bytes, mediaType, sourceName });
    return {
        sourceType: body.source_type,
        sourceName,
        mediaType,
        bytes
    };
}

function createContentImportsRouter({
    previewImport = previewContentImport,
    listImports = listContentImports,
    readImport = getContentImport,
    commitImport = commitContentImport,
    resolveImport = resolveContentImport
} = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            requireRequestScope(req);
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                ok: true,
                imports: await listImports(scope.db)
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/preview", uploadOne, async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await previewImport(scope.db, await previewInput(req));
            res.status(201).json({ ok: true, result });
        } catch (error) {
            next(error);
        }
    });

    router.get("/:id", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json({
                ok: true,
                result: await readImport(scope.db, req.params.id)
            });
        } catch (error) {
            next(error);
        }
    });

    router.post("/:id/commit", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const result = await commitImport(
                scope.db,
                req.params.id,
                req.body?.decisions
            );
            res.json({ ok: true, result });
        } catch (error) {
            next(error);
        }
    });

    router.post("/:id/resolve", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            if (req.body?.confirm_reject_pending !== true) {
                throw contentImportError(400, "import_resolution_confirmation_required", "请明确确认放弃尚未提交的旧候选。");
            }
            res.json({ ok: true, result: await resolveImport(scope.db, req.params.id) });
        } catch (error) { next(error); }
    });

    return router;
}

module.exports = {
    MAX_IMPORT_BYTES,
    createContentImportsRouter,
    previewInput,
    validateUpload
};

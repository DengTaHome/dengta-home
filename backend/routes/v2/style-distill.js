const express = require("express");
const multer = require("multer");
const { requireRequestScope } = require("../../services/request-scope");
const { extractText } = require("../../services/adaptive-file-parser");

const FILE_LIMIT_BYTES = 20 * 1024 * 1024;

function createStyleDistillRouter(services = {}) {
    const distillService = services.service || null;
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: FILE_LIMIT_BYTES, files: 1 }
    });
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

    // 自适应解析导入的聊天记录/文档文件（md/txt/json/html/eml/mbox/csv/srt/pdf/docx…）
    router.post("/parse-file", (req, res, next) => {
        upload.single("file")(req, res, (error) => {
            if (error instanceof multer.MulterError) {
                const tooBig = new Error(error.code === "LIMIT_FILE_SIZE"
                    ? "文件不能超过 20MB。" : "请一次上传一个聊天记录文件。");
                tooBig.status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
                tooBig.code = error.code === "LIMIT_FILE_SIZE"
                    ? "style_distill_file_too_large" : "style_distill_file_invalid";
                return next(tooBig);
            }
            next(error);
        });
    }, async (req, res, next) => {
        try {
            requireRequestScope(req);
            if (!req.file?.buffer) {
                const error = new Error("没有收到文件，请重新选择。");
                error.status = 400;
                error.code = "style_distill_file_required";
                return next(error);
            }
            const originalName = String(req.file.originalname || "聊天记录.txt");
            const parsed = await extractText(originalName, req.file.buffer);
            if (!parsed.text || parsed.text.length < 40) {
                const error = new Error("这个文件里没有解析出可用的文字内容，请换一个文件。");
                error.status = 400;
                error.code = "style_distill_file_empty";
                return next(error);
            }
            res.json({
                parsed: {
                    filename: originalName,
                    format: parsed.format,
                    size: parsed.size,
                    characters: parsed.text.length,
                    included_characters: Math.min(parsed.text.length, 60000),
                    truncated: parsed.text.length > 60000,
                    text: parsed.text.slice(0, 60000)
                }
            });
        } catch (error) {
            if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
                const tooBig = new Error("文件不能超过 20MB。");
                tooBig.status = 413;
                tooBig.code = "style_distill_file_too_large";
                return next(tooBig);
            }
            next(error);
        }
    });

    router.post("/", async (req, res, next) => {
        try {
            if (!distillService) {
                const error = new Error("风格提纯服务还没有启用。");
                error.status = 503;
                error.code = "style_distill_unavailable";
                return next(error);
            }
            const scope = requireRequestScope(req);
            res.json({ result: await distillService.distill(scope, req.body || {}) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = { createStyleDistillRouter };

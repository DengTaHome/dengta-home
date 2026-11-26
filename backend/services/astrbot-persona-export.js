const express = require("express");
const { assertPromptFieldsDoNotContainSecrets } = require("./prompt-security");
const { requireRequestScope } = require("./request-scope");

const EXPORT_FIELDS = "ai_name,prompt_mode,unified_system_prompt,system_prompt,additional_prompt,personality";

function buildAstrBotPersona(settings, includeUserDetails = false) {
    const unified = String(settings.prompt_mode || "").trim().toLowerCase() === "unified"
        && Boolean(String(settings.unified_system_prompt || "").trim());
    const fields = unified ? ["unified_system_prompt"] : ["system_prompt", "additional_prompt", "personality"];
    const persona = Object.fromEntries(fields.filter((field) => typeof settings[field] === "string"
        && settings[field].trim()).map((field) => [field, settings[field]]));
    if (Object.keys(persona).length === 0) {
        const error = new Error("请先保存伴侣的个性化指令。");
        error.status = 422;
        error.code = "astrbot_persona_empty";
        throw error;
    }
    if (includeUserDetails && typeof settings.user_details === "string" && settings.user_details.trim()) {
        persona.user_details = settings.user_details;
    }
    assertPromptFieldsDoNotContainSecrets(persona);
    return {
        format: "dengta.astrbot-persona",
        version: 1,
        name: String(settings.ai_name || "伴侣").trim().slice(0, 80),
        prompt_mode: unified ? "unified" : "legacy",
        persona
    };
}

function createAstrBotPersonaRouter() {
    const router = express.Router();
    router.get("/", async (req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            const scope = requireRequestScope(req);
            const includeUserDetails = req.query.include_user_details === "true";
            const { data, error } = await scope.db.from("settings")
                .select(includeUserDetails ? EXPORT_FIELDS + ",user_details" : EXPORT_FIELDS)
                .order("created_at", { ascending: true }).limit(1).maybeSingle();
            if (error) throw error;
            res.json(buildAstrBotPersona(data || {}, includeUserDetails));
        } catch (error) {
            next(error);
        }
    });
    return router;
}

module.exports = { buildAstrBotPersona, createAstrBotPersonaRouter };

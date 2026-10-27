/**
 * 拒答诊断的展示字段。
 *
 * 后端在消息的 tool_calls.refusal_detected 里给出 reason / excerpt / model /
 * provider / code；老记录可能只有 code 和 source。这里统一成一组可渲染字段，
 * 并且保证任何情况下都有话可说——不能出现一个空白的告警条。
 */

const UPSTREAM_SOURCE_LABEL =
    "上游模型（DengTa 提示词已允许成人内容，为模型自身/中转站审核拦截）";
const LOCAL_SOURCE_LABEL = "DengTa 自身过滤";

function pickText(...candidates) {
    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

/**
 * @param {object|null|undefined} refusal  refusal_detected 对象
 * @returns {{
 *   code: string,
 *   sourceLabel: string,
 *   reason: string,        // 人话原因（可能为空字符串）
 *   excerpt: string,       // 拒答原文摘要（可能为空字符串）
 *   provenance: string     // 「模型 / 供应商」一行，可能为空字符串
 * }}
 */
export function refusalDisplayFields(refusal) {
    if (!refusal || typeof refusal !== "object") {
        return {
            code: "provider_boundary_residue",
            sourceLabel: UPSTREAM_SOURCE_LABEL,
            reason: "",
            excerpt: "",
            provenance: ""
        };
    }

    // 只有明确标成 local 才归因给 DengTa 自身的过滤；其余（包括字段缺失）
    // 一律按上游拒答解释——provider_boundary_residue 本身就是上游条件，
    // 把不知道的情况说成「DengTa 自身过滤」会误导用户。
    const sourceLabel =
        refusal.source === "local" ? LOCAL_SOURCE_LABEL : UPSTREAM_SOURCE_LABEL;

    // 后端可能给 reason（带错误码的整句），也可能只给 excerpt（原文摘要）。
    const reason = pickText(refusal.reason);
    const excerpt = pickText(refusal.excerpt);
    const fallbackExcerpt = !reason && !excerpt ? pickText(refusal.refusal_text) : "";

    const model = pickText(refusal.model);
    const provider = pickText(refusal.provider);
    const provenanceParts = [];
    if (model) provenanceParts.push(`模型 ${model}`);
    if (provider) provenanceParts.push(`供应商 ${provider}`);

    return {
        code: pickText(refusal.code) || "provider_boundary_residue",
        sourceLabel,
        // reason 已经在提示语里带上了原文摘要，优先用它，避免重复两遍。
        reason,
        excerpt: reason ? "" : excerpt || fallbackExcerpt,
        provenance: provenanceParts.join(" · ")
    };
}

#!/usr/bin/env node
/**
 * DengTa Home Graduation Thesis Reproducible Quantitative Benchmark Suite
 * Evaluates real production modules across 4 dimensions:
 *  1. Hybrid Semantic Retrieval Ablation (M0 Substring vs M1 BM25 vs M2 Semantic vs M3 Hybrid RRF)
 *  2. 5-Tier A/B/C/D/X OTC Medication Interaction Safety Checker Accuracy
 *  3. Diagnostic Error Redaction, Business Stack Extraction & Fingerprinting Stability
 *  4. Takeout Natural Language Query Extraction & Guardrail Safety
 */
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { createHybridSemanticIndex } = require("../../_refs/backend-prod/services/semantic-search.js");
const {
  COMMON_MEDICATIONS,
  searchMedications,
  checkMedicationInteractions,
} = require("../../_refs/backend-prod/services/medications-db.js");
const {
  diagnosticRecord,
  publicDiagnosticLog,
  classifySubsystem,
  computeDiagnosticFingerprint,
} = require("../../_refs/backend-prod/services/diagnostic-errors.js");
const { normalizeTakeoutSearchKeyword } = require("../../_refs/backend-prod/services/takeout-query.js");

const RETRIEVAL_CASES = [
  { query: "高烧39度浑身发冷骨头疼", expected: ["ibuprofen", "acetaminophen"] },
  { query: "大姨妈痛经小腹坠胀受不了", expected: ["ibuprofen"] },
  { query: "胃不好发烧想选不伤胃的退烧药", expected: ["acetaminophen"] },
  { query: "运动打球脚踝扭伤局部肿痛", expected: ["diclofenac-gel"] },
  { query: "着凉打喷嚏流清鼻涕轻微发烧", expected: ["ganmaoling-999", "compound-paracetamol-amantadine"] },
  { query: "咽喉红肿发炎热感冒", expected: ["lianhua-qingwen"] },
  { query: "晚上干咳停不下来影响睡觉", expected: ["dextromethorphan"] },
  { query: "嗓子有浓痰咳不出来", expected: ["ambroxol"] },
  { query: "鼻炎鼻塞日常温和冲洗鼻腔", expected: ["saline-nasal-spray"] },
  { query: "吃坏肚子一直拉稀水样便", expected: ["montmorillonite", "ors-iii"] },
  { query: "拉肚子怕脱水补充电解质", expected: ["ors-iii"] },
  { query: "熬夜胃酸反流烧心反酸", expected: ["omeprazole", "hydrotalcite"] },
  { query: "吃太撑消化不良胀气积食", expected: ["domperidone", "probiotics"] },
  { query: "吃完油腻拉肚子调理肠道菌群", expected: ["probiotics"] },
  { query: "春天花粉过敏打喷嚏白天还要开车", expected: ["loratadine"] },
  { query: "全身起风团荨麻疹奇痒无比", expected: ["cetirizine", "loratadine", "calamine-lotion"] },
  { query: "蚊子咬起大包涂抹清凉止痒无激素", expected: ["calamine-lotion"] },
  { query: "手指倒刺发炎化脓毛囊炎药膏", expected: ["mupirocin"] },
  { query: "摔倒膝盖擦伤破皮怎么温和消毒", expected: ["povidone-iodine"] },
  { query: "手背湿疹发红脱皮止痒乳膏", expected: ["hydrocortisone-cream"] },
  { query: "通宵看电脑眼睛干涩发酸人工泪液", expected: ["sodium-hyaluronate-eye"] },
  { query: "嘴巴长口腔溃疡说话疼局部含片", expected: ["cydiodine-lozenges", "watermelon-frost"] },
  { query: "熬夜掉发嘴角起泡补充B族", expected: ["vitamin-b-complex"] },
  { query: "感冒期间温水冲泡补维C", expected: ["vitamin-c"] },
];

function runSubstringBaseline(docs, query) {
  const q = query.trim().toLowerCase();
  const scored = [];
  for (const doc of docs) {
    const hay = `${doc.title} ${(doc.tags || []).join(" ")} ${doc.content}`.toLowerCase();
    let score = 0;
    if (hay.includes(q)) score += 10;
    // Also count 2-char exact chunks to represent naive keyword lookup
    for (let i = 0; i < q.length - 1; i += 2) {
      const chunk = q.slice(i, i + 2);
      if (hay.includes(chunk)) score += 1;
    }
    if (score > 0) scored.push({ id: doc.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.id);
}

function evaluateRetrieval() {
  const docs = COMMON_MEDICATIONS.map((drug) => ({
    id: drug.id,
    title: `${drug.genericName} ${drug.aliases.join(" ")}`,
    category: drug.category,
    tags: [...drug.aliases, ...drug.symptoms, ...drug.activeIngredients, drug.otcClass, drug.category],
    content: `${drug.summary} 适应症：${drug.indications.join("；")}。用法：${drug.dosage}。`,
  }));
  const index = createHybridSemanticIndex(docs);

  const modes = [
    { id: "M0_Substring", label: "M0 朴素子串/关键词匹配", run: (q) => runSubstringBaseline(docs, q) },
    { id: "M1_BM25", label: "M1 纯 BM25 (MiniSearch)", run: (q) => index.search(q, { mode: "bm25", limit: 5 }).results.map((r) => r.doc.id) },
    { id: "M2_Semantic", label: "M2 语义同义词+余弦", run: (q) => index.search(q, { mode: "semantic", limit: 5 }).results.map((r) => r.doc.id) },
    { id: "M3_Hybrid_RRF", label: "M3 混合 RRF 融合 (本文方法)", run: (q) => index.search(q, { mode: "hybrid", limit: 5 }).results.map((r) => r.doc.id) },
  ];

  return modes.map((mode) => {
    let hit1 = 0;
    let hit3 = 0;
    let mrrSum = 0;
    const t0 = performance.now();
    for (const tc of RETRIEVAL_CASES) {
      const ranked = mode.run(tc.query).slice(0, 5);
      const firstRank = ranked.findIndex((id) => tc.expected.includes(id));
      if (firstRank === 0) hit1 += 1;
      if (firstRank >= 0 && firstRank < 3) hit3 += 1;
      if (firstRank >= 0) mrrSum += 1 / (firstRank + 1);
    }
    const elapsedMs = performance.now() - t0;
    const n = RETRIEVAL_CASES.length;
    return {
      mode: mode.label,
      recallAt1: Number(((hit1 / n) * 100).toFixed(1)),
      recallAt3: Number(((hit3 / n) * 100).toFixed(1)),
      mrrAt5: Number((mrrSum / n).toFixed(3)),
      avgLatencyMs: Number((elapsedMs / n).toFixed(2)),
    };
  });
}

function evaluateInteractions() {
  const cases = [
    { name: "对乙酰氨基酚 + 999感冒灵（重复成分）", drugs: ["acetaminophen", "ganmaoling-999"], factors: {}, expected: "X" },
    { name: "布洛芬 + 阿司匹林（NSAIDs叠加）", drugs: ["ibuprofen", "aspirin-ec"], factors: {}, expected: "X" },
    { name: "对乙酰氨基酚 + 饮酒（急性肝损伤）", drugs: ["acetaminophen"], factors: { alcohol: true }, expected: "X" },
    { name: "布洛芬 + 饮酒（胃出血风险）", drugs: ["ibuprofen"], factors: { alcohol: true }, expected: "X" },
    { name: "氯雷他定 + 西替利嗪（抗组胺重复）", drugs: ["loratadine", "cetirizine"], factors: {}, expected: "D" },
    { name: "蒙脱石散 + 益生菌（物理吸附间隔）", drugs: ["montmorillonite", "probiotics"], factors: {}, expected: "D" },
    { name: "右美沙芬 + 氨溴索（镇咳与祛痰冲突）", drugs: ["dextromethorphan", "ambroxol"], factors: {}, expected: "D" },
    { name: "扑尔敏 + 开车（嗜睡高危）", drugs: ["chlorpheniramine"], factors: { driving: true }, expected: "D" },
    { name: "布洛芬 + 孕期（妊娠禁忌）", drugs: ["ibuprofen"], factors: { pregnancy: true }, expected: "D" },
    { name: "奥美拉唑 + 铝碳酸镁（错开2小时）", drugs: ["omeprazole", "hydrotalcite"], factors: {}, expected: "C" },
    { name: "奥美拉唑 + 饮酒（胃黏膜慎用）", drugs: ["omeprazole"], factors: { alcohol: true }, expected: "C" },
    { name: "口服补液盐III（单药安全）", drugs: ["ors-iii"], factors: {}, expected: "A" },
    { name: "玻璃酸钠滴眼液 + 碘伏（外用无冲突）", drugs: ["sodium-hyaluronate-eye", "povidone-iodine"], factors: {}, expected: "A" },
    { name: "维生素C + 复合维B（常规营养安全）", drugs: ["vitamin-c", "vitamin-b-complex"], factors: {}, expected: "A" },
    { name: "氯雷他定 + 炉甘石洗剂 + 开车（安全组合）", drugs: ["loratadine", "calamine-lotion"], factors: { driving: true }, expected: "A" },
  ];

  let exactMatches = 0;
  let hazardTotal = 0;
  let hazardCaught = 0;
  let safeTotal = 0;
  let safeFalseAlarm = 0;

  for (const tc of cases) {
    const res = checkMedicationInteractions(tc.drugs, tc.factors);
    if (res.highestSeverity === tc.expected) exactMatches += 1;
    const isHazard = tc.expected === "X" || tc.expected === "D";
    if (isHazard) {
      hazardTotal += 1;
      if (res.highestSeverity === "X" || res.highestSeverity === "D") hazardCaught += 1;
    } else if (tc.expected === "A") {
      safeTotal += 1;
      if (res.highestSeverity !== "A") safeFalseAlarm += 1;
    }
  }

  return {
    totalCases: cases.length,
    exactSeverityAccuracyPct: Number(((exactMatches / cases.length) * 100).toFixed(1)),
    hazardRecallPct: Number(((hazardCaught / hazardTotal) * 100).toFixed(1)),
    safeFalsePositivePct: Number(((safeFalseAlarm / safeTotal) * 100).toFixed(1)),
  };
}

function evaluateDiagnostics() {
  const secrets = [
    "sk-proj-SUPERSECRETKEY1234567890",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SIGNATURESTRING",
    "password=MyPrivatePassword9988!",
    "cookie: MUSIC_U=secret_netease_cookie_9999",
    "13812345678",
  ];
  const samples = [
    { path: "/api/chat/stream", status: 502, err: new Error(`Upstream failed with ${secrets[0]} and ${secrets[1]}`) },
    { path: "/api/v2/takeout/commands", status: 504, err: new Error(`Timeout with ${secrets[2]}`) },
    { path: "/api/v2/knowledge/search", status: 400, err: new Error(`Invalid query with ${secrets[3]}`) },
    { path: "/api/v2/music/play", status: 429, err: new Error(`Rate limited user ${secrets[4]}`) },
  ];

  let leaked = 0;
  let localized = 0;
  const fingerprints = [];

  for (const sample of samples) {
    const rec = diagnosticRecord({
      method: "POST",
      path: sample.path,
      status: sample.status,
      error: sample.err,
      traceId: "dt-bench-001",
      userMessage: "服务暂时不可用",
    });
    const pub = publicDiagnosticLog(rec);
    const serialized = JSON.stringify(pub);
    for (const secret of secrets) {
      const core = secret.split(/\s|=|:/).pop();
      if (core && serialized.includes(core)) leaked += 1;
    }
    if (pub.error_location || pub.subsystem) localized += 1;
    const fp1 = computeDiagnosticFingerprint({
      path: pub.path,
      errorCode: pub.error_code,
      topFrame: pub.error_location,
      errorSource: pub.error_source,
      upstreamStatus: pub.upstream_status,
    });
    const fp2 = computeDiagnosticFingerprint({
      path: pub.path,
      errorCode: pub.error_code,
      topFrame: pub.error_location,
      errorSource: pub.error_source,
      upstreamStatus: pub.upstream_status,
    });
    fingerprints.push(fp1 === fp2 && fp1.startsWith("DTF-"));
  }

  return {
    testedPayloads: samples.length,
    secretLeakageRatePct: Number(((leaked / samples.length) * 100).toFixed(1)),
    subsystemLocalizationPct: Number(((localized / samples.length) * 100).toFixed(1)),
    fingerprintDeterminismPct: Number(((fingerprints.filter(Boolean).length / fingerprints.length) * 100).toFixed(1)),
  };
}

function evaluateTakeoutQueries() {
  const utterances = [
    { input: "帮我点一份清淡养胃的皮蛋瘦肉粥，30元以内不要葱花", expectToken: "粥" },
    { input: "晚饭想吃一点麻辣烫或者米线，微辣", expectToken: "麻辣烫" },
    { input: "下午茶来杯少糖芝士葡萄奶茶和提拉米苏", expectToken: "奶茶" },
    { input: "深夜饿了帮我点烧烤烤串和小龙虾", expectToken: "烧烤" },
    { input: "加班来份轻食沙拉或者鸡胸肉波奇饭", expectToken: "沙拉" },
    { input: "胃疼想喝一碗热乎乎的鲜肉馄饨", expectToken: "馄饨" },
    { input: "今天想吃肯德基汉堡炸鸡套餐", expectToken: "汉堡" },
    { input: "发烧买点退烧药或者电解质水送过来", expectToken: "电解质" },
  ];
  let matched = 0;
  for (const item of utterances) {
    const q = normalizeTakeoutSearchKeyword(item.input);
    if (q && q.includes(item.expectToken)) matched += 1;
  }
  return {
    totalUtterances: utterances.length,
    concreteFoodExtractionPct: Number(((matched / utterances.length) * 100).toFixed(1)),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  corpusSize: COMMON_MEDICATIONS.length,
  retrievalAblation: evaluateRetrieval(),
  medicationSafety: evaluateInteractions(),
  diagnosticObservability: evaluateDiagnostics(),
  takeoutQueryExtraction: evaluateTakeoutQueries(),
};

console.log(JSON.stringify(report, null, 2));

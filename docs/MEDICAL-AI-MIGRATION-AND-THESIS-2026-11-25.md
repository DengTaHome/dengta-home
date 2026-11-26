# DengTa（灯塔）医疗 AI 专区迁移、系统工程优化与毕业论文实证交付报告

> 交付日期：2026-11-25  
> 适用范围：`tnineninet/dengta-home-frontend`、`tnineninet/dengta-home-backend`、`tnineninet/dengta-home`  
> 合规红线：零生产数据库改动、零 Cloudflare DNS 改动、零明文密钥/Token 输出、零原始患者 PII 迁移

---

## 1. 工作总览（M0–M4 + P0 + P2 全链路闭环）

本次持续工程交付将 `E:\zsh\OphthalmicOCR_System` 中全部可复用的隐私安全眼科临床底座迁移并升级为 DengTa 独立懒加载模块 **「灯塔医疗 AI 专区（Medical AI Studio）」**，同时落地了交接文档 [AI-HANDOVER-2026-11-25.md](./AI-HANDOVER-2026-11-25.md) 与 [GITHUB-REPOS-INDEX.md](./GITHUB-REPOS-INDEX.md) 中的高优先级 P0/P2 能力：

| 里程碑 / 优先级 | 核心交付内容 | 关键代码路径 | 验证状态 |
| :--- | :--- | :--- | :---: |
| **M0** 医疗 AI 专区迁移 | 迁入 29 项眼科指标、27 种眼科临床药典、4 套围术期方案、L1 规则校验与 36 页/9 例脱敏科研队列；接入导航、`⌘K` 命令面板与灵动岛 2×2 快捷格 | `backend-prod/services/medical-ai-domain.js`<br>`frontend-gh/src/MedicalAiStudio.jsx`<br>`frontend-gh/src/medical-ai-data.js` | PASS（前后端+浏览器复验） |
| **M1** 三源跨设备校验与随访导出 | 迁入 `E:\zsh` 跨设备一致性规则（`ΔCCT>35μm`、`ΔK1>1.5D`、`ΔACD>0.35mm`、`ΔIOP>4mmHg`）；新增本地 Zero-PII 随访三联折线图（IOP/AL/SE）与 Markdown/JSON 导出 | `backend-prod/routes/v2/medical.js`<br>`frontend-gh/src/MedicalAiStudio.jsx`<br>`frontend-gh/src/medical-ai-studio.css` | PASS（`ySpread=0px` 零溢出） |
| **M2** 36 问句医疗 RAG 消融基准 | 编写可复现消融脚本与毕业论文 `booktabs` LaTeX 对比表；拆分优化屈光术式/防 Haze/干眼同义词簇；实测柱图嵌入 Tab 5 看板 | `dengta-home/tools/medical-rag-ablation.mjs`<br>`dengta-home/docs/MEDICAL-RAG-ABLATION-BENCHMARK-2026-11-25.md` | PASS（Hybrid RRF 全面领先） |
| **M3** HTTP 全接口集成 & 聊天证据卡 | 10 端点真实 Express HTTP 集成测试 + `medical` 子系统错误指纹；聊天气泡自动渲染结构化医疗问诊卡与 `[M1..Mk]` 证据锚点（绝不篡改 AI 原文） | `backend-prod/test/medical-routes.integration.test.js`<br>`frontend-gh/src/medical-chat-card.js`<br>`frontend-gh/src/ChatMessage.jsx` | PASS（14/14 后端 + 聊天回归） |
| **P0** 登录排障与零密钥诊断回执 | 识别已停用旧邮箱（`tnineninet@gmail.com` / `buyaocaowo555@gmail.com`）、按错误码分因引导、支持一键复制脱敏登录诊断回执（零密码/零 Token） | `frontend-gh/src/auth-diagnostics.js`<br>`frontend-gh/src/AuthGate.jsx` | PASS（AuthGate 回归全绿） |
| **P2** 缓存感知上下文预算与记忆衰减 | 借鉴 `dayflow` 理念自主洁净实现：不可变 KV-Cache 前缀哈希 `dtpfx-*`、检索记忆去重省 Token、锁定记忆永不衰减 + 普通记忆指数遗忘曲线 | `backend-prod/services/context-budget.js`<br>`backend-prod/test/cache-aware-context-budget.test.js` | PASS（前缀哈希 100% 稳定） |

---

## 2. 从 `E:\zsh` 迁移的资产边界与隐私合规矩阵

### 2.1 已迁入（100% 共识知识与脱敏统计）
- **29 项结构化眼科临床指标**（源自 `app/knowledge_base.py`）：覆盖 IOLMaster 700（AL/CCT/ACD/LT/WTW/Pupil/K1/K2/ΔK/TK/CW 弦）、Pentacam（QS/Km/后表面曲率/最薄点厚度/Kmax/角膜容积）、ZEISS MEL90（Sphere/Cylinder/SE/OZ/Ablation）、安全红线（RSB/PTA/Munnerlyn/KC-Screen）及门诊体征（IOP/UCVA/BCVA/C/D）。
- **27 种眼科临床药典 + 4 套屈光围术期阶梯方案**（源自 `app/drug_formulary.py`）：8 大药理分类 + TPRK/SMILE-LASIK/激素性高眼压应急/神经源性干眼修复方案 + X/D/C/A 四级眼科禁忌拦截。
- **L1 确定性规则与三源跨设备校验器**（源自 `app/validator.py` + `app/config.py` + `app/parsers.py`）：`0D→OD` / `回K→OK` OCR 伪影清洗、SE/RSB/PTA/Munnerlyn/Ehlers 薄角膜眼压校正、浅前房自动剔除散瞳药推荐、三机跨单据极差校验。
- **匿名化聚合科研队列基准**（源自 `thesis_experiments_report.json`）：仅迁入汇总均值/分布与 4 阶段消融精度（36 页 / 9 例脱敏队列、Accuracy `56.31% → 93.2%`、温度校准 `T* = 0.653`、ECE 降幅 `-13.4%`、Munnerlyn 拟合 `11.1 μm/D, r = 0.873`）。

### 2.2 严格隔离（严禁迁入 DengTa）
- 严禁迁入任何原始患者检查图像（JPG/PNG）、原始 PDF 报告、真实姓名、手机号、病历号或 SQLite 个人明细行；
- 随访趋势数据仅保存在用户本机浏览器 `localStorage`（`dengta.medical.visits.v1`），不自动上传云端，导出摘要强制标记 `Zero-PII` 并附带非替代面诊处方免责声明。

---

## 3. AI 产品经理架构选型论证（毕业论文核心论点）

在医疗垂直 AI 场景下，我们对比了「纯关键词检索」「纯稠密向量 RAG」「直接大模型端到端问诊」与 **「L1 确定性临床护栏 + L2 混合语义增强检索 + L3 Grounded RAG 证据装配」** 四种方案，最终落地三层混合架构：

1. **L1 确定性临床校验与禁忌护栏（零幻觉底线）**：
   - `RSB < 280 μm`、`PTA ≥ 40%`、`Kmax > 47.2 D`、薄角膜 Ehlers 眼压校正、哮喘禁用噻吗洛尔（X 级）、浅前房禁散瞳（X 级）等硬性数值与禁忌判定对幻觉零容忍，100% 由确定性函数算出并前置阻断，绝不交由 LLM 心算。
2. **L2 混合语义增强检索（MiniSearch BM25 + 中文 Bigram/Trigram + 双域医疗同义词簇 + TF-IDF 余弦 + RRF 融合）**：
   - 临床场景同时存在高度精确的医学缩写（`CCT`/`Kmax`/`0.1% 氟米龙`/`0.02% MMC`）与高度口语化的患者问法（“做完激光晚上开车炫光”“角膜薄眼压 20 正常吗”）。纯 BM25 在口语桶 Recall@1 仅 **66.7%**，纯语义余弦在专业缩写桶精度回落至 **91.7%**；采用 RRF 混合融合后，在 89 条统一医疗语料上取得全场最高的 **Recall@1 = 91.7%、Recall@5 = 100.0%、MRR@5 = 0.951、nDCG@5 = 0.879**，且平均耗时仅 **3.53 ms**（端/服均可零外部依赖离线运行）。
3. **L3 Grounded RAG 证据装配器 + 聊天结构化问诊卡**：
   - 自动将 L1 计算值、红线告警与 L2 召回的 `[M1..Mk]` 指南编号封装进 Prompt；前端在聊天流里以结构化问诊卡呈现并完整保留伴侣逐字回复原文，兼顾临床严谨性与陪伴可读性。

---

## 4. 关键定量实证数据（均可一键复现）

复现命令：
- 医疗 RAG & L1 护栏消融：`node dengta-home/tools/medical-rag-ablation.mjs --write-report`
- 全站 OTC / 诊断日志 / 外卖基准：`node dengta-home/tools/thesis-eval-benchmark.mjs`

| 评测维度 | 核心指标 | 实测结果 |
| :--- | :--- | :--- |
| L2 医疗混合语义 RAG（36 问句 × 89 语料） | Recall@1 / Recall@5 / MRR@5 / nDCG@5 / 延迟 | **91.7% / 100.0% / 0.951 / 0.879 / 3.53 ms**（优于 B0 子串 80.6%、B1 BM25 88.9%、B2 语义 88.9%） |
| L1 临床生物力学与红线校验（14 例） | 精确匹配率 / 高危召回率 / 正常误报率 | **100.0% / 100.0% / 0.0%** |
| L1 眼科药典 A/C/D/X 禁忌拦截（10 例） | 分级准确率 / X+D 召回率 / 安全误报率 | **100.0% / 100.0% / 0.0%** |
| 三源跨设备一致性 + 随访进展（8 例） | 精确匹配率 | **100.0%** |
| L3 Grounded 引用与 Zero-PII 审计（6 组 + 导出） | 引用合规率 / 隐私泄露率 | **100.0% / 0.0%** |
| 全站家庭常备 OTC 混合检索（24 问句 × 29 药） | Recall@1 / Recall@3 / MRR@5 / 延迟 | **95.8% / 95.8% / 0.958 / 0.82 ms** |
| 前端首包体积极限控制（懒加载拆包） | 入口 Raw / Gzip（上限 600KB / 190KB） | **409,995 raw / 128,349 gzip bytes**（医疗专区 124KB 独立按需加载） |
| 聊天虚拟化与渲染隔离（120 条历史流式增量） | 增量重渲染行数 | **1 / 120**（零历史气泡抖动） |

---

## 5. 发布前强制同步检查单（严格遵循 `AI-HANDOVER §11`）

> 以下发布/推送步骤需经你确认后再执行，本次交付未做任何未经授权的线上推送或数据库变更：

1. **三仓提交前自检**：确认 `git status` 中不含 `.env`、`_credentials/`、`_audit/`、APK/keystore 与任何明文 Token。
2. **推送至 `tnineninet` 主组织**：
   - `D:\GZdeepseek\_refs\backend-prod` → 核对分支策略后合并/推送至 `tnineninet/dengta-home-backend` 并确认 Render 服务健康；
   - `D:\GZdeepseek\_refs\frontend-gh` → 推送 `main` 至 `tnineninet/dengta-home-frontend` 并确认 Vercel 自动部署与 `deployment-health.mjs` 全绿；
   - `D:\GZdeepseek\dengta-home` → 推送文档与基准脚本至 `tnineninet/dengta-home`。
3. **三方备份同步**：运行 `powershell -ExecutionPolicy Bypass -File D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1`，确认 CNB `DengTaArchive2026/dengta-workspace` 新 commit 并在 `docs/SYNC-LEDGER.md` 登记。
4. **遗留外部人工项**：修复 GitHub `tnineninet` Billing/Spending Limit 以恢复 Android Release APK 自动发布；保持 Cloudflare DNS 不动。

# 附件 / 聊天记录导入 / 蒸馏全流程审计（2026-10-28）

目标：回答“蒸馏效果好不好用、精不精细、是否适配所有后缀、怎么优化”。本文只记录**审计事实与改进方案**，
不包含未验证的承诺；标注 ✅ 的为读过代码确认，⚠️ 为需要实测的风险点。

## 1. 现有链路（✅ 已读代码）

```
上传文件 / 粘贴文本
  ├─ backend/services/adaptive-file-parser.js   （203 行）格式识别 + 文本提取
  ├─ backend/services/content-import.js         （752 行）世界书/聊天记录 → 记忆/日历候选
  ├─ backend/services/style-distill.js          （117 行）聊天记录 → 风格提示词（单次 LLM）
  ├─ backend/services/world-book.js             （165 行）世界书 CRUD（不解析文件）
  ├─ backend/routes/v2/imports.js               （267 行）
  └─ frontend/src/ContentImport.jsx             （511 行）/ WorldBookManager.jsx（260 行）
```

### 1.1 自适应解析器已支持（✅）

| 类型 | 处理 |
|---|---|
| md / markdown / txt / text / log | 原文，UTF-8 + GB18030 回退 |
| json / jsonl / ndjson | JSON 聊天结构（`messages/conversations/chats/items/mapping`）+ 常见 sender/content 字段 |
| html / htm | 去 script/style 标签后转纯文本 |
| csv / tsv | 引号感知 CSV → `a | b | c` 行 |
| srt / vtt | 去序号/时间轴 |
| eml | mailparser 提取正文/主题 |
| pdf | pdf-parse 提取文字（扫描版会明确报错需 OCR） |
| docx | mammoth 提取纯文本 |
| xml / yaml / yml / ini / conf | 当文本读 |

明确拒绝并给出提示：zip/xlsx/xls/ppt/pptx/旧 doc。

### 1.2 蒸馏实现（✅）

- 单次 LLM 调用，system prompt 要求 7 个维度（人设/说话风格/口头禅/称呼/标点表情/边界/示例改写），
  输入上限 60,000 字，输出要求 800–2000 字。
- 有 10 分钟 5 次限流；使用账号自己的模型与 API；空结果/过短会报错。
- **不是多轮、不是分块、不做统计特征、不产出结构化 JSON、不回写世界书/角色卡、无质量评估**。

## 2. 适配缺口（⚠️ 需要实现）

### 2.1 聊天记录格式

| 来源 | 现状 | 缺口 |
|---|---|---|
| 微信 Windows 导出（TXT/HTML，`xxx: 内容` / 时间行） | 文本能读；`parseTextChat` 有简单时间行解析 | 不支持微信 4.x 的加密数据库、合并转发的 XML/引用/图片占位、语音转写格式；HTML 导出里的昵称/时间列会混入正文 |
| 微信聊天记录（自带的 .db/.sqlite 加密库） | 直接二进制拒绝 | 需要明确“不支持解密，请用官方导出/第三方导出 txt/html”的引导（合规风险，不做解密） |
| QQ 导出（TXT / MHT / 手机 QQ 合并转发） | TXT 可读；MHT 当二进制拒绝 | 缺 `.mht/.mhtml` 解析（quoted-printable HTML）、QQ 时间行 `2024-01-01 12:00:00 昵称(123)` 结构 |
| Telethon / Telegram Desktop JSON | JSON 结构可读一部分 | 缺 `from_id`/`peer_id`/`date` unix/`text` 数组富文本的 sender 提取 |
| WhatsApp `_chat.txt` | 文本可读 | 格式 `[2024/1/1, 12:00:00] 昵称: 内容` / `昵称: 内容`（无时间）未专门解析 |
| Discord / Slack JSON | 泛化 JSON 可读 | 无 `author.username`、`timestamp`、线程父子关系 |
| 飞书/钉钉/企业微信导出 | CSV/HTML 可能可读 | 缺字段映射（发送者列、时间列、消息类型） |
| **DSH 会话导出（jsonl）** | JSONL 泛化可读 | DSH 事件是 `{type, payload, ts}` 结构，不是 `{sender, content}`；需要专门适配（tool_call/segment/角色） |
| 小红书/微博等 | 无 | 不属于聊天记录，暂不做 |
| 图片截图聊天 | 无 OCR | 可选接入视觉模型做 OCR，成本高，优先级低 |

### 2.2 附件格式

- 现有 `TEXT_EXTENSIONS` 不含 `.mht/.mhtml/.mbox/.msg`，也不支持 `.xlsx`（很多平台聊天记录导出是 Excel）。
- 文件指纹/去重、断点续传已有一部分（`import-file-fingerprint*`、`import-checkpoint.js`），但格式识别
  只按扩展名 + 魔数，**不看内容特征**（例如 `.txt` 里其实是 JSON、MHT、QQ 记录）。
- 大文件上限 1,000,000 字符，超出只保留前缀并提示——对超长聊天记录会**丢后半段**，而蒸馏需要覆盖
  角色变化/长期语气，这是质量痛点。

## 3. 蒸馏质量优化方案（按投入/收益排序）

### 阶段 A：确定性统计层（不花 token，立即提升信息密度）

新增 `backend/services/chat-style-stats.js`：

- 消息数、按发送者的消息占比、平均长度、长短句分布、问句/感叹句比例；
- 高频词/二元组/三元组（jieba 分词已在 kiwi 侧；后端可轻量正则 + 停用词）、emoji/颜文字 Top N、
  标点组合（`……`、`！！`、`？？`）、换行/分点习惯；
- 时间活跃段（小时分布）、回复速度（有双时间戳时）；
- 与"普通 AI"的差异：重复口头禅、称呼、句尾语气词；
- 输出 JSON + 人类可读摘要，作为蒸馏 prompt 的"证据层"注入，降低模型编造。

### 阶段 B：分块 map-reduce + 证据引用

- 按时间/轮次切块（每块 8k–12k 字），每块提炼“风格证据条目”（含原句引用）→ reduce 合并；
- 每块结果缓存（内容 hash），相同聊天记录重复蒸馏不重复花 token；
- 输出结构化 JSON：`identity/style/phrases/address/punctuation/boundaries/examples/evidence`，
  再渲染成可粘贴 Markdown；前端可预览/编辑后再保存。
- 超出 60k 字不再截断，按块处理（与阶段 A 统计一起覆盖全文）。

### 阶段 C：质量评估与回写

- 自动质量检查：是否覆盖 7 维度、口头禅是否有原文证据、示例是否含目标角色特有表达；
  不达标自动重试一次（换更严格 prompt）。
- 一键把结果写入“个性化指令/世界书/角色卡”（需要 world-book API 支持来源标记）；
- 提供 A/B 对比：同一段聊天记录用旧单次 vs 新 map-reduce 的输出并排展示，便于用户选择。

### 阶段 D：参考开源项目择优融合（需先做候选对比）

候选方向（下一轮联网核对 license/接口后再定）：

- SillyTavern 的 character card / world info 格式（角色卡 V2、世界书 JSON）；
- 聊天记录清洗/角色扮演语料项目的“发言者分离 + 场景切分”思路；
- 开源 “chat distillation” / “persona extraction” 项目的结构化 schema 与评估 rubric。

原则：不直接引入厚重框架；只吸收 **格式规范 + prompt 结构 + 评估 rubric**，用现有 Node 后端实现。

## 4. 下一轮落地清单（可交付/可测试）

1. `chat-style-stats.js` + 单测（微信 TXT、QQ TXT、DSH JSONL、WhatsApp、Telegram JSON 各 1 个 fixture）；
2. 解析器补 `.mht/.mhtml`、`.xlsx` 聊天导出、WhatsApp/Telegram/DSH 专用分支 + 单测；
3. 蒸馏分块 map-reduce + 结构化 JSON 输出 + 缓存（保留旧接口兼容）；
4. 前端导入页显示“识别到的格式/统计摘要/分块数量”，蒸馏结果预览与一键写回；
5. 用真实样例（脱敏）做质量对比，记录在账本。

## 5. 本轮结论

- 现有导入/蒸馏不是“不能用”，而是**单次、易截断、缺统计证据、格式覆盖偏通用**；
- 最划算的第一步是 **阶段 A（零 token 统计）+ 格式嗅探增强 + 分块**，能明显提升精细度；
- 加密的微信数据库不做解密；只支持官方/第三方**已导出**的 txt/html/csv 等格式，并在 UI 明确提示。

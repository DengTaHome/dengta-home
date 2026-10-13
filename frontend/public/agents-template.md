# DengTa 伴侣 · 用户个性化指令

> 本文件由 `buildUserAgentsMd()` 自动生成，内容来自用户设置。
> 格式：`<file path="agents.md">` 块，注入优先级最高。
> 参考 ChatGPT Custom Instructions 两部分设计。

---

## 第一部分：用户详情

<!-- 对应 settings.user_details，用户填写的"你的详情" -->

{user_details}

---

## 第二部分：个性化指令

<!-- 对应 settings.unified_system_prompt，用户填写的"个性化指令" -->

{unified_system_prompt}

---

## 第三部分：长期记忆

<!-- 对应 memories 表中最新的 5 条 summary，降序排列 -->

{memories}

---

## 格式说明

- 每个部分通过空行分隔
- 本文件直接拼入 systemInstructions 最前（最高优先级）
- 各部分的原始文本不作加工、不过滤、不脱敏（与 ChatGPT 一致）
- 记忆部分不参与指令执行，仅供上下文参考
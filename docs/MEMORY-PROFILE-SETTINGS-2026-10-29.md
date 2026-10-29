# 设置页补回记忆、性格与偏好、对话摘要（2026-10-29）

## 用户反馈
设置里的记忆、性格与偏好、对话摘要“还是没有”。

## 排查结论
不是数据丢失：

- 后端 `/api/v2/memories`：当前账号 + 伴侣 **19 条**长期记忆，4957 字
- 后端 `/api/v2/companion-profile`：档案 v1，含 8/23 从 2647–2963 条聊天提取的线索
- 记忆独立页本身能正常展示，但**设置 → 个性化与记忆**只显示个性化指令/你的详情，没有把这三块渲染出来；稳定长期记忆计数也因为没加载数据而显示 0

## 修复
在设置 → 个性化与记忆顶部加入「记忆、性格与对话摘要」卡片：

- 复用 `CompanionProfile`：档案 v1、性格/喜欢/不喜欢/小习惯/相处方式、身份关系、成长记录
- 复用 `LocalMemorySummaries`：读取真实 `/api/v2/memories`，显示 19 条摘要，可编辑/删除/重新整理
- 档案为空时显示后端 `change_reason` 中最近从聊天读到的线索，而不是只显示“还没聊到足够多”
- 旁边「打开记忆页」按钮可跳到独立 Memory 页
- 稳定长期记忆计数会随摘要加载更新

## 验证
- 本地真实浏览器（390×844，真实账号 token）：
  - MARKERS：summary=true, profile=true, memory=true, memoryItems=19
  - 无 pageerror
- 截图：`_audit/settings-persona-check.png`
- `npm run build` 成功

## 说明
- 这次没有改后端数据结构；后端 19 条记忆与 v1 档案原地保留。
- 伴侣档案的“性格/偏好”字段本身仍受后端提取规则影响：已有线索会显示，但条目要等后续档案刷新整理。


## 最终验证（2026-10-29 18:10）
- 生产 Vercel `fd1ec20` READY；真实账号生产页面：summary=true、profile=true、memoryItems=19，无 pageerror（仅一个 404 静态资源）。
- 前端全量：0 failure（3829 行）。
- 最终 APK：`_audit/DengTa-2.13.44-302-memory-settings.apk`
  - SHA-256：`ba472f97eec9506ce54c8f480d0d1d70a4fb976415f1719bedef8a7c70edecfd`
  - 手机当前未连接，待重新插入后 `adb install -r`；网页端已生效。

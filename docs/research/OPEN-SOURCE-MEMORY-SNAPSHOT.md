# 灯塔开源调研笔记：陪伴架构、长期记忆与 RP 提示词

检索日期：2026-11-12。交接快照：调研尚未最终合并成用户选型报告，未批准或安装任何候选库。只读调研；未修改灯塔产品代码、未发送站外消息。

推荐结论：继续使用现有 Kiwi / Ombre 和灯塔自己的上下文压缩。优先借鉴 AIRI 的 Capacitor 移动路线、SillyTavern 的提示词分层与角色资料按需注入。新记忆引擎先用虚构中文对话做后台对照试验，再决定是否替换。以下“适合/成本/建议”是基于源码的工程判断，不能当已经完成性能或安全验收。

## 灯塔基线

父代理已核对：灯塔是 React DOM / Vite / Capacitor 8，不是 React Native；长期记忆以用户和伴侣组合隔离，已有画像/核心记忆/时间与情绪权重、会话压缩预算、Ombre MCP、统一与旧版 RP 提示词拼接。AI 长期记忆在服务器；iOS Keychain 与账号加密缓存是另一层。这些不应因选型被混为一谈。

## 1. AIRI：最贴合移动宿主路线的参考应用

- **已核实事实**：官方 [moeru-ai/airi](https://github.com/moeru-ai/airi) 是自托管虚拟陪伴应用；[代码许可为 MIT](https://raw.githubusercontent.com/moeru-ai/airi/main/LICENSE)。README 的 Stage Pocket 已给出 `cap run ios` 路线；[移动 package.json](https://github.com/moeru-ai/airi/blob/main/apps/stage-pocket/package.json) 明确列出 Capacitor、Keyboard、LocalNotifications，主体 UI 使用 Vue，并带 Three、Transformers、ONNX、多种字体等依赖。其 README 仍把 Memory Alaya 标为 WIP。
- **大白话**：这是另一套会说话、有形象的陪伴应用，可以看它如何照顾手机与音频生命周期。
- **建议**：推荐作为代码/架构参考，不整包塞入灯塔。Capacitor 路线与灯塔接近，但 Vue 页面、整套形象和推理资产不能当作可直接安装的 React 组件。只参考设计不会增加 IPA；若搬入模型、字体或角色资产，包体与内存可能明显上升，需要逐项实测和核对资产许可。
- **维护证据**：官方 README 有 2026-03-23 的移动性能开发日志、2026-01-01 的 Pocket 与 FlowChat 记忆实验，以及 2025-08-01 的流式文字/字素开发日志链接。它们是具体研发线索，不等于稳定 iOS 发布承诺。网页在本次查询显示约 51.3k stars，仅作热度快照。

## 2. SillyTavern：提示词与角色资料管理参考

- **已核实事实**：[官方项目](https://github.com/SillyTavern/SillyTavern) 采用 [AGPL-3.0](https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/LICENSE)。[Prompt Manager](https://docs.sillytavern.app/usage/prompts/prompt-manager/) 可管理提示词顺序、角色与场景等分段；[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/) 按关键词动态注入，并支持角色、persona 和单个会话各自的资料与预算。
- **大白话**：把“角色是谁”“你是谁”“这次发生什么”“过去哪些事有关”分开管理，只把有关的资料放进本轮对话。
- **建议**：推荐借鉴分段、来源与预算的可视化方式，继续用灯塔自己的服务端 prompt 契约。它是完整应用，不是轻量 RN/Capacitor 插件；不要直接复制整套 UI 或 AGPL 代码当普通 MIT npm 包处理。
- **关键边界**：[官方多用户文档](https://docs.sillytavern.app/administration/multi-user/) 明确说用户密码只提供基础隐私，服务器聊天、API key 等以明文保存，不能视为安全边界。不能照搬它的账号存储来满足灯塔隐私指标。网页查询显示约 35.6k stars，不代表安全等级。

## 3. Memobase：用户画像与事件时间线，后台试验备选

- **已核实事实**：[官方项目](https://github.com/memodb-io/memobase) 与 [Apache-2.0 许可](https://raw.githubusercontent.com/memodb-io/memobase/main/LICENSE)已核对。[使用说明](https://github.com/memodb-io/memobase/blob/main/readme.md) 提供用户、聊天 blob、画像、事件、context 及删除接口；默认处理后可移除原始 blob，原始资料保留策略可配置。用户 buffer 批量抽取，不必每条消息都做抽取。
- **运行成本事实**：[服务器说明](https://github.com/memodb-io/memobase/blob/main/src/server/readme.md) 是 FastAPI / Postgres / Redis，支持 Docker 与兼容模型接口；可选择关闭事件 embedding。需要模型推理和可选 embedding 的资源/费用，以及新服务的备份、迁移和运维。
- **大白话**：更擅长维护“用户喜欢什么、重要事件发生在何时”，比单纯关键词搜索更贴近陪伴画像。
- **建议/推断**：可作为后台隔离试验，优先比较它是否真的优于现有 Kiwi，而不是立刻迁全量记忆。项目 token 必须留后端；手机只调用灯塔自己的登录 API。把 `userId + companionId` 映射到独立记忆用户，不能仅凭客户端传来的 uid 或仅按真实用户 id 共用所有伴侣记忆。按这种后端接法，不把 Memobase 引擎/模型打进 IPA；手机包体实际差值仍需同配置 Release 构建确认。
- **维护边界**：README 的近期更新列出 0.0.40 等版本，但不能据此宣称它就是最新发布；当前 News 同时引导至 Acontext，落地前要锁定实际版本、迁移路线与维护范围。README 性能数字来自作者自己的条件，未在灯塔中文对话上复测，不作性能保证。

## 4. Smart-Memory：关系连续性设计样本，暂不接入

- **已核实事实**：[官方仓库](https://github.com/senjinthedragon/Smart-Memory) 是 SillyTavern 扩展，[AGPL-3.0](https://raw.githubusercontent.com/senjinthedragon/Smart-Memory/main/LICENSE)。它描述了角色事实、关系状态、场景、故事弧及滚动摘要，并处理角色“亲历/转述”的知识边界。其 README 允许将 embedding API key 放在扩展设置，不能照搬到灯塔手机凭证策略。
- **建议**：仅作为设计样本，尤其参考“事实被新证据更正”“关系变化有来源”“角色不知道没参与的场景”。它依赖 SillyTavern 的上下文与扩展运行时，不是可直接插入灯塔的 SDK。仓库网页本次显示 75 stars，暂不把这个小扩展与成熟服务等同。独立实现设计不会增加手机依赖；直接移植会引入宿主改造和许可义务。

## 跨候选的验证要求

以下是灯塔接入候选服务时必须自行验证的工程条件，不是声称各库已保证：

1. 服务端从可信登录身份获得用户，再校验伴侣所有权；每个查询、写入、后台抽取任务和删除都带相同组合租户。
2. 并发删除或切换账号时，排队的记忆抽取不能把已删资料写回来。服务商的 `user_id` / `group_id` 名称不是授权边界。
3. 删除需要检查画像、事件、向量、历史、缓存、异步任务和备份；不能把前台“不再显示”写成物理擦除。
4. 用同一份虚构中文长对话比较现有 Kiwi 与候选：事实准确、角色串记忆、矛盾更正、时间关系、遗忘、调用费用和 P95 延时。公开英文榜单不代替灯塔实测。
5. 保留灯塔“召回记忆是不可信数据”的 prompt 边界、上下文预算与故障降级。候选异常不能阻断主聊天，也不能自动改写角色设定。

## X / Twitter 检索范围与限制

实际检索过 `site:x.com moeru airi open source companion`、`site:x.com memobase AI memory open source`、`site:x.com "moeru-ai/airi"`、`site:x.com "Memobase" "github"`、`site:x.com/memobase_io/status`、`site:x.com "AIRI" "nekomeowww"` 等。多条查询未返回相关官方帖子，部分返回了第三方镜像；不以镜像代替官方技术证据。

Memobase 官方 README 指向 [@memobase_io](https://x.com/memobase_io)，打开实际返回 403。因此不能声称已读其完整时间线或最新推文。X 只用于发现线索；上面的选择依据以直接可查的项目代码、LICENSE 和官方文档为准。子任务对 Mem0 / Letta 的帖子索引限制会附在补充段。

实际 GitHub/Web 关键词还包括：`Companion AI`、`AI Girlfriend framework`、`long term memory`、`长期记忆 情感陪伴 Memobase 角色扮演 prompt`、`SillyTavern Prompt Manager`。没有声称搜索穷尽全网。

## 补充：Mem0 / Graphiti / Letta

另见 `/tmp/dengta-memory-engines.md`；完成后并入本笔记。当前已发现的关键差异：Graphiti 参考服务器的 group_id 不是权限边界；Letta 当前仓库路线发生迁移；Mem0 删除向量会写历史，不能直接许诺抹去所有副本。最终事实以补充中具体源码和官方文档链接为准。


---

## 三引擎已核实子任务原始笔记（交接附录）

# 灯塔记忆引擎专项调研：Mem0 / Graphiti / Letta

检索日期：2026-11-12。仅阅读公开资料，未安装依赖、未接入服务、未修改灯塔代码。以下许可证来自官方仓库 LICENSE，不把云产品的免费额度等同于开源许可。未核实具体稳定版本、发布时间或星数，因此不提供这些数字；落地前仍要锁定发布版。

总体建议：灯塔已经有 Kiwi/Ombre、摘要压缩和分层提示词，本轮不要整体换记忆系统。三者都更适合放在服务器；后端部署本身不会把模型和数据库塞进 IPA，但新增请求适配器的手机端增量尚未实测，不能编造 MiB。

## 1. Mem0：可做后端小范围对比实验

大白话：它是“从聊天中整理事实、再按问题找回事实”的记忆管家，比一遍遍把全部聊天发给模型更有针对性。

**已核实事实**：官方主仓库和 LICENSE 为 Apache-2.0；提供 Python/Node 库和自托管 REST 服务。当前自托管服务默认开启认证，提供 JWT、每用户 API key、仪表盘和审计记录；参考部署包含 Postgres/pgvector，并仍需 LLM 与 embedding 配置。[仓库](https://github.com/mem0ai/mem0)、[许可证](https://raw.githubusercontent.com/mem0ai/mem0/main/LICENSE)、[自托管配置](https://github.com/mem0ai/mem0/blob/main/docs/open-source/setup.mdx)。

**接入边界**：自托管 OSS 与托管平台的 API 路径不同，不能照抄云端 `/v1/` 示例；当前库的写入接受实体 ID，而搜索/列表通过 filters 传作用域。后台应由登录身份确定账号和伴侣范围，不能相信 iPhone 自报的 owner；按单个 memory_id 更新/删除时还必须校验归属。[OSS REST 文档](https://github.com/mem0ai/mem0/blob/main/docs/open-source/features/rest-api.mdx)、[当前实现](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py)。

**删除不是全盘擦除**：当前 OSS `_delete_memory` 删除向量后，仍将旧值写入 history 的 DELETE 记录，`history(memory_id)` 可查询历史。因此“用户要求忘记”不能只调用向量删除，还要设计历史、备份、派生资料的保留/清理规则；异步队列也要防删除后旧写入复活。后者是灯塔接入时需要验证的工程要求，并非声称 Mem0 已提供这些保证。[删除与历史源码](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py)。

**对灯塔的判断（推断）**：已有 REST 后端，薄适配容易试验；只在 Kiwi 召回质量确有缺口时，以虚构对话离线对比事实准确率、纠错、忘记和 A/B 账号隔离。不要同时让两个引擎直接改生产记忆，防止重复抽取和冲突。服务器会增加抽取/检索调用、向量存储和运维成本；手机不承担模型权重。

**不采纳营销数字**：官方 README 明确其公开性能表基于托管平台，包含 OSS 不具备的私有优化，不能把数字当成灯塔自托管后的效果承诺。[官方说明](https://github.com/mem0ai/mem0#new-memory-algorithm-april-2026)。

## 2. Graphiti：值得借鉴时间记忆，当前不直接接入

大白话：它像“带时间的关系档案”，可以表达某人过去喜欢什么、后来改变了什么，并追到原始聊天来源。

**已核实事实**：Apache-2.0 的 Python 时序知识图谱框架；跟踪事实有效期、来源 episode，使用语义、关键词和关系检索。需要图数据库、LLM 和 embedding；当前 README 列出 Neo4j/FalkorDB 等，Kuzu 已标弃用。并发限制用于控制上游模型限流，不代表同一账号事件具有业务顺序保证。[仓库与运行要求](https://github.com/getzep/graphiti)、[许可证](https://raw.githubusercontent.com/getzep/graphiti/main/LICENSE)。

**关键安全事实**：官方 SECURITY.md 明确参考 REST/MCP 服务未提供认证、授权及调用者隔离；任何调用者可访问别人的 group_id，且未防提示词注入。group_id 是图分区，不是权限。接入灯塔必须由既有后端鉴权、生成账号+伴侣 namespace、限制工具和输入；不能把参考服务器直接放上公网。[官方安全边界](https://github.com/getzep/graphiti/blob/main/SECURITY.md)。

**删除边界**：官方工具支持按 group_ids 清图；group_ids 为 None 的清理路径会删除全部图数据。不能把底层“全清”接口直接交给客户端，且删节点不等于清理源聊天、备份和已输出的提示词副本。[分组清理实现](https://github.com/getzep/graphiti/blob/main/graphiti_core/utils/maintenance/graph_data_operations.py)、[CRUD 文档](https://help.getzep.com/graphiti/working-with-data/crud-operations)。

**对灯塔的判断（推断）**：情感陪伴中的“偏好变化”和关系演变适合借鉴其时间窗口和来源追踪，但为了 iOS 适配新增整套图数据库，成本和迁移面偏大。当前推荐借鉴数据结构及评测，不替换 Kiwi/Ombre。若未来做多年关系历史，再单独评估后端服务。仅服务端使用不会把图数据库编进 IPA；会增加服务、存储和模型抽取成本。

## 3. Letta：完整角色运行平台，当前以借鉴为主

大白话：它更接近“有长期生活档案、会整理自己的常驻 AI 角色系统”，不只是一个记忆搜索插件。

**重要的当前变化**：官方 `letta-ai/letta` 主分支现明确指向 `letta-ai/letta-code`；`archive` 分支是退役 V1 API。新项目不能直接沿用旧 MemGPT/Python server 教程。[官方迁移指引](https://github.com/letta-ai/letta/blob/main/README.md)。当前 letta-code LICENSE 为 Apache-2.0。[当前源码](https://github.com/letta-ai/letta-code)、[许可证](https://raw.githubusercontent.com/letta-ai/letta-code/main/LICENSE)。

**已核实事实**：当前 MemFS 使用 Git 管理每个 agent 的记忆；根目录资料常驻提示词，子目录按需查阅；有后台 dreaming 整理和 Git worktree 并发修改。默认没有语义向量索引，可另装搜索扩展。Git 版本历史意味着删当前文件不自动抹掉历史版本。[MemFS](https://github.com/letta-ai/letta-docs-md/blob/main/concepts/memfs/index.md)、[记忆与整理](https://github.com/letta-ai/letta-docs-md/blob/main/configuration/memory/index.md)。

**自托管/权限边界**：可运行 local backend 或独立 App Server，通过 SDK 接入；非回环地址需配置 WebSocket 认证。不能把服务器 token 或任意 agent_id 直接发给手机，仍要在灯塔后端维护账号→伴侣→agent/repository 的权限映射。共享记忆也不是陪伴应用默认应该打开的功能。[自托管](https://github.com/letta-ai/letta-docs-md/blob/main/self-hosting/index.md)、[App Server 协议与认证](https://github.com/letta-ai/letta-docs-md/blob/main/self-hosting/app-server/quickstart/index.md)。

**对灯塔的判断（推断）**：角色资料分层、记忆版本和冲突可视化值得参考；整体采用将涉及聊天循环、状态存储、工具权限和协议适配，超出本轮手机适配收益。当前不推荐整体替换。后端运行不会把平台和模型打进 IPA，但新的常驻服务、后台整理和备份会增加资源及调用成本。

## 共同的接入验收条件（灯塔工程建议）

只在用户确认选型后实施。使用虚构资料测试：A/B 账号及同账号不同伴侣严格分开；更新偏好不会丢来源；旧异步写入不能复活已忘记资料；单条、批量和历史删除的语义明确；失败时仍可聊天；角色设定不会被检索到的用户文本覆盖。日志不含对话、密钥或记忆原文。不能用一个“支持 user_id/group_id/agent_id”的字段替代鉴权。

## X/Twitter 检索限制

官方 Mem0 README 直接链接其 X 账号 [@mem0ai](https://x.com/mem0ai)。公开搜索索引发现 [Mem0 相关原帖链接](https://x.com/mem0ai/status/2100287339574734848) 和 [Letta 相关原帖链接](https://x.com/Letta_AI/status/1914356940412772414)，但这两个具体 status 仅从二手索引发现，直接读取官方原帖均返回 403，未找到官网对这些具体 status 的反向核验。因此它们仅列为待核验发现线索，未用于上述技术结论，也不称已读过原帖全文。未使用第三方镜像代替官方证据。

## 实际查询记录

- `site.github.com/mem0ai/mem0 LICENSE user_id agent_id self hosted memory delete_all`
- `site.github.com/getzep/graphiti LICENSE group_id delete graph selfhost`
- `site.github.com/letta-ai/letta LICENSE memory blocks self hosted`
- `site.docs.letta.com local server authentication permissions multi tenant agents delete memory repository`
- `site.x.com mem0ai "open source" memory`
- `site.x.com getzep Graphiti "open source"`
- `site.x.com Letta_AI "memory" "MemFS"`
- `"mem0ai" "x.com/mem0ai/status"`
- `"Graphiti" "x.com/getzep/status"`
- `"Letta" "x.com/Letta_AI/status"`
- `site.mem0.ai "x.com/mem0ai/status/"`
- `site.letta.com "x.com/Letta_AI/status/"`
- `site.getzep.com "x.com" "status" Graphiti`

无生产数据传给候选服务；所有建议属于阅读后的选型判断，不是接入完成或效果实测报告。

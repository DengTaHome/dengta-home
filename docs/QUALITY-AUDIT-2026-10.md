# 实机质量整治报告（2026-10-28）

本文件记录 2026-10-28 这一轮长期整治的**实测证据**，不是计划也不是愿望。
每一条都注明「怎么测的、测出什么」，方便以后复核或推翻。

## 一、硬约束：回复必须逐字立刻显示，且立即保存

| 要求 | 实现 | 证据 |
| --- | --- | --- |
| 每个字立即显示，不撤回 | 流式转发器优先读 `event.content`，同时兼容旧的 `text`；前端两种字段都认 | `backend/test/stream-forwarder.test.js`（8 例）、`frontend/test/streaming-partial` 相关断言 |
| 不允许生成完才发 | 上游输出守卫默认关闭（`PROVIDER_OUTPUT_GUARD_DISABLED !== "false"`） | 代码 + 真机流式断言 |
| 出错也不撤回已生成内容 | 错误/中断路径保留正文，标 `partial_reply` | `frontend/test/partial-reply.test.js` |
| 立即保存 | 逐块落库（串行写链），断线后可从 `stream_partials` 恢复 | `backend/test/stream-persistence.test.js`、`stream-partial-read.test.js` |
| 拒答不静默丢弃 | 拒答文本保留，附原因/片段/日志号/错误码 | `backend/test/refusal-diagnostics.test.js`、`frontend/test/refusal-diagnostic.test.js` |

真机验证：`tools/browser-verify/verify-streaming.mjs` 断言「不渲染出字面量 undefined」「无未捕获异常」。

## 二、首屏与回复速度

同一台机器、同一后端，连续构建实测：

| 阶段 | 重复访问「第一条消息」 |
| --- | --- |
| 起点 | 6,542 ms |
| 移除 7.4 MB 字体预加载 + preconnect | 8,502 ms（首次路径），重复路径 4,010 ms |
| 加聊天历史缓存 | 4,010 ms |
| **放开加载占位（isLoading）** | **766 ms** |

关键发现：缓存数据早已在内存里，却被「正在加载 DengTa home…」的占位符挡着。
把占位条件改成「有可显示消息就不显示占位」后，收益从 39% 提升到 88%。

冷启动（首次安装）仍需 8–11 秒：26 个 API 分三波，每波 2–4 秒，属网络往返成本。
本地 JS 长任务合计仅 204 ms——**代码不慢，慢在网络**。

## 三、触屏可用性

| 界面 | 元素数 | 小于 44×44 |
| --- | --- | --- |
| 主界面 | 282 | 0 |
| 状态面板 | 16 | 0 |
| 设置 | 177 | 0 |
| 音乐 | 49 | 0 |
| 投屏接收端 | 4 | 0 |
| 涂鸦画室 | 29 | 0 |

修复前主界面有 **136 个**小于 44×44（会话列表 40、引用按钮 40×22、
心声按钮 34–36、顶栏按钮 36–40、断线重连按钮 36）。

## 四、状态栏错位与闪烁

- 位置采样（每 250 ms，共 52 次）：胶囊、容器、外壳**各只有 1 种取值**——状态栏不跳。
- CLS：< 0.1（达标）。
- 曾经报出的 0.116 有两种来源，都不是状态栏：
  1. 空状态 → 消息列表的内容替换；
  2. **测量脚本自己点击会话列表**造成的位移（真实用户输入不计入 CLS）。

## 五、其他用户直接提出的问题

| 问题 | 结论 |
| --- | --- |
| 网易云音乐 | 后端明确返回 `netease_cookie_invalid` 时，界面原先仍显示「已连接」。已改为「登录已失效，请重新登录」，真机断言 `stillShowsConnected: false` |
| 自动播放音乐 | 进入听歌页不会自动播放，`<audio>` 为暂停且无 autoplay 请求（实测快照） |
| 彩虹胶囊 | `.rainbow-agent-mark` 在 `button.chat-attach-button` 内，是**附件按钮的装饰**，不是消息容器；媒体消息按普通卡片渲染 |
| 投屏 | 配对链路实测：创建 co-watch 会话 → 取配对码 → `cast/pair` 换 receiver token → 结束会话，全部 2xx。Chromecast / DLNA 仍是 planned |
| 头像 / 背景设置 | 端到端实测：上传 → 设为偏好 → 浏览器真的请求资产内容并渲染（头像 192×192 blob、背景同样） |
| 菜单滑动高亮 | `.sliding-indicator` 实测挂载、opacity 1、140×71，随激活项移动 |

## 六、验证体系

| 层 | 数量 / 状态 |
| --- | --- |
| 后端测试 | 273 通过 |
| 前端测试 | 1607 通过 |
| 数据库迁移 | 70 个，在 pglite 与真实 PostgreSQL 16 均通过 |
| HTTP 鉴权 | 5 条受保护路由全部 401，health 200 |
| 一键体检 | `node tools/browser-verify/run-all.mjs` → **6/6 通过** |

## 七、已知未完成（需要人或环境）

1. **首次冷启动仍是 8–11 秒**：受跨境网络往返限制；要真正解决需要缓存预热或就近部署。
2. **仓库的三个迁移在生产库不适用（已查证，不是「未执行」）**：
   - 生产库的迁移版本是时间戳格式（`20261018023642`…），不是仓库的 001–070 编号；
     线上 schema 有大量仓库没有的表（`companion_runtime_states`、`nursery_*`、`world_book_entries`…）
   - `companion_xinchao_state`、`stream_partials` 在生产库**不存在**，但心潮接口在线能返回真实数据
   - `companion_runtime_states` 只有 6 列，`status`/`interaction_stats` 两个 jsonb；
     bootstrap 返回的 `state` 正好来自这张表（含 `revision: 593`）
   - 全库列名扫描（drives/emotion/consciousness/partial/is_streaming/draft…）只命中
     `music_playback_queue.revision`，**没有任何心潮或流式中间态列**
   - 063 的两件事线上已完成：8 张表 `rowsecurity = true`，
     且 `anon`/`authenticated` 对它们都没有 SELECT 权限
   - 关键补充：`messages` 共 19 列，其中含
     `chat_generation_state`（text）+ `chat_generation_started_at` / `_lease_expires_at` /
     `_failed_at` / `_completed_at` 四个时间戳 + `client_message_id`（uuid）
     → 线上是**在 messages 行上做「生成中状态 + 租约」**，边生成边更新同一行；
     这比仓库单独的 `stream_partials` 表更直接，也解释了线上为何不需要 064
   → 结论：**生产库不需要执行任何迁移**。这三个迁移只适用于用仓库后端自托管/本地部署的场景。
   → 关于「逐字立即保存」：线上很可能就是用 messages 行 + 生成状态实现的（同一行持续更新），
     但**更新频率从库外无法验证**；仓库方案（独立表 + 串行写链）与线上方案是两套设计，
     不能互相作为证据。
3. **音乐真实播放未验证**：网易云登录态存在 App 内置浏览器会话里，自动化环境拿不到。
4. **Vercel / Render / GitHub 的空间清理**需要登录控制台。
5. **13 处源码切片测试**尚未重构为真实挂载（属技术债，不影响功能）。
6. 密码、token 等凭据只存在于工作区 `_audit/`，**不在仓库内**。

## 八、测量本身的教训

这一轮抓到的产品缺陷里，有两个是「测量工具先说谎」：

- token 过期 → 页面没渲染 → 却报「CLS 达标」；
- 页面在慢后端下没加载完 → 却报「设置未生效」。

所以每次「指标突然变好/变坏」，都要先看**陪伴指标**是否自相矛盾
（例如「CLS 0.0000 但首条消息 121 秒」）。这条已写进工具 README。

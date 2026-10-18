# 小红书独立会话适配（本地实现，未部署）

## 当前能力与边界

灯塔后端的小红书客户端必须由真实 `RequestScope` 绑定当前账号和伴侣后使用。数据库记录分组和上游浏览器分组分别校验，不能用数据库过滤代替浏览器隔离。旧服务未返回隔离协议回执时，报 `xhs_session_isolation_required`；不会回退到共享登录态。

本仓库提供可单独启动的网页读取 worker：`scripts/xhs-profile-worker.js`。它提供扫码登录、Cookie 导入、登录检测、第一页默认排序的笔记搜索，以及当前会话搜索结果的可见评论与封面来源。笔记来源、作者和封面来自页面实际卡片；不构造搜索结果，不绕过登录、验证码或平台访问限制。页面结构变化会报错，不能当作空搜索结果。

网页适配器当前没有点赞、评论发布、关注实现；这些路由在本适配器中返回 `xhs_action_not_supported`。已经存在的写操作授权规则仍保留。round37 已在本地增加封面导入私人表情库与 AI 选图，需在数据库草案获准应用、worker 与后端部署后验收。它不会在小红书发布图片或评论，当前尚未上线。

## 服务配置

默认后端启动命令不变。worker 需要独立配置并执行 `npm run start:xhs`，本次没有启动常驻服务或变更部署。生产接入前必须完成真实账号测试。

| 变量 | 要求 |
| --- | --- |
| `XHS_SERVICE_TOKEN` | 后端和 worker 共用的随机服务凭据，至少 32 字符，不可提交仓库 |
| `XHS_SERVICE_URL` | 仅灯塔后端配置，指向 worker；跨机器传输必须使用 HTTPS 和私有访问控制 |
| `XHS_PROFILE_ENCRYPTION_KEY` | worker 独立的至少 32 字符随机加密密钥；不要复用用户 Cookie |
| `XHS_PROFILE_DIRECTORY` | worker 的绝对持久化目录，仅服务账号可读；不可位于公开静态目录 |
| `XHS_GATEWAY_HOST` | 默认 `127.0.0.1`；跨机器绑定需由部署环境提供网络访问控制 |
| `XHS_GATEWAY_PORT` | 默认 `3014` |
| `XHS_BROWSER_CHANNEL` | 可选 Playwright 浏览器通道，例如已安装的 `msedge` |
| `XHS_PLAYWRIGHT_MODULE` | 可选已安装 Playwright 模块路径；未指定则解析 `playwright` |

默认后端不新增浏览器依赖；worker 运行环境需单独准备与锁定 Playwright 和其浏览器。本次验证使用了本机既有 Playwright 1.62.1 / Edge，没有安装新依赖。缺少运行时、加密配置、监听失败分别有稳定错误码，不会在日志中打印凭据或原始异常。

## 隔离与持久化协议

后端使用服务凭据对账号 ID 与伴侣 ID 做 HMAC，生成不可直接还原身份的 64 位十六进制会话键。请求头携带 `x-dengta-isolation: profile-v1` 和 `x-dengta-session`，服务返回对应回执。原始账号 ID、Cookie 不放入 URL。

worker 的 HTTP 请求头上限为 64KB，覆盖现有 32KB Cookie 的 Base64 传输；如果前方还有网关或反向代理，需独立验证其请求头上限，不能只提高 Node 上限就宣称外部服务已适配。

每个会话拥有独立 `BrowserContext`，同一会话的操作顺序执行。最多同时保留四个浏览器会话；空闲会话回收前保存加密状态。浏览器状态包括 Cookie 和 localStorage，使用 AES-256-GCM 加密，绑定当前会话键；密文放到其他会话名下无法解密。损坏文件不自动删除或覆盖。

Cookie 变更会建立新上下文，清除旧来源存储；相同的自动恢复凭据不会反复重置网页。退出登录保存空状态，并保留凭据摘要作为退出标记，防止旧后端 Cookie 再次自动恢复登录。用户显式重新导入才重新登录。超时后必须等旧会话关闭和写盘结束再恢复，避免旧状态覆盖新状态。

Playwright 的独立上下文和 `storageState` 机制依据其[官方文档](https://playwright.dev/docs/api/class-browsercontext)。测试使用独立浏览器，不读取 Codex 内置浏览器或其他用户的登录资料。

本 worker 的内存队列和扫码票据只在单进程内有效。当前版本应采用单 worker + 独立持久化卷；多副本和共享磁盘需要额外的分布式租约、扫码路由及恢复设计，不能直接宣称支持。服务凭据或加密密钥变化会影响既有会话恢复；不要在未做迁移和回滚准备时轮换。

## 错误与验证

| 错误码 | 含义 / 操作 |
| --- | --- |
| `cookie_expired` | 登录未建立或已过期，重新扫码或导入 |
| `verification_required` | 平台要求人工验证，由当前用户完成后重新检测 |
| `xhs_page_changed` | 页面结构不符合读取契约，需要检查适配器 |
| `xhs_profile_storage_failed` | 加密会话读写失败，保留原文件并排查目录和密钥 |
| `xhs_session_isolation_required` | 服务未实现隔离回执，升级 worker 后再接入 |
| `xhs_note_lookup_required` | 当前会话未搜索到该笔记，先搜索再读取评论 |
| `xhs_search_request_invalid` | 无搜索词、非第一页或不支持的排序，调整参数 |
| `xhs_timeout` / `xhs_profile_busy` | 操作超时或会话繁忙，稍后重试 |

本地命令：`npm run test:xhs`、`npm run typecheck`、`npm run check`。完整链路与浏览器夹具证据在 `docs/release-evidence`。浏览器夹具通过不等于真实平台通过：登录有效性、实际网页选择器、扫码确认、图片可下载性和平台访问频率尚需真实账号验收。

round37 后端对 `cookie_expired` 使用 HTTP 409，避免外部平台登录过期触发灯塔请求层的 401 退出逻辑；灯塔自身 `invalid_session` / `authentication_required` 仍保持 HTTP 401。`GET /notes/:id/sticker-source` 只接受当前独立上下文最近搜索中出现的笔记，返回封面、作者、标题及不带检索签名的规范来源；旧 worker 缺少该端点时明确报 `xhs_action_not_supported`。本地表情流程证据另见 `docs/release-evidence`。

本轮无数据库迁移，无生产数据访问或修改，无 GitHub/CNB/Render/Vercel 写入，无 APK 构建。

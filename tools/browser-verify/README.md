# 真机验证（本地构建 + 生产后端 + 真浏览器）

单测回答「代码符合假设吗」，这个脚本回答**「用户到底能不能看到」**。

它在真 Edge、390×844 移动视口、真账号登录态下检查关键界面，失败会以非零码退出。

## 为什么需要它

在本项目里它抓到过两个所有单测都放过的 bug：

1. **心潮胶囊被渲染成嵌套 `<button>`** —— 无效 HTML，浏览器重排出一大块灰色方块压住状态栏。
   单测只断言组件能渲染，看不到合成后的布局。
2. **`drives` 数据形态不匹配** —— 线上返回对象 `{ possess: 0.79, … }`，而 `sortDrives` 只认数组，
   于是花瓣一片都不画、主导项永远回退成「心潮」。单测喂的是数组，所以一直绿。

## 前置

| 需要 | 说明 |
| --- | --- |
| `frontend/dist` | 先 `npm run build`（构建时 `.env.local` 指向生产后端） |
| 代理 | 脚本经 `127.0.0.1:10809`（HTTP）与 `10808`（SOCKS）出网，需先启动 sing-box |
| `playwright-core` + Edge | 用系统 Edge（`channel: "msedge"`） |
| 凭据文件 | JSON：`{"email":"…","password":"…"}`，路径见下表 |

## 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DENGTA_BROWSER_VERIFY_OUT` | `../_audit/browser` | 截图与报告输出目录 |
| `DENGTA_BROWSER_VERIFY_CREDENTIALS` | `<OUT>/browser-auth.json` | 登录凭据文件 |
| `DENGTA_BROWSER_VERIFY_AUTH` | `<OUT>/auth.json` | token 缓存 |
| `DENGTA_BROWSER_VERIFY_PORT` | `5173` | 静态服务器端口 |
| `DENGTA_SUPABASE_TOKEN_URL` / `DENGTA_SUPABASE_ANON` | 内置公开值 | 取 token 的地址与公开 key |

**凭据文件绝不能进仓库。** 默认路径在工作区 `_audit/` 下，不在 git 里。

## 跑法

```powershell
cd frontend; npm run build
node tools/browser-verify/verify-local-build.mjs          # 人读输出
node tools/browser-verify/verify-local-build.mjs --json   # 机器读
```

## 检查项（任何一条不过就退出码 1）

1. 应用外壳渲染
2. 有实质内容（说明真的登录了）
3. 心潮胶囊在状态栏内
4. 心潮花瓣 ≥ 1 片
5. 心潮胶囊有尺寸
6. 状态栏高度为 68（线上一致）
7. 滑动高亮块已挂载
8. 拒答标注样式已加载
9. 部分回复样式已加载
10. 没有嵌套 `button`（无效 HTML）
11. 无 console 错误

## 局限

- 依赖生产后端可用（免费实例冷启动时首次会很慢，脚本已等 12 秒）
- 只覆盖首屏与状态栏；聊天流、投屏、音乐播放需要真实动作，尚未纳入
---

# 流式渲染场景（verify-streaming.mjs）

拦截 `/chat/stream`，喂一段合成 SSE（含 `meta` → `status` → 三段正文 → `done`，
其中一段故意只用旧的 `text` 字段），验证渲染过程不产生 `undefined`、没有未捕获异常。

```powershell
node tools/browser-verify/verify-streaming.mjs
```

## 它能证明什么

- 请求契约被真的走到（拦截计数 ≥ 1）
- F-4 回归：末段用 `text` 字段时，界面**不会**出现字面量 `undefined`
- 整轮没有未捕获异常

## 它不能证明什么（重要）

**无法验证「流式过程中逐字渲染」。** 原因：`done` 之后前端会用服务端真相校正消息列表，
合成消息会被真实历史覆盖；而 Playwright 的 `route.fulfill` 只能一次性返回整段 body，
无法模拟真实的慢速分块。要验证逐字显示，需要真实后端 + 真实发一条消息（会花额度）。

这个限制是刻意写下来的：**不要用它冒充「逐字显示已验证」**。
---

# 触摸目标检查（verify-touch-targets.mjs）

用户反复说「触屏点不动」。这个脚本在真浏览器里逐个量可交互元素的实际命中框
（`button / a / input / select / textarea / [role=button] / [role=tab]`），
把小于 44×44 的按尺寸列出来，有任何一个就退出码 1。

```powershell
node tools/browser-verify/verify-touch-targets.mjs
```

隐藏的文件输入不算触摸目标（靠外部 label 触发），已在脚本里排除。

## 第一次跑的结果

```
可交互元素 282 个，其中 136 个小于 44×44
  63 个  按钮无类名（心声按钮 34–36px 高）
  43 个  .message-reference-button   40×22
  27 个  .session-select             291×40
```

## 修完之后

```
可交互元素 282 个，其中 0 个小于 44×44
```

对应改动：
- `apple-ui.css`：会话列表项 40 → 44
- `index.css`：引用按钮 40×22 → 44×44
- `interface-polish.css`：心声按钮按容器收敛到 44；成就引导与棉花工具条的按钮同样处理

## 覆盖范围（三个阶段）

脚本会依次进入三个界面并分别测量：

| 阶段 | 进入方式 | 实测元素数 |
| --- | --- | --- |
| 主界面 | 直接加载 | 282 |
| 状态面板 | 点状态胶囊展开 | 16 |
| 设置 | 点状态面板里的齿轮 | 177 |

三个阶段当前都是 **0 个小于 44×44**。

## 仍未覆盖

投屏接收端（`/receive`）、音乐面板、涂鸦画室等需要更多交互步骤才能打开的界面，
尚未纳入。如果后续出现「某个页面点不动」，照现有结构加一个 `surface` 阶段即可。
---

# 私密媒体设置端到端（verify-media-e2e.mjs）

回答一个具体抱怨：「在设置里换了头像，聊天里没变」。

```powershell
node tools/browser-verify/verify-media-e2e.mjs
```

完整链路并断言：

1. 上传一张临时头像（`public/app-icon-192.png`）→ 201
2. 设为 `user_avatar` 偏好 → 200，且目录读回时偏好指向新资产
3. 真浏览器加载 → 聊天里出现 `img.message-avatar-image`，`naturalWidth > 0`，
   并且确实请求了 `/api/v2/private-media/assets/<id>/content`
4. **清理**：清空偏好 + 永久删除临时资产，目录回到 0 个 active

实测结论：**头像链路是通的**（请求了内容，渲染出 192×192 的 blob 图片）。

## 这个脚本最该记住的一件事

第一版把静态服务器放在 **5188 端口**，结果浏览器里消息一条都没渲染、
头像请求一个都没有，看起来像「重大 bug」。真实原因是
**后端 CORS 白名单只放行 5173**，所有接口被浏览器拦掉了。

> 端口不对 → 假 bug。测出来的「异常」先检查测试环境本身。
## 用途可配置

```powershell
# 头像
node tools/browser-verify/verify-media-e2e.mjs
# 聊天背景
$env:DENGTA_MEDIA_PURPOSE="chat_background"; node tools/browser-verify/verify-media-e2e.mjs
```

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `DENGTA_MEDIA_PURPOSE` | `user_avatar` | 上传与偏好的用途 |
| `DENGTA_MEDIA_SELECTOR` | 按用途推断 | 断言哪个元素应该出现 |

## 两种用途的实测结果（都通过）

| 用途 | 断言选择器 | 结果 |
| --- | --- | --- |
| `user_avatar` | `img.message-avatar-image` | 请求了内容，渲染 192×192 |
| `chat_background` | `.private-chat-background img` | 请求了内容，渲染 192×192 |

每种用途跑完都会把账号恢复到原状（清空偏好 + 永久删除临时资产）。
---

# 投屏接收端与涂鸦画室（verify-touch-extra.mjs）

主界面/状态面板/设置/音乐之外的另两个界面：

```powershell
node tools/browser-verify/verify-touch-extra.mjs
```

| 界面 | 进入方式 | 元素数 | 结果 |
| --- | --- | --- | --- |
| 投屏接收端 | 直接打开 `/receive` | 4 | 0 个偏小 |
| 涂鸦画室 | 侧边栏「涂鸦」 | 29 | 0 个偏小 |

画室这一轮抓到两个顶栏全局按钮偏小（新对话 36×40、设置齿轮 40×40），
已统一提到 44——它们出现在所有主视图的顶栏，属于全局问题。
---

# 界面稳定性（verify-stability.mjs）

用户说状态栏会「错位、闪」。这个脚本不靠肉眼，测两件事：

1. **布局位移（CLS）**：累计无输入位移得分
2. **状态胶囊/状态栏位置采样**：每 250ms 一次，外壳出现 2 秒后位置不应再变

```powershell
node tools/browser-verify/verify-stability.mjs
```

## 当前实测

| 指标 | 结果 | 判定 |
| --- | --- | --- |
| 状态胶囊位置（2 秒后） | 52 次采样只有 1 种取值 | ✓ 不跳 |
| 状态栏容器位置 | 1 种取值 | ✓ 不跳 |
| CLS（首次） | **0.1159** | ✗ 超过 0.1「需要改进」线 |
| CLS（重复访问） | **0.116** | ✗ 同上 |
| 重复访问首条消息 | 726–7,525 ms（波动大） | 取决于后端 |

## 结论：闪的不是状态栏

状态栏本身**完全稳定**（52 次采样零位移）。CLS 的唯一来源是
`.message-list` 在 5–8 秒时从空状态变成 43 条消息，
位移源是 `message-row`。

把缓存上限从 40 提到 60 **没有**降低 CLS（仍 0.116），
说明「预览条数少于真实历史」不是主因。下一轮继续找替换瞬间的真正位移原因。
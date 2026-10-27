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

## 局限

只量主界面。设置面板、投屏接收端、音乐面板需要额外的打开步骤，尚未纳入
（脚本里已有的侧边栏点击选择器在当前构建上没命中，需要按实际 DOM 更新）。
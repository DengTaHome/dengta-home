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
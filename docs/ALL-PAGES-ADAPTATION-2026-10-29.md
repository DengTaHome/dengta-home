# 全页面全尺寸适配审计与修复（2026-10-29）

## 用户反馈
手机「听歌 / 一起听」页面右侧被裁切，按钮只露出半个；要求全面检查所有页面、所有功能、手机/平板/电脑/网页尺寸，并让 Elephant/Goldfish 复核。

## 根因
1. **一起听页面的 min-content 把整页撑到 ~723px**（390 视口）
   - `.together-layout` 桌面列里第二列 `minmax(280px, .75fr)`，移动端媒体查询本应改单列，但长 `select` 选项和 flex 头部产生 665–707px 的 min-content，父级 grid 仍按内容扩宽
   - 结果页面横向溢出，右侧「开始/导入」按钮被裁
2. **设置 → 音乐导入**的 `select` 宽 405px，超出 390 sheet
3. **彩虹胶囊 `.chat-presence-stack`** 横向 margin 叠加 width，在手机溢出 9px、在 1280/1920 桌面溢出 10px

## 修复
`src/android-compat.css`：

- 手机/横屏：`.together-page`、`.together-layout`、`.together-controls`、`.music-quick-start*` 等统一
  `min-width:0; max-width:100%`
- 一起听页强制单列 `grid-template-columns: minmax(0,1fr)`
- 头部允许换行，长文本 `overflow-wrap:anywhere`
- 选择器/输入框 `width:100%; max-width:100%; min-width:0`；导入按钮可换行
- 设置 sheet 内 select/input/textarea 全部 100% 宽
- 彩虹胶囊：
  - 手机 `width: calc(100vw - 18px); margin-inline:9px`
  - 桌面 `width: calc(100% - 20px)`（保留 10px 边距）
- 状态面板、聊天页顶部不再被右侧裁切

## 审计
新增 `_audit/all-pages-audit.mjs`（本地静态服务 + 真实账号 + Playwright）：

- 11 个视口：
  - 手机：320×568、360×800、375×667、390×844、412×915、430×932
  - 平板/横屏：600×960、844×390、900×540
  - 桌面：1280×800、1920×1080
- 15 个页面：聊天、动态、日记、涂鸦画室、家庭、一起看、放映厅、听歌、互动挑战、记忆、藏宝地图、成就、发现、外卖、工作区
- 11 个设置分类：个性化与记忆、外观与聊天、模型与服务、视觉接口、语音与情绪、设备与共看、成就与新玩法、数据导入、数据导出、音乐导入、错误日志
- 检测：document scrollWidth、所有可见元素 left/right 超出视口
- 结果：**286 项检查，0 failure**
- 390 听歌页最终截图无横向溢出：`_audit/all-pages/music-390.png`

## 说明
- 这是**几何/裁剪层**的全面审计；视觉统一、动效手感、极端字号/真机刘海仍需 Goldfish 和真机复核。
- 电脑端顶栏命令按钮仍是桌面样式；浮块只在手机/短横屏出现。


## Goldfish 复核追加（2026-10-29 19:05）
- Goldfish 发现：(1) 听歌页 `.mobile-command-dock` 不存在，无法开命令面板；(2) 音乐导入浮层有 405px select 超出 390 视口。
- 修复：浮块改为**全页面渲染**，手机隐藏顶栏重复的 ⌘K；音乐导入对话框 select/input/textarea 限 100% 宽、overflow-x hidden。
- 390 验证：听歌页浮块可打开命令面板；导入弹层无元素超出视口；顶栏更干净。
- 最终复测：390 + 1280 全 52 项 0 failure。


## 最终收口（2026-10-29 19:25）
- 286 项全页面审计（11 视口 × 15 视图 + 11 设置分类）：0 failure
- 最终 390 + 1280 复测：52 项 0 failure
- 19 机型布局矩阵（聊天/横屏/状态面板/浮块）：0 问题
- 前端全量：0 failure（3829 行）
- Vercel `8bc2530` READY
- 最终 APK：`_audit/DengTa-2.13.44-302-allpages.apk`
  - SHA-256：`96c79789e537b67d2f2e08693e2c238daac546690caa797fe6164ff710da9fe2`
  - 手机当前未连接，待重新插入后 `adb install -r`
- Goldfish 复核发现并已修复：听歌页无浮块、音乐导入 select 405px 溢出；其余状态面板/回复选项/外卖通过。

## 验证命令
```powershell
# 全页面几何审计（需 5173 端口本地服务/账号夹具）
node D:\GZdeepseek\_audit\all-pages-audit.mjs
# 聊天 19 机型矩阵
node tools\browser-verify\verify-layout-matrix.mjs
# 前端全量
cd D:\GZdeepseek\_refs\frontend-gh; npm test
```

# 可拖动命令浮块 + 命令面板视觉重做（2026-10-29）

## 用户要求
彩虹胶囊旁的小方块「命令」改成可随处拖动的悬浮块：拖到屏幕边界自动收起，点击再展开；同时解决界面打开/关闭闪烁、动画卡顿和 UI 观感。

## 实现
### 1. 悬浮命令块
新增 `src/FloatingCommandTrigger.jsx` / `src/floating-command-trigger.css`，替换原 `.mobile-command-trigger`：

- 48×48 圆角浮块，柔和渐变光环 + 奶油白表面 + 三层阴影
- 支持触摸/鼠标拖动，`pointer capture` + `translate3d`，拖动过程不触发 React 重渲染
- 靠近任意一边（左/右/上/下，阈值 26px）自动吸附并收起，只留 24px 可见边缘
- 收起后点击先展开回屏内；展开状态点击打开命令面板
- 位置/收起状态写入 `localStorage`（`dengta.command-dock.v1`），旋转/窗口变化自动夹回视口
- 拖动阈值 5px，拖动结束抑制误触 click；支持 reduced-motion
- 手机横屏断点与现有移动布局一致：`max-width:820px` 或 `(max-height:560px) and (max-width:960px)`

### 2. 命令面板视觉
参考 `_refs/music-mcp-netease/screenshots` 的软色/圆角/底部 sheet 风格：

- 手机/横屏改为底部 sheet：28px 顶部圆角、顶部 grabber、奶油渐变背景
- 移除 `backdrop-filter`（闪烁/掉帧主要来源），改为实色半透明 scrim + opacity/transform 动画
- 面板入场 220–240ms 弹性曲线，搜索框 focus 改为柔光描边
- 行图标换成 lucide 线性图标（聊天/动态/日记/涂鸦/家庭/小棉花/一起看/放映厅/听歌/记忆等）
- 保留完整键盘操作：↑↓、Enter、Esc、Tab focus trap

## 验证
- 新增 `_audit/verify-command-dock.mjs`，真实 Edge + 390×844 / 320×568 / 844×390：
  - 起始在视口内、四边都能拖动收起、点击展开、面板打开/关闭、位置持久化、无 pageerror
  - **3/3 视口全部 PASS，0 failures**
- `node --test test/command-palette.component.test.js`：1/1 pass
- `npm run build` 成功
- 截图：`_audit/command-dock/palette-390x844.png`、`dock-390x844.png`、`collapsed-right-390x844.png`

## 注意
- 收起状态只露出 24px 抓取条，拖动/点击都在可见区域内；再次拖动可直接拉出。
- 浮块默认在右侧偏上，用户拖动后的位置会记住。
- 动画只用 transform/opacity；手机端不再有命令面板的 backdrop-filter。


## 最终验证（2026-10-29 17:55）
- 布局矩阵 19 视口：**0 页面问题，exit 0**（844/915/900 横屏也显示浮块且不与胶囊重叠）
- 前端全量：**0 failure，3829 行**；命令面板组件测试 1/1
- Vercel `41042b3` READY；生产页面实测 `.mobile-command-dock` 存在且可见，无 pageerror
- 最终 APK：`_audit/DengTa-2.13.44-302-dock-final.apk`
  - SHA-256：`820967fc9a5818f01f993dc90926b7971805f451f210c264f319bf81f98dce77`
  - 同源登录 + 可拖动浮块；手机当前未连接，待重新插入后 `adb install -r`。

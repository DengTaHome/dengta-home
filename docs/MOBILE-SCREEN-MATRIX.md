# 全系列手机屏幕适配记录（2026-10-29）

## 方法
真实 Edge（Playwright）加载本地最新 `frontend/dist`，注入现有测试账号，等聊天界面就绪后检查：
- 水平溢出、元素被推出视口
- 输入框/底栏落在视口外
- 可交互元素实际命中框 <44×44
- 聊天气泡文本被裁

脚本：`tools/browser-verify/verify-layout-matrix.mjs`（已扩到 16 个视口）。

## 覆盖与结果（修复后）

| 视口 | 类型 | 结果 |
|---|---|---|
| 320×568 @2 | 超小屏/iPhone SE1 | 通过 |
| 360×640 @2 | 小屏安卓 | 通过 |
| 360×800 @3 | 高长屏安卓 | 通过 |
| 375×667 @2 | iPhone SE2 | 通过 |
| 375×812 @3 | iPhone X | 通过 |
| 390×844 @3 | iPhone 14 | 通过 |
| 393×873 @2.75 | Pixel 主尺寸 | 通过 |
| 412×915 @2.625 | 大屏安卓 | 通过 |
| 414×896 @2 | iPhone XR | 通过 |
| 428×926 @3 | iPhone Max | 通过 |
| 430×932 @3 | iPhone Pro Max | 通过 |
| 480×1040 @2 | 折叠屏外屏 | 通过 |
| 600×960 @2 | 小平板 | 通过 |
| 800×1280 @2 | 平板 | 通过 |
| 844×390 @3 | 横屏 iPhone 14 | 通过 |
| 915×412 @2.625 | 横屏大屏安卓 | 通过 |

合计：**16/16 无布局问题**；就绪 3.1–3.2s。

## 本轮修复
1. **短横屏 composer 出视口**
   - 原因：presence stack（227px）+ 恢复条（74px）+ topbar 占满 390/412px，`.view-content` 被压到 41px，composer 溢出到视口下方。
   - 修复：`@media (orientation: landscape) and (max-height: 560px)` 下隐藏 `.chat-presence-stack`，收紧 composer padding；聊天输入框回到可视区。
2. **横屏触控目标**
   - `.menu-button`、`.new-chat-top`、`.composer-reply-options-button` 提升到 44px；最后者用 `.composer .composer-reply-options-button` 覆盖组件后加载的 32px 规则。
3. 已有适配保留：
   - `viewport-fit=cover`、`interactive-widget=resizes-content`
   - Android 15 edge-to-edge 顶部安全区
   - composer 底部 `env(safe-area-inset-bottom)`
   - ≤820px 关闭 backdrop-filter，低功耗冻结背景
   - 手机首次访问系统字体，不下载 7.42MB 字体

## 复现
```powershell
cd D:\GZdeepseek\dengta-home
node tools\browser-verify\verify-layout-matrix.mjs
# 16 个视口；期望 合计问题: 0
```

## 边界
- 浏览器无法模拟真实刘海/挖孔 safe-area 像素值；已用 CSS `env()` + Android edge-to-edge 规则覆盖，真机仍需复核。
- 系统字体放大（Android 无障碍缩放）未做 200% 专项；当前布局按 px 流式，若后续出现大字溢出再补。
- 横屏时隐藏 presence stack 是取舍：优先保证输入框可达；需要状态信息可转回竖屏。

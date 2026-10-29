# 全系列手机屏幕适配记录（2026-10-29）

## 方法
真实 Edge（Playwright）加载本地最新 `frontend/dist`，注入现有测试账号，**等恢复条/启动幕消失且真正出现消息或会话内容之后**再检查（不是只等 2.5s 外壳）：
- 水平溢出、元素被推出视口
- 输入框/底栏落在视口外
- 可交互元素实际命中框 <44×44
- 聊天气泡文本被裁

脚本：`tools/browser-verify/verify-layout-matrix.mjs`（扩到 19 个视口，含 568×320、844×390、896×414、915×412、900×540 横屏）。每个视口都等待启动幕/恢复条消失，**自动切到有消息的会话**，断言至少一个 `.message-bubble`；短横屏还会真实点击状态胶囊并断言 `.status-panel.is-open=true`；无消息/白屏直接失败。

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

合计：**19/19 无布局问题（含 320/360 命令键与胶囊重叠断言）**；矩阵就绪 **19.6–21.4s**（含 Render 冷启动、切换到一个有消息的会话并等待消息渲染；纯首屏启动另测为 5.5s）。

## 本轮修复
1. **短横屏 composer 出视口**
   - 原因：presence stack（227px）+ 恢复条（74px）+ topbar 占满 390/412px，`.view-content` 被压到 41px，composer 溢出到视口下方。
   - 修复：短横屏把 presence stack 压到 76px、隐藏 ribbon/ambient 大卡片，**保留状态胶囊**；收紧 composer padding。聊天输入框与状态入口都可见。
2. **横屏触控目标**
   - `.menu-button`、`.new-chat-top`、`.composer-reply-options-button` 提升到 44px；最后者用 `.composer .composer-reply-options-button` 覆盖组件后加载的 32px 规则。
   - 设置搜索框 42→44px；抽屉 `.session-heading button` 29→44px。
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
# 18 个视口；期望 合计问题: 0
```

## 状态面板 / 设置 / 音乐可达性

- 320×568、390×844、844×390 下点击状态胶囊：`.status-panel.is-open=true`，rect 正常（304×456 / 374×732 / 430×214）。
- 菜单抽屉、设置页、音乐页均 0 布局问题。

## 复现口径

- 19 个视口在**同一个构建**上连续跑完；每档 `msgCount > 0`，截图是真实聊天而不是加载壳。
- 短横屏（568/844/896/915）每档点击胶囊后 `.status-panel.is-open=true`。
- 每个视口必须出现真实消息（不是只看到会话列表）；没有消息/白屏/启动失败会抛错退出 1。
- 恢复态（`.connection-recovery` 存在）：短横屏 composer 273–380 / 390，presence 隐藏，底栏不被裁；恢复后胶囊重新出现。

## 已验证的恢复态

- 844×390 下拦截 bootstrap 12s：`.connection-recovery=true`，`.composer` 273–380（视口 390），presence display=none；底栏完整可见。

## 边界
- 浏览器无法模拟真实刘海/挖孔 safe-area 像素值；已用 CSS `env()` + Android edge-to-edge 规则覆盖，真机仍需复核。
- 系统字体放大（Android 无障碍缩放）未做 200% 专项；当前布局按 px 流式，若后续出现大字溢出再补。
- 横屏时 presence stack 压缩为单行胶囊，状态面板仍可点击打开；ribbon 文案在横屏隐藏，完整状态进面板。

## 扩展：设置 / 音乐 / 抽屉界面
在同一 320×568、390×844、844×390 横屏下打开菜单抽屉、设置页、音乐页检查：

- 主界面：0 布局问题
- 菜单抽屉：0
- 设置页：0（修复 `.settings-home-search-field input` 高度 42→44）
- 音乐页：0（随机播放开关保留原生 51×31 视觉，label 为实际命中区）
- 横屏抽屉：修复 `session-heading button` 新建对话 29×29→44×44

验证脚本 `_audit/verify-surfaces.mjs`（本地临时审计；截图在 `_audit/browser-surfaces/`）。

## 软键盘弹起

模拟 Android 软键盘缩小可视视口，并设置真实 App 的 `data-keyboard-open=true`：

| 初始视口 | 键盘后高度 | composer bottom | textarea bottom | 结果 |
|---|---:|---:|---:|---|
| 390×844 | 400 | 390 | 382 | 通过 |
| 320×568 | 300 | 290 | 282 | 通过 |
| 844×390 横屏 | 230 | 220 | 165 | 通过 |

修复：仅在 `:root[data-keyboard-open="true"]` 且短横屏时隐藏 presence stack，并将 composer 固定到可视视口底部；键盘关闭后恢复。568×320 正常横屏不再被键盘规则影响。

## 断点一致性

- CSS 移动断点：`(max-width: 820px), (max-height: 560px) and (max-width: 960px)`（height 从 500 对齐到 560）。
- JS 胶囊断点使用同一字符串；`915×412` 与 `900×540` 均已实测打开 `.status-panel`。
- 44px 判定对 `::after` 有效命中区取 43.5 容差，避免 43.99 临界抖动；19/19 稳定。

## 源目录警告

- `dengta-home/frontend/src` 是公开镜像旧快照，已加 README 警告；生产修改只以 `_refs/frontend-gh` 为准，不从旧副本 rebuild。

## 抽屉/设置页闪烁与合成（2026-10-29）

用户反馈侧边栏弹出时闪屏、动画杂，设置页显示异常。根因不是布局，而是手机上把多层 `backdrop-filter` 放在正在 `transform` 的抽屉/滚动容器里：

- `.sidebar` / `.sidebar-footer` / `.sidebar-account-slot`
- `.settings-sheet` / `.settings-sheet-header` / `.settings-sheet-scroll`
- `.settings-page .settings-card` / `.settings-folder`

修复：
- 手机/coarse 指针下这些层全部 `backdrop-filter: none !important`
- 抽屉只保留 `transform` 过渡，加 `will-change: transform`
- 遮罩不再播 `dim-in`，避免抽屉+遮罩双动画
- 抽屉阴影从 60px 缩小到 18px，降低重绘

验证：surface 审计在 320/360/390/844/915 打开抽屉+设置页后，无 `mobile-backdrop`、0 布局问题；截图见 `_audit/browser-surfaces/`。

## 侧边栏/设置可读性（2026-10-29）

- 手机去 blur 后，用户反馈侧边栏太透明、设置页背景穿透。
- 修复：手机/coarse 下 sidebar 用不透明 `--theme-card-rgb`，brand 标题改 `--theme-ink`、副标题 `--theme-muted`；设置 sheet/scroll/page 用不透明 `--theme-background`；settings 卡片/文件夹实色。
- 侧边栏新增「下载 Android App」入口，设置页新增「下载安卓安装包」；安装按钮恢复内联 guidance 反馈（原先 notice 被设置层遮住，看起来没反应）。
- 验证：320/360/390/844/915 截图侧边栏、设置页均无透明/布局问题。

# Redmi K30 布局事故（2026-10-29）

## 症状
其他用户的 Redmi K30 截图/录屏里：

- 左侧 286px 桌面侧栏一直显示
- 主内容被挤到右侧很窄，通知文字变成竖排
- 侧栏没有关闭按钮
- 五天内多次更新都没有变化

## 根因
不是 Redmi 分辨率本身，而是 **部分 MIUI/Redmi WebView 在桌面模式/显示大小设置下把布局视口报成 980px**。

- CSS 只写了 `@media (max-width: 820px)` 的移动布局
- WebView 报 980px → 媒体查询不命中
- 于是走桌面布局：`grid-template-columns: 286px 1fr`，主区只剩很窄；`.sidebar-close` 在桌面规则里是 `display:none`
- 同时 **更新源 `updates/android.json` 还停在 2.13.43（301）**，后续修复没有发到用户手机

## 修复
1. `index.html` 在 CSS 前按 **物理屏幕短边 + 触摸/UA** 检测真实手机，写入
   `data-dengta-force-mobile="true"`；即使布局视口被报成 980px 也能识别出手机。
2. 新增 `src/force-mobile.css`：
   - `.app-shell` 改为 block，强制单列
   - `.sidebar` 固定为抽屉、`transform` 隐藏/滑出
   - `.sidebar-close` 强制显示 44×44
   - `.sidebar-scrim` 重新显示
   - `.menu-button` 强制显示
   - `.main-panel` 100% 宽、底部安全区
3. 更新链路：
   - `updates/android.json` / `download.json` 从 301/2.13.43 更新到 **305/2.13.47**
   - APK 同时传到 `https://www.dengtahome.com/downloads/DengTa-2.13.47.apk`
   - 旧版 App 会通过 AppUpdateCenter 看到更新
4. 音乐工作室也一起进入 305：独立「音乐工作室」栏目 + 原有「一起听 · 同步」。

## 验证
- 模拟 Redmi 桌面模式：viewport 980×2178，screen 393×873，Android UA
  - `forceMobile=true`
  - `.app-shell display:block`
  - sidebar 抽屉宽 310，关闭按钮 44×44 可见
  - 打开/关闭 scrim 正常
- 正常 390×844：仍走移动布局，未被误伤
- 线上更新源已验证：
  - version_code 305
  - APK 200 OK，size 36,536,695
  - sha256 `e38c464f47c61ba896dbb81312f50668859d8fb8598d9807487bb024b2d1f051`

## 注意
- 线上 2.13.43 的 APK 历史签名是旧 debug 证书；如果用户从 2.13.43 直接升级提示签名不一致，需要**卸载旧版一次再安装 2.13.47**。2.13.44（当前签名）起的版本可直接覆盖更新。
- 从 2.13.47 开始使用统一的新签名，后续更新不会再出现这类断链。

## 文件
- `src/force-mobile.css`
- `index.html`（手机视口检测）
- `public/updates/android.json`
- `public/updates/download.json`
- `public/downloads/DengTa-2.13.47.apk`
- `src/MusicStudio.jsx` / `music-studio.css`

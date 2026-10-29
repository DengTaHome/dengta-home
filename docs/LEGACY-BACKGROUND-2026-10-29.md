# 旧版海岸背景与切换器（2026-10-29）

## 用户诉求
用户提供旧版截图：奶油/粉橘色海岸、太阳、云、灯塔，以及星夜版本。希望保留旧版氛围，并能自由切换背景。

## 找到的旧版素材
旧版背景就是仓库里现成的海岸静帧：

- `public/assets/coast-video/coast-day.webp`
- `public/assets/coast-video/coast-twilight.webp`
- `public/assets/coast-video/coast-night.webp`

新版实时天空把它们裁在底部当海岸层；旧版截图是整屏静帧 + 柔和天空。本轮没有改动实时天空，而是新增「经典海岸」模式，用这三张旧素材重建旧版观感。

## 实现
- `src/LegacyCoastBackdrop.jsx` + `src/legacy-coast-backdrop.css`
  - 整屏 `object-fit: cover` 海岸图
  - 日光/暮色时叠加柔和太阳光晕与云层
  - 星夜时叠加月光、星点与暗角
  - 保留 `prefers-reduced-motion` / DengTa 减少动画开关
  - 聊天有私密背景图时自动隐藏，不抢用户自己的壁纸
- `src/dengta-theme.js`
  - 新增 `background` 偏好：`auto | legacy | legacy-day | legacy-dusk | legacy-night`
  - 持久化到原有主题存储（按账号隔离）
  - `data-dengta-background` 写入根节点
- `src/App.jsx`
  - `background === "auto"` 时渲染原来的 `CelestialBackdrop` 实时天空
  - 其它模式渲染 `LegacyCoastBackdrop`，不启动实时天空 canvas，手机更省电
- `src/ThemeStudio.jsx` + `src/theme-background-switcher.css`
  - 设置 → 外观与聊天 → 「背景」
  - 五个选项：实时天空 / 旧版海岸（晨昏自动）/ 晨光海岸 / 暮色海岸 / 星夜灯塔
  - 每个选项有真实海岸缩略图；固定晨光、暮色、星夜会同步切换浅色/深色显示，避免白字浅底
  - 选择立即生效并持久化

## 默认行为
- 已有用户默认仍是 `auto`，不会突然换背景。
- 想回旧版：设置 → 外观与聊天 → 背景 → 「旧版海岸」，或直接选晨光/暮色/星夜固定场景。
- 选「实时天空」会恢复原来的天气/时间实时变化。

## 验证
- `test/dengta-theme.test.js`、`settings-folders`、`settings-category-navigation`、`interaction-polish`：18 tests 通过。
- 前端全量回归：**0 failure（3833 行）**。
- 390×844 实测：
  - `legacy-day` → `.legacy-coast-backdrop[data-scene=day]`
  - `legacy-dusk` → `twilight`
  - `legacy-night` → `night`
  - `auto` → `.celestial-backdrop` 重新出现
  - 无横向溢出（docSW=390）
- 截图：`_audit/legacy-background/legacy-day-direct.png`、`legacy-dusk-direct.png`、`legacy-night-direct.png`、`settings-background-switcher.png`

## 限制
- 经典海岸模式是固定场景，不跟随实时天气降雨/云量；实时天空仍是默认天气系统。
- 旧版截图里那种更大的太阳/云是当年动态天空叠层；本轮用 CSS 复原了相近的柔和程度，没有逐像素复刻。


## 最终交付
- Vercel `b8dc35a` READY。
- APK `DengTa-2.13.45-303-backgrounds.apk`，SHA-256 `acc8768c27efd71dfafe9e7e589454558e84337d2c12a9f06b6d7b4411f8a751`；已安装 vivo V2454A（versionCode 303 / 2.13.45）。
- 入口两处：
  1. 设置 → 外观与聊天 → 背景
  2. 命令面板（⌘K / Ctrl+K）→「背景 · 旧版海岸」或「背景 · 实时天空」
- 旧版素材来自仓库现成的三张海岸静帧；经典模式覆盖整屏，并在手机上禁用实时天空 canvas 以省电。

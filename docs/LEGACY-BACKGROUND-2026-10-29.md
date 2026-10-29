# 旧版动态海岸背景（2026-10-29）

## 先纠正上一版的问题
上一版我把旧版做成了「三张固定图」，这是错的。旧版并不是固定场景：

- 太阳在天空中的高度随时间连续变化
- 月亮高度、月出/月落随时间变化
- 日出、正午、日落、蓝调时段使用不同的五段天空颜色
- 星星在夜间逐渐出现

本轮重新找回并接回了旧版的太阳/月亮/天空计算，而不是用静态图冒充。

## 找回的旧代码/素材
旧版太阳月亮的计算本来还在仓库里，只是新版 UI 没有以旧版方式呈现：

- `src/sun-glass-sky.js`
  - `getSunGlassSky(minute, snapshot)`：按时间插值五段天空颜色、太阳/月亮位置、日出/日落光晕、星空强度
  - 旧提交中的 `CelestialBackdrop.jsx` 与当前计算一致，后续提交只是性能和手机省电调整
- `public/assets/coast-video/`
  - `coast-day.webp`、`coast-twilight.webp`、`coast-night.webp`：旧版海岸静帧
  - 旧版背景就是这套天空计算 + 海岸静帧

本轮 `LegacyCoastBackdrop` 不再使用固定 `day/dusk/night` 选择，而是：

1. 从 `snapshot` 取当前分钟、日出、日落
2. 调 `getSunGlassSky` 得到太阳 `sunX/sunY/sunOpacity`
3. 得到月亮 `moonX/moonY/moonOpacity`
4. 得到五段天空颜色 `colors[0..4]`
5. 得到 `sunriseAura / sunsetAura / blueHour / night` 等光晕与星星强度
6. 把这些值实时写进 CSS 变量，驱动太阳/月亮高度、颜色、星星和暖光

## 切换入口
**设置 → 外观与聊天 → 背景**：

- **实时天空**：新版天气/云层/光线系统（默认）
- **旧版动态天空**：本轮找回的旧版太阳月亮高度、日出日落五段色彩

也可以 `⌘K` / `Ctrl+K` →「背景 · 旧版海岸」/「背景 · 实时天空」。

## 实测（模拟不同时间，390×844）
| 时间 | 场景 | 太阳 | 月亮 | 星星 |
|---|---|---|---|---|
| 06:40 | twilight | x=11.2%, y=67.2%, opacity=1 | opacity=0 | 0 |
| 12:00 | day | x=52.7%, y=18.3%, opacity=1 | opacity=0 | 0 |
| 19:30 | night | opacity=0 | x=16.5%, y=57.0%, opacity=.97 | 1 |
| 22:30 | night | opacity=0 | x=39.2%, y=24.3%, opacity=.97 | 1 |

同一套五段天空颜色也随这些时间变化；截图：

- `_audit/legacy-dynamic/legacy-0640.png`（低太阳 + 晨光）
- `_audit/legacy-dynamic/legacy-1735.png`（晚霞）
- `_audit/legacy-dynamic/legacy-1930.png`（月亮升起）
- `_audit/legacy-dynamic/legacy-2230.png`（月高悬）

## 发布
- 前端全量回归：0 failure（3833 行）
- Vercel：待最新提交 READY
- APK：本版重新构建，安装后可在设置里切换

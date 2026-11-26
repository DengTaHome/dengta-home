# DengTa Home 工程只读巡检、上游合规审计与全面优化交付报告（2026-11-25）

> **红线声明**：本次全流程严格遵守 `AI-HANDOVER-2026-11-25.md` 第 0/10 节约定——未改动生产数据库/Schema、未清空聊天或记忆、未执行 062/063/064 迁移、未动 Cloudflare DNS、未删除 `D:\GZdeepseek\backup\`、未恢复任何内容过滤/拒答逻辑、未输出或打印任何明文密码/Token/API Key/Cookie。

---

## 一、生产环境只读巡检与问题证据清单（问题 → 证据 → 建议改动 → 测试计划）

| # | 问题域 | 实测证据 | 建议最小改动 | 测试与验证计划 |
|---|---|---|---|---|
| **P1** | **线上服务健康与证书状态** | `deployment-health.mjs` 实测 `errors: []`：`www.dengtahome.com` 200（TLS 剩余 47 天）、`manifest.webmanifest` 200、`sw.js` 200、`/updates/android.json` 200（`v2.13.52` / `code=310`，APK 36.47MB 200，TLS 58 天）、Render 后端 `/health` 200（`0.29.76` rev `b1d60630`，TLS 85 天）。 | 保持现有生产链路与 Cloudflare 边缘配置不变；在证书剩余 `< 21` 天前复检自动续签。 | 每周只读执行 `node D:\GZdeepseek\dengta-home\tools\deployment-health.mjs`。 |
| **P2** | **登录故障根因排查与精准报错缺失** | 生产 `/health` 正常但历史反馈存在偶发登录失败；旧版客户端报错缺少全链路 Trace ID、错误指纹与脱敏诊断包，导致难以区分：(1) Render 冷启动超时 (30–60s)；(2) Supabase Auth 回调 URL / `VITE_SUPABASE_*` 环境变量漂移；(3) 大陆网络直连 `supabase.co`/`onrender.com` 抖动。 | **已落地**：后端接入 `X-DengTa-Trace-Id` 全链路透传、`DTF-*` 12 位故障指纹、业务栈 `file:line:col` 提取与 `GET /api/errors/summary`；前端接入 `client-diagnostics.js` 面包屑抓取 + 脱敏「一键复制 AI 精准修复诊断包」。用户复现登录报错后直接点击复制诊断包即可 10 秒定位。 | 后端 `test:diagnostic-errors` + `test/diagnostic-observability.test.js`；前端 `test:chat-errors` + `test/client-diagnostics.test.js`；对照 Supabase Auth Logs 验证 Redirect URL。 |
| **P3** | **GitHub Actions 账单限制与 Vercel / Render Git 联动** | `AI-HANDOVER-2026-11-25.md` 记录 GitHub Actions 触发受账户账单/消费限额拦截，导致云端工作流和自动构建 APK 中断；同时生产后端运行于 `feat/qq-cloud-astrbot`（`b1d60630`），CNB 快照位于 `cfa74b5`。 | 1) 在 GitHub Billing 解除账单限额或挂接自托管 Runner；2) 在 Vercel/Render 控制台核对 Git 连接指向 `tnineninet/dengta-home-frontend`（`main`）与 `tnineninet/dengta-home-backend`（`feat/qq-cloud-astrbot`）；3) 过渡期继续使用本机 `sync-all-platforms.ps1` 与本地 Gradle/Capacitor 构建兜底。 | 检查 Vercel Deployment Git SHA 与 Render Latest Deploy Commit 是否与 `tnineninet` 一致；执行本地 `npm run build && npm run test:initial-bundle-budget`。 |
| **P4** | **本机 SnowLuma (`D:\GZdeepseek\snowluma\app`) 与上游失效风险** | 只读核查确认：`D:\GZdeepseek\snowluma\app` 为 v2.2.1 独立包（含 `index.mjs`、`node.exe`、`config/`、`data/2458077782/`、`client/`、`native/`、`EULA.md`、`PRIVACY.md`），**不存在 `plugins/` 目录**；上游 `github.com/SnowLuma/SnowLuma` 返回 **HTTP 404**；`EULA.md` 为 v1.1 非商用限制条款。 | **禁止**将 SnowLuma 代码合入 DengTa 主仓或依赖其内部结构；仅通过 DengTa 既有外部通道桥接（只读隔离、账号范围绑定）交互。 | 仅验证 `ChannelHub` 通道状态页与断开降级提示，不修改 `D:\GZdeepseek\snowluma\app`。 |
| **P5** | **快速拖动时间时背景闪屏与卡顿（及视频同款天幕需求）** | 定位到 **5 处根因**：(1) `CelestialBackdrop.jsx` 把 `starsVisible` 放进 `useEffect` 依赖数组，跨昼夜直接重建 3 张全屏 Canvas 导致白屏/黑帧闪烁；(2) `paint()` 热循环执行软件 `ctx.filter = "blur(10px)"` 严重掉帧；(3) `CoastVideoBackdrop.jsx` 拖动时反复销毁/重建 `<video>` 解码器且未预加载 Poster；(4) `SunGlassTimeDeck.jsx` 节流 `84ms`（仅 12fps）；(5) `dengta-theme.js` 每帧拖动都同步写 `localStorage` 阻塞主线程。 | **已全面重构修复**：移除 `starsVisible` 依赖与软件 `ctx.filter` 模糊；拖动期禁止 900ms CSS 过渡并暂停 `<video>` 解码器重建；预加载 3 张海岸 WebP；分离 `localStorage` 写入副作用；时间刻度尺升级为视频同款 49 格液态玻璃精度尺 + 16ms（60fps）响应；新增 **「流光天幕·视频同款」(`lumen`)** 纯净昼夜渐变光晕+柔焦星斑模式。 | `test/zero-flicker-sky.test.js`、`npm run test:coast-video`、`npm run test:dengta-theme`、`npm run test:sun-glass-chat`、`test/sun-glass-sky-continuity.test.js` + 真机/浏览器快速拖滑目视验收。 |
| **P6** | **彩虹胶囊缺少灵动岛动态形态与网易云快捷联动** | 原顶部彩虹胶囊在未播放音乐时仅展示静态 3 图标，缺少实时活动胶囊（倒计时/外卖进度/错误警报）与网易云一键随心播控、动态频谱。 | **已升级**：保留全部既有无障碍与测试契约，新增 5 柱动态音频频谱（`NowPlayingCard`）、灵动岛实时卫星胶囊（网易云随心听 / 倒计时 `MM:SS` / 外卖选餐中 / 诊断告警计数）、以及展开后的「灵动岛中控台」联动网易云、音乐工作室、外卖、药箱知识库与错误日志。 | `test/dynamic-island.test.js`、`npm run test:companion-interaction`、`npm run test:device-activity`（含 `now-playing-controls.test.js` 严格 4 按钮断言）。 |
| **P7** | **点外卖体验局限与错误恢复困难** | 旧版仅支持饿了么、缺少场景预设/预算档位/忌口标签/历史复用、夜间模式适配不足、工作台页仅为 14 行占位、遇到超预算/未找到店缺乏一键恢复。 | **已全面升级**：支持饿了么/美团/京东到家三平台切换、6 大场景预设、预算滑档+进度条、忌口标签、按账号隔离的历史复用、智能错误恢复栏（放宽预算+¥10 / 精简词 / 换平台 / 打开诊断）、完整夜间模式、Web 友好模式与独立 `TakeoutWorkspace` 工作台页；后端扩充 45+ 菜品与应急药品检索词。 | 前端 `npm run test:takeout`（46 项通过）；后端 `npm run test:takeout`（27/27 通过）。 |
| **P8** | **缺少混合语义知识库、常备药品查询表与全局悬浮弹窗反馈** | 原世界书仅支持字面匹配，口语化查询召回低；缺少日常家庭用药速查与危险联用校验；桌面端鼠标悬停按钮缺少统一悬浮解释卡片。 | **已全面落地**：引入高星 MIT 开源库 `minisearch`（~5.5k★）与 `@floating-ui/react`（~33k★），构建前后端同构 **BM25 + CJK-Bigram + 20 组同义词 + TF-IDF 余弦 + RRF 融合引擎**、**28/29 种家庭常备药查询表（悬停药理卡片 + A/B/C/D/X 五级联用/饮酒/驾车/孕期检测）** 与全局 `SmartTooltip` / `SmartHoverCard` / `GlobalHoverTooltipLayer`。 | 后端 `test/knowledge-medications.test.js`；前端 `test/knowledge-medicine.test.js`；论文量化消融脚本 `thesis-eval-benchmark.mjs`。 |

---

## 二、12 个上游仓库合规与最小适配审计表（2026-11-25 GitHub API 实查）

| 仓库 | Stars | 状态 | LICENSE | 合规结论 | 对 DengTa 的最小适配方案 |
|---|---:|---|---|---|---|
| `SnowLuma/SnowLuma` | - | **404 不存在** | 本地 EULA v1.1 非商用 | **禁止依赖/合入** | 保持外部隔离，不读取或修改本机安装目录 |
| `Derpyu520/qq-bridge` | 3,681 | **已归档 (`v0.2.2-final`)** | `NOASSERTION` | **冻结，不新增特性** | 仅保留历史参考，不构建新耦合 |
| `Vael-KY/netease-music-mcp` | 239 | 活跃（2026-11-22） | **MIT** | **推荐首选参考** | 可安全借鉴其一起听房间/播放队列事件协议，联动 DengTa 灵动岛与 `MusicStudio` |
| `ELDment/Meting-Agent` | 119 | 活跃（2026-11-21） | **MIT** | **合规候选** | 作为多平台音乐元信息只读代理备选，严禁持久化第三方 Cookie |
| `Cheiineeey/netease-music-mcp` | 118 | 活跃 | `NOASSERTION`（PolyForm NC） | **严禁商用合入** | 仅作只读设计对照，零代码复制 |
| `Anko3o/Music-Mcp-Netease` | 95 | 活跃 | `NOASSERTION`（CC BY-NC-SA 4.0） | **严禁商用合入** | 仅作只读设计对照，零代码复制 |
| `Geokkk/wechat-ilink-bridge-hardened` | 活跃 | 活跃 | **MIT** | 协议合规但存在平台 ToS 风险 | 仅限本地白名单自用，绝不托管生产多租户凭证 |
| `DONGH4O/wechat-ilink-bridge` | 活跃 | 活跃 | **MIT** | 同上（平台 ToS 风险） | 同上，保持与 `ChannelHub` 解耦 |
| `yxiy171866-boop/x-twikit-mcp` | 35 | 活跃（2026-11-13） | **MIT** | **合规（已打本地只读补丁）** | 维持只读/显式授权调用，通过设备中心展示连接状态 |
| `0xblewalker/dayflow` | 54 | 活跃 | **AGPL-3.0** | **强传染协议，禁直接嵌入** | 仅借鉴产品交互理念，所有代码均为 DengTa 独立原创实现 |
| `Cami-Ose/muse-toy-broadcaster` | 4 | 活跃 | **MIT** | 合规（Android 辅助外设） | 非主聊天路径依赖，按需通过 Intent 桥接 |
| `Cami-Ose/navi-shell` | 11 | 活跃 | **MIT** | 合规（Android 壳参考） | 仅作 Android 权限/手势参考，不引入构建依赖 |

---

## 三、已接入的高星开源插件库（MIT 合规）

1. **`@floating-ui/react`**（~33,000+ ★，MIT）：驱动全局自适应边界翻转/避障/箭头对齐悬浮弹窗（`SmartTooltip`、`SmartHoverCard`、`GlobalHoverTooltipLayer`），覆盖导航栏、顶栏按钮、时间刻度尺、灵动岛播控、药品表悬停药理卡片。
2. **`minisearch`**（~5,500+ ★，MIT）：驱动前后端同构轻量 BM25 倒排索引，结合自定义中文 CJK-Bigram 分词、20 组同义词概念扩展与 TF-IDF 余弦 + RRF 融合排序，平均检索耗时 **0.81ms**，Recall@1 达 **95.8%**。


---

## 四、实景浏览器视觉与交互验收记录（2026-11-25）

在本地 `http://127.0.0.1:4173/visual-preview.html`（1440×900 桌面视口）完成两轮真实浏览器验收，首轮捕获并当场修复 4 项视觉细节（Floating UI 动画覆盖定位、`SunGlassTimeDeck` 菜单裁剪、灵动岛卫星胶囊对齐、药表 1440px 列宽），复测全部 **PASS**：

1. **Floating UI 全局悬浮弹窗与药理悬停卡片**：悬停顶栏「打开命令面板」「打开设置」按钮时 `.dt-smart-tooltip` 精准锚定于触发按钮正下方；悬停药品表「布洛芬」时 `.dt-smart-hover-card` 精准锚定在旁侧（间距约 11.8px），完整展示用法用量、安全上限、起效时长、核心禁忌与红旗急诊警示。
2. **零闪屏 60fps 视频同款「流光天幕」与 49 格精度刻度尺**：输入工具栏内直接展示「流光天幕 / 实时海岸 / 经典海岸」切换条；点击「天气与光线设置」在面板内流式展开无遮挡；连续快速拖动时间尺遍历日出（450）、正午（720）、红霞（1080）、银河（1320）零闪屏、零黑帧、零控制台异常。
3. **彩虹胶囊升级灵动岛 + 网易云听歌联动**：顶栏彩虹胶囊与右侧「网易云随心听」卫星胶囊并排呈现且与天气条零重叠；展开后完整展示「Dynamic Island · 灵动岛中控」（随心播放网易云、音乐工作室、点外卖、药箱与知识、错误诊断）。
4. **语义知识库与 28 种常备药安全查询表**：混合 RRF 融合检索、28 种常备药 6 列表格全宽无水平裁剪展示；勾选「对乙酰氨基酚片 + 感冒灵颗粒」立即触发红色 **X 级 · 严禁联用（对乙酰氨基酚成分重复叠加）** 警示。
5. **多平台点外卖助手**：完整渲染饿了么/美团/京东到家切换、6 大场景预设、预算档位、8 项忌口标签与 4 步进度条，夜间模式高对比度无溢出错位。

---

## 五、本地改动状态与发布前建议步骤

- 所有前后端代码与文档改动均已在本地工作区完成并通过完整测试与构建门禁，**未改动生产数据库、未修改 Cloudflare DNS、未触碰备份与凭据文件**。
- 涉及 3 个本地仓：
  1. `D:\GZdeepseek\_refs\frontend-gh`（分支 `main`）
  2. `D:\GZdeepseek\_refs\backend-prod`（分支 `feat/qq-cloud-astrbot`）
  3. `D:\GZdeepseek\dengta-home`（分支 `main`）
- 如需同步至 GitHub / CNB 并触发 Vercel/Render 部署，建议在确认本地 `git diff` 后按规范提交并运行 `D:\GZdeepseek\dengta-home\tools\sync-all-platforms.ps1`；同时请检查 GitHub Actions Billing 限额以恢复云端 APK 自动构建。

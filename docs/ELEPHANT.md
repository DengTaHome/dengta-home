# ELEPHANT — DengTa 长期账本（当前事实）

> 给后续全新上下文用。最后更新：2026-10-29 04:40 Asia/Shanghai。
> 详细逐轮记录见 `D:\GZdeepseek\dengta-home\docs\OPTIMIZATION-LEDGER.md`。

## 目标状态

- 目标是「持续约 8 小时全面优化 DengTa」，方法 Elephant（账本）/ Goldfish（外部只读复核）/ 深检索 + 真实浏览器验证。
- 当前 goal 仍 active；外部凭据项（CNB 写权限、高德开发者认证、部分凭据轮换）未完成，不应标记 complete。

## 已在线版本（已核对）

- backend：`https://dengta-home-backend-rkmq.onrender.com/health` → revision `59af43d`（最近一次；更早已部署 `1d74d59`/`ec88074`）。
- frontend：Vercel production 最新 `37cef72` READY（含 art-studio 清理 flake 修复）。
- VPS 音乐稳定版：`https://music.dengtahome.com/health` → 200 `ok`，网易云登录态保留。
- X MCP quick tunnel + API key：DengTa 连接 `4bcdbfeb-64c8-46e7-9d2f-9c9c217d36f2`，`/test` 200，12 工具。
  连接必须用 `protocol_version=2024-11-05`，不能是 `auto`。

## 已验证的关键事实

- 前端完整 `npm test` 最近一次：**exit 0**，3924 行日志，0 failure（full6）。
- 后端 `npm run test:module-coverage`：**124/124**。
- 真机布局 6 视口（360×640、360×780、393×873、412×915、480×1040、800×1280）：**6/6 无布局问题**。
  报告：`_audit/browser-remaining/layout-matrix.json`。
- 每用户网易云扫码入口已挂载 `MusicSettings`；后端有 per-user MUSIC_U 存储。
- 时间胶囊：网页 status 写入会保留 capsule keys；qq-bridge 保存前读最新 status 并用 `applyCapsuleJobs` 合并 marker。
  runtime 写入已用 `services/keyed-lock.js` 按 `user:companion` 串行化（Render 单实例前提）。
- `time_capsule.active` 使用保存后的实际胶囊条数，qq-bridge 测试断言 active=1。
- NetEase `service.songUrl` 是 2 参 async resolver（返回 Promise），三处调用正常；importPlaylist 查询错误会抛出。
- X 可复现工具：`dengta-home/tools/x-mcp/`（patches/capture/smoke/README）；
  `git apply --check --ignore-whitespace` 两个 twikit patch 均 exit 0；smoke 得 tools=12 + get_user_info。
- Muse 1.1 私有 release `companion-muse-v1.1`：本地模式/强度 SeekBar + ACTION_MODE，versionCode=2。

## 已知修复过的坑（勿重复误报）

- 旧说“music 许可证 MIT”是错的，实际 CC BY-NC-SA 4.0。
- 旧说“Muse 可独立分发”不成立；仍需年龄门槛/隐私政策/更新源。
- 旧说“时间胶囊已完全修好”在 36174d5 时过强；后续补了 keyed-lock/active 修复。
- `test:module-coverage` 曾 121/121 但 qq active 测试是假绿；现在 124/124 且真实断言。
- frontend full5 曾因 `art-studio` ENOTEMPTY 临时目录 flake 失败；已加 `rm maxRetries/retryDelay`，full6 exit 0。
- 旧 X 连接 `/test` 400 根因是 `protocol_version=auto`，不是网络/API key。
- 旧本机 18012 cloudflared 公网裸奔已停止；不要重开。
- 之前工具输出曾打印凭据；建议轮换，但尚未完成。

## 验证命令

```powershell
# backend tests
cd D:\GZdeepseek\_refs\backend-prod
D:\GZdeepseek\_tools\node\npm.cmd run test:module-coverage

# frontend full tests (long)
cd D:\GZdeepseek\_refs\frontend-gh
D:\GZdeepseek\_tools\node\npm.cmd test

# frontend build/lint
D:\GZdeepseek\_tools\node\npm.cmd run lint
D:\GZdeepseek\_tools\node\npm.cmd run build

# X smoke (cookie path outside repo)
$env:X_COOKIES_PATH='D:\GZdeepseek\_credentials\x-cookies-full.json'
$env:TWITTER_PROXY='http://127.0.0.1:10809'
$env:TWIKIT_ONDEMAND_URL='<capture-ondemand 输出>'
D:\GZdeepseek\_tools\python312\python.exe D:\GZdeepseek\dengta-home\tools\x-mcp\smoke-test.py
```

## 仍未完成

- CNB 写权限：本地无 CNB write token，需用户提供或等 11/1 GitHub Actions `sync-cnb.yml`。
- 高德/Amap：开发者认证与 Key 仍需用户完成。
- 凭据轮换：Vercel/GitHub/Render/VPS 凭据此前异常输出过，建议轮换。
- X twikit ondemand 补丁需随 X 前端更新重新抓 URL；quick tunnel URL 重启会变。
- 全量测试仍未覆盖真实多用户并发（锁只保证单 Render 实例内）。

## 最终收尾（2026-10-29）

- 最终在线：backend `8afbee7`、Vercel `9d570d1` READY。
- 最新定向测试 6/6（voice/QR guards/NetEase entry），build+CSP 通过；backend 124/124；真机 6/6 视口。
- 已修包括：NetEase 导出/导入、胶囊并发与 active、QR 竞态/卸载、语音权限松手、更多回复去重、JSON 4MB 守卫、聊天历史 500 条分页、X `/test` protocol、X 可复现补丁、Muse 1.1。
- 未闭环：CNB 写权限、高德认证、凭据轮换；前端/后端若干 P2（TTS 在途取消、preflight 取消、情绪伪展示、首屏 CSS/字体/动图成本、语音键盘可达性、歌词 focus trap、stream 断连取消、优雅停机）。

## 流畅度专项（2026-10-29 新 8h 第 1 轮）

- 已移除 Vite 模板 `App.css` 全量引入，改为 `refusal-banner.css` 仅保留拒答样式。
- `RainbowAgentMark` 默认静态首帧，悬停才启动 426KB 动态 WebP；移动端不持续解码。
- ≤700px 关闭 backdrop-filter 玻璃模糊；隐藏/滚动时通过 data 属性暂停所有装饰动画。
- 真机：verify-local-build 11/11、verify-animation-budget 全通过、touch targets 0 <44px。

## 流畅度/语音 P2（2026-10-29 轮次 63）

- TTS stop 会 abort 在途 fetch；新播放先停旧 audio；voice.test 增加 fetch 中 stop 断言。
- 语音 preflight 每个 await 后检查 submitRun，取消不再上传。
- 情绪关闭/无分析时不挂 voiceAnalysis，避免伪“未确定”。
- 性能：静态 mark + 移动端 blur off + hidden/scroll pause；浏览器 animation/local-build/touch 均通过。

## 流畅度/语音/无障碍（2026-10-29 轮次 64）

- TTS stop abort fetch、避免重叠 audio；voice.test 覆盖 fetch 中 stop。
- 语音 preflight 每个 await 后检查取消 token。
- 情绪关闭/无分析不挂 voiceAnalysis。
- 歌词弹层 focus trap/Escape/44px target。
- 浏览器：local-build 11/11、animation-budget 全通过、touch 0<44px。

## Goldfish 流畅度复核闭环（2026-10-29 轮次 65）

- 触屏 tap 不再加载 426KB 动图（仅 fine hover + mouse pointer）；App 内 reduced-motion 也生效。
- 取消语音后 RefreshSessions 返回不再自动播放；TTS body abort 统一 speech_cancelled。
- ≤820px backdrop blur 全部关闭（高 specificity > 原有 820 caps）。
- 测试：touch 按 ::after 有效区、animation 不再假 skip；local-build 11/11、animation 全过、touch 0<44。
- backend `voice_analysis_retention_enabled` 已消费；审计引用的 dengta-home/backend 是旧副本。

## 轮次 66（2026-10-29）

- 触屏 tap 不加载动图；取消语音后不自动播放；TTS body abort 统一错误；≤820px blur 全关。
- 语音按钮键盘可达；后端 SIGTERM 优雅关闭。
- 真机：local-build 11/11、animation 全通过、touch 0<44；backend d0fafa7、frontend bcbb0ea。

## 轮次 67（2026-10-29）

- 语音按钮键盘可达；低内存/saveData 使用系统字体，避免 7.4MB webfont。
- 新增 performance-guards 测试；music-listening 3/3。
- full8 停滞已停止；最近完整全绿仍是 full6；真机 local-build/animation/touch 通过。

## 全量测试停滞修复（2026-10-29 轮次 68）

- full8 卡在 music-import-flow 的 vite.close()；已加 2s race + process.exit(exitCode) 兜底。
- 单文件通过；full9 全量重跑。

## full9 唯一失败修复（2026-10-29 轮次 69）

- full9 只在 mobile-layout 的 stylesheet order 失败（缺 refusal-banner.css）；已修并单测通过。
- full10 复跑中；music-import-flow teardown 停滞已修。

## full10 收尾（2026-10-29 轮次 70）

- full10 3821 行、0 failure 标记（一个 Vite 测试端口警告）。
- full9 失败已修；music-import teardown 停滞已修。
- backend d0fafa7、frontend 2a30695 READY。

## 轮次 71（2026-10-29）

- full10 3821 行 0 failure；full9 唯一样式顺序失败已修；teardown 停滞已修。
- 401/403 不再写 chat_error_logs；前端 keyboard/lowdata/perf guards/浏览器验证保持通过。

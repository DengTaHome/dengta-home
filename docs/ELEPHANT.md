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

## 低功耗背景（2026-10-29 轮次 72）

- CelestialBackdrop 在 saveData/deviceMemory≤4 时冻结 Canvas/视频为静态帧。
- RainbowAgentMark 读取 data-dengta-reduced-motion==="true"；test teardown lint 修复。

## 轮次 73（2026-10-29）

- backend a783535 在线（401/403 不写日志）；frontend d11729f（低功耗冻结背景）。
- full10 3821 行 0 failure；Goldfish 复核启动。

## 轮次 74（2026-10-29）

- 401/403 匿名才免写日志；登录 403 保留 error_log_id。
- performance guards 覆盖 lowPower；app-motion false positive 修正；32/32 通过。
- full10 早于 d11729f，最新以定向测试为准。

## 轮次 75（2026-10-29）

- DB health timeout 会 abort 底层查询；voice body abort 测试。
- 401/403 仅匿名跳过日志；full11 运行中，full10 最近完整 0 failure。

## 轮次 76（2026-10-29）

- 手机首次访问默认系统字体，避免 7.4MB 品牌字体下载；桌面仍 standard。
- typography/performance 9 项通过；DB health abort；full11 运行中。

## full11 全绿（2026-10-29 轮次 77）

- full11 exit 0，3938 行，0 failure；full12 跑最新手机字体。

## full12 最新全绿（2026-10-29 轮次 78）

- full12 exit 0，3938 行，0 failure；覆盖手机系统字体/语音/低功耗/teardown。

## 手机首访字体（2026-10-29 轮次 79）

- index.html inline 脚本已按 820px 默认 system；CSP hash 更新。
- Edge headless 390×844 生产实测：fontMode=system，无 7.42MB 字体请求。
- full12 3938 行 0 failure；build/CSP 通过。

## 手机字体/布局（2026-10-29 轮次 80）

- 生产 f5b590f3：390×844 system、无字体请求。
- 3 手机视口布局全通过，就绪 3.1–3.3s（之前 ~272s）。

## 最新 6/6 布局（2026-10-29 轮次 81）

- 手机 3 + 平板/折叠/桌面 3 全通过，就绪 3.1–3.5s。
- 生产手机首屏 system 字体、无字体请求；full13 运行中。

## full13 全绿（2026-10-29 轮次 82）

- full13 exit 0，3938 行 0 failure；含 inline 手机字体/CSP/DB health。

## 生态全量审查（2026-10-29 轮次 83）

- 新建 `docs/ECOSYSTEM-INVENTORY-2026-10-29.md`：24 个仓库/镜像 + 依赖，逐仓读 README/LICENSE/入口/配置/关键源码，四组独立只读审计。
- 关键动作：删 `_refs/frontend-prod`/`_refs/artifacts`；公开镜像 README+Android feed 指向 v2.13.43；music-stable fail-closed token/body/常量时间+测试；backend render.yaml 对齐/coverage 停跟踪；frontend 调试截图 untrack；typography 行为测试；Vael attribution。
- 仍待：CNB token、Amap、kiwi 鉴权、x-twikit 写工具闸门、music 新镜像部署、公开镜像 tag 清理。

## 生态审查修正与部署（2026-10-29 轮次 84）

- Goldfish 复核纠正：x-twikit 只读闸门仅在本机 worktree/补丁，上游 dc5c935 仍可写；清单已改为“本机补丁、未合并上游”。
- HEAD 已校正：backend f96b0b5、frontend 58ae256、music 4fde883；公开镜像 54 个重复 tag（非 63 全同）。
- 公开镜像：README/feed 已指 v2.13.43；Vael attribution 已提交；THIRD_PARTY_NOTICES 在 origin/main。
- music-stable：proxy/entrypoint/Dockerfile 安全加固已部署到 VPS（pull 4fde883、重建镜像、重启）；public /health 200、无 token /mcp 401、.netease_cred 保留。
- backend render.yaml/coverage、frontend 根调试图/XML untrack、typography 行为测试均已落地。
- CNB 非前端-only（backend-main/opensource-main 等）；sync 仍只推 frontend-main，无写 token。
- 仍待：x 闸门合并上游、公开镜像 tag 清理、kiwi 鉴权、CNB/Amap/凭据轮换。

## APK 2.13.44 阻塞（2026-10-29）

- 构建成功 302/2.13.44，但本机 debug cert 0d63… ≠ 渠道 38a03…；Actions 额度失败、无 adb 设备。候选不发布。
- 需原稳定 keystore 或 Actions 恢复；新增 visual-loop 冻结行为测试。

## 启动健康并行（2026-10-29 轮次 86）

- /health 622ms 与 bootstrap 并行；首条消息 5.5s（前 7.6s）。
- full14 全绿；full15 跑 App.jsx/visual-loop 最新改动。
- APK 2.13.44 构建成功但签名/额度/无设备三重阻塞，候选不发布。

## 启动并行上线 / APK 阻塞（2026-10-29 轮次 87）

- Vercel 70c229e READY；startup 5.5s（前 7.6s），health 622ms 与 bootstrap 并行。
- full15 3829 行 fail 0；APK 2.13.44 因签名证书不匹配/Actions 额度/adb 无设备不能发布。

## 全系列手机屏幕（2026-10-29 轮次 88）

- 16 视口（含 844×390/915×412 横屏）0 布局问题。
- 短横屏隐藏 presence stack，composer 不再出视口；菜单/回复按钮 44px。

## 手机全界面（2026-10-29 轮次 89）

- 主/抽屉/设置/音乐 × 320/390/844 横屏 = 0；搜索框 44px、抽屉新建 44px。
- full16 exit0 3944 行 0 fail；Vercel f2c6531 READY。

## Goldfish 纠正（2026-10-29 轮次 90）

- 上轮 16/16 是 loading 壳假绿；已改验证器为真实消息/会话就绪 + 必需元素断言。
- 17 视口真实 0 问题，ready 6.2–7.5s；短横屏保留状态胶囊，面板可打开。

## full17（2026-10-29 轮次 91）

- full17 exit0 3944 行 0 fail；17 视口真实就绪 0 问题。

## 真实 transcript / 18 视口（2026-10-29 轮次 92）

- 矩阵切有消息会话，msgCount>0；18/18 0 问题，ready 19.3–20.9s。
- 915 横屏走移动断点；恢复态 composer 273–380/390；引用 chip 伪元素命中区全局化。

## full18（2026-10-29 轮次 93）

- full18 exit0 3945 行 0 fail；18 视口真实 transcript 0 问题；恢复态/915 修复。

## 915 胶囊（2026-10-29 轮次 94）

- JS 断点同步 960 复合条件；915 胶囊可打开 status-panel；矩阵新增点击回归。

## 键盘适配（2026-10-29 轮次 95）

- 键盘态 390/320/844 横屏 composer/textarea 全在可视区；固定 composer 仅键盘态。
- Vercel c2c9a1b READY；full20 运行中。

## 后端配置纠正（2026-10-29 轮次 96）

- render.yaml=false 是外部触发器契约；上轮改 true 导致测试失败，已恢复 false。
- 线上 health=true 漂移待 Render 手动对齐；生产配置测试 1/1 通过。

## 后端全量（2026-10-29 轮次 97）

- backend npm test exit0 1107 行 0 fail；render.yaml=false 配置测试通过。

## 断点一致（2026-10-29 轮次 98）

- 500→560 CSS 断点与 JS 一致；19/19 稳定，新增 900×540；旧 source 快照加警告。

## full21（2026-10-29 轮次 99）

- full21 exit0 3945 行 0 fail；19 视口真实消息 0 问题。

## 320 重叠（2026-10-29 轮次 100）

- ⌘K 下移避开胶囊；矩阵新增重叠检查；320 0 问题。

## 320/360 重叠（2026-10-29 轮次 101）

- 断点 365；19/19 0 问题（含重叠检查）。

## 抽屉/设置闪烁（2026-10-29 轮次 102）

- 手机去掉 sidebar/settings 多层 backdrop-filter、scrim 动画，抽屉仅 transform；0 布局/无 heavy backdrop。

## 侧边栏透明度/下载入口（2026-10-29 轮次 103）

- 手机 sidebar/settings 改不透明主题色，brand 对比修复；新增下载入口；安装 guidance 可见。

## 外卖卡关闭（2026-10-29 轮次 104）

- 任务卡新增 44px 关闭按钮；working 关闭先暂停，其它状态直接清除；19/19 takeout 测试。

## 下载/侧边栏/外卖卡（2026-10-29 轮次 105）

- 不透明侧边栏/设置、下载入口、安装 guidance、外卖卡关闭均验证；full24 0 fail，full25 运行中。

## Goldfish 回归修复（2026-10-29 轮次 106）

- 侧边栏 contrast/账号文字、notice 44px；外卖卡键盘冒泡；安装按钮拉伸；full25 exit0。

## 收尾（2026-10-29 轮次 107）

- full26 0 failure；Vercel c45a587 READY；后端 6c1ccb5c；收尾文档/备份已更新。

## 光子流动恢复（2026-10-29 轮次 108）

- 移除 ≤820px 手机 fallback；仅 saveData/reduced-motion fallback；390 拖动验证流体。

## 新签名 APK（2026-10-29 轮次 109）

- 新 keystore（ab4c7a2f…）构建 fresh-install APK；不能覆盖旧版/更新 feed，详见 docs。


## 新签名真机（2026-10-29 轮次 110）

- vivo V2454A Android15：卸载旧 301、安装新 302 成功，启动到登录页。


## 同源登录代理（2026-10-29 轮次 111）

- /supabase rewrite + VITE_SUPABASE_URL 同源；手机 auth health 200；新 APK 已装。

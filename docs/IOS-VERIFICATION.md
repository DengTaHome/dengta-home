# iOS 适配验证记录

源仓库：`DengTaHome/dengta-home`，基于提交 `77472defa5db873ba07d48e3f8b4149d3b278daa`。本记录区分源码/Web 检查与 Apple 原生验收。

| 检查 | 结果 |
| --- | --- |
| `npm run test:ios` | 通过：工程资源、公开配置校验、媒体兼容、冷热启动深链与清理回归 |
| 前端 `npm test` 的全部子套件 | 通过；执行中更新了原生音乐模拟和样式清单，停止处单独复测通过后执行了全部剩余命令 |
| 前端 `npm run lint`、`npm run typecheck` | 通过；项目 typecheck 是 JS/JSX 静态检查，不是 TypeScript 编译 |
| `npm run build` | 通过；既有大分块警告仍存在 |
| `npm run ios:prepare` | 使用虚构的公开 CI 配置，通过配置校验、Vite ios 模式构建、Capacitor SPM 同步；没有使用真实账号或访问模型 |
| iOS plist、PrivacyInfo、storyboard XML 解析 | 通过 |
| Chromium 页面尺寸检查 | 23 项通过，覆盖登录提示、虚构聊天、输入框聚焦、状态与设置 |
| 第二阶段 Chromium 尺寸与交互补验 | 七种尺寸完整矩阵 79 项通过；补验和范围说明见 [第二阶段报告](IOS-PHASE2-REPORT.md) |
| 远程 Xcode 模拟器构建及启动 | [Actions run 42985728913](https://github.com/DengTaHome/dengta-home/actions/runs/42985728913) 通过：Xcode 26.6、iOS 26.5，三个目标 iPhone 均启动并采集登录页截图 |
| 远程原生截图画面检查 | 三张 PNG 已查看，尺寸/SHA256 与 manifest 一致；[预览及原图来源](screenshots/ios-phase2/README.md)。小屏下方内容需滚动，原生滚动尚未自动验证 |
| 后端 `npm run check`、`npm run typecheck` | 通过 |
| 后端完整 `npm test` | 未全部通过：原有迁移测试要求最新文件为 `064_stream_partials.sql`，实际为 `069_channel_sync_hardening.sql` |
| 本地 Xcode、签名、真机、独立 Safari/WebKit 自动化 | 尚未完成，见下方限制；远程原生容器截图不替代这些检查 |

后端失败已在原始提交的独立干净 worktree 中使用 `node test/multitenant-pglite.test.mjs` 复现，失败位置为第 19 行。本次未修改后端或 SQL。

浏览器尺寸为 375×667、390×844、844×390、820×1180、1024×768；未发现文档横向溢出、未捕获页面错误或小于 16px 的可见文字输入控件。发现并修复了旧样式将聊天输入框压到 15px 的问题。测试脚本 [`verify-ios-browser.mjs`](../frontend/scripts/verify-ios-browser.mjs) 使用现有虚构预览，不代表真实账号、云端持久化或模型链路已经验收。

复现布局检查需要 Playwright 和运行中的 Vite 服务，例如在 `frontend/` 下运行：

```bash
npm run dev -- --host 127.0.0.1
# 另一个终端；环境需已安装 Playwright 和 Chromium
node scripts/verify-ios-browser.mjs
```

检查会输出 `artifacts/ios/` 下的截图和 JSON 报告，该目录不进入源码提交。可以设置 `IOS_TEST_ENGINE=webkit` 切换引擎，但需要事先安装 Playwright WebKit 及其系统依赖。

当前执行环境是 Linux，没有本地 Xcode 或 iOS Simulator。已尝试启动 Playwright WebKit，但因缺少 GTK4 等系统动态库而未能运行；不将 Chromium 尺寸模拟称为 Safari 或 iOS 真机测试。远程运行已提供真实 iOS Simulator 原生容器的登录页截图，能检查这三个初始画面；软键盘、滚动/横屏交互、麦克风/相机/位置授权、原生存储、后台挂起和通知仍需按 [iOS 验收清单](IOS.md#真机验收清单) 在 Apple 设备上验证。

已执行的 [iOS 模拟器构建 workflow](../.github/workflows/ios.yml) 使用虚构公开配置执行无签名编译。成功的 run 42985728913 对应源提交 `b09a65d50b78c24235ceba2e10638df24f8a808d`，实际构建 PR 合并提交 `5d7f7a8fecf919b546d9c72d21baafa547a1bf81`；这一结果不自动适用于之后的安全改动。截图原图产物为 [13840402981](https://github.com/DengTaHome/dengta-home/actions/runs/42985728913/artifacts/13840402981)，平台是 `iPhoneSimulator`，不能作为真机 IPA 签名安装。该 workflow 不生成签名 IPA，也不执行 TestFlight 或 App Store 发布。

原生截图采集成功与逐图检查已完成，第四阶段所要求的自动 UI 操作、已登录聊天/记忆/设置页面，以及基准图视觉差异比较仍待实施。

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
| 后端 `npm run check`、`npm run typecheck` | 通过 |
| 后端完整 `npm test` | 未全部通过：原有迁移测试要求最新文件为 `064_stream_partials.sql`，实际为 `069_channel_sync_hardening.sql` |
| 本地 Xcode 编译、签名、真机、Safari/WebKit | 尚未完成，见下方限制 |

后端失败已在原始提交的独立干净 worktree 中使用 `node test/multitenant-pglite.test.mjs` 复现，失败位置为第 19 行。本次未修改后端或 SQL。

浏览器尺寸为 375×667、390×844、844×390、820×1180、1024×768；未发现文档横向溢出、未捕获页面错误或小于 16px 的可见文字输入控件。发现并修复了旧样式将聊天输入框压到 15px 的问题。测试脚本 [`verify-ios-browser.mjs`](../frontend/scripts/verify-ios-browser.mjs) 使用现有虚构预览，不代表真实账号、云端持久化或模型链路已经验收。

复现布局检查需要 Playwright 和运行中的 Vite 服务，例如在 `frontend/` 下运行：

```bash
npm run dev -- --host 127.0.0.1
# 另一个终端；环境需已安装 Playwright 和 Chromium
node scripts/verify-ios-browser.mjs
```

检查会输出 `artifacts/ios/` 下的截图和 JSON 报告，该目录不进入源码提交。可以设置 `IOS_TEST_ENGINE=webkit` 切换引擎，但需要事先安装 Playwright WebKit 及其系统依赖。

当前执行环境是 Linux。已尝试启动 Playwright WebKit，但因缺少 GTK4 等系统动态库而未能运行；不将 Chromium 尺寸模拟称为 Safari 或 iOS 真机测试。系统刘海/灵动岛、软键盘、麦克风/相机/位置授权、原生存储、后台挂起和通知仍需按 [iOS 验收清单](IOS.md#真机验收清单) 在 Apple 设备上验证。

新增的 [iOS 模拟器构建 workflow](../.github/workflows/ios.yml) 使用虚构公开配置执行无签名编译。只有实际 GitHub Actions 记录成功后，才能认为对应提交的 Xcode 编译通过；该 workflow 不生成签名 IPA，也不执行 TestFlight 或 App Store 发布。

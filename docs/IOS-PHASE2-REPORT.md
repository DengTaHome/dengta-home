# 第二阶段：iOS 屏幕与交互适配报告

本阶段基于公开 iOS 提交 `3401fb1`，所有开发在 `/workspace/dengta-ios/ios-agent` 独立副本完成，原目录未修改。GitHub 和腾讯 CNB 的实时分支、版本及选择依据见 [源码来源核对](phase2-repository-sources.md)。未用较旧的 CNB 默认分支覆盖现有工程，也未将私有配置复制到公开源码。

## 本次修复

| 实测问题 | 修复及验证 |
| --- | --- |
| iPhone SE 的登录容器达到 912px，超过 667px 屏幕，且无法滚动到底部 | 将登录容器约束到可见视口并保留内部滚动；底部的重置/验证入口可以滚动访问 |
| 键盘控制只在业务 App 中存在，登录与恢复页面未覆盖 | AuthGate 与 App 共用一个可释放的视口控制器；新增共享、退出交接、旋转和清理回归 |
| 设置/会话弹层仍按完整布局视口显示，键盘遮住下半部分 | 弹层和内容高度使用可见视口；保留安全区与内部滚动，并检查输入框可滚动到达 |
| Pro Max 横屏 932×430 被当作桌面显示永久侧栏 | 保留原有导航行为，改为汉堡按钮打开侧栏抽屉；验证展开、遮罩关闭、重新展开和跳转记忆 |
| 横屏键盘只剩 230px 可见高度时，输入框底部仍到 299px / 251px | 键盘模式收起非必要的时间/状态卡，允许消息区收缩，输入框和发送按钮位于可见范围内 |
| 部分导航、关闭、发送、记忆操作的点击区域不足 44px | 扩大实际触控框，保持原有图标和功能；核心控件加入自动尺寸断言；天气组件的两个按钮另在三种尺寸补验至 44×44px |

未修改后端、账号隔离、凭证存储或签名策略。Keychain 与多账号问题仍按第三阶段处理。

## 浏览器检查结果

七种尺寸的完整矩阵 **79 项通过**。另有专门检查设置搜索框滚动可达性的补充检查 **35 项通过**，以及主题一致的记忆组件补验 **14 项通过**，其中包含与完整矩阵重复的场景，不能把两者相加当作独立功能数。

| 场景 | 尺寸 / 覆盖 |
| --- | --- |
| iPhone SE | 375×667 |
| iPhone 15 / 15 Pro 页面尺寸 | 393×852；尺寸相同不代表系统安全区完全相同 |
| iPhone 15 Pro Max | 430×932 |
| iPhone 横屏 | 852×393、932×430 |
| iPad | 820×1180、1024×768 |
| 页面和操作 | 配置完整的虚构登录界面、底部滚动、聊天草稿、设置搜索、导航抽屉、记忆导航、虚构记忆编辑 |
| 自动断言 | 无文档横向溢出、无未捕获页面异常、文字输入字号至少 16px、核心触控目标至少 44px |
| 控制条件 | 模拟 visualViewport 收缩、模拟指定安全区值，检查输入框、弹层和发送区的位置及滚动可达性 |

测试不使用真实账号、聊天或模型接口。模拟键盘和安全区条件均明确标注，**不等同于实际 iOS 系统键盘或 Dynamic Island 硬件验收**。

本地证据位于 `artifacts/ios-phase2/`：

- `before/`：修复前截图与原有 23 项检查记录。
- `final/chromium-layout-report.json`：79 项完整矩阵结果及页面测量。
- `focus-reachability/chromium-layout-report.json`：35 项设置搜索框补充检查。
- `memory-theme/chromium-layout-report.json`：14 项记忆主题/编辑补充检查。
- `weather-targets/report.json`：两处天气按钮在三种尺寸的最终补验，均为 44×44px；这是对完整矩阵中尺寸建议项的修正。
- `final/chromium-iphone-se-login-scrolled-bottom.png`：小屏登录滚动到底部。
- `final/chromium-iphone-pro-max-landscape-chat.png`：Pro Max 横屏聊天。
- `memory-theme/chromium-iphone-se-memory-edit.png`：与应用一致主题的虚构记忆编辑。
- `focus-reachability/chromium-iphone-pro-max-landscape-settings-simulated-keyboard.png`：横屏设置与模拟键盘。

截图是本阶段的视觉检查证据；尚未建立第四阶段的自动基准图 Diff 门禁，不把“成功生成截图”表述成“视觉快照回归全部通过”。

## 代码与构建检查

- 现有 iOS 专项、登录界面、移动布局和视口测试通过。
- 原生动效相关回归 47 项通过。
- 前端构建通过，保留已有的大分块体积提示。
- ESLint 通过；最终提交的检查状态以对应 CI 记录为准。
- Playwright 固定为开发依赖 `1.62.1`，不再要求运行者碰巧拥有全局安装。

## 原生模拟器证据

本阶段新增 macOS 截图脚本和 CI 步骤：使用真实 iOS Simulator 启动 SE 第三代、iPhone 15 Pro、iPhone 15 Pro Max，采集原生竖屏画面，附设备类型、系统运行时、构建提交、PNG SHA256 等元数据。缺少设备类型或启动失败时必须失败，不会静默跳过。

脚本先检查模拟器平台、等待启动、安装并核对应用进程，再等待开场动画结束。它明确属于**截图采集**，不自动宣称布局正确，仍需检查实际 PNG。

前次原生运行 [#2](https://github.com/DengTaHome/dengta-home/actions/runs/42984273332) 的 Xcode 26.6 编译、iOS 专项测试成功，但 iOS 26.5 / SE 第三代首次启动在 `CoreLocationMigrator` 数据迁移期间触发原先 240 秒超时；当时尚未安装/启动 App，不能据此判断 App 闪退。随后将完整启动等待调至 660 秒，保留失败门禁，没有跳过目标设备或绕过迁移状态。

补跑 [#3：42985728913](https://github.com/DengTaHome/dengta-home/actions/runs/42985728913) **成功**：Xcode 编译、iOS 专项测试、三个设备启动与截图、产物上传全部通过。运行对应源分支提交 `b09a65d50b78c24235ceba2e10638df24f8a808d`；CI 实际构建的是 PR 合并提交 `5d7f7a8fecf919b546d9c72d21baafa547a1bf81`。使用 Xcode 26.6、iOS 26.5（23F77），产物平台为 `iPhoneSimulator`。

已下载并逐张查看 [原始截图产物](https://github.com/DengTaHome/dengta-home/actions/runs/42985728913/artifacts/13840402981)，核对三张 PNG 的尺寸及 SHA256 与 manifest 一致。便于直接查看的 [截图预览与来源记录](screenshots/ios-phase2/README.md) 已保留在代码库中。

| 设备 | 原始截图尺寸 | 本次画面检查 |
| --- | --- | --- |
| [iPhone SE 第三代](screenshots/ios-phase2/iphone-se-3-login-preview.png) | 750×1334 | 登录卡片、邮箱/密码框、主按钮正常显示；辅助入口在首屏下方，需要滚动 |
| [iPhone 15 Pro](screenshots/ios-phase2/iphone-15-pro-login-preview.png) | 1179×2556 | 登录控件和辅助入口正常显示，避开顶部灵动岛区域；底部隐私提示末尾超出首屏 |
| [iPhone 15 Pro Max](screenshots/ios-phase2/iphone-15-pro-max-login-preview.png) | 1290×2796 | 登录控件、辅助入口与底部隐私提示均可见，顶部灵动岛区域未遮挡控件 |

三张图均未出现空白页面或可见的应用崩溃画面。较小屏幕下，登录容器设计为内部滚动；**原生截图只记录初始位置，尚未自动验证原生滚动能到达下方入口**。已有浏览器滚动可达性结果不能替代这一项原生交互验证。

CI 中使用虚构公开配置，只能检查登录界面与原生容器，不能证明真实账号、聊天、记忆持久化或模型服务可用。以上是构建、启动和截图证据，**不等于第四阶段的 UI 自动交互测试或基准图 Diff 已通过**。实际原生滚动、键盘、横屏自动交互、完整账号流程与图像 Diff 仍待第四阶段验证。

## 复现本地尺寸检查

在 `frontend/` 目录先运行：

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

另一个终端运行：

```bash
IOS_TEST_SUITE=phase2 IOS_TEST_URL=http://127.0.0.1:5174 \
IOS_TEST_OUTPUT=../artifacts/ios-phase2/final npm run test:ios:layout
```

上述命令为 macOS/Linux shell 写法。脚本默认使用 `/usr/bin/chromium`，其他位置通过 `CHROMIUM_PATH` 指定；使用 Playwright WebKit 需要事先准备浏览器及系统依赖。本环境尝试 WebKit 后仍缺少 GTK4 等动态库，没有将它记为通过。

## 阶段边界

本阶段只完成屏幕、键盘、触控及对应验证。没有生成真机 IPA、没有签名，没有将 UserDefaults 迁移到 Keychain，也未宣称多账号私密数据已达到最终隔离标准。

用户已确认进入第三阶段 Keychain 与账号隔离，相关改造另行记录；本报告的原生补验不扩大为第三阶段安全验收结论。保留用户选择的全能签，最后处理签名。

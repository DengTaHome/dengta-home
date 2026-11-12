# iOS 适配改造清单

审计时间：2026-11-11。阶段：第零步、第一阶段。审计基线：`3401fb1ea7ad971df93015f9096af8539cfd9802`。

本清单记录已存在的能力、已核实的缺口与后续改造范围。本阶段没有实施 UI、Keychain 或 IPA 改造，也没有开始签名。

## 1. 工作区隔离与环境自检

用户指定路径为 `D:\LMKJ\dengta-ios\ios-agent`，但当前连接的执行环境是 Linux，没有挂载该 Windows 磁盘。因此不能声称已在用户电脑的 D 盘创建目录。

当前实际使用的独立副本为：

```text
/workspace/dengta-ios/ios-agent
```

副本通过 `git clone --no-hardlinks` 从已经提交的稳定版本建立。源码文件 inode 独立，Git 元数据独立；依赖在副本内单独安装，没有通过软链接共享原目录。沙盒的远程地址已指向 GitHub，避免后续误推送到本地原目录。分支为 `audit/ios-phase1`。

原目录 `/workspace/dengta-home` 的已跟踪文件、暂存区及工作区均未改变。本阶段只在沙盒内新增审计文档和安装依赖。

| 项目 | 已核实状态 |
| --- | --- |
| 当前操作系统 | Linux |
| Node.js / npm | 24.22.1 / 11.9.0，符合项目 Node 24.x 要求 |
| Capacitor CLI | 副本中安装成功，版本 8.4.3 |
| 锁定前端依赖 | `npm ci --prefix frontend` 成功 |
| React Native / Expo | 工程不使用这两套运行时，依赖和 CLI 均未配置；无需为了本项目强行引入 |
| 本地 `xcodebuild` / `xcrun` | 不存在，当前 Linux 不能运行 Xcode 或 iOS Simulator |
| GitHub macOS 构建 | 已核实 Xcode 26.6 模拟器编译成功，见下方实际运行记录 |
| 本地模拟器 UI 运行 | 未完成；不能将远程编译成功当作已启动 App 或已跑 UI 自动化 |

已成功的远程构建：[iOS simulator build #1](https://github.com/DengTaHome/dengta-home/actions/runs/42851275140)。其中 `Build unsigned simulator app` 成功，日志显示 Xcode 26.6 和 `BUILD SUCCEEDED`。这次运行没有生成可供 iPhone 签名的 IPA。

## 2. 实际技术栈与架构决定

这是 **React DOM / Web 应用 + Capacitor 原生容器**，不是 React Native，也不是 Expo。

| 层 | 实际依赖 / 文件 |
| --- | --- |
| 页面与状态 | React 19.2.7、react-dom，`frontend/src/*.jsx` |
| 打包 | Vite 8，`frontend/vite.config.js` |
| 原生容器 | Capacitor core / ios / CLI 8.4.3 |
| iOS UI 宿主 | WKWebView，`frontend/ios/App/App.xcodeproj` |
| 原生依赖管理 | Swift Package Manager，`frontend/ios/App/CapApp-SPM/Package.swift` |
| 认证 | `@supabase/auth-js`，`frontend/src/auth-session.js` |
| 服务端 | Express + Supabase，聊天使用 fetch SSE |

后续保留 Capacitor，以复用现有聊天、长期记忆、伴侣隔离和共同活动。安全区使用 CSS `env(safe-area-inset-*)` 配合原生 WebView；凭证采用 Swift Keychain 桥；原生 UI 自动化采用适用于 WKWebView 的 Appium / XCUITest。不直接套入只适合 React Native 的库，也不安排无必要的整应用重写。

## 3. 已有 iOS 基础

- 已有 iPhone / iPad Xcode 工程、Debug / Release 配置，最低 iOS 15.0。
- SPM 与 JS 侧的 Capacitor 版本一致。已有 App、Browser、Clipboard、LocalNotifications、Preferences 五个官方插件。
- `Info.plist` 已有 `dengta://` URL Scheme，以及麦克风、相机、相册、使用期间位置用途说明；未发现这几项基础权限声明缺失。
- AppDelegate 已转发深链事件；前端已有冷启动/热启动深链和去重逻辑。
- 已有 `viewport-fit=cover`、安全区 CSS、visualViewport 键盘控制及 iOS 输入字号修正。
- 已修正 iOS 调用 Android 网易云桥和 APK 更新路径的问题；录音支持 `audio/mp4` / M4A。

这些是现有基础，不能直接得出“已达到像素级适配、数据绝对隔离或可侧载”的结论。

## 4. 必须改造的缺口

### 4.1 凭证安全：尚未满足要求

证据：[`auth-native-storage.js`](../frontend/src/auth-native-storage.js) 第 14 行 通过 Preferences 保存完整登录会话；该插件在 iOS 使用 UserDefaults。原生存储异常后还会回退 localStorage。没有 Keychain 插件和访问等级策略。

后续必须：

- 将 iOS 登录 token 与账号加密密钥交给 Keychain，设置 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，禁止 iCloud 同步。
- 原生安全存储不可用时阻止持久登录，不降级写入 UserDefaults 或 localStorage。
- 设计旧凭证迁移和删除策略，避免迁移后残留明文副本；缺少归属证明的旧缓存不导入其他账号。
- UserDefaults 仅保留不敏感偏好；保留必要的隐私 API 声明，不能因为迁走 token 就误删仍被偏好插件使用的声明。

### 4.2 多账号隔离与退出：有基础，但仍存在缺口

| 发现 | 证据 | 后续要求 |
| --- | --- | --- |
| 通用账号存储主要靠 key 后缀隔离 | `account-storage.js:1` | 统一账号容器，不允许私密数据落入无账号默认空间 |
| 工作区缓存共用一个 IndexedDB 数据库 | `workspace-cache.js:4` | 按账号建立独立数据库或原生目录，并保留伴侣/会话子范围 |
| 聊天与草稿存入 localStorage | `chat-history-cache.js:26`、`chat-draft.js:1` | 将私密缓存纳入独立账号存储与统一清理清单 |
| 消息引用和会话模型字典缺少账号范围 | `message-reference.js:148`、`chat-models.js:84` | 增加账号/伴侣归属，禁止无归属迁移 |
| 全局 GET 合并请求的 key 缺少账号 | `api.js:62` | 合并 key 必须包含请求时的账号、伴侣和会话代次 |
| 响应返回后直接更新当前伴侣 | `api.js:150` → `auth-session.js:499` | 返回时重新检查请求身份；账号 A 的迟到响应不能更新账号 B |
| 退出未统一清空本地缓存 | `auth-session.js:421` | 退出、认证失效和账号切换统一协调 Keychain、内存、请求、文件和缓存清理 |
| 组件卸载会保存草稿 | `use-chat-draft.js:12` | 清理前停止写入并使旧写入失效，避免删除后又写回 |

以上请求竞态是源码审计发现的具体风险路径，不代表已经观测到真实用户数据泄露。本阶段不使用真实账号做破坏性验证。

现有按账号/伴侣重挂载业务界面、请求刷新范围检查与私有媒体卸载清理仍应保留。它们不能代替上述完整隔离。

### 4.3 屏幕与键盘：需要原生设备矩阵验收

现有 CSS 和 visualViewport 方案可以继续使用，但之前的 Chromium 尺寸模拟不等同于 iOS 安全区、Dynamic Island 或系统键盘验证。

第二阶段计划验证 iPhone SE、iPhone 15、iPhone 15 Pro、iPhone 15 Pro Max；覆盖竖屏、横屏、键盘开合、长文本、弹窗、聊天输入、底部导航和图片预览。第四阶段在实际 Simulator runtime 上执行交互及快照对比，记录设备类型、系统版本和安全区。

布局使用响应式 CSS Grid / Flex 和安全区变量；测试中的设备尺寸参数不写入业务页面的固定宽高。输入字号、动态字体、滚动与焦点需要一起检查。

### 4.4 登录深链：需要增加竞态回归

`auth-session.js:556` 先等待 `setSession`，然后才设置密码恢复状态；SDK 在中间发出登录事件时可能短暂发布普通登录态。`main.jsx:62` 的冷启动 URL 获取与 AuthGate 挂载也并行。

后续应保证密码重置回跳不会先进入普通聊天界面，并将过期/拒绝回跳转为可理解的提示；无效链接不能破坏已有合法会话。测试覆盖冷启动、热启动、重复回调、过期链接及 SDK 事件顺序。

### 4.5 自动化：当前没有完整原生 UI 与视觉对比流水线

- `package.json` 未声明 Appium、Detox、Playwright 或视觉快照对比工具。
- 现有浏览器脚本使用环境提供的 Playwright，能够截图和检查溢出，但**没有基准图比较与 Diff 门禁**。
- 未发现已跑通的 Appium / XCUITest 登录、发消息、切账号、记忆和朋友圈流程。
- 后续采用 Appium / XCUITest 检查原生容器与 WebView；固定虚构测试账号和受控 API，避免测试污染生产聊天。
- 快照必须覆盖聊天、记忆、设置。保存基准、实际图、差异图及统计结果；首次生成基准不能自动当作布局正确，不能通过随意更新基准掩盖差异。
- 增加 Keychain 失败、锁屏、离线退出、账号切换期间迟到响应、退出后的延迟写回等回归。

### 4.6 构建与侧载：只有模拟器构建，缺真机 IPA

当前 `.github/workflows/ios.yml` 只构建 `Debug` + `generic/platform=iOS Simulator`，使用虚构服务配置，也没有上传 IPA。模拟器的 arm64 产物不能通过手机签名变为真机应用。

第五阶段需增加：

- 真机 `Release` / `iphoneos` 无签名构建，使用经过校验的实际公开服务配置；编译用占位配置不能作为可用 App 交付。
- 验证 App 和嵌入二进制的 iOS 平台、arm64 架构、资源完整性；不能只靠文件名或 arm64 判断真机。
- 打包标准 `Payload/App.app`，保留可执行权限，生成 IPA、SHA256 和不含秘密的构建清单，并提供下载方式。
- 最后再处理签名。保留用户已选择的**全能签**，不要求现在提供 Apple ID、证书密码或签名材料。
- 全能签需要有效证书和对应描述文件；不能承诺只输入免费 Apple ID 就可在任意手机签名工具完成安装。届时提供 AltStore/SideStore 免费签名路径与全能签导入路径，并解释适用的 7 天有效期、续签及常见同时安装数量限制。

## 5. 核心文件改造清单

以下是计划，不是已完成修改。具体拆分可在实施中按最小必要范围调整。

| 阶段 | 修改已有文件 | 计划新增文件 / 目录 |
| --- | --- | --- |
| 第二阶段：UI | `frontend/src/ios.css`、`mobile-viewport.js`、`main.jsx`，以及实际发现问题的聊天/导航/弹层样式 | 设备矩阵及 UI 验收场景 |
| 第三阶段：安全存储 | `frontend/src/auth-native-storage.js`、`auth-session.js`、iOS 工程注册与启动宿主 | Swift Keychain 插件、JS 安全存储适配器、迁移测试 |
| 第三阶段：账号隔离 | `api.js`、`api-get-cache.js`、`account-storage.js`、`chat-history-cache.js`、`chat-draft.js`、`use-chat-draft.js`、`workspace-cache.js`、`message-reference.js`、`chat-models.js`、相关私有媒体与页面调用点 | 账号容器、退出协调器、请求身份代次与存储清理回归 |
| 第四阶段：原生与视觉测试 | `frontend/package.json`、锁文件、`verify-ios-browser.mjs`、相关 CI | Appium 配置、UI 场景、快照基准/对比器、报告和独立 macOS UI workflow |
| 第五阶段：打包 | `.github/workflows/ios.yml`、`verify-ios-env.mjs`、构建文档 | 未签名 IPA 打包/验证脚本、产物清单、手机安装与续签指南 |

Swift Keychain 插件需进入 Xcode Sources 并通过 Capacitor 注册。当前 Info.plist 的基本权限已经存在；按实测补充必要配置，不增加与功能无关的敏感权限。Keychain 不使用共享组时不应为了存储 token 盲目开启 Keychain Sharing，避免引入免费个人签名不支持的额外能力。

## 6. 本阶段实际验证与待验证项

本阶段在独立副本执行：

1. `npm ci --prefix frontend`：成功。
2. `npx cap --version`：8.4.3。
3. `npm ls --depth=0`：已核对主要版本；输出有一个 sharp 的可选 WASM 包标为 extraneous，本阶段不据此改锁文件。
4. `npm run test:ios`：现有 3 个测试文件通过，0 失败；这不是原生 UI 自动化或 Keychain 验收。
5. 原目录 Git 状态复核：干净，没有源码修改。

此外已读取既有 GitHub CI 记录：前端 job 和 Xcode 模拟器 job 成功；总体 CI 的后端迁移测试和公开发布审计失败。前者存在测试预期停留在 064、实际迁移到 069 的已知基线问题，后者包含既有发布文件/内容规则问题；不能把总体 CI 宣称为全绿。后续需单独核查、修复或准确说明，而不是关闭检查。

仍未验证：iOS 原生启动与完整 UI 交互、物理安全区和软键盘行为、Keychain 策略、多账号完整隔离、视觉基准 Diff、真机 Release 构建、IPA、免费 Apple ID 签名和全能签安装。当前不声称已完成这些目标。

## 7. 阶段边界

第零步与第一阶段在当前可访问的 Linux 独立工作区完成；用户指定的 Windows 目录尚未访问。本阶段只交付审计与清单。

**等待用户确认后才进入第二阶段。第三、第四、第五阶段也各自等前一阶段确认；不提前实施 Keychain、UI 重构、打包或签名。**

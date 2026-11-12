# 灯塔 iOS 云端开发交接：供用户的本地 GPT 继续执行

交接日期：2026-11-12。**这是未完成工程的真实交接，不是“已可安装”的交付声明。**

## 先看这五点

1. 工作发生在云端 Linux 工作区 `/workspace/dengta-ios/ios-agent`，没有写入用户电脑。用户只知道文件在 D 盘，具体工作区未知；**不要假定 `D:\LMKJ`、`D:\LMKG` 或其他目录，不要要求用户先找出路径。** 由本地 AI 只读定位现有项目，检查版本、Git 状态和未提交工作后，在独立副本或工作树导入本交接包。
2. 实际技术栈是 **React DOM / Vite / Capacitor 8.4.3**，不是 React Native 或 Expo。不要把 RN/Expo 依赖直接装进来，不要为适配 iOS 重写整个应用。
3. 第一、第二阶段已做；第三阶段的安全实现和大量测试已完成，但**第三阶段尚未通过原生启动验收**。当前最高优先级是修复模拟器签名后的启动问题，下面有准确证据。
4. **目前没有可安装到 iPhone 的设备版 `.ipa`，也没有设备版 `.xcarchive`、用户证书或描述文件。** 源码、ZIP、文档、截图和 Simulator `.app` 均不需要用户签名，不能把模拟器程序改后缀当作 iPhone IPA。
5. 用户已经选定手机上的 **全能签**，签名留在最后。先完成原生验收与设备 Release 构建，再把真正的设备 IPA 交给用户。不要再次询问签名工具，不要索要 Apple ID 密码或在聊天中索要证书私钥。

用户要求每阶段结束后等其确认。第三阶段未通过的修复仍在已授权范围；新增候选插件、第四阶段和第五阶段继续遵守用户确认契约。用户最新意图是把云端成果交给本地 AI，云端不再扩展产品开发。

## 版本与源码来源

| 项目 | 值 |
| --- | --- |
| 主仓库 | <https://github.com/DengTaHome/dengta-home> |
| Draft PR | <https://github.com/DengTaHome/dengta-home/pull/1>，未合并 |
| 远端开发分支 | `codex/ios-adaptation` |
| 本次代码头 | `70b407d2fad356934a85ab8ff28a4527db2b79da` |
| 公开基线 | `77472defa5db873ba07d48e3f8b4149d3b278daa`，公开版本 `2.10.74` |
| 云端隔离副本 | `/workspace/dengta-ios/ios-agent`；本地分支历史名 `ui/ios-phase2`，不能仅凭分支名判断进度 |
| 云端原始副本 | `/workspace/dengta-home`，未直接修改 |
| CNB | <https://cnb.cool/dengtahome/dengtahome> |

CNB `frontend-main` 与 GitHub 私有前端主分支曾核对到同一提交 `f8fa26aed2bdff46505b32a0115952fa3b92c896`，版本 `2.13.43`；本工程保留公开 `2.10.74` 基线做选择性适配，没有整包覆盖为私有新版。来源比较见 [phase2-repository-sources.md](phase2-repository-sources.md)。

**本地导入规则：** 若本地已在 `2.13.43` 或另有并行修改，不可整目录覆盖。先备份/建分支，识别共同基线，用本包修改清单或补丁做三方合并；没有共同基线时逐模块移植。任何清理命令只作用于本次生成的副本和可重建缓存，不删除用户原项目、证书或 `.env`。

重要提交顺序：

| 提交 | 内容 |
| --- | --- |
| `3401fb1` | 初始 Capacitor iOS 工程、原生能力兼容及文档 |
| `3f1b5f0`、`b09a65d` | 安全区、可视视口/键盘、尺寸验证与原生截图流水线 |
| `4a10172` | Keychain、账号加密缓存、退出清理和请求隔离 |
| `0e8368e` | 修复 Swift fixture 对文件别名路径的核对，未弱化文件保护策略 |
| `94e4c0e` | 共享 GET 的最后调用者取消/重连修复，补业务测试夹具 |
| `600b797` | 页面和业务诊断绑定本轮登录，阻断 A→B→A 旧回调 |
| `6e50a0e` | 修复异步返回 Capacitor 插件代理造成的加载挂起，新增实际登录页 OCR 门禁 |
| `70b407d` | CI 专用真实 Keychain 探针、无签名/模拟器 ad-hoc 身份对照；此尝试仍有启动阻断 |

## 已完成的工程工作

### 第一阶段：审计与原生工程

- 已梳理公开仓库、CNB 分支和新版前端差异，确认架构和核心业务。
- 新增 `frontend/ios/App/App.xcodeproj`，使用 Swift Package Manager 集成 Capacitor；不是 CocoaPods/RN 工程。
- 配置 app 图标、启动资源、Info.plist、PrivacyInfo、URL scheme 和原生宿主。
- iOS 最低部署版本为 15，当前 CI 使用 Node 24、Xcode 26.6、iOS 26.5 Simulator。先以仓库配置和当前安装的 SDK 为准。
- Android 专属音乐、浏览器、更新 APK 等能力已做平台判断；iOS 不应调用这些 Android 插件。
- 保留 POST + fetch 的自定义 SSE 流式协议，没有开启全局 `CapacitorHttp` 接管。

### 第二阶段：布局与交互

- `ios.css`、`mobile-viewport.js` 处理顶部刘海/灵动岛、底部 Home Indicator、可视视口变化、输入控件字号和关键触控目标。
- AuthGate 与 App 共享有引用计数的 viewport 控制器，避免重复监听与卸载互相破坏。
- 键盘打开时收起状态叠层，处理聊天输入与设置覆盖层；横屏抽屉和小屏登录滚动已补验。
- 七种尺寸的 Chromium 模拟矩阵曾通过 79 项检查，另有搜索可达性、记忆主题和天气触控补验。它们是浏览器/安全区数值模拟，**不能称为真实 iOS 键盘或视觉基准 Diff**。
- 第二阶段提交 `b09a65d` 的三机原生登录截图成功并人工查看，预览在 `docs/screenshots/ios-phase2/`。小屏下方辅助项需要滚动；未完成原生滚动自动测试。

### 第三阶段：凭证、账号缓存及生命周期

- Swift `DengTaKeychain`：只允许三个认证 key；`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，不启用 iCloud 同步或生产共享访问组；失败不回退 iOS 明文存储。
- 旧 Preferences/localStorage 认证项迁移：Keychain 优先，验证写入再擦除旧副本，失败保持封闭；错误和桥接日志不输出凭证。
- Swift `DengTaAccountVault`：账号哈希独立目录、每账号独立 256 位 Keychain 密钥、AES-GCM 和账号绑定认证数据；文件完全保护、排除备份，清理优先销毁密钥。
- `account-cache-vault.js`：原生同步内存镜像，挂载业务页前异步准备；每次登录捕获独立存储访问对象。旧 A 的对象在退出后不能读写新 B 或重新登录的 A。
- `auth-storage-lease.js`：旧 SDK 存储访问立即失效，排空已开始的操作后清理，阻止迟到刷新写回/删除新账号凭证。
- `auth-session.js`、`AuthGate.jsx`：账号轮次、清理屏障、初始化竞态、旧 SDK 监听、并发登录、离线退出与失败重试；同账号快速退出重登也重新挂载业务状态。
- 缓存准备后恢复所选伴侣，正常 token 刷新或伴侣变化不重置账号准备边界。
- API 按账号、伴侣和版本隔离缓存与共享请求，正文/流式读取也检查作用域；最后一个 GET 调用者取消会中止并移除旧请求，重新连接可新建请求。
- App 的草稿、聊天历史、模型、引用、心声、共同活动、音乐回执、导入回执等接入捕获的账号存储；新旧登录的诊断记录分离。
- 首次 iOS 准备清理识别到的旧明文缓存、当前账号旧工作区行和无归属 v1 缓存，不把未知资料分配给第一个账号；不删除服务器聊天与记忆。
- 退出停止语音、清理已注册的内存状态和本机缓存。远程撤销针对旧设备会话，尽力执行；离线不能保证服务端立即撤销。
- 原生缓存限额每账号 2 MiB；超额拒绝缓存写入，不截断资料或转存明文。工作区可显示缓存失败，部分可重建读缓存降级在线加载。

这些实现不等于第三阶段已经验收完毕。下面的原生运行阻断仍必须解决。

## 测试证据与明确未通过项

不要把不同提交、模拟器、真实设备或重复子套件的数量相加，声称一个新的“总通过率”。历史报告用于追溯；本节和交接包中的最后证据优先于旧报告的等待状态。

| 检查 | 已知真实结果 |
| --- | --- |
| 完整前端 `npm test` | 在 `600b797` 诊断修复候选上从头到尾完成，退出码 0，包含 pretest 和完整主测试链；不是拼接部分结果。对应日志由交接包保留。 |
| 前端 GitHub CI | `6e50a0e` / [CI run 43168863745](https://github.com/DengTaHome/dengta-home/actions/runs/43168863745) 的前端 job `131017063236` 全部成功，包括测试、集成、构建、lint/typecheck 等。 |
| 账号专项 | `70b407d` / 原生 run #9 中 **23/23 文件、157/157 命名用例，另 2 个断言脚本通过**。先前 `6e50a0e` 为 156 项；增加的 1 项是 CI 诊断安全 schema 检查。 |
| iOS 专项 | 同一 run #9 **51/51** 通过。这里包含工程和 JS 检查，不能替代真实 Keychain/真机验证。 |
| Swift fixture | Keychain 策略和注入 Security 失败处理、真实 CryptoKit 加解密/账号隔离/篡改检查，已在 macOS CI 执行成功。注入 Security 的 fixture 不是真实 iOS Keychain 往返。 |
| Xcode 编译 | run #9 的 Xcode 26.6 Simulator Debug 编译成功。设备 Release 尚未构建。 |
| 原生实际启动 | **当前失败，见下一节。不能称模拟器安全版已可用，更不能称真机可用。** |
| 原生 UI / 视觉基准 | 第四阶段未实施完整登录、发送、切账号、朋友圈自动操作；没有聊天/记忆/设置三机基准 Diff 验收。 |
| 后端全部 `npm test` | 原有迁移断言仍要求 `064_stream_partials.sql`，实际最新为 `069_channel_sync_hardening.sql`。曾在原始基线独立副本复现；本次没有修改 SQL/后端。 |
| public-release-audit | 基线已跟踪 `tools/kiwi-deploy/p1-bundle.tar.gz`，违反仓库发布审计的压缩包规则；另有既有审计项。整体 CI 不是全绿，勿归因于或掩盖为已修复。 |

### P0：原生安全存储与模拟器签名启动阻断

1. 安全实现早期的三机截图只显示“正在找回你的家”。已定位到 `auth-native-storage.js` 中异步函数直接返回 Capacitor `Preferences` Proxy：Promise 将 Proxy 的虚构 `then` 当作 thenable 等待，导致初始化永久挂起。`6e50a0e` 已改为返回普通 `get/set/remove` 方法适配器，并增加真实 Capacitor Proxy、Android 存储、真实 GoTrue 匿名启动回归。不要改回异步返回 Proxy。
2. 新增 Mac Vision OCR 门禁后，[run #8：43168863750](https://github.com/DengTaHome/dengta-home/actions/runs/43168863750) 确实退出加载，但 SE 登录页显示“安全登录存储暂不可用”。门禁正确返回 `auth-error / secure-storage-unavailable`，未把错误页计为通过。
3. [run #9：43242777530](https://github.com/DengTaHome/dengta-home/actions/runs/43242777530)，源码头 `70b407d`，实际 PR 合并提交 `8ee11bb16090c943124c6298014544aca905d1cf`，取得以下真实证据：
   - 无签名启动收据中，`bridge-keychain-available`、`bridge-vault-available`、`protected-data-available` 均存在。
   - 临时独立 Keychain probe 的 add/read/delete 都是 **OSStatus `-34018` (`errSecMissingEntitlement`)**，`probe-roundtrip.verified` 为 `false`。
   - 这证明已有原生桥可见，但无签名 Simulator 进程缺少 Keychain 访问身份。Apple 依据：[errSecMissingEntitlement](https://developer.apple.com/documentation/security/errsecmissingentitlement)、[DTS 排查说明](https://developer.apple.com/forums/thread/114456)。
   - 新增的 `sign-ios-simulator-ci.sh` 使用虚构前缀 `DENGTACI00` 做 Simulator 专用 ad-hoc 身份；脚本成功生成并核验 `simulator-ci-signature.json`。
   - **重新安装后，签名程序没有启动成功**：`simctl launch` 返回 `FBSOpenApplicationServiceErrorDomain` code 1，`SBMainWorkspace` 拒绝请求。不得据 codesign 校验成功就声称签名或 Keychain 问题解决。
   - 没有 signed 运行收据、没有此轮新截图；manifest 为 `capture-failed`，`devices: []`，失败阶段 `iphone-se-3:install-and-launch`。
4. 关键证据在 `artifacts/ios-native-43242777530/`；GitHub 原生 artifact `13956406530`，安全用例 artifact `13956501298`。Artifacts 有保留期限，优先使用交接包副本。

**建议本地 AI 下一步：** 在 Mac/Xcode 或 macOS CI 中，用标准 Xcode Simulator ad-hoc 构建设置验证自动生成的权限和可启动签名，优先评估 `CODE_SIGNING_ALLOWED=YES` / Simulator 本地身份 `CODE_SIGN_IDENTITY=-`，对照 Xcode 产生的签名、Mach-O 主程序与 Debug dylib、嵌套 framework 和系统启动日志。不要把手工虚构权限抄到设备 Release；手工重签失败的具体原因尚未确认，不能把建议写成已验证修复。

保留 `DEBUG && targetEnvironment(simulator)` 且显式 `--dengta-ci-keychain-diagnostics` 的探针限制。收据只允许固定阶段、整数 OSStatus 和往返布尔值；不写 key/token/账号/原生路径。临时 probe 使用独立 service、随机临时 item，最后删除，不能触碰三个真实认证 key。达到以下条件才能关闭 P0：

- 程序确实能启动；真实 Keychain add/read/delete 全部 status 0，verified true。
- 加载完成并到达正常登录表单，不能是错误页或加载页。
- SE、15 Pro、15 Pro Max 三种设备的 readiness、尺寸、SHA 和画面检查通过；真实锁屏与 iPhone 仍另测。
- 安全策略、日志关闭及 iOS 不回退明文的规则保持不变。

## 尚未完成的其他事项与执行顺序

### P1：确认退出后的系统通知清理

只读研究发现 `App.jsx` 和 `companion-reply-notifier.js` 有 `LocalNotifications.schedule`，而统一退出清理未明显见到 pending/delivered 通知的取消与清除。这是**待复现的隐私疑点，不是已证明泄露**。验证 A 账号已排程/已投递通知在退出、切到 B 后是否仍显示，旧通知点击是否可能打开 A 的会话。若属实，接入账号拥有的通知 ID、取消排程/已投递清理和点击作用域校验，并补真实 iOS 回归。不要简单清除 B 的通知或只靠组件卸载。

### P2：完成第四阶段原生 UI 与视觉测试

- 使用 Appium + XCUITest 的 WKWebView/native context 等适合 Capacitor 的方式；Detox 的 RN 方案不能直接套用。
- 确定可控测试账号/后台或完全隔离的测试服务，记录测试配置，不把虚构数据验收说成生产模型调用已跑通。
- 核心流程：登录、消息发送/流式回复、取消/重试、A→B→A、记忆、设置、朋友圈、退出；覆盖离线、锁屏、后台恢复、通知和语音中断。
- 设备至少覆盖 iPhone SE 第三代、iPhone 15、iPhone 15 Pro Max；保留 15 Pro 的 Dynamic Island 补验。避免将型号变化隐藏为“等价”。
- 对聊天、记忆、设置建立经人工审阅的真实 Simulator 截图基准，固定字体/主题/时间/测试数据，执行 image diff 并解释差异。已有 OCR 只证明登录标签出现，不是像素级视觉通过。

### P3：设备 Release、IPA 与全能签

先等用户确认第五阶段。Windows 本地 AI 可以继续修改、跑 JS 测试和触发 GitHub Actions；**Xcode 和 iPhone 设备构建需要 Mac 或 macOS runner**，不能靠在 Windows 安装几个 npm 包替代。

设备构建方向（交给本地 AI 执行，用户无需输入这些命令）：

```bash
cd frontend
# 先用正确公开配置执行 ios:prepare；不要把虚构 CI 地址用于交付。
npm ci
npm run ios:prepare
DENGTA_DEVICE_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/dengta-device-build.XXXXXX")"
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$DENGTA_DEVICE_BUILD" CODE_SIGNING_ALLOWED=NO build
```

打包前必须检查产物来自 `Release-iphoneos`，平台为 iOS、架构含真实设备 arm64，**不是 `iphonesimulator`**。将设备 `.app` 正确放在 `Payload/App.app` 后打包为未签名 IPA，保留实际构建 SHA、版本、平台与文件 SHA256；或交付真实设备 `.xcarchive`。若使用 `xcodebuild -exportArchive`，其签名/描述文件要求需按实际渠道配置，不能承诺无证书必定导出。

最后给用户的手机步骤应是：把**真正的设备 IPA**保存到 iPhone“文件”→分享/导入全能签→选择合法有效且匹配的证书与描述文件→签名→按工具安装指引安装。全能签不是证书来源的保证，不能承诺它仅凭 IPA 就能在手机上生成免费 Apple ID 签名。不要把模拟器的 `DENGTACI00` 身份带入设备 IPA。

免费个人 Apple ID 经相应侧载渠道通常有 7 天有效期和最多 3 个同时激活应用等限制；全能签实际有效期取决于所用证书和描述文件，并不一律等于 7 天。AltStore/SideStore 的续签条件与全能签不同；最终指南以实际选用的合法签名渠道和当时官方说明为准。

## 关键文件与不能破坏的契约

| 范围 | 入口 |
| --- | --- |
| 工程/原生桥 | `frontend/ios/App/App.xcodeproj/project.pbxproj`、`Base.lproj/Main.storyboard`、`DengTaBridgeViewController.swift` |
| 原生凭证 | `DengTaKeychainStore.swift`、`DengTaKeychainPlugin.swift`；不要放宽访问等级、云同步或 key 白名单 |
| 加密账号文件 | `AccountVaultStore.swift`、`DengTaAccountVaultPlugin.swift` |
| JS 凭证与会话 | `auth-native-storage.js`、`auth-keychain-storage.js`、`auth-storage-lease.js`、`auth-session.js` |
| 挂载/缓存/退出 | `AuthGate.jsx`、`account-cache-vault.js`、`account-cleanup.js`、`account-storage.js`、`workspace-cache.js` |
| 业务接线 | `App.jsx`、`Together.jsx`、聊天缓存/草稿/引用/心声、导入与语音模块 |
| 请求与诊断 | `api.js`、`api-get-cache.js`、`settings-save-scope.js`、`operation-diagnostics.js` |
| 屏幕与深链 | `ios.css`、`mobile-viewport.js`、`native-app-runtime.js` |
| CI/测试 | `.github/workflows/ios.yml`、`verify-ios-security.mjs`、`capture-ios-simulator-layout.sh`、`native-ios-login-readiness.swift`、`sign-ios-simulator-ci.sh`、两套 `test-ios-*-native.sh` |

- 原生账号容器必须准备好才挂载 App；不得用未准备的全局 localStorage 兜底，也不要全局替换 `window.localStorage`。
- 保留账号激活轮次、可撤销存储访问和请求正文校验；只有 UID 前缀无法防同账号重新登录的旧回调。
- 所有异步诊断生产者在请求开始捕获 ticket，不能等错误回来后重捕获；raw scope 的 fail-closed 不可改成盲目恢复。
- 普通 EventSource 只有 GET，灯塔聊天是带附件/幂等元信息的 POST 自定义 SSE；不要全局启用 CapacitorHttp 或自动重发 POST。
- `capacitor.config.json` 的 `ios.loggingBehavior: none` 和原生 `CAPLog.enableLogging = false` 用于避免桥接响应泄露 token；调试不能打开全量响应日志。
- Supabase 前端只能放公开 URL 和 anon/publishable key，绝不能放 service-role/secret；生产配置应由已有安全环境或 CI Secrets 提供。交接包没有用户密码、证书或生产私钥。
- 服务器长期记忆与手机本机缓存是两个层次；已有 Kiwi/Ombre、上下文预算/压缩、RP 提示词和情绪 TTS，不要因调研候选库而从零替换。

## 本地接手的最短执行清单

1. 阅读本文及交接包的文件清单、未完成事项和证据。确认没有需要用户现在签名的设备 IPA。
2. 只读定位 D 盘现有工作区，记录 Git/版本/未提交修改，建立隔离导入点；用户本地 GPT 已在并行工作，优先合并而非覆盖。
3. 用 Node 24 在 `frontend` 执行依赖安装与专项检查。源码包不含 `node_modules`、构建缓存或云端 Linux 专属工具，它们可重建。
4. 修复 P0，复用已有探针与 OCR 门禁取得真实原生证据；不要跳过失败门禁或把加载/错误页作为基准。
5. 校验通知清理疑点，更新第三阶段报告，向用户报告确切通过/失败范围并等待阶段确认。
6. 把调研快照整理为最终选型报告，请用户确认候选插件，再实施获批项；第四、第五阶段按上述次序推进。

常用复现命令：

```bash
cd frontend
npm ci
npm run test:ios:security
npm run test:ios
npm run test:auth-session
npm run test:auth-gate
npm run lint
npm run typecheck
npm run build
npm test
```

原生步骤只在 Mac 执行：

```bash
cd frontend
bash scripts/test-ios-keychain-native.sh
bash scripts/test-ios-account-vault-native.sh
# 设置公开构建配置后执行，不将密码或 service-role key放在前端。
npm run ios:prepare
```

云端曾有两项环境坑，仅供复现排障：沙盒下 Node 子进程可能 EPERM，不能把空文件级结果当用例通过，专项 runner 已检查实际摘要；大量 Vite SSR 临时 `node_modules/.vite/deps_temp_*` 可占满磁盘，测试结束后只清本次副本可重建缓存，原始仓库不动。不要为了这些云端限制修改业务逻辑。

## 开源调研交接状态

交接包含两份 `dengta-opensource-memory-research.md`、`dengta-opensource-ios-research.md` 快照，均已停止新检索。它们不是用户批准的最终选型，也没有安装相应插件。

- 记忆/陪伴快照覆盖 7 个项目，包含 AIRI、SillyTavern、Mem0、Memobase、Graphiti、Letta 等的一手仓库/许可/隔离与维护事实。AIRI 的 Stage Pocket 同样使用 Capacitor，可参考，但整个应用及其模型资源不能当轻量插件复制。
- iOS/流式快照覆盖 13 项候选，包括官方 Capacitor Keyboard/Haptics、SSE 解析/传输、AI SDK 7、RN 参考库、语音等。注意当前 SPM 工程与社区 STT 插件的集成差异。
- X/Twitter 的官方页面访问返回 403，相关严格检索未取得可用原帖；快照明确该限制，没有假称读取作者时间线，也不以第三方转帖代替源码依据。
- 不编造精确 IPA 增量。服务端记忆库不会直接增加手机包体，但会增加服务端部署/推理成本；前端依赖需用相同设备 Release 配置实际比较。

用户期待收到可审阅的推荐方案，而不是被要求决定底层架构。优先保留现有 Capacitor 与已做的安全边界，给出大白话的用途、适配性、代价和推荐项；确认后才接入。

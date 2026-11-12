# DengTa iOS 版交接文档（给接手的 AI/GPT）

> 交接日期：2026-11-12（Asia/Shanghai）
> 目标：让一个没有本对话上下文的 AI 能独立找到工作区、登录网站、理解权限边界、在 macOS 上创建 iOS 版，并知道哪些能复用、哪些必须重做。
> **本文件不包含密码、token、Cookie 值。** 网站账号密码和本机凭据位置在另一份私有文件：
> `D:\GZdeepseek\_credentials\IOS-DENGTA-PRIVATE-ACCESS.md`
> 不要把私有文件复制进任何 Git 仓库、聊天记录或公开文档。

---

## 0. 先读这一段（给接手的 AI 的操作约束）

1. **生产 Web/PWA/Android 的源码在 `_refs`，不是 `dengta-home`。**
   - 前端：`D:\GZdeepseek\_refs\frontend-gh`
   - 后端：`D:\GZdeepseek\_refs\backend-prod`
   - `D:\GZdeepseek\dengta-home` 是汇总/文档/备份仓库，旧版代码副本只在 `dengta-home\frontend`、`dengta-home\backend`，**不要拿它做 iOS 源**。
2. **iOS 工程目前不存在。** `frontend-gh` 里只有 `android/`，没有 `ios/`。
3. **Windows 不能构建 iOS。** 当前机器没有 Xcode、没有 macOS、没有 Apple Developer 账号。iOS 必须使用 Mac（或 macOS CI）和 Apple 开发者签名。
4. **不要碰生产数据/生产环境**，除非用户明确授权；默认只在分支/PR/模拟器/TestFlight 工作。
5. **不要用成年内容直接冲 App Store**。DengTa 是成人向伴侣产品，Apple 明确禁止露骨性内容；先读第 8 节，决定做 SFW 版、TestFlight 还是 PWA。
6. **网站测试账号是 owner 角色**，权限很大；只用于登录/查看自己的数据，不要用它改生产配置。
7. 任何 token/密码都只从私有文件/环境变量读取，不写进代码、不截图、不提交。

---

## 1. 工作区地图：哪里是什么

```
D:\GZdeepseek\
├── _refs\
│   ├── frontend-gh\              ★ 生产前端源码（React 19 + Vite + Capacitor Android）
│   │   ├── src\                  UI/逻辑（App.jsx、api.js、ChannelHub、AppUpdateCenter...）
│   │   ├── public\               PWA、download.html、updates feed
│   │   ├── android\              Android 原生壳（Java 插件、Gradle、签名）
│   │   ├── scripts\              build/CSP/发布脚本
│   │   ├── test\                 前端回归测试
│   │   ├── .env.production       生产构建公开配置
│   │   ├── capacitor.config.json Capacitor 配置（目前只有 Android 平台）
│   │   └── vercel.json           Vercel 构建/CSP/rewrite
│   └── backend-prod\             ★ 生产后端源码（Node 24 + Express 5 + Supabase）
│       ├── server.js             主应用/路由/聊天/工具
│       ├── routes\               路由
│       ├── services\             业务/Provider/记忆/语音/创作/通道
│       ├── supabase\             SQL 迁移
│       ├── test\                 后端测试
│       ├── .env.example          环境变量说明
│       └── render.yaml           Render 部署描述
├── dengta-home\                  ★ 文档/汇总/备份仓库（不是 iOS 源码）
│   ├── docs\                     交接文档、审计、架构、ledger
│   ├── backend\                  旧版汇总后端副本（不要作为 iOS 后端源）
│   ├── frontend\                 旧版汇总前端副本（不要作为 iOS 前端源）
│   ├── tools\                    repo-watch、QQ/微信桥脚本
│   └── _audit\                   历史审计（体积大，非源码）
├── _credentials\                 ★ 本机秘密（不进 Git）
│   ├── dengta-credentials.json   GitHub/Vercel/Render/Supabase/账号/VPS 凭据
│   ├── dengta-account-session.json  DengTa 登录会话
│   ├── snowluma.json             QQ 网关
│   └── wechat-dengta-bridge.json 微信桥
├── _tools\
│   ├── node\                     Node 24
│   ├── jdk21\                    Java
│   ├── android-sdk\              Android SDK
│   └── pw\                       Playwright（浏览器/多视口验证）
├── apk-build\                    Android 构建工作区
├── backup\                       唯一 Git bundle 备份
└── _audit\                       测试日志/截图（可能含隐私，勿外传）
```

### 1.1 当前生产版本（交接时）

| 项 | 值 |
|---|---|
| Web/PWA | `https://www.dengtahome.com`（Vercel） |
| 后端 | `https://dengta-home-backend-rkmq.onrender.com`（Render） |
| 前端 main | `f8fa26ae`（QQ 云接入合并后的生产基线） |
| 后端 main | `b1d60630`（QQ 云接入合并后的生产基线） |
| Android | 2.13.52 / versionCode 310 |
| APK 更新 feed | `https://www.dengtahome.com/updates/android.json` |
| Supabase | ref `nyyqizwrlmejpfdhgrnd` |
| 前端仓库 | `https://github.com/DengTaHome/dengta-home-frontend` |
| 后端仓库 | `https://github.com/DengTaHome/dengta-home-backend` |
| 文档仓库 | `https://github.com/DengTaHome/dengta-home` |

**iOS 从 `frontend-gh` 的 main 拉分支；不要从 `dengta-home/frontend` 拉。**

---

## 2. 网站登录与账号

- 网站：`https://www.dengtahome.com`
- 测试账号：`2458077782@qq.com`（owner 角色）
- 密码：见 `D:\GZdeepseek\_credentials\IOS-DENGTA-PRIVATE-ACCESS.md`
- user_id：`3a86a0d7-a3a2-4034-8868-1afd8889e1da`
- companion_id：`d99ebbd8-5823-4e39-8be4-79a92be965c0`
- 该账号是 **owner**，能看自己的账号/伴侣/设置/会话/记忆；不是平台管理员，不能跨用户读数据。
- 登录后可用于：
  - 验证 Web/PWA 功能、人格/记忆、通道绑定页面；
  - iOS 客户端登录联调（同一个 Supabase Auth）；
  - 不要用它生成大量垃圾消息/记忆；测试后清理。

### 2.1 平台账号（不是网站登录）

| 平台 | 账号/入口 | 权限 |
|---|---|---|
| GitHub | 组织 `DengTaHome`，仓库前后端 | 现有 PAT 可读写/PR；建议给 iOS AI 单独 collaborator + 短期 token |
| Vercel | 账号 `tnineninet@gmail.com`，team `buyaocaowo555-9312s-projects`，project `dengta-home` | 生产部署；token 在 `_credentials` |
| Render | `dashboard.render.com/u/usr-d9uk8dfavr4c73aocnug`，service `srv-d9ukrqvqj5pc73frp5d0` | 后端服务/环境变量；token 在 `_credentials` |
| Supabase | project ref `nyyqyizwrlmejpfdhgrnd` | 数据库/Auth/Storage；service role 只在 Render env |
| Apple Developer | **当前没有** | iOS 必需：Apple Developer Program + App Store Connect + 签名证书/描述文件 |
| Mac/Xcode | **当前没有** | iOS 编译/签名必需 |

> 权限建议：给 GPT 的账号只给“读仓库 + 建分支/PR + 本地构建”，不要给生产数据库/服务 role；生产发布仍由用户或 Lead 执行。

---

## 3. iOS 技术路线：Capacitor，不是重写

DengTa 前端已经是 React + Vite，Android 用 Capacitor；iOS **优先复用同一份 Web 代码**：

```
src/ (React)
  ├── Web/PWA：Vite 构建 dist → Vercel
  ├── Android：dist → Capacitor android/ → APK
  └── iOS（新增）：dist → Capacitor ios/ → Xcode → TestFlight/App Store
```

优点：聊天、人格、记忆、音乐、通道 UI 等 Web 逻辑全部复用。
代价：Android 原生插件在 iOS 不存在，需要逐一实现或降级（见第 5 节）。

### 3.1 第一步：在 Mac 上创建 iOS 工程

```bash
# 在 macOS，Node 24 + Xcode 最新稳定版
cd /path/to/frontend-gh
git switch main
git pull
npm ci
npm install @capacitor/ios@8.4.3
npx cap add ios
npm run build:web
npx cap sync ios
npx cap open ios
```

说明：
- `@capacitor/core` / `@capacitor/android` 当前是 `8.4.3`；`@capacitor/ios` 用同版本。
- 生成的工程：`ios/App/App.xcworkspace`（或 SPM 工程，按 Capacitor 8 生成结果）。
- Bundle ID 用 `home.dengta.app`（与 Android 一致，便于后端/推送识别）。
- Team 选择用户的 Apple Developer Team；没有就先用模拟器跑通再处理签名。
- `capacitor.config.json` 增加 iOS 配置时，保留 Android 配置；不要删 `android` 段。

### 3.2 环境变量

iOS 构建同样读 Vite 环境：
- `VITE_API_URL`：生产后端
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_PUBLIC_AUTH_REDIRECT_URL`

注意：`VITE_*` 会被打进 JS，**都是公开值**；不要放 service role、API secret。
iOS 的 `.env.production` 可用与 Web 相同的生产值；本地模拟器可用 `.env.local` 指测试后端。

### 3.3 认证与深链

- Supabase Auth 的 redirect allowlist 需要加入 iOS 回调，例如：
  - `home.dengta.app://auth-callback`（自定义 scheme）
  - 或 Universal Link：`https://www.dengtahome.com/auth-callback`
- Xcode `Info.plist` 增加 `CFBundleURLTypes`（自定义 scheme）。
- 前端 `src/main.jsx` 已用 `@capacitor/app` 监听 app URL open；iOS 要实测邮箱验证/重置密码回跳。
- 后端 CORS 已经允许 `capacitor://localhost` 和 `https://localhost`（见 `server.js` allowedOrigins）；iOS 默认 origin 是 `capacitor://localhost`，不要再改成 `ionic://`。
- 登录态用 `@capacitor/preferences` 持久化；iOS 端不要用裸 localStorage 存 token。

### 3.4 安全区/状态栏/输入法

- iOS 刘海/灵动岛/Home Indicator 必须用 `env(safe-area-inset-*)`；前端已有 safe-area CSS，需在真机逐页检查。
- `viewport-fit=cover` 已存在。
- 键盘弹出时 WKWebView resize 行为与 Android 不同；聊天输入框、底部导航要真机验证。
- 状态栏样式用 Capacitor StatusBar 或 Info.plist `UIViewControllerBasedStatusBarAppearance`，不要在 Web 里硬编码。

### 3.5 更新机制

- **没有 APK/下载 feed 的 iOS 等价物。**
- iOS 更新必须走 App Store / TestFlight：
  - 版本提醒可用 App Store lookup API 或自己的 `/updates/ios.json`（未来新增）；
  - `itms-apps://apps.apple.com/app/id<APP_ID>` 打开商店；
  - 不要复用 `AppUpdatesPlugin` / `AppUpdatePolicy`（Android APK 安装逻辑）。
- iOS 上应隐藏/禁用“下载 APK”“应用内安装”入口。

---

## 4. 现有代码里哪些可以直接用

### 4.1 直接复用

- `src/` 绝大部分 React 页面/组件/业务逻辑；
- `api.js`（Bearer + companion header + 超时/GET 重试）；
- `auth-session.js` / `auth-native-storage.js`（Capacitor Preferences）；
- `ChannelHub.jsx` / `QQCloudConnect.jsx`（QQ 云扫码是服务端二维码，iOS WebView 可跑）；
- `AstrBotPersonaExport.jsx`（文件导出需换 iOS share sheet）；
- 聊天 SSE、人格/记忆设置、音乐/动态/日记等纯 Web 功能；
- `useBackLayer` / `app-back-navigation.js` 需要 iOS 手势适配，不要直接假设 Android 返回键。

### 4.2 必须改/新增

| Android 侧 | iOS 对应 | 建议 |
|---|---|---|
| `AppUpdatesPlugin` / APK 下载 | App Store/TestFlight 更新 | 移除/隐藏 APK 更新；做 iOS 版检查 |
| `AppNavigationPlugin` | WKWebView 手势/导航栈 | 用 Capacitor App + 自定义 Swift |
| `BackgroundNotificationsPlugin` / `PushNotificationWorker` | APNs + BackgroundTasks | 后端要加 APNs；先做前台通知/轮询 |
| `BrowserLauncherPlugin` / PersistentBrowser | `SFSafariViewController` / `ASWebAuthenticationSession` | 登录/外部网页用系统浏览器 |
| `DeviceTtsPlugin` | `AVSpeechSynthesizer` | Swift 插件，或降级 Web Speech |
| `DeviceActivityPlugin` / `DeviceSignalsPlugin` | CoreMotion/CoreLocation/DeviceActivity | 先砍非核心，按需实现 |
| `DlnaReceiverPlugin` / Cast 系列 | iOS 无 DLNA 同等能力 | 首版不做；后续用 AirPlay/自定义 |
| `NeteaseCookiePlugin` / `NeteasePlaybackPlugin` | 不能用 Android 注入 cookie；用 in-app web/API + AVAudioPlayer | 需产品/合规决策 |
| `ScreenGlancePlugin` / `See Now` | ReplayKit 只能录本 App 屏幕，不能任意截屏 | 首版改为“用户主动录屏/上传” |
| `WhereaboutsPlugin` | CoreLocation | 需权限说明，先可选 |
| `OrderBrowserPlugin` / 外卖页面 | WKWebView/SFSafari | 按功能逐个接 |
| `DengTaFileBridge` | UIDocumentPicker/Share Sheet | 导出 AstrBot 人设/附件 |
| 微信/QQ 本地桥 | 不需要改：桥在服务器/本机，iOS 只访问云端 API | 用云 QQ / 微信通道 |
| Android 签名/更新 feed | App Store 签名/TestFlight | 新建 iOS CI |

### 4.3 iOS 原生能力清单

首版建议只做“核心陪伴”：
1. 登录/注册/找回密码
2. 聊天（SSE/流式/引用/附件图片）
3. 人格设置/你的详情/记忆/通道同步
4. 语音输入/语音播放（麦克风权限 + AVAudioSession）
5. 前台/本地通知
6. 音乐播放（AVAudioPlayer/AVPlayer）
7. 安全区/键盘/深链/分享导出

明确延后：Cast/DLNA、Android 任意屏幕捕获、后台常驻、Netease cookie 注入、外卖浏览器自动化。

---

## 5. 后端与 iOS 的关系

- 后端 **不需要为 iOS 重写**；同一套 REST/SSE/Auth。
- 需要新增的只有：
  1. CORS 已允许 `capacitor://localhost`（已具备）；
  2. Supabase Auth redirect allowlist 加 iOS 回调；
  3. 若要离线推送：增加 APNs（当前没有 `apns`/FCM 依赖，Android 是自有轮询/Worker 模型）；
  4. 若要 App Store 更新提醒：新增 `/updates/ios.json` 或 App Store lookup；
  5. 若要 iOS IAP：新增 StoreKit 验证/权益接口（当前 companion slot 是兑换码/管理员授予）。
- 不要给 iOS 客户端 Supabase service role；只给 anon key + 用户 JWT。

---

## 6. 构建、签名、TestFlight/App Store

### 6.1 前提

- macOS（建议最新稳定版）
- Xcode 最新稳定版
- Apple Developer Program（$99/年）
- App Store Connect 账号（App Manager/Developer/Admin 角色）
- Bundle ID：`home.dengta.app`（如果已被 Android/其他占用，在 App Store Connect 新建唯一 ID；iOS Bundle ID 可与 Android 不同，但建议保持一致）

### 6.2 本地构建

```bash
npm run build:web
npx cap sync ios
npx cap open ios
# Xcode: Product → Archive → Distribute App → App Store Connect / TestFlight
```

或命令行（示例，按实际 scheme 调整）：

```bash
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -archivePath build/DengTa.xcarchive \
  archive
```

### 6.3 CI（推荐）

- GitHub Actions `macos-latest` + Xcode + 签名证书/描述文件 secrets；
- 或 Xcode Cloud / Codemagic / EAS；
- 步骤：checkout → npm ci → build:web → cap sync ios → archive → export → upload TestFlight。
- 签名 secrets 不要给 iOS AI 的通用 token；用 CI secret 或用户手动签名。

### 6.4 App Store 审核（重要，先读）

DengTa 是成人向伴侣产品，Apple App Review Guidelines 对露骨性内容限制很严：
- 含明确性内容/成人角色扮演的 App 很可能被拒；
- 即便 SFW，AI 生成内容也需要内容过滤、举报/屏蔽、年龄分级（17+）、隐私政策、账号删除；
- 数字内容/会员/伴侣名额若在 App 内购买，通常必须走 Apple IAP（不能引导外部支付）；
- 第三方登录（Google 等）若存在，通常还必须提供 Sign in with Apple；
- 需要 Privacy Manifest、App Privacy 标签、权限说明（麦克风/相机/照片/定位/通知）。

**建议路线：**
1. 先做 **TestFlight 内测**（仍需审核，但比公开 App Store 容易）；
2. 公开版做 **SFW 模式**（成人内容开关默认关闭/仅 Web），或
3. 不做 App Store 公开版，走 **PWA（添加到主屏幕）**，成本最低；
4. 若要公开上架，先让用户确认内容策略和 IAP 方案，再投入。

---

## 7. 权限与安全

### 7.1 账号权限

- 网站测试账号：owner，能读写自己的数据；不要用于跨用户测试。
- GitHub：建议新建 `ios-agent` 协作者，只给 `dengta-home-frontend` 写权限 + PR，不给 backend/main 直推。
- Vercel/Render/Supabase：只读或由用户发布；iOS AI 不应持有 service role。
- Apple：用户自己持有 Developer/App Store Connect 管理权；AI 只拿 App-specific password/CI key（如必须）。

### 7.2 不要外传

- `_credentials` 下所有文件；
- `.env.local`、`.env.production` 中非公开值；
- 用户聊天/记忆/动态内容；
- `_audit` 截图/日志；
- 签名证书、Provisioning Profile、App Store Connect API key。

---

## 8. 技能 / Skill 链接

> “Skill”分两类：一是本机/DSH 可用的技能文件，二是 iOS 开发官方文档。不要假设有公开的 DengTa Skill 商店。

### 8.1 本机可用技能文件

| 技能 | 路径 | 用途 |
|---|---|---|
| Playwright CLI | `D:\GZdeepseek\_tools\pw\node_modules\playwright-core\lib\tools\skills\playwright-cli\SKILL.md` | 浏览器自动化/多视口验证 |
| Playwright component | `...\playwright-component-testing\SKILL.md` | 组件测试 |
| Playwright trace | `...\playwright-trace\SKILL.md` | 失败追踪 |
| Office 文档 | `D:\deepseek\resources\runtime\office-skills\office\SKILL.md` | docx/xlsx/pptx/pdf |
| Elephant/Goldfish 复核 | `D:\GZdeepseek\_tools\eg\elephant-goldfish-model-main\skills\egm_*\SKILL.md` | 独立审查/回归 |

### 8.2 iOS 官方文档/链接

- Capacitor iOS：https://capacitorjs.com/docs/ios
- Capacitor 插件总览：https://capacitorjs.com/docs/apis
- Apple HIG：https://developer.apple.com/design/human-interface-guidelines/
- HIG Layout / Safe Area：https://developer.apple.com/design/human-interface-guidelines/layout
- App Review Guidelines：https://developer.apple.com/app-store/review/guidelines/
- TestFlight：https://developer.apple.com/testflight/
- App Store Connect：https://appstoreconnect.apple.com/
- APNs：https://developer.apple.com/documentation/usernotifications
- Universal Links：https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content
- Privacy Manifest：https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- In-App Purchase：https://developer.apple.com/in-app-purchase/
- Xcode Cloud：https://developer.apple.com/xcode-cloud/
- Fastlane：https://docs.fastlane.tools/
- Supabase Auth Redirect URLs：https://supabase.com/docs/guides/auth/redirect-urls
- Capacitor Local Notifications：https://capacitorjs.com/docs/apis/local-notifications
- Capacitor Preferences：https://capacitorjs.com/docs/apis/preferences
- Capacitor App：https://capacitorjs.com/docs/apis/app

### 8.3 推荐工作流

```
读本文件 + 私有凭据
→ 在 Mac 克隆 frontend-gh main
→ 建 feat/ios-capacitor 分支
→ npm ci / npm install @capacitor/ios@8.4.3 / npx cap add ios
→ 先跑模拟器：登录→聊天→人格→设置→安全区
→ 再逐项补原生插件（TTS/通知/分享/麦克风）
→ TestFlight 内测
→ 根据 Apple 审核风险决定公开版内容策略
```

---

## 9. 给接手 AI 的启动 Prompt（可直接复制）

```text
你是 DengTa iOS 版负责人。先读：
1. D:\GZdeepseek\dengta-home\docs\IOS-DENGTA-HANDOVER.md
2. D:\GZdeepseek\_credentials\IOS-DENGTA-PRIVATE-ACCESS.md（只在本机读，不要上传/提交）
3. D:\GZdeepseek\_refs\frontend-gh\CONTEXT.md
4. D:\GZdeepseek\_refs\frontend-gh\capacitor.config.json

约束：
- iOS 源码从 D:\GZdeepseek\_refs\frontend-gh（GitHub main）建 feat/ios-capacitor 分支；
  不要用 D:\GZdeepseek\dengta-home\frontend 旧副本。
- Windows 不能构建 iOS；先在 Mac 上跑 Xcode 模拟器，再谈签名/TestFlight。
- 不要改生产数据库/Render/Vercel；不要提交密码/token/证书。
- 首版只做核心陪伴：登录/聊天/人格/记忆/设置/语音/通知/音乐；
  Cast/DLNA、任意屏幕捕获、Netease cookie 注入、后台常驻先不做。
- 先交付模拟器可运行工程 + 变更清单 + 截图/测试报告；再申请 Apple 账号/签名。

先输出：
1) 你确认的工作区/版本/账号（不要输出密码）；
2) iOS 工程创建日志与模拟器截图；
3) 与 Android 的功能差异清单；
4) App Store 审核风险评估和下一步。
```

---

## 10. 已知限制/风险清单

| 风险 | 说明 |
|---|---|
| 无 macOS/Xcode | 当前 Windows 机器无法编译 iOS；必须换 Mac/CI |
| 无 Apple Developer | 无法签名/TestFlight/上架 |
| 成人内容审核 | App Store 很可能拒绝露骨内容；需 SFW/TestFlight/PWA 方案 |
| 原生插件缺口 | Android 有大量 Java 插件；iOS 需 Swift 重写或降级 |
| 后台通知 | Android 轮询 Worker 模式不能直接用于 iOS；需 APNs |
| 更新机制 | iOS 不能应用内装 APK；必须 App Store/TestFlight |
| 屏幕捕获/See Now | iOS 不允许任意截屏；只能 ReplayKit 本 App 或用户主动上传 |
| 网易云 Cookie | iOS 不能像 Android 一样注入其他 App；需网页/API 方案 |
| IAP | 若售卖伴侣名额/会员，Apple 可能要求 IAP |
| 隐私合规 | 麦克风/照片/定位/通知/账号删除/隐私政策都要准备 |
| 生产凭据 | 不要把 owner token/service role 交给外部 AI |

---

## 11. 相关文档

- 部署/人格/架构：[DENGTA-DEPLOYMENT-PERSONA-ARCHITECTURE.md](DENGTA-DEPLOYMENT-PERSONA-ARCHITECTURE.md)
- QQ/微信本地栈：[QQ-WECHAT-DEPLOYMENT-HANDOVER.md](QQ-WECHAT-DEPLOYMENT-HANDOVER.md)
- 前端上下文：[CONTEXT.md](../../_refs/frontend-gh/CONTEXT.md)
- 后端环境变量：[.env.example](../../_refs/backend-prod/.env.example)
- 前端构建/测试：`_refs/frontend-gh/package.json`
- 生产更新 feed：`https://www.dengtahome.com/updates/android.json`

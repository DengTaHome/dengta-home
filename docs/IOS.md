# iOS 适配、构建与验收

本版本沿用现有 React 客户端，通过 Capacitor 8 / WKWebView 提供原生 iPhone、iPad 工程；聊天、伴侣、记忆和共同活动继续使用同一套后端。工程入口为 [`frontend/ios/App/App.xcodeproj`](../frontend/ios/App/App.xcodeproj)。这是可继续构建和验收的源码交付，不代表已生成签名 IPA、通过真机验收或完成 App Store 发布。

本次已执行的测试、浏览器检查及已知基线失败见 [验证记录](IOS-VERIFICATION.md)。

## 环境要求

- macOS、**Xcode 26.0 或更新版本**，安装所需 iOS Simulator runtime，首次启动 Xcode 完成组件安装及许可确认。
- **iOS / iPadOS 15.0+**；以最低版本和当前版本分别验收。
- **Node.js 24.x**、npm；项目要求见 [`frontend/package.json`](../frontend/package.json)。
- 原生依赖使用 **Swift Package Manager（SPM）**，打开 `.xcodeproj`，无需运行 `pod install`。首次解析包需要访问 GitHub。
- 真机运行需要自己的 Apple 开发签名；TestFlight / App Store 分发需要相应 Apple Developer 资格。

最低系统版本同时写入项目和 Capacitor 依赖。Xcode 要求依据 [Capacitor 8 官方说明](https://capacitorjs.com/docs/updating/8-0#upgrade-xcode)，系统支持见 [iOS 文档](https://capacitorjs.com/docs/ios)。

## 配置服务并准备工程

在仓库根目录运行以下 macOS 终端命令：

```bash
cd frontend
npm ci
cp .env.ios.example .env.ios.local
```

编辑 `.env.ios.local`，填写自己部署的服务（示例值须替换）：

```dotenv
VITE_API_URL=https://api.example.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-publishable-or-anon-key
```

原生客户端必须连接可从设备访问的 **HTTPS** API 和 Supabase 地址，证书须有效。iPhone 上的 `localhost` 指向手机自身；模板中的本地 HTTP 地址不能直接用于本版本的 iOS 包。工程不添加任意 HTTP 放行，也不内置生产账号或服务凭据。后端部署、数据库初始化和模型供应商配置见 [部署说明](DEPLOYMENT.md)。

`VITE_*` 全部进入 App 内的静态资源，用户可以读取。这里只能填服务公开地址和 Supabase 公共 key；Supabase secret/service-role key、模型 API key、Cookie 和签名材料不能放进前端环境变量或仓库。模型凭据通过现有账号供应商配置流程提交给自己的后端。

配置完成后运行：

```bash
npm run ios:prepare
npm run ios:open
```

`ios:prepare` 使用 Vite 的 `ios` 模式校验公开配置、构建网页并同步到 iOS 工程；每次修改前端或服务地址后都需要重新执行。`ios:open` 在 macOS 打开 Xcode。已有 `ios/` 工程无需再执行 `cap add ios`；不要删除工程重建，以免丢失权限、隐私清单和原生适配。

在 Xcode 选择 `App` target，打开 **Signing & Capabilities**，选择自己的 Team。默认 Bundle Identifier 是 `home.dengta.app`；若不具备该标识的签名权限，改为自己名下唯一标识，并同步 [`capacitor.config.json`](../frontend/capacitor.config.json) 的 `appId`。仓库不包含 Team、证书或 provisioning profile。选择模拟器或已配对 iPhone 后运行。

## 邮箱验证与密码重置

在自己 Supabase 项目的 **Authentication → URL Configuration → Redirect URLs** 中添加：

```text
dengta://auth
```

网页端继续保留自己的 HTTPS 回跳地址。原生端固定使用 `dengta://auth`，忽略面向网页的 `VITE_PUBLIC_AUTH_REDIRECT_URL` 覆盖值。App 的 URL Scheme、AppDelegate 转发和前端深链处理配合，接收已打开状态和冷启动状态的邮箱验证、密码重置回跳。自定义邮件模板也要保留 Supabase 正确的验证/重置链接及 redirect 参数。

`dengta://room/join?code=...` 用于放映厅邀请。HTTPS Universal Links 还需要域名的 AASA 文件和 Associated Domains 配置；本工程的自定义 scheme 支持不能视为已配置 Universal Links。

后端已允许 `capacitor://localhost` origin，见 [`backend/server.js`](../backend/server.js)；若部署的网关另设 CORS，也须允许这个 origin、Authorization 和伴侣范围请求头。

## 支持范围

下表描述适配路径及限制，功能实际可用性仍取决于数据库、用户授权和服务配置。

| 能力 | iOS 路径 / 限制 |
| --- | --- |
| 注册、登录、邮箱验证、重置密码 | Supabase Auth + App 深链；需要自己的服务和重定向白名单 |
| 多模型聊天、流式回复、引用、附件 | 复用现有 API 和 fetch SSE；切后台、锁屏后不保证流持续连接 |
| 伴侣、个性化、长期记忆、日记、动态、创作 | 复用现有账号/伴侣作用域与后端能力 |
| 语音录制与回复 | WKWebView 麦克风授权；录音可选 `audio/mp4` / `.m4a`；TTS 需服务配置，首次播放可能需用户点击 |
| 音乐、观影、放映厅 | 保留网页媒体和服务端会话能力；第三方格式、DRM、自动播放及外链行为需实测 |
| 打开网易云资源 | 有对应原生桥时调用，否则使用 HTTPS 页面；不承诺跨 App 静默播放 |
| 本地通知、应用内回复提醒 | 用户授权后使用 LocalNotifications；通知点击回到对应会话 |
| App 被挂起或终止后的远程消息推送 | **未接入 APNs**；Android 的后台轮询不能在 iOS 等效运行 |
| 读取其他 App 通知、使用记录、跨应用屏幕共看 | Android 自定义插件专属，iOS 不提供对应授权入口 |
| DLNA 接收、Android 内置浏览器登录态提取、设备工具桥 | 当前没有对应 iOS 自定义插件；按能力检测降级，不应当作已支持 |
| MCP、外部记忆、天气 | 可访问的后端服务可继续使用；本机 Android 工具和位置插件不随迁移自动获得 iOS 实现 |

麦克风权限由用户操作触发；拒绝后可在系统设置恢复。`Preferences` 在 iOS 使用 **UserDefaults**，用于会话持久化，**不是 Keychain 或加密保险库**。本版本保留现有存储机制，卸载会清除相应本地数据。应用隐私清单声明 `NSPrivacyAccessedAPICategoryUserDefaults`、原因 `CA92.1`，依据 [Preferences 官方说明](https://capacitorjs.com/docs/apis/preferences#apple-privacy-manifest-requirements)。发布者仍需根据自己的后端、模型和第三方服务如实填写隐私说明及 App Store 隐私信息。

## 模拟器构建检查

在 macOS 的 `frontend/` 下先完成 `npm run ios:prepare`，然后运行：

```bash
xcodebuild -version
xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/dengta-ios-build CODE_SIGNING_ALLOWED=NO build
```

这验证的是模拟器编译，不产生可分发真机 IPA。可用目标通过 `xcrun simctl list devices available` 查看；在 Xcode 选择目标并运行可检查实际 UI。深链路由可在已启动模拟器上用 `xcrun simctl openurl booted 'dengta://auth'` 检查是否打开 App；这个无 token 链接不代表登录成功，完整验收必须用真实验证邮件。

Linux 可执行网页构建、JavaScript 回归和工程静态检查，不能替代 Xcode 编译、签名或 Apple 设备测试。CI 配置存在也不代表某次构建已通过，应以实际运行记录为准。

## 真机验收清单

- [ ] 安装、首次启动、无网络启动；未配置或服务错误时显示可恢复提示。
- [ ] 注册、邮箱确认、密码登录、退出；App 打开和完全关闭时分别点击验证/重置邮件，确认能进入对应状态。
- [ ] 切换账号和伴侣后，历史、记忆、附件、通知和个性化不串数据；重启 App 后恢复正确会话。
- [ ] 发送流式聊天、停止、重试、引用和附件；弱网、切后台、锁屏及回前台时无重复提交，历史可恢复。
- [ ] iPhone 小屏、刘海/灵动岛、横屏、iPad 分屏；键盘出现和收起时输入框、发送按钮、安全区及弹层均可操作。
- [ ] 麦克风允许、拒绝、撤销授权；短录音、60 秒限制、`.m4a` 上传、语音播放和来电/切后台中断。
- [ ] 通知允许和拒绝、本地提醒点击回会话；确认没有把挂起后的远程推送标为可用。
- [ ] 音乐/视频首次播放、暂停、第三方外链、放映厅邀请；Android 专属项目显示正确限制且不触发缺失插件异常。
- [ ] 日记、记忆编辑和外部记忆、模型/语音/MCP 设置各做一次保存与重新读取，使用虚构测试内容。
- [ ] 发布前核对签名、版本号、图标、隐私清单、服务端数据处理说明及依赖授权；在 Xcode Archive 验证后再分发。

# 灯塔 iOS 第三阶段：Keychain 与多账号隔离报告

日期：2026-11-12。开发目录：`/workspace/dengta-ios/ios-agent`；原始 `/workspace/dengta-home` 未修改。本文记录第三阶段，不把模拟器产物当作可安装到 iPhone 的 IPA。

## 实现结果

灯塔仍使用 React DOM / Vite / Capacitor，保留原有后端和流式聊天协议。本阶段没有引入待选型的新记忆库、React Native UI 库或云服务。

| 内容 | 本阶段处理 |
| --- | --- |
| 登录凭证 | 新增 Swift `DengTaKeychain` 桥，登录会话、PKCE 验证值和 SDK 用户缓存只允许三个固定 key。使用 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`，不启用 iCloud 同步或共享访问组。iOS 写入失败时停止登录，不回退 UserDefaults / localStorage。 |
| 旧凭证迁移 | 只读取明确的旧认证 key，验证 Keychain 写入后删除并复查旧明文副本。失败显示解锁与重试提示，不把凭证放进错误日志。 |
| 本机私密资料 | 新增 `DengTaAccountVault`。每个账号有独立目录、独立 256 位加密密钥和 AES-GCM 密文，账号 UUID 经哈希作为目录名，并参与认证校验。文件使用完全保护，排除备份；加密密钥同样绑定本机 Keychain。 |
| 页面同步读取 | 原生缓存先解密到该账号独立的内存镜像，准备完成后才挂载聊天页面。聊天、草稿、引用、心声、工作区和共同活动捕获本次登录的存储访问对象。 |
| 同账号重新登录 | 使用账号激活轮次区分旧 A 与新 A；即使 React 合并掉中间的登录页，也会丢弃旧组件状态、重新准备缓存。切换伴侣或正常刷新 token 不重置账号边界。 |
| 退出与失效 | 同步封停旧账号读写、清除内存身份和请求权限，再等待正在进行的写入结束，清除 Keychain 与本账号缓存。离线不阻止本机退出；清理失败会阻止新登录进入业务页面，并允许解锁后重试。 |
| 网络请求 | 缓存及共享 GET 按账号、伴侣、会话版本隔离；响应正文和流式读取也检查所属账号。迟到响应不能修改新账号的伴侣选择。登录请求使用 `cache: no-store`，保留现有 POST / fetch 流式协议。 |
| 旧明文缓存 | 首次 iOS 准备时清理已识别的旧私密 key、当前账号的旧工作区行和无归属的 v1 工作区缓存；未知资料不会分配给第一个登录用户。其他账号 v2 行保留到该账号清理；服务器聊天和记忆不删除。 |
| 音频、导入、诊断 | 退出停止语音播放；导入回执与诊断捕获本轮账号权限，旧回调不能在重新登录后复活；iOS 免登录投屏接收凭证只保留在内存，擦除旧 sessionStorage 副本。 |
| 日志 | 关闭 iOS Capacitor 原生和 JS 桥接响应日志，避免 Debug 输出中出现会话凭证。 |

退出时，服务端撤销针对退出前捕获的设备会话，尽力执行；离线时无法承诺服务器立即撤销。迟到的全局撤销不会踢掉同账号刚建立的新登录。本机封停和擦除不依赖这次网络请求。

原生缓存当前限额为每账号 2 MiB 明文。超额会报告缓存失败，不静默截断聊天，也不改写成明文保存。图片不写进这个字符串缓存，私有媒体沿用受鉴权网络请求及卸载时释放 Blob URL 的路径。

## 核心文件

- 原生：`frontend/ios/App/App/DengTaKeychainStore.swift`、`DengTaKeychainPlugin.swift`、`AccountVaultStore.swift`、`DengTaAccountVaultPlugin.swift`、`DengTaBridgeViewController.swift`，以及 Xcode Sources 和 storyboard 注册。
- 凭证与生命周期：`auth-keychain-storage.js`、`auth-storage-lease.js`、`auth-native-storage.js`、`auth-session.js`、`AuthGate.jsx`。
- 账号缓存与清理：`account-cache-vault.js`、`account-cleanup.js`、`account-storage.js`、`workspace-cache.js`、聊天与共同活动相关缓存模块及 `App.jsx` 接线。
- 请求与设置：`api.js`、`api-get-cache.js`、`settings-save-scope.js`、导入回执及诊断模块。
- 自动验证：`frontend/scripts/verify-ios-security.mjs`、两套 `test-ios-*-native.sh` 和 `.github/workflows/ios.yml`。

## 已执行验证

| 验证 | 结果与范围 |
| --- | --- |
| `npm run test:ios:security` | **20/20 文件成功：142/142 个命名用例，另 2 个断言脚本通过。** 每文件独立进程执行；缺少实际用例摘要、子进程错误、超时或非零退出都会失败。 |
| 账号生命周期 | 15 项：离线退出、旧 SDK 回调、迟到初始化、重复退出、并发登录、失败清理重试、迟到物理擦除、同账号重新登录轮次及准备后恢复伴侣。 |
| 凭证与原生缓存 | 覆盖迁移、锁定与错误脱敏、可撤销存储、账号独立持久化、篡改所属账号、退出中加载、已开始写入的排空、重新登录和缓存限额。JS 插件替身用例不能代替真实 Keychain 执行。 |
| 页面准备边界 | 6 项真实 React 渲染用例：清理和缓存加载前不挂载业务；迟到 A 不覆盖 B；安全存储失败重试；旧明文清理失败时阻止挂载；批处理下同账号重登仍重新挂载。 |
| 既有业务回归 | 历史流程 23/23、设置保存 18/18、心声 5/5、发送准备 5/5、决斗流程 53/53、共同活动播放 8/8 等受影响文件已单独验证。它们与专项流水线有交集，不相加作为新的总通过率。 |
| 前端静态检查与构建 | `npm run lint`、Release 前端资源构建通过；既有大分块提示仍在。 |
| iOS 资源准备与专项检查 | iOS 专项 **41/41** 通过；使用虚构公开配置的 `npm run ios:prepare` 通过资源构建与 Capacitor SPM 同步，未使用真实账号。 |
| Swift fixture / Xcode 编译 | 已加入 macOS CI，等待本次原生执行结果后补记；Linux 本机没有 Xcode，不能据静态检查宣称 Swift 已通过。 |

专项 JSON 与逐文件日志生成在 `artifacts/ios-phase3-security/`，不包含真实账号或生产模型调用。复现：

```bash
cd frontend
npm ci
npm run test:ios:security
npm run lint
npm run build
```

原生 fixture 分别验证 Keychain 访问策略与失败处理、真实 CryptoKit 加解密和篡改检测；使用虚构数据，不访问用户凭证。操作系统真实锁屏、安装后的 Keychain 行为及真机侧载仍需设备验证。

## 本阶段边界与后续

此前真实模拟器三机登录截图已成功并人工查看，见[第二阶段报告](IOS-PHASE2-REPORT.md)及[截图预览](screenshots/ios-phase2/README.md)。这批截图来自第二阶段提交，不作为当前安全改动已运行的证明。

第四阶段的登录、发送消息、切换账号、朋友圈原生自动操作，以及聊天/记忆/设置三机视觉基准 Diff，仍待单独完成。本报告不称原生 UI 测试已全部通过，也不称已提供可真机安装的 IPA。

第三阶段原生验证通过后，按用户追加要求调研 GitHub 与 X/Twitter，提交《灯塔 iOS 架构审查与开源插件选型报告》。推荐的新增插件在用户确认后才接入。第四阶段和第五阶段继续遵守阶段确认；最终签名使用用户已选的全能签。

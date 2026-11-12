# 灯塔 iOS 第三阶段：Keychain 与多账号隔离报告

日期：2026-11-12。开发目录：`/workspace/dengta-ios/ios-agent`；原始 `/workspace/dengta-home` 未修改。本文记录第三阶段，不把模拟器产物当作可安装到 iPhone 的 IPA。

**交接截止状态：第三阶段实现已提交，原生验收尚未通过，现交由用户本地 AI 继续。** 代码提交 `70b407d2fad356934a85ab8ff28a4527db2b79da` 的 macOS 运行 #9 已通过 Swift fixture、157 项安全检查、51 项 iOS 检查和 Xcode 编译；真实无签名模拟器 Keychain 返回 `-34018`。临时 ad-hoc 签名后，模拟器启动被 `SBMainWorkspace` 拒绝，未取得签名后 Keychain 往返成功或新登录截图。不能把这些结果称为 iPhone 可用。详见 [本地 GPT 交接文档](LOCAL-GPT-HANDOFF.md)。用户本地 D 盘路径未知，云端工作区没有写入其电脑。

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

原生缓存当前限额为每账号 2 MiB 明文。超过限额拒绝缓存写入，工作区缓存路径会报告失败；可重建读缓存可降级在线加载，不截断资料或回退明文。图片不写进这个字符串缓存，私有媒体沿用受鉴权网络请求及卸载时释放 Blob URL 的路径。

## 核心文件

- 原生：`frontend/ios/App/App/DengTaKeychainStore.swift`、`DengTaKeychainPlugin.swift`、`AccountVaultStore.swift`、`DengTaAccountVaultPlugin.swift`、`DengTaBridgeViewController.swift`，以及 Xcode Sources 和 storyboard 注册。
- 凭证与生命周期：`auth-keychain-storage.js`、`auth-storage-lease.js`、`auth-native-storage.js`、`auth-session.js`、`AuthGate.jsx`。
- 账号缓存与清理：`account-cache-vault.js`、`account-cleanup.js`、`account-storage.js`、`workspace-cache.js`、聊天与共同活动相关缓存模块及 `App.jsx` 接线。
- 请求与设置：`api.js`、`api-get-cache.js`、`settings-save-scope.js`、导入回执及诊断模块。
- 自动验证：`frontend/scripts/verify-ios-security.mjs`、两套 `test-ios-*-native.sh` 和 `.github/workflows/ios.yml`。

## 已执行验证

| 验证 | 结果与范围 |
| --- | --- |
| `npm run test:ios:security` | 最新 macOS 运行 #9 **23/23 文件、157/157 个命名用例、另 2 个断言脚本通过**。包括账号切换、共享 GET 取消/重连、诊断权限及真实 Capacitor 代理/GoTrue 初始化回归。缺少用例摘要、子进程错误、超时或非零退出都会失败。 |
| 账号生命周期 | 15 项：离线退出、旧 SDK 回调、迟到初始化、重复退出、并发登录、失败清理重试、迟到物理擦除、同账号重新登录轮次及准备后恢复伴侣。 |
| 凭证与原生缓存 | 覆盖迁移、锁定与错误脱敏、可撤销存储、账号独立持久化、篡改所属账号、退出中加载、已开始写入的排空、重新登录和缓存限额。JS 插件替身用例不能代替真实 Keychain 执行。 |
| 页面准备边界 | 6 项真实 React 渲染用例：清理和缓存加载前不挂载业务；迟到 A 不覆盖 B；安全存储失败重试；旧明文清理失败时阻止挂载；批处理下同账号重登仍重新挂载。 |
| 既有业务回归 | 历史流程 23/23、设置保存 18/18、心声 5/5、发送准备 5/5、决斗流程 53/53、共同活动播放 8/8 等受影响文件已单独验证。它们与专项流水线有交集，不相加作为新的总通过率。 |
| 前端静态检查与构建 | `npm run lint`、Release 前端资源构建通过；既有大分块提示仍在。 |
| iOS 资源准备与专项检查 | 最新运行 #9 iOS 专项 **51/51** 通过；使用虚构公开配置完成资源构建与 Capacitor SPM 同步，未使用真实账号。 |
| Swift fixture / Xcode 编译 | [运行 #9](https://github.com/DengTaHome/dengta-home/actions/runs/43242777530) 对应代码 `70b407d2fad356934a85ab8ff28a4527db2b79da`：Keychain 策略与注入 Security 失败处理、CryptoKit 加解密和篡改检测、Xcode 26.6 模拟器编译通过；运行期签名后启动失败，不能据编译通过宣称原生功能通过。 |
| 完整前端回归 | 本地 `npm test` 在诊断修复候选完整执行退出 0；随后 `6e50a0e` 的远程前端 CI 包含完整测试、集成、build、lint、typecheck/check 全部成功。 |

专项 JSON 与逐文件日志生成在 `artifacts/ios-phase3-security/`，不包含真实账号或生产模型调用。复现：

```bash
cd frontend
npm ci
npm run test:ios:security
npm run lint
npm run build
```

原生 fixture 分别验证 Keychain 访问策略与失败处理、真实 CryptoKit 加解密和篡改检测；使用虚构数据，不访问用户凭证。操作系统真实锁屏、安装后的 Keychain 行为及真机侧载仍需设备验证。

### 原生启动补验发现与修复

运行 #5 的截图步骤虽返回成功，逐图检查发现三台设备均停在“正在找回你的家”加载页，未进入登录页。截图 SHA 和尺寸一致，但进程存活、固定等待 6 秒和生成 PNG 不能证明登录已就绪。原图及校验记录保存在 `artifacts/ios-native-43165168653/`，对应 `0e8368e`，不包含后续诊断与加载修复。

已定位并修复一个实际原因：异步加载函数直接返回 Capacitor 插件代理，Promise 将代理误当作 thenable，等待不存在的 `then()` 调用而挂起。已改为返回普通方法适配器，并增加真实代理与真实 GoTrue 初始化回归。运行 #8 已能离开加载页，但出现安全存储不可用；运行 #9 进一步用固定字段收据确认无签名 Keychain 的 `-34018`，并发现签名后启动仍失败。当前阻断已转为模拟器代码签名与运行权限排查，尚未解决。

截图脚本已增加 macOS Vision OCR 门禁：最多轮询 60 秒，必须看见欢迎标题、邮箱、密码及登录主按钮；加载页不能通过，识别到安全存储错误会失败。门禁先用已知登录图和此次真实加载图验证正反例，只保存固定状态及标签布尔值，不导出 OCR 原文。它验证登录画面已出现，不代替第四阶段完整 UI 操作或视觉基准 Diff。

## 本阶段边界与后续

此前真实模拟器三机登录截图已成功并人工查看，见[第二阶段报告](IOS-PHASE2-REPORT.md)及[截图预览](screenshots/ios-phase2/README.md)。这批截图来自第二阶段提交，不作为当前安全改动已运行的证明。

第四阶段的登录、发送消息、切换账号、朋友圈原生自动操作，以及聊天/记忆/设置三机视觉基准 Diff，仍待单独完成。本报告不称原生 UI 测试已全部通过，也不称已提供可真机安装的 IPA。

用户追加的只读开源研究已保存为 [记忆架构快照](research/OPEN-SOURCE-MEMORY-SNAPSHOT.md) 和 [iOS 插件快照](research/OPEN-SOURCE-IOS-SNAPSHOT.md)，尚未最终合并为批准方案，未安装候选插件。X 原站访问返回 403，未声称读过其时间线。后续由本地 AI 完成原生阻断、正式选型确认、第四及第五阶段；最终签名工具为用户已选的全能签。

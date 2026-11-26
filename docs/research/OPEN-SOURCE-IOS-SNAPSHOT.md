# 灯塔 iOS 开源插件调研快照（供本地 GPT 交接）

检索日期：2026-11-12。状态：只读研究快照；尚未经用户批准，未安装依赖、未接入任何候选插件。用户随后要求立即交接，因此已停止新增检索。本文件不是完成兼容性实测的安装清单。

## 已核实的结论

灯塔当前是 React DOM 19 / Vite / Capacitor 8.4.3，并非 React Native / Expo。React Native 的聊天、键盘、动画组件依赖另一套宿主，不能直接安装后替代当前 WKWebView 页面。优先保持现有架构、账号边界、POST 流式协议及后台情绪 TTS。

建议优先试验官方 `@capacitor/keyboard`，可选轻触反馈 `@capacitor/haptics`。流式解析只有发现现有解析器缺口时才考虑 `eventsource-parser`；长列表和动效先测实际卡顿再引入。系统 STT/TTS、通用 AI SDK、整套 RN 聊天界面均不应一次性叠加。

下表版本来自检索时官方仓库默认分支的 `package.json`，**不等同于 npm 最新稳定发布，也不是已锁定的交付版本**。真正接入时仍需重新核对 npm dist-tag、锁文件、iOS SPM 与 Release 包差值。

| 项目 / 许可证 / 源码版本观察 | 大白话用途 | 与灯塔匹配程度、建议 | 包体及关键边界 |
| --- | --- | --- | --- |
| [Capacitor Keyboard](https://github.com/ionic-team/capacitor-keyboard)，MIT，8.0.6；[package](https://github.com/ionic-team/capacitor-keyboard/blob/main/package.json) 的 core peer >=8；有 Package.swift | 让页面知道键盘何时出现、多高，控制 WebView 随键盘调整 | **优先候选**。可在现有 mobile-viewport 控制器下面接入真实原生键盘事件；必须由一个地方统一管理高度，避免 native resize 与 visualViewport 重复上推 | 小型原生桥及 JS 增量，未实测 MiB。iOS 支持 resize 模式；`Keyboard.show()` 官方说明仅 Android 支持，不能许诺 iPhone 任意主动弹键盘。新仓库已从 capacitor-plugins 拆出，勿引用旧目录 |
| [Capacitor Haptics](https://github.com/ionic-team/capacitor-haptics)，MIT，8.0.2；core peer >=8，有 Package.swift | 发送、成功、错误时轻轻震一下 | **可选**，无需改架构；遵循系统设置，限制频率，不把每个流式字块都变成震动 | 小型桥，使用系统反馈硬件；无对应硬件时调用可以成功但没有触感，模拟器不能证明真机触觉效果 |
| [Motion](https://github.com/motiondivision/motion)，MIT；framer-motion 源包14.13.0，[React peer 18/19](https://github.com/motiondivision/motion/blob/main/packages/framer-motion/package.json) | 给消息气泡和面板做弹出、移动、过渡 | **条件候选**。真正适合 React DOM，入口用 motion/react；灯塔已有 CSS 动效，不应为了“高级感”全部重写 | 增加 JS；按需加载并尊重 reduced-motion。没有 native 模型文件，不代表零成本；不得按官网 FPS 宣称灯塔实测达标 |
| [TanStack Virtual](https://github.com/TanStack/virtual)，MIT；react-virtual3.14.26，React peer 包含19 | 长聊天只绘制屏幕附近的消息，减轻负担 | **出现长列表性能瓶颈后试验**。可保留灯塔现有气泡和 HTML，不必换聊天库 | JS 增量。动态图片高度、引用跳转、聊天底部跟随、软键盘、读屏与旧消息加载需一起验证，不能只比空列表滚动 |
| [eventsource-parser](https://github.com/rexxars/eventsource-parser)，MIT，4.1.3 | 把一段段网络数据正确拼成 SSE 事件 | **低侵入的备选**，不接管网络，能保留现有 POST、AbortController、账号检查及 meta/content/thinking/error/done 业务契约 | 纯 JS 解析器，无原生桥和模型。它报告 retry 字段，不自动替应用重发请求；README 有缓冲上限机制。只有当前解析器确有缺口才新增依赖 |
| [Microsoft fetch-event-source](https://github.com/Azure/fetch-event-source)，MIT，2.0.1 | 用 fetch 收流，允许 POST、自定义头和取消 | **不作为默认替换**。确实比浏览器 GET-only EventSource 更接近灯塔，但会改变连接生命周期 | 纯 JS。官方 README 明确隐藏页面时会断开、恢复可见时重连；错误也可自动重试。陪伴聊天 POST 有写入副作用，若无幂等键与明确恢复协议会重复发消息。须禁止未经设计的自动回放 |
| [Vercel AI SDK](https://github.com/vercel/ai)，[Apache-2.0 LICENSE](https://github.com/vercel/ai/blob/main/LICENSE)，ai 源包7.0.170 | 给后台统一接模型、工具、音频和流式 UI | **后台长期选项，当前不整体迁移**。灯塔已适配多供应商和自己的提示词 / 事件协议；不能只换前端 useChat | 依赖范围比单一解析器大；服务器使用时不必把核心框架全放进 IPA。官方 [SDK7发布](https://vercel.com/changelog/ai-sdk-7) 已是2026-06-25，Node22+、ESM；不要按旧v5/v6做选型。GitHub API license=NOASSERTION，但实际 LICENSE 与 package 均明确 Apache2 |
| [Gifted Chat](https://github.com/FaridSafi/react-native-gifted-chat)，MIT，3.5.0；API快照约14,448 stars | RN 完整聊天气泡、输入、回复、历史界面 | **仅参考交互，不装入灯塔**。官方 README 已说明进入维护模式，活跃开发移到下述 fork；高星不代表当前最适合 | 需 RN、gesture-handler、keyboard-controller、reanimated、safe-area-context 等宿主依赖。迁移整个应用的成本远大于增加一个小库 |
| [@kesha-antonov/react-native-chat](https://github.com/kesha-antonov/react-native-chat)，MIT，6.1.5 | Gifted Chat 的活跃后续，含 AI 流式气泡 | **仅借鉴**。源码 peer 要 React19、RN>=0.82，并列出多种 Expo/RN 可选能力；它仍不是 DOM 聊天库 | 不应为其流式光标效果引入整个 RN/Expo 宿主。源码 package 字段未逐项验证所有 peer 是否可选，不能把列出的每项都称必装 |
| [react-native-keyboard-controller](https://github.com/kirillzyusko/react-native-keyboard-controller)，MIT，1.23.0 | RN 键盘随手势移动、粘住输入框、聊天滚动与工具栏 | **仅学习键盘交互策略**。peer 需要 RN 与 Reanimated，不是 Capacitor 插件 | 原生宿主及相关依赖，不能据“lightweight”广告给出灯塔 IPA 增量。可借鉴交互式收键盘和一次只挂一个键盘管理者的原则 |
| [Reanimated](https://github.com/software-mansion/react-native-reanimated)，MIT；main 为4.8.0-main，属开发快照 | RN 多线程动画与手势 | **不接入当前架构**。官方 README：4.x 依赖 New Architecture / Worklets；需对应 RN 版本 | 需要 RN 原生体系，不是 React DOM 可用的动画包；不得把 main 版本当稳定发布。灯塔 DOM 动效比较对象应是 CSS / Motion |
| [Capacitor community STT](https://github.com/capacitor-community/speech-recognition)，MIT，7.0.1，core peer >=7 | 调用系统语音识别，把说话转文字并返回中间结果 | **延后，需要额外适配验证**。名义 peer 可包含8，但仓库树**没有 Package.swift**，当前灯塔为 SPM；不能承诺直接 cap sync 即可 | 使用 AVAudioEngine / SFSpeechRecognizer；需麦克风与语音识别用途说明。检视 iOS 源码未见 requiresOnDeviceRecognition，不能承诺完全离线。必须与现有 MediaRecorder/TTS 互斥，并在退出时停止 |
| [Capacitor community TTS](https://github.com/capacitor-community/text-to-speech)，MIT，8.0.2，core peer >=8，有 Package.swift | 用系统声音朗读，能控制语速、音高、音量、队列、停止 | **作为低成本备用朗读可选**。不能取代现有 MiniMax 情绪 TTS，更不能把调整音高称为情绪模型 | 小型系统桥，不自带大型语音模型；语音资源由系统决定。仍需处理音频打断、耳机路由、静音、锁屏、队列清空和退出停止 |

## 额外的一手证据与集成原则

- [AI SDK7流协议](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) 明确区分纯文本与结构化 UIMessage SSE；结构化协议有自己的 `x-vercel-ai-ui-message-stream: v1` 和消息分段定义。灯塔现有自定义 event/data 不能自动当作兼容协议。若未来采用，应做后台适配器并保留附件、取消、幂等、账号代次和结束/错误语义。
- [Capacitor iOS 插件官方指南](https://capacitorjs.com/docs/plugins/ios) 支持 Swift/Objective-C 自定义桥。SwiftUI 局部原生页面可经 UIHostingController 封装；无需为了“像原生”重写整套 UI。此处是架构建议，未建立或实测新的 SwiftUI 桥。
- [Apple CallKit](https://developer.apple.com/documentation/callkit.md) 面向真正的 VoIP 服务和系统通话协调，后台通信仍由应用负责；不能把它当作普通聊天动效插件。当前不建议加入 CallKit/PushKit。
- [Apple requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition.md) 说明强制本地识别还取决于设备支持。不能因为用了系统 Speech 就承诺音频不经网络。
- 已核实 [AIRI stage-pocket package](https://github.com/moeru-ai/airi/blob/main/apps/stage-pocket/package.json)：它是真实 Capacitor 移动端，使用 keyboard、local-notifications 等，并有 `dev:ios: cap-vite -- ios`。比 RN 聊天库更贴合灯塔宿主。此组尚未核实 AIRI 许可证及所有 catalog 实际版本，交由记忆/陪伴组补齐；不要在此基础上直接复制代码。
- 系统 Keychain 桥和账号隔离是两层能力。换一个安全存储插件不能自动解决 A→B→A 迟到写回；保留已完成的账号容器、SDK 存储撤销、请求和诊断代次检查。
- 所有“包体小/中等”均为源码依赖形态推断，**没有测出 MiB**。要在相同设备架构、Release配置和资源集下分别构建，再比较下载包/安装体积及首屏 JS；不能把 npm unpackedSize 当 IPA 增量。

## 原生通知的交接 TODO（实际代码发现，未修改）

只读检视见 `frontend/src/App.jsx` 约3108行和 `companion-reply-notifier.js` 约114行调用 LocalNotifications.schedule；在 account-cleanup 中未见 cancel/getPending/removeDelivered。App 通知 extra 看见 sessionId，未在本次阅读中确认有账号标签。因此需本地 GPT 复核：退出前已排程或已投递的 A 通知是否继续出现在通知中心；旧通知点击是否可能进入 B 的会话。

这是待验证的隐私缺口，不是已复现的泄露结论。建议按账号标记通知并在退出屏障中取消该账号 pending、清除 delivered、拒绝旧账号点击；未知旧通知不能分配给首个登录用户。不要修改系统其他应用通知，也不要用裸 sessionId 代替账号所有权。这个 TODO 已通知根代理。

## 实际检索范围与 X 限制

实际使用的关键词包括：

- `site:github.com "Chat UI" "React Native" gifted chat keyboard controller`
- `site:github.com "iOS LLM Streaming" "eventsource-parser"`
- `site:github.com Capacitor 中文 语音识别 text to speech`
- `site:capacitorjs.com/docs/apis/keyboard Capacitor 8 resize iOS`
- `site:capacitorjs.com/docs/apis/haptics iOS impact`
- `"@capacitor/keyboard" "github.com" "8.0.4"`
- `"@capacitor/haptics" "github.com" "8.0"`
- `site:x.com capacitor keyboard haptics`
- `site:x.com kirillzyusko "keyboard" "controller"`
- `site:x.com/ziusko "keyboard"`
- `site:x.com/vercel "AI SDK" "7"`

上述 X 严格检索没有得到可可靠归属的相关原作者帖子。直接打开 `https://x.com/ziusko`、`https://x.com/motiondotdev`、`https://x.com/ionicframework` 都返回403。**没有读取其登录后时间线，也未以镜像转帖充当一手证据。** 因此本组选型事实以官方 GitHub、LICENSE、源码 package、官方文档核实；不能声称已“地毯读完 X”。

维护活跃度采用 GitHub API pushed_at 作为观察，不能等同于稳定发布频率。Gifted Chat 即使最近仍有 push，README 的维护模式公告依旧成立；官方 keyboard/haptics 拆仓后 stars 很低，也不能据此判断项目不成熟。

## 建议给用户的简单选项（尚未批准）

- A（推荐）：保留现有架构，接官方键盘事件；轻触反馈可选；按帧合并流式 UI 更新先做性能实验；现有后台记忆和情绪语音继续使用。新增解析/动效/长列表库必须有具体问题和验收再引入。
- B：在 A 基础上另做系统 STT/TTS 试验，明确是否需要服务器、中文可用性、SPM与音频会话兼容，测试通过后才默认开启。
- C：大规模改成 RN / 更换整个模型与聊天框架。当前不推荐，已有业务和隐私回归成本高，不能保证单靠换库更快更小。

如果您不知道选哪个，我强烈建议选 A。以上只是研究建议；用户确认前不安装任何新插件。

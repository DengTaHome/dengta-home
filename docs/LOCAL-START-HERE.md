# 灯塔 iOS 云端成果交接：先看这里

这些文件来自云端 `/workspace/dengta-ios/ios-agent`，**没有自动保存到你的电脑**。你的 D 盘工作区具体路径未知，交接不依赖任何猜测目录。

你只需把交接包交给本地 AI，让它先读 [详细交接文档](LOCAL-GPT-HANDOFF.md)。若包内有 `source` 目录，那是完整源码；有 `evidence` 目录的是测试记录。GitHub 备用下载保留仓库原本目录，文档位于 `docs/`。

- 已有：iOS 工程、安全区与键盘布局改造、Keychain/账号加密缓存实现、自动验证脚本、源码与测试证据、开源研究快照。
- 未完成：原生签名后启动阻断、完整原生 UI 与视觉基准测试、设备 Release IPA、真机安装和续签验收。
- 当前没有可供 iPhone 签名的 IPA。请看 [手机签名说明](PHONE-SIGNING-HANDOFF.md)，不要给源码和 ZIP 签名。

代码在 [GitHub PR #1](https://github.com/DengTaHome/dengta-home/pull/1)，分支 `codex/ios-adaptation`。源码实施截止提交 `70b407d2fad356934a85ab8ff28a4527db2b79da`；交接文档提交可能在其后，应用实现不因此改变。

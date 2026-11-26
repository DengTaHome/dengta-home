# 原生加载页负例

`ios-native-login-loading.png` 是原始、未裁切或重绘的 iPhone SE 模拟器截图。

- 来源：[iOS CI run #5](https://github.com/DengTaHome/dengta-home/actions/runs/43165168653)，artifact `ios-native-layout-43165168653`。
- 源提交：`0e8368eb312bd3a4293f63c7ce11a022c81573aa`；PR merge：`6451929550334f9e617418d68ecaa4cb292ee9f1`。
- 750 × 1334，SHA256：`a8023d77567287dd1a39b23a3fe48e7ee26d2c78a5c8eaac3f12cc5ec50fe024`。
- 使用虚构 CI 登录配置；图中没有用户、密码、凭证或聊天资料。

它复现第三阶段首次原生补验发现的初始化挂起。Vision 门禁必须识别其为 `loading`，不能把“应用进程存活、已经生成 PNG”当作登录界面就绪。正例使用 `docs/screenshots/ios-phase2/iphone-15-pro-login-preview.png`。

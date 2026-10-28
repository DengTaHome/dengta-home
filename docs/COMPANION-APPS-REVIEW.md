# 两个 Cami-Ose 项目深审 + 构建记录

日期：2026-10-29  
范围：`Cami-Ose/muse-toy-broadcaster`、`Cami-Ose/navi-shell`  
许可证：两者均为 MIT（可再分发，但保留版权声明）。

## 结论速览

| 项目 | 类型 | 能否构建 | 能否给所有用户直接用 | 主要阻塞 |
|---|---|---|---|---|
| muse-toy-broadcaster | Android BLE 广播器 | ✅ 已构建/签名 APK | ⚠️ 可独立分发，但需成人场景合规与年龄门槛 | 上游仓库缺 `res/`，已本地补齐；BLE 广播无设备反馈 |
| navi-shell | Android 高德导航 App | ✅ 已构建 debug APK | ❌ 目前不能 | 缺高德 Amap Key；缺 `/access` `/asr` `/proxy_chat` `/tts` 后端 |

## 一、MuSe Toy Broadcaster

### 代码结构
- `BleBroadcaster.kt`：`BluetoothLeAdvertiser` 发 Manufacturer Specific Data，Company ID `0x00FF`
- `Payload.kt`：CRC16 + 双层 whitening（seed `0x3F`、`0x25`），命令 `0x00`–`0x09`
- `ToyService.kt`：前台服务，BLE 广播 + 可选 SSE 长连接
- `SseClient.kt`：从 VPS `/events?page=sex&kind=app` 收命令
- `Prefs.kt`：SharedPreferences 保存 VPS 地址/Token
- 零第三方运行时依赖，minSdk 26 / targetSdk 35

### 构建问题（重要）
上游仓库**没有 `app/src/main/res/`**，但 Manifest/`MainActivity` 引用了：
`@drawable/ic_launcher`、`@string/app_name`、`@style/Theme.ToyBroadcaster`、`R.layout.activity_main`、多个 View id。

因此原仓库 `assembleDebug` 直接失败：
`AAPT: resource drawable/ic_launcher not found`、`string/app_name not found`、`style/Theme.ToyBroadcaster not found`。

本机已补齐最小可用资源：
- `res/values/strings.xml`（app_name）
- `res/values/themes.xml`（平台 Material Light NoActionBar）
- `res/drawable/ic_launcher.xml`（简单矢量图标）
- `res/layout/activity_main.xml`（VPS 地址、Token、保存、广播开关、状态、日志）

补齐后：
- `:app:assembleDebug` ✅
- `:app:assembleRelease` ✅
- 使用独立 keystore 签名：`com.muse.toybroadcaster` v1.0 / versionCode 1
- 产物：`_audit/DengTa-MuseToy-1.0.apk`（约 0.63 MB，v2/v3 签名通过）

### 安全/隐私审查
- Manifest 设置 `android:usesCleartextTraffic="true"`，SSE 若用 `http://` 会明文传 Token；应强制 HTTPS，至少给用户明确警告。
- VPS Token 存在 SharedPreferences（明文）；无加密、无证书绑定。
- BLE 广播本身无认证：附近任何知道 payload 的人都能模仿；这是协议层限制，不是 App bug。
- 命令强度映射未标注（`0x01`–`0x09` 需实机标定），建议首次使用从最低档开始。
- 前台服务 + `BLUETOOTH_ADVERTISE/SCAN/CONNECT` 权限校验完整；Android 13 通知权限处理正确。
- 远程 SSE 地址和 Token 为空时完全本地广播，不上传数据。

### 给所有用户的可行路径
1. **独立 APK 分发**（最现实）：需要年龄门槛/成人内容提示、隐私政策、稳定签名证书、后续更新源。
2. **并入 DengTa Android**：把 `BleBroadcaster/Payload/CommandMapper` 做成 Capacitor 插件；DengTa 已有前台服务、通知和权限体系，但需新增 BLE 权限与独立开关。
3. **远程控制**：DengTa 后端加一个受鉴权的 SSE 通道 + 控制 UI，App 侧只做 BLE；注意端到端鉴权、限速、审计、可紧急停止。
4. 无论哪种，先做「紧急停止」和「断开即停止」的硬件/软件兜底。

## 二、Navi Shell

### 代码结构
- 高德 SDK 负责算路/定位/转向/测速；`setUseInnerVoice(false)` 接管播报文本
- Compose UI（`NaviScreen`、`FootprintsPanel`）
- `NaviService` 前台服务保证锁屏继续播报
- 语音链路：`WavRecorder` → `/asr` → `/proxy_chat` → `/tts`，预录词表优先
- 出行记录/足迹/常用地点：`/api/navi/*`
- `AuthStore`：`GET /access` 换 `gate_auth` cookie，后续所有请求带 cookie
- 配置：`local.properties` 的 `sdk.dir`、`amap.key`、`app.base.url`、`app.auth.token`

### 构建结果
本机配置：
- `sdk.dir=D:/GZdeepseek/_tools/android-sdk`
- `amap.key=`（空）
- `app.base.url=https://dengta-home-backend-rkmq.onrender.com`
- `app.auth.token=`（空）

`:app:assembleDebug` ✅（1m54s）。高德 SDK 的 `.so` 未 strip，属正常提示。

### 为什么现在不能给所有用户用
1. **高德 Key 绑定「包名 + 签名 SHA1」**：没有你申请的 Key，地图空白、定位停在「正在定位…」；空 Key 的 APK 只能作为编译验证包。
2. **后端接口不匹配**：App 调 `/access`、`/asr`、`/proxy_chat`、`/tts`、`/api/navi/*`；DengTa 生产后端没有这些路由。
3. **签名一致性**：高德 Key 必须与最终发布证书 SHA1 匹配；换签名必须重新申请 Key。
4. **隐私合规重**：后台定位、麦克风、轨迹、录音上传都需要明确授权、隐私政策和最小化存储。

### 给所有用户的可行路径
- **方案 A（最快）**：用户自带高德 Key + 自建后端，App 作为开源工具分发；不是「所有用户开箱即用」。
- **方案 B（推荐产品化）**：在 DengTa 后端实现导航适配层（`/access`、`/asr`、`/proxy_chat`、`/tts`、`/api/navi/*`），用 DengTa 账号鉴权、人设/记忆/TTS；客户端用统一签名构建。
- **方案 C（深度集成）**：把高德 SDK + 导航前台服务并入 DengTa Android 主包，作为「导航模式」；需要主包签名密钥/CI secrets（当前 GitHub Actions 额度阻塞），且包体/权限会变大。
- 无论哪个方案，先补：导航结束自动停止录音、轨迹脱敏/保留期限、后端接口鉴权与限流、驾驶中禁止复杂交互。

## 三、已加入长期追踪

`tools/repo-watch/repos.json` 已加入：
- `Cami-Ose/muse-toy-broadcaster`
- `Cami-Ose/navi-shell`
- `dengtahome/dengtahome`（CNB `frontend-main` 分支）

`docs/REPO-WATCH.md` 每日 09:10 由 Windows 任务 `DengTaRepoWatch` 刷新；本次已跑通，0 错误。

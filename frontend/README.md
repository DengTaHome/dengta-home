# DengTa Home · 灯塔的家

> 维护提示：此目录是公开镜像的旧快照，可能落后于当前前端源码。生产修复请以 `_refs/frontend-gh` 为准；不要用本目录直接 rebuild，否则会回退手机适配与首屏修复。`frontend/dist` 仅用于本地浏览器验证，可能来自更新构建。

面向成年用户的 AI 陪伴应用，围绕持续对话、个性化角色、长期记忆与共同活动构建。DengTa Home 把聊天、日记、音乐、观影和创作放在同一个日常空间中，并提供浏览器、PWA 和 Android 体验。

An AI companion app for adults, built around continuous conversation, personal characters, long-term memory, and shared activities. This repository contains the React web client and Capacitor Android app.

[配套后端](../backend/README.md) · [版本与下载](https://github.com/DengTaHome/dengta-home/releases) · [问题反馈](https://github.com/DengTaHome/dengta-home/issues)

## 项目介绍

DengTa Home 的核心是一个可以持续积累关系与经历的 AI 伴侣。用户可以保存自己的个性化指令、用户详情与伴侣档案，选择模型供应商，并在独立会话中继续聊天。记忆、世界书、日记和共同活动为后续对话提供背景。

项目采用前后端分离架构。这个仓库负责界面、浏览器体验与 Android 原生能力；模型调用、账号范围、持久化和外部服务集成由后端负责。模型能力、上下文窗口、服务可达性及供应商策略由实际选择的服务决定。

## 主要功能

| 能力 | 当前源码中的实现 |
| --- | --- |
| 连续聊天 | 流式回复、聊天会话、会话模型选择、引用回复、聊天建议、附件与错误回执 |
| 个性化与记忆 | 个性化指令、用户详情、伴侣档案、稳定记忆、聊天摘要、世界书及可选外部记忆连接 |
| 日常陪伴 | 动态栏、日记、动态内容、纪念日、陪伴活动与成就 |
| 一起看与一起听 | 视频/网页共看、放映厅、音乐库与播放队列、网易云扫码入口及音乐解读界面 |
| 创作与资料 | 绘画、创作收藏、灵感、内容导入与用户工作区 |
| 语音与工具 | 语音输入/输出设置、模型供应商控制台与 MCP 连接管理 |
| 多端体验 | 响应式网页、PWA 安装、Android 通知、设备活动与经用户授权的屏幕共看 |

这些是代码包含的功能范围。可选功能需要相应后端、数据库表、外部服务、设备权限及模型能力；功能存在不代表所有设备和生产流程已经完成验收。

## 如何使用

1. 打开运营方提供的网页，或安装其发布的 Android APK，注册/登录账号并完成必要的邮箱确认。
2. 在设置中填写个性化指令、用户详情和伴侣档案，按需管理记忆与世界书。
3. 打开“多供应商 API 控制台”，配置自己的接口地址、凭据和默认模型；已有会话可以选择自己的会话模型。
4. 回到聊天页发送消息，按需使用引用、附件、语音和聊天建议。
5. 在“一起看/一起听”、日记、创作或工作区中开始共同活动。功能提示缺少服务或权限时，先完成对应配置。

用户可在设置中选择亲密与成人表达。表达方式仍取决于所选模型及供应商；应用设置无法覆盖外部服务的策略。

PWA 安装：iPhone/iPad 使用 Safari 的“分享 → 添加到主屏幕”；Android 使用浏览器的“安装应用”或“添加到主屏幕”；桌面浏览器在支持时提供安装入口。网页和 Android 使用同一后端时共享账号与服务器数据。锁屏通知、后台设备活动和屏幕共看等原生能力需要 Android 安装版与相应权限。

## 技术栈

- Node.js **24.x**、npm。
- React **19**、Vite **8**、JavaScript ES Modules。
- Capacitor **8**；Android 最低 **12 / API 31**，当前源码目标 SDK 为 **36**。
- Supabase Auth 客户端、Lucide 图标、Three.js 与本地字体资源。
- 配套服务：Node.js/Express 后端与 Supabase 数据层。

## 本地开发

先按[后端说明](../backend/README.md)准备一个独立开发环境。这个前端不是离线模型服务，需要可达的后端、Supabase Auth 与可用模型接口。

以下命令使用 Windows CMD：

```cmd
git clone https://github.com/DengTaHome/dengta-home.git
cd dengta-home\frontend
npm ci
copy .env.example .env.local
```

编辑 `.env.local`，填入自己的开发配置：

| 变量 | 用途 |
| --- | --- |
| `VITE_API_URL` | 后端地址；本地通常为 `http://localhost:3000` |
| `VITE_SUPABASE_URL` | 自己的 Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable key，或仍在使用的 legacy anon key |
| `VITE_PUBLIC_AUTH_REDIRECT_URL` | 登录/邮件确认后的公开回跳地址；需与自己的 Supabase Auth 配置一致 |

`VITE_*` 会进入客户端构建产物。这里不能填写 Supabase secret/service-role key、模型 API key、登录 Cookie 或服务器共享密钥。[Supabase API key 说明](https://supabase.com/docs/guides/getting-started/api-keys)。

```cmd
npm run dev
```

使用终端显示的本地地址，默认是 `http://localhost:5173`。更改构建环境变量后重新启动开发服务或重新构建。

## 检查与构建

```cmd
npm run lint
npm run typecheck
npm test
npm run build:web
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务 |
| `npm run build` | 构建网页到 `dist/` |
| `npm run build:web` | 构建并检查公开认证配置是否进入产物 |
| `npm run preview` | 本地预览 `dist/`；不替代生产部署 |
| `npm run android:sync` | 将网页产物和 Capacitor 配置同步到 Android 工程 |

完整测试与定向测试入口见 [`package.json`](package.json)。缺少公开认证变量时，登录页会提示登录服务未接通，`build:web` 的认证产物校验也会失败。

## Android 开发

安装 Android Studio、Android SDK 和 Android 工程要求的 JDK，并先完成前端环境配置。应用 ID 为 `home.dengta.app`。

```cmd
npm run build:web
npm run android:sync
cd android
gradlew.bat :app:assembleDebug
```

调试 APK 输出在 `android/app/build/outputs/apk/debug/`。仓库的 [Android Actions 工作流](.github/workflows/android-apk.yml)也提供调试构建。调试签名用于测试；正式分发需要发布方确认签名、升级兼容性、真机安装与发布资产。每个 Release 应以该版本说明中的签名、校验值和验收状态为准。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/` | React 界面、客户端状态和 API 集成 |
| `public/` | PWA、字体及静态资源 |
| `android/` | Capacitor Android 工程及原生插件 |
| `scripts/` | 构建、配置核验和开发辅助脚本 |
| `test/` | 客户端与组件回归测试 |
| `docs/` | 架构决策及工程文档 |

## 发布与验证状态

仓库公开、构建成功和全功能生产验收是不同状态。当前源码的真机安装/帧率、实际账号登录与供应商调用、Supabase 管理面与生产 RLS、多账号完整隔离、外部音乐和视频服务完整流程仍需结合发布版本逐项验收。

音乐/视频播放能力受服务授权、资源可用性、设备与浏览器限制影响。外部播放器的控制和进度只有在操作系统/第三方播放器提供相应能力时可用。持续对话通过历史、摘要和记忆机制维持连续性，实际请求仍受模型上下文与接口限制。

## 反馈与贡献

在 [Issues](https://github.com/DengTaHome/dengta-home/issues) 中说明版本、设备/浏览器、复现步骤、预期结果和实际结果。涉及模型时补充供应商类型与脱敏错误码。不要上传真实聊天、用户个性化原文、邮箱、登录 Cookie、密钥或完整私密日志；使用虚构数据复现。

提交改动前运行相应检查，保留用户个性化内容、记忆及现有提示词装配契约。涉及后端行为时同时说明配套后端版本和数据库要求。

## 许可证与第三方资源

本公开发行版的项目源码适用根目录的 [ISC License](../LICENSE)。第三方代码和资源继续适用各自许可证，详见[第三方归属说明](../THIRD_PARTY_NOTICES.md)与[资源说明](../ASSETS.md)。

第三方依赖和资源适用各自许可证。本地字体的授权说明见 [`public/fonts/README.md`](public/fonts/README.md) 及同目录的 OFL 文件，分发时应保留对应声明。

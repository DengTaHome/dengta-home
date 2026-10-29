# 同源登录代理（2026-10-29）

## 背景
手机/国内网络访问 `*.supabase.co` 出现 TLS reset，导致全新安装后无法登录；`www.dengtahome.com` 与后端 Render 均正常。

## 实现
- `vercel.json` 增加 rewrite：
  `/supabase/:path*` → `https://nyyqizwrlmejpfdhgrnd.supabase.co/:path*`
- Vercel 项目环境变量 `VITE_SUPABASE_URL` 改为：
  `https://www.dengtahome.com/supabase`
- 本地 `.env.local` 同步改为同源 URL，重新构建 APK
- 前端 `auth-session.js` 自动拼 `/auth/v1`，无需改代码
- 原有邮箱/密码/OTP/刷新逻辑不变；CSP 的 `connect-src 'self' https:` 允许同源

## 验证
- PC：`/supabase/auth/v1/health` 200（带 anon key），401（无 key，正常）
- **手机 curl：同源 auth health = 200**（不再 connection reset）
- 线上 `auth-session-*.js` 已包含 `www.dengtahome.com/supabase`
- APK `DengTa-2.13.44-302-proxy-auth-newkey.apk`（SHA-256 `29c7cf48…`）已安装到 vivo V2454A，启动正常
- 旧 APK 的直连 Supabase 配置已被同源代理替换

## 注意
- Vercel rewrite 只代理 Auth 路径，不代理 Supabase Storage；APK 更新文件的 Storage 域名仍可能被网络阻断，但登录/会话刷新已不再依赖直连。
- 若 Vercel 域名本身不可达，代理也会不可用。

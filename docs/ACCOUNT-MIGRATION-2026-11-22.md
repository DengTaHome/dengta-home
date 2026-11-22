# Google 账号封禁后的迁移记录（2026-11-22）

> 2026-11-22 更新：原定新账号 `naiyouhaochi520@gmail.com` 已不可用，迁移目标改为 `2458077782sans@gmail.com`。

## 已知影响

- 旧 Google 账号：`tnineninet@gmail.com`（已封禁，不能作为唯一恢复入口）
- 新 Google 账号：`2458077782sans@gmail.com`（当前已登录，Google 服务可能需要设备/手机验证）
- 新账号密码由用户持有，不写入本文档、仓库或聊天。

## 当前平台身份（审计时）

| 平台 | 当前登录/邮箱 | 迁移目标 | 状态 |
|---|---|---|---|
| GitHub | 账号 `DengTaHome`；已验证 `buyaocaowo555@gmail.com`；`tnineninet@gmail.com` 为主邮箱但未验证；组织 `tnineninet` 有 `DengTaHome` 与 `Jessica-tce` 两位 Owner | 新 Gmail 加入组织并给 Owner；旧 Gmail 降级/移除 | 进行中 |
| Vercel | `tnineninet@gmail.com`，team `buyaocaowo555-9312s-projects`，GitHub 登录 | 新 Gmail 加入账号/团队并给 Owner | 待操作；Hobby 团队邀请成员需 Pro |
| Render | owner/workspace `dengta`，邮箱 `tnineninet@gmail.com`，GitHub 登录；Hobby，团队邀请需 Pro | 改工作区邮箱为新 Gmail；保持 GitHub 登录可用 | 待操作 |
| Supabase | Organization `buyaocaowo555-collab's Org`，Owner `tnineninet@gmail.com` 与 `buyaocaowo555@gmail.com` | 邀请 `2458077782sans@gmail.com` 为 Owner | 待操作 |
| CNB | 微信登录账号 `cnb.covlGfKahIA`，仓库 `dengtahome/dengtahome` | 继续使用当前 CNB 账号；同步最新源码；新 Google/GitHub 账号作为备份入口 | 进行中 |
| Cloudflare | `dengtahome.com` NS 在 Cloudflare；账号无法登录 | 恢复账号或转移 DNS | 阻塞，需用户人工处理 |
| Google 账号 | 新账号已登录；旧账号封禁 | 新 Gmail 作为长期恢复邮箱 | 进行中 |

## 迁移顺序

1. GitHub：新 Gmail 加入组织 `tnineninet` 并给 Owner；验证新邮箱；旧邮箱降级/移除。
2. Vercel：新 Gmail 加入 Vercel；把 team/project 所有权转过去；Hobby 限制需升级或改主邮箱。
3. Render：更新 workspace 邮箱；保留 GitHub 登录方式；团队邀请受 Hobby 限制。
4. Supabase：邀请新 Gmail 为 Organization Owner；转移项目/账单。
5. CNB：上传最新工作区源码；确认新账号有仓库权限。
6. Cloudflare：人工恢复后，把新 Gmail 加为成员并转移域名。
7. 轮换 GitHub PAT、Vercel/Render/Supabase/CNB token；更新 `_credentials`；删除旧 token。
8. 验证：从新账号登录 GitHub/Vercel/Render/Supabase/CNB，确认能访问项目；从 CNB clone 验证源码完整。

## 2026-11-22 执行记录

- 已在浏览器中登录 CNB、Vercel、Render、Supabase、GitHub、新 Google 账号。
- GitHub：已向 `2458077782sans@gmail.com` 发出组织 `tnineninet` 的 **Owner** 邀请；当前显示 `login: null`，说明该邮箱还没有对应 GitHub 账号，需要新账号注册后接受邀请。当前 GitHub 账号 `DengTaHome` 的已验证邮箱是 `buyaocaowo555@gmail.com`；`tnineninet@gmail.com` 仍为主邮箱但未验证。
- Supabase：已向 `2458077782sans@gmail.com` 发出 Organization **Owner** 邀请，页面显示 INVITED，需要新账号接受。
- Vercel：尝试添加 `2458077782sans@gmail.com`，页面要求输入 Vercel 6 位 2FA 验证码；尚未完成。Hobby 团队限制邀请成员，建议优先完成邮箱验证并设为主邮箱。
- Render：Hobby 工作区限制邀请成员；工作区邮箱仍为 `tnineninet@gmail.com`，需在 Settings → General → Email 修改或升级 Pro。
- CNB：当前登录账号 `cnb.covlGfKahIA` 对 `dengtahome/dengtahome` 没有仓库写权限；使用新建访问令牌 push 返回 `Repository Not Found`。需要改用拥有 `dengtahome` 组织权限的账号（GitHub 登录）或先把当前账号加入仓库。
- Cloudflare：无法登录，DNS 迁移暂缓。
- 本地备份：`D:\GZdeepseek\backup\workspace-snapshot-20261122\`（完整源码 ZIP + 各仓库 bundle + 未提交 patch + manifest）。
- CNB 工作区快照已生成：`D:\GZdeepseek\_incoming\cnb-workspace-20261122\`（3060 文件，约 95MB，待有权限的 CNB 账号推送）。

## 迁移期间安全规则

- 不在聊天、日志、仓库中写密码/token。
- 旧 Google 账号的 OAuth 授权到期前完成上述迁移；不要只依赖旧账号的浏览器会话。
- 迁移期间保留旧账号访问，直到新账号全部验证通过。
- Cloudflare 未恢复前，不要改 DNS/域名注册信息，避免双重故障。

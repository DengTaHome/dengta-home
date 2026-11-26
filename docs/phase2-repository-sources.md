# 阶段二：GitHub / CNB 源码来源核对

核对日期：2026-11-11，UTC 07:52 起。此记录仅用于已授权的 iOS UI 适配参考；没有推送、部署、触发远程工作流或修改原仓库。对照基线固定为本地沙箱提交 `3401fb1ea7ad971df93015f9096af8539cfd9802`，不是后续可能变化的工作区文件。

## 已确认的仓库

- GitHub：[DengTaHome/dengta-home](https://github.com/DengTaHome/dengta-home)。本地沙箱的源仓库也是这个地址。
- GitHub 私有前端：[DengTaHome/dengta-home-frontend](https://github.com/DengTaHome/dengta-home-frontend)。主任务通过已连接 GitHub 工具核对其 `main` 元数据与版本；本报告没有复制私有仓库源码或配置。
- 腾讯 CNB：[dengtahome/dengtahome](https://cnb.cool/dengtahome/dengtahome)。这是仓库内已有明确引用的地址，并非根据名称猜测。

CNB 地址的本地来源证据：

- [`docs/REPO-WATCH.md`](REPO-WATCH.md) 第 24 行记录该地址及历史 `frontend-main` 提交 `4916b678`。
- [`docs/REPO-WATCH-STATE.json`](REPO-WATCH-STATE.json) 对应记录的检查时间是 `2026-11-02T01:20:22.960Z`；它只能证明当时的结果。
- [`tools/repo-watch/repos.json`](../tools/repo-watch/repos.json) 登记 `cnbRepos: ["dengtahome/dengtahome"]`。
- [`tools/repo-watch/watch.mjs`](../tools/repo-watch/watch.mjs) 的第 149–158 行实际以 `git ls-remote` 查询该 CNB 地址的 `refs/heads/frontend-main`。
- [`docs/DEPLOY-SCHEDULE.md`](DEPLOY-SCHEDULE.md) 第 7–8、28 行说明 CNB 为镜像，前端同步目标为 `frontend-main`。这些部署记录没有在本次执行。

## 本次实时读取到的分支

以下完整 SHA 来自公开 Git 的 `ls-remote`，无需账号或令牌。提交时间与标题来自临时参考仓库中对应提交，版本来自对应 `package.json`；未读取生产 env 文件。

| 平台 / 分支 | 实时 SHA | 提交时间 / 前端版本 | 结构及用途 |
| --- | --- | --- | --- |
| GitHub `main` / `HEAD` | `77472defa5db873ba07d48e3f8b4149d3b278daa` | 本次未重新提取日期；前端 `2.10.74` | 公开 monorepo，含 `frontend/`、`backend/`、`docs/` |
| GitHub `codex/ios-adaptation` | `3401fb1ea7ad971df93015f9096af8539cfd9802` | 2026-11-11 00:04:15 +08:00；`2.10.74` | 当前 iOS 沙箱继承的提交 |
| GitHub 私有前端 `dengta-home-frontend/main` | `f8fa26aed2bdff46505b32a0115952fa3b92c896` | `2.13.43`；由主任务通过连接器核对 | 与 CNB `frontend-main` 当前完整提交 SHA 一致 |
| CNB `frontend-main` | `f8fa26aed2bdff46505b32a0115952fa3b92c896` | 2026-11-06 18:03:09 +08:00；`2.13.43` | 独立前端仓库结构，源码在根目录 `src/`；当前较新的前端参考 |
| CNB `backend-main` | `b1d606302eac974955e88160199eda0c4c1500ce` | 本次只读分支 ref，未获取其版本或源码内容 | 此阶段未纳入 UI 实现 |
| CNB `opensource-main` | `766e47c9bd59e6dd51f7f0ed240909d97cf660f1` | 2026-10-18 16:25:23 +08:00；`2.10.74` | monorepo，前端位于 `frontend/` |
| CNB 默认 `main` / `HEAD` | `f2e1553cbdd2f402f05a4ad21c740f6b100479da` | 2026-08-10 21:03:39 +08:00；`2.8.12` | 较旧 monorepo；默认分支不能代表最新前端 |

固定提交链接：[GitHub 沙箱基线](https://github.com/DengTaHome/dengta-home/commit/3401fb1ea7ad971df93015f9096af8539cfd9802)、[CNB frontend-main 对照提交](https://cnb.cool/dengtahome/dengtahome/-/commit/f8fa26aed2bdff46505b32a0115952fa3b92c896)、[CNB opensource-main 对照提交](https://cnb.cool/dengtahome/dengtahome/-/commit/766e47c9bd59e6dd51f7f0ed240909d97cf660f1)。

本次 CNB `frontend-main` 提交标题为 `Merge QQ cloud onboarding, AstrBot export, and screen glance`；`opensource-main` 为 `Publish verified Android 122 update manifest`；默认 `main` 为 `Add cancellable long-running model requests`。版本号、分支名和提交时间共同证明三条分支不是可以互换的同一份源码。

主任务另通过 GitHub 连接器确认：私有前端 `main` 与 CNB `frontend-main` 的完整 SHA、包版本都一致；公开 monorepo `main` 仍是 `77472de`。当前较新的前端参考因而有 GitHub 与 CNB 两边互证，但本阶段依然保留公开 iOS 提交 `3401fb1` 作为实现基线，不进行整仓覆盖。

## 与 iOS 沙箱基线的 UI 文件比较

比较将 CNB 独立前端的根目录映射到沙箱 `frontend/`。只读取指定 UI 文件与包版本，没有整体覆盖、合并或复制生产配置。

| 文件 | 沙箱 `3401fb1` | CNB `frontend-main` | CNB `opensource-main` |
| --- | --- | --- | --- |
| `src/ios.css` | 已存在，1328 字节 | 不存在 | 不存在 |
| `src/mobile-viewport.js` | 5645 字节 | 5916 字节；有一处键盘滚动调度修正 | 与沙箱逐字节一致 |
| `src/auth.css` | 11096 字节 | 13229 字节；新增登录帮助等样式，也有触控目标回退 | 10976 字节；不含沙箱已有的 44px 触控目标修正 |
| `src/index.css` | 211235 字节 | 269608 字节；与沙箱不同 | 211181 字节；与沙箱不同 |
| `src/main.jsx` | 5868 字节；有 iOS 平台标记与原生回跳处理 | 8932 字节；与沙箱不同 | 3681 字节；与沙箱不同 |

`frontend-main` 的 `package.json` 将 `@capacitor/core` 固定为 `8.4.3`，但没有 `@capacitor/ios` 依赖；另两条 CNB 分支也没有该依赖。因此不能把 CNB 的更新直接当成已经完成的 iOS 版本。

### 与当前 UI 阶段直接相关的差异

1. **键盘滚动反馈循环。** 新前端的 [`src/mobile-viewport.js`](https://cnb.cool/dengtahome/dengtahome/-/blob/frontend-main/src/mobile-viewport.js) 在原 `schedule()` 后新增 `scheduleScroll()`：键盘打开时不由 `visualViewport.scroll` 再次调度高度写入，`resize` 仍正常调度；监听器清理也改为移除 `scheduleScroll`。这是该文件与沙箱的唯一实质差异，可作为本轮键盘 UI 验证的独立候选，不能跳过真实视口测试就宣布修复。
2. **登录页样式并非全面改善。** 新前端的 [`src/auth.css`](https://cnb.cool/dengtahome/dengtahome/-/blob/frontend-main/src/auth.css) 新增密码显隐、验证提示、网络帮助、重试和结果样式；移动端还设置 `auth-scene` 最小高度与 `auth-panel` 上边距为 `16dvh`。同时它把安装按钮最小高度从沙箱的 44px 改成 42px，并移除了 `auth-text-button` 的 44px 最小高度和内边距。这些变化需要逐项评估，不能整体覆盖现有 iOS 触控修正。
3. **样式与组件必须配套。** 新登录样式对应的额外界面流程不能仅靠复制 CSS 获得；该阶段不顺带升级认证、供应商、QQ、导出或屏幕共看业务。
4. **保留 iOS 分支资产。** 三条 CNB 对照分支均无 `src/ios.css`，也没有本次 iOS 依赖；重置到 CNB 分支会丢失已有适配。保持 `3401fb1` 为实现分叉基线，以 CNB 指定提交为 UI 参考来源。

用于复核的 SHA-256：

| 文件 / 来源 | SHA-256 |
| --- | --- |
| 沙箱 `src/mobile-viewport.js` | `4cf8afa099e9f3cd1bec0d7a4428b91c6a619b0115d189a086becb02298779b0` |
| CNB frontend-main `src/mobile-viewport.js` | `d52e688440d0b243dfe36e448630e3ab91005175e951b25e6bad42f1b1967da9` |
| CNB frontend-main `src/auth.css` | `e17f03280cd30cea43966a5954926380e9a5a515b3d99555c815670595178648` |
| CNB frontend-main `src/index.css` | `36dc1e63784010e62a34e5578dab97726fd400898ee790f7fddbb709a367d8bd` |

## 访问结果与边界

- 按名称进行的公开搜索没有返回结果；这不表示 CNB 仓库不存在。
- Web 阅读工具未能打开 CNB 页面；普通 HTTPS 请求返回 200，公开 Git 分支查询和指定文件读取成功。因此本次结果是“公开只读访问可用”，不是“无权限”或“未找到”。
- 默认受限执行命令起初无法连接环境代理；按环境网络规范在获准的外层执行相同只读请求后成功。报告不保存响应 Cookie、令牌或认证头。
- 临时参考仓库位于 `/tmp/cnb-dengtahome-references`，采用浅层、按需 blob 获取，不修改 `/workspace/dengta-home` 或沙箱 Git 分支。后续分支更新应重新读取 ref，不能以本文 SHA 充当持续最新证明。
- 本阶段仅完成来源确认和指定 UI 文件比较；没有认定 CNB 的所有新功能、生产配置或测试状态已经在当前 iOS 沙箱实现或验收。

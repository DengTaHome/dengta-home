# 交接证据索引

实施代码截止 `70b407d2fad356934a85ab8ff28a4527db2b79da`。本目录只保存固定字段与已脱敏的测试摘要，不含用户凭证。

- `SECURITY-RUN9.json`：macOS [运行 43242777530](https://github.com/DengTaHome/dengta-home/actions/runs/43242777530) 的实际专项报告，23/23 文件、157/157 命名用例、另 2 个脚本通过。
- `FRONTEND-NPM-TEST.json`：本地完整 `npm test` 一次从头到尾退出 0 的记录；不是将分段结果拼成一次成功。随后 `6e50a0e` 的远程完整前端 CI 也通过。
- `native-43168863750`：运行 #8，加载器修复后已离开 loading，但真实登录画面显示安全存储不可用，OCR 正确判失败。原始图在测试附件与 [原产物](https://github.com/DengTaHome/dengta-home/actions/runs/43168863750/artifacts/13921722202)。
- `native-43242777530`：运行 #9，无签名真实 Keychain 返回 -34018；Simulator ad-hoc 签名文件校验通过，重装后却无法启动，没有 signed Keychain 成功收据和新的页面截图。`simulator-ci-signature.json` **只表示静态签名校验**，不表示 App 可启动。
- `CODE-COMMITS.txt`：本次相对公开基线的实施提交列表。交接文档提交可能在列表之后。

Manifest 的 `build.commit` 是 Actions 实际构建的 PR 合并 SHA，可能与源分支 head SHA 不同，不能因此把结果误判为另一版本。

GitHub Actions 原始附件有保留期限（此次 14 天）；交接测试附件 ZIP 内已保存本机取得的关键文件。历史第二阶段三机成功登录图不代表当前安全版本已经通过验收。

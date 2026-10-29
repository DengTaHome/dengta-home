# 更多回复弹层与打字冲突修复（2026-10-29）

## 反馈
- 「更多回复」弹出来后，输入框打不出字
- 打字会取消/收起自动弹出的回复建议
- 自动回复建议希望只在**点发送**或**用户主动收起**时关闭

## 原因
`App.jsx` 有一段：

```js
input.addEventListener("input", closeOnType);
```

第一次 input 事件就 `setReplyOptionsOpen(false)`，弹层卸载导致 React 重渲染、输入框丢失焦点，所以表现为“打不出字”；同时这违反“只有发送/主动关闭才收起”的预期。

自动弹层在用户已经输入草稿时仍会定时打开，也会打断输入。

## 修复
- 删除 `input` 事件自动收起逻辑
- 自动弹出前检查：
  - 输入框已有文字 → 不自动弹
  - 输入框正在聚焦/用户正在输入 → 不自动弹
- 保留的关闭路径只有：
  - 点发送（`sendMessage` 里 `setReplyOptionsOpen(false)`）
  - 点弹层右上角「收起回复选项」
- 点某句建议仍会填入输入框，不强制关闭；用户可继续改或发送
- 提示文案改为「输入不会收起，发送或点收起后才关闭」

## 验证
- 真实 Edge + 390×844 + 真实账号：
  - 打开「更多回复」，输入“这是一次输入测试”，值完整保留
  - 输入后弹层仍存在（`popoverAfterTyping=1`）
  - 输入框仍保持焦点
  - 点收起后弹层关闭
  - 无 pageerror
- 单测 `test/reply-options-trigger.test.js`：5/5 通过（新增输入不收起回归）
- `npm run build` 成功
- 截图：`_audit/reply-options-typing.png`

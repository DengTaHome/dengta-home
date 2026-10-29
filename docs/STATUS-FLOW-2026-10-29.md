# 彩虹胶囊状态栏光子流动效果恢复

## 现象
用户反馈彩虹胶囊弹出的状态面板里原来的“光子流动/流体”效果没有了。

## 原因
`StatusFlowField.jsx` 里有一段针对手机的性能降级：

```js
if (globalThis.matchMedia?.("(max-width: 820px)").matches === true) {
  canvasRef.current?.parentElement?.classList.add("status-flow-field--fallback");
  return undefined;
}
```

所有 ≤820px 手机都被强制改用静态玻璃背景，`status-fluid-engine` 完全不初始化，所以效果消失。

旧版公开镜像 `dengta-home/frontend/src/StatusFlowField.jsx` 没有这段手机 fallback，确认是后来加的性能优化过度。

## 恢复
- 移除 `max-width: 820px` 全局降级
- 仅当 `navigator.connection.saveData === true` 时使用静态 fallback
- 保留 reduced-motion 阻断
- 引擎本来就有移动端 dye resolution 640（桌面 768），并只在状态面板打开/指针交互时绘制

## 验证
- 390×844 打开状态面板：`.status-flow-field--ready`，canvas 存在
- 指针按下拖动后截图出现绿/蓝/青流体（见 `_audit/browser-surfaces/status-flow-390x844.png`）
- 320/360/390/844/915 状态面板均正常打开
- 注意：该效果是**指针/触摸驱动的**，不拖动时保持黑色静态底，这是原版行为

/**
 * SlidingIndicator 的几何计算。
 *
 * 单独成文件的原因：组件文件只应导出组件（react-refresh 规则），
 * 而这些纯函数需要被测试直接导入。
 *
 * 逻辑从生产前端产物的编译结果逐字对读得到，未做推测性改动。
 */

/**
 * 计算指示器应当落在哪里。
 * 返回 null 表示「现在不该显示」（缺少元素、尺寸为 0、或对象不像元素）。
 */
export function measureIndicator(container, active) {
  if (!container || !active) return null;
  if (
    typeof container.getBoundingClientRect !== "function" ||
    typeof active.getBoundingClientRect !== "function"
  ) {
    return null;
  }

  const containerBox = container.getBoundingClientRect();
  const activeBox = active.getBoundingClientRect();

  // 布局尚未完成时（或元素被隐藏时）不要画，否则会出现一条 0 宽的发丝线。
  if (
    activeBox.width < 1 ||
    activeBox.height < 1 ||
    containerBox.width < 1 ||
    containerBox.height < 1
  ) {
    return null;
  }

  return {
    left: activeBox.left - containerBox.left + (container.scrollLeft || 0),
    top: activeBox.top - containerBox.top + (container.scrollTop || 0),
    width: activeBox.width,
    height: activeBox.height,
  };
}

/** 几何未变就不需要重绘，用它做比较键。 */
export function boxKey(box) {
  return box ? `${box.left}|${box.top}|${box.width}|${box.height}` : "";
}

export default function ChatContextSettings({ settings, onChange }) {
  const turns = Number(settings.context_turns) || 0;
  const automatic = turns <= 0;
  return (
    <div className="chat-context-settings">
      <strong>超长聊天上下文</strong>
      <p className="card-hint">
        按所选模型的容量尽量带入历史，支持百万级 token 窗口；不会删除聊天、人设或记忆。
        更长的输入可能增加等待时间和 API 用量，实际容量取决于模型与接口。
      </p>
      <button type="button" className="primary-button" onClick={() => {
        onChange("context_turns", 0);
        onChange("compression_threshold", 0);
      }}>使用模型最大上下文</button>
      <div className="settings-grid">
        <label>
          聊天历史范围
          <select value={automatic ? "auto" : "custom"} onChange={(event) =>
            onChange("context_turns", event.target.value === "auto" ? 0 : 10000)
          }>
            <option value="auto">尽量完整 · 按模型容量</option>
            <option value="custom">指定最近轮数</option>
          </select>
        </label>
        {!automatic && <label>
          最多带入的近期轮数
          <input type="number" min="1" max="1000000" step="1" value={turns}
            onChange={(event) => onChange("context_turns", event.target.value)} />
        </label>}
      </div>
      <p className="card-hint" role="status">
        {automatic ? "已选择按模型容量读取，不再按固定 20／50 轮截取。" : `当前保留最近 ${turns.toLocaleString("zh-CN")} 轮，可一键切换为最大上下文。`}
        超出窗口时优先带入近期对话，并继续使用已保存的长期记忆；不会恢复你已重置的上下文。
      </p>
    </div>
  );
}

import { THEME_PRESETS } from "./dengta-theme.js";
import { useGlassScrubber } from "./use-glass-scrubber";

const APPEARANCE_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

export default function ThemeStudio({
  preferences,
  updateTheme,
  chatSkinPreferences,
  updateChatSkin,
}) {
  const glassScrubber = useGlassScrubber(
    preferences.cardOpacity * 100,
    (value) => updateTheme({ cardOpacity: value / 100 }),
  );

  return (
    <section className="theme-studio" aria-labelledby="theme-studio-title">
      <div className="settings-card-heading">
        <div>
          <span className="settings-kicker">APPEARANCE</span>
          <h3 id="theme-studio-title">Theme studio</h3>
        </div>
        <span className="theme-live-dot">Live</span>
      </div>

      <div className="theme-preset-grid" aria-label="皮肤预设">
        {THEME_PRESETS.map((preset) => (
          <button
            type="button"
            className={preferences.preset === preset.id ? "active" : ""}
            key={preset.id}
            aria-pressed={preferences.preset === preset.id}
            onClick={() =>
              updateTheme({
                preset: preset.id,
                accent: preset.accent,
                card: preset.card,
              })
            }
          >
            <span
              className="theme-preset-swatch"
              style={{
                "--preset-background": preset.background,
                "--preset-card": preset.card,
                "--preset-accent": preset.accent,
              }}
            >
              {preferences.preset === preset.id && <em>✓</em>}
            </span>
            <small>{preset.label}</small>
          </button>
        ))}
      </div>

      <div className="theme-control-list">
        <label className="theme-color-control">
          <span>
            <strong>Accent</strong>
            <small>按钮、状态和互动高光</small>
          </span>
          <input
            type="color"
            value={preferences.accent}
            onChange={(event) => updateTheme({ accent: event.target.value })}
          />
        </label>
        <label className="theme-color-control">
          <span>
            <strong>Card colour</strong>
            <small>玻璃卡片的底色</small>
          </span>
          <input
            type="color"
            value={preferences.card}
            onChange={(event) => updateTheme({ card: event.target.value })}
          />
        </label>
        <label className="theme-opacity-control">
          <span>
            <strong>Global glass</strong>
            <output>{Math.round(glassScrubber.value)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(glassScrubber.value)}
            {...glassScrubber.inputProps}
          />
        </label>
      </div>

      <div className="theme-appearance-control">
        <span>
          <strong>Light cycle</strong>
          <small>定位开启后按当地日出日落 · 否则使用上海时刻</small>
        </span>
        <div>
          {APPEARANCE_OPTIONS.map((option) => (
            <button
              type="button"
              className={
                preferences.appearance === option.id ? "active" : ""
              }
              aria-pressed={preferences.appearance === option.id}
              key={option.id}
              onClick={() => updateTheme({ appearance: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-font-control">
        <span>
          <strong>字体</strong>
          <small>聊天与界面文字</small>
        </span>
        <div role="group" aria-label="字体模式">
          <button
            type="button"
            className={preferences.fontMode === "standard" ? "active" : ""}
            aria-pressed={preferences.fontMode === "standard"}
            onClick={() => updateTheme({ fontMode: "standard" })}
          >
            DengTa 标准
          </button>
          <button
            type="button"
            className={preferences.fontMode === "system" ? "active" : ""}
            aria-pressed={preferences.fontMode === "system"}
            onClick={() => updateTheme({ fontMode: "system" })}
          >
            跟随系统
          </button>
        </div>
      </div>

      <section className="chat-skin-control" aria-labelledby="chat-skin-title">
        <div className="settings-card-heading">
          <div>
            <span className="settings-kicker">CHAT SKIN</span>
            <h4 id="chat-skin-title">奶油挂件</h4>
          </div>
          <span className="theme-live-dot">Live</span>
        </div>
        <label className="chat-skin-toggle">
          <span>
            <strong>奶油气泡与原创挂件</strong>
            <small>旧消息只换样式，不改聊天数据</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.skin === "taotao-cream"}
            onChange={(event) =>
              updateChatSkin?.({
                skin: event.target.checked ? "taotao-cream" : "classic-glass",
              })
            }
          />
        </label>
        <label className="chat-skin-select">
          <span>
            <strong>挂件活跃度</strong>
            <small>安静、自然或热闹</small>
          </span>
          <select
            value={chatSkinPreferences?.ornamentActivity || "natural"}
            onChange={(event) =>
              updateChatSkin?.({ ornamentActivity: event.target.value })
            }
          >
            <option value="quiet">安静</option>
            <option value="natural">自然</option>
            <option value="lively">热闹</option>
          </select>
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>AI 心情输入提示</strong>
            <small>随当前会话氛围更新，不阻塞回复</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.dynamicComposerHint !== false}
            onChange={(event) =>
              updateChatSkin?.({ dynamicComposerHint: event.target.checked })
            }
          />
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>减少动画</strong>
            <small>关闭回弹、挂件与背景动态；系统偏好也会生效</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.reduceMotion === true}
            onChange={(event) =>
              updateChatSkin?.({ reduceMotion: event.target.checked })
            }
          />
        </label>
      </section>
    </section>
  );
}

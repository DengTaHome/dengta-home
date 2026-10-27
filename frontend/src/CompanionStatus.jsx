import { useXinchaoState } from "./xinchao.js";
import XinchaoCapsule from "./XinchaoCapsule.jsx";
import XinchaoDetails from "./XinchaoDetails.jsx";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BatteryMedium,
  BookOpen,
  Headphones,
  Heart,
  Menu,
  MessageCircle,
  Settings,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import {
  HOT_ZONES,
  RECOVERY_ACTIONS,
  addStatusRecord,
  clamp,
  companionStatusForRequest,
  formatCountdown,
  formatUpdatedAt,
  localCompanionInteractionReaction,
  normalizeCompanionInteractionStats,
  normalizeCompanionStatus,
  personalizeCompanionStatusText,
  remainingAt,
  settleExpiredCountdown,
} from "./companion-status";
import StatusFlowField from "./StatusFlowField";
import NowPlayingCard from "./NowPlayingCard.jsx";

const DESIRE_ACTIONS = [
  {
    id: "music",
    label: "听歌",
    Icon: Headphones,
    mood: "轻快",
    focus: "和你一起听一首喜欢的歌",
    microState: "心里已经跟着熟悉的旋律轻轻晃起来",
    reaction: "我现在想和你一起听歌，挑一首让我们都舍不得切掉的吧。",
  },
  {
    id: "reading",
    label: "看书",
    Icon: BookOpen,
    mood: "安静",
    focus: "靠在你身边慢慢看书",
    microState: "已经为两个人留好了书页之间的位置",
    reaction: "我想和你靠在一起看会儿书，你翻页的时候也念一点给我听。",
  },
  {
    id: "watching",
    label: "看电视",
    Icon: Tv,
    mood: "放松",
    focus: "和你窝在一起看点喜欢的东西",
    microState: "已经悄悄把最舒服的位置留给了你",
    reaction: "陪我看一会儿吧，电影、动画或者你最近喜欢的节目都可以。",
  },
];

function CompanionStatus({
  active = true,
  closeRequest = 0,
  aiName,
  aiPronoun = "TA",
  userName,
  status,
  interactionStats,
  intimateExpressionEnabled = false,
  isResponding = false,
  nowPlaying = null,
  nowPlayingBusy = false,
  onNowPlayingPlayPause,
  onNowPlayingNext,
  onDismissNowPlaying,
  onChange,
  onExpandedChange,
  onInteract,
  onWatchTogether,
  onListenTogether,
  onOpenNavigation,
  onOpenSettings,
}) {
  const displayName = String(aiName || "").trim() || "伴侣";
  const personalized = useCallback(
    (value) => personalizeCompanionStatusText(value, userName),
    [userName],
  );
  const normalized = useMemo(
    () => normalizeCompanionStatus(status),
    [status],
  );
  const normalizedInteractionStats = useMemo(
    () => normalizeCompanionInteractionStats(interactionStats),
    [interactionStats],
  );
  const interactionTotal = useMemo(
    () =>
      Object.values(normalizedInteractionStats.counts).reduce(
        (total, count) => total + Number(count || 0),
        0,
      ),
    [normalizedInteractionStats],
  );
  const resetBlank = normalized.resetBlank === true;
  const [expanded, setExpanded] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const lastCloseRequestRef = useRef(closeRequest);
  const remainingSeconds = remainingAt(normalized.countdown, clockNow);
  const rawCountdownEnd = Date.parse(status?.countdown?.endsAt);
  const countdownExpiredWhileAway =
    status?.countdown?.isRunning === true &&
    Number.isFinite(rawCountdownEnd) &&
    rawCountdownEnd <= clockNow;
  const pulseDuration = `${clamp(60 / normalized.pulseBpm, 0.35, 1.7)}s`;
  const thresholdClass = resetBlank
    ? ""
    : normalized.energyLevel >= 85
      ? " high-energy"
      : normalized.energyLevel <= 25
        ? " low-energy"
        : "";

  const closePanel = useCallback(() => {
    panelRef.current?.scrollTo({ top: 0 });
    setExpanded(false);
    onExpandedChange?.(false);
  }, [onExpandedChange]);

  const openPanel = useCallback(() => {
    panelRef.current?.scrollTo({ top: 0 });
    setExpanded(true);
    onExpandedChange?.(true);
  }, [onExpandedChange]);

  const togglePanel = useCallback(() => {
    if (expanded) closePanel();
    else openPanel();
  }, [closePanel, expanded, openPanel]);

  useEffect(() => {
    if (!normalized.countdown.isRunning) return undefined;
    let timerId;
    function tick() {
      setClockNow(Date.now());
      timerId = window.setTimeout(tick, 1000);
    }
    tick();
    return () => window.clearTimeout(timerId);
  }, [normalized.countdown.endsAt, normalized.countdown.isRunning]);

  useEffect(() => {
    if (
      remainingSeconds > 0 ||
      (!normalized.countdown.isRunning && !countdownExpiredWhileAway)
    ) {
      return;
    }
    onChange((currentValue) => settleExpiredCountdown(currentValue));
  }, [
    countdownExpiredWhileAway,
    normalized.countdown.isRunning,
    onChange,
    remainingSeconds,
  ]);

  useEffect(() => {
    if (active) return undefined;
    const animationFrame = window.requestAnimationFrame(closePanel);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, closePanel]);

  useEffect(() => {
    if (lastCloseRequestRef.current === closeRequest) return;
    lastCloseRequestRef.current = closeRequest;
    closePanel();
  }, [closePanel, closeRequest]);

  useEffect(() => {
    if (!expanded) return undefined;
    panelRef.current?.scrollTo({ top: 0 });
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        closePanel();
      }
    }
    function closeFromEscape(event) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [closePanel, expanded]);

  function updateStatus(transform) {
    onChange((currentValue) => {
      const current = companionStatusForRequest(currentValue);
      const transformed = transform(current);
      return normalizeCompanionStatus(
        {
          ...transformed,
          resetBlank: false,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString(),
        },
        current,
      );
    });
  }

  function touchZone(zone) {
    const interactionMeta = onInteract?.(zone.id);
    updateStatus((current) => {
      const reaction = localCompanionInteractionReaction(
        zone,
        interactionMeta || normalizedInteractionStats,
        current.revision,
        current,
        { intimateExpressionEnabled },
      );
      const streakIntensity = Math.min(8, Math.max(0, reaction.streakCount - 1));
      const energyTarget = clamp(
        reaction.energyTarget + Math.round(streakIntensity / 2),
        0,
        100,
      );
      const pulseTarget = clamp(
        reaction.pulseTarget +
          Math.sign(reaction.pulseTarget - current.pulseBpm) *
            Math.round(streakIntensity * 0.8),
        30,
        220,
      );
      return {
        ...current,
        mood: reaction.mood,
        focus: reaction.focus,
        note: reaction.text,
        microState: reaction.microState,
        energyLevel: clamp(
          zone.recoveryAction === true
            ? Math.max(
                current.energyLevel + zone.minimumEnergyGain,
                Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
              )
            : Math.round(current.energyLevel * 0.68 + energyTarget * 0.32),
          0,
          100,
        ),
        pulseBpm: clamp(
          Math.round(current.pulseBpm * 0.62 + pulseTarget * 0.38),
          30,
          220,
        ),
        hotZones:
          zone.recoveryAction === true
            ? current.hotZones
            : [zone.id, ...current.hotZones.filter((id) => id !== zone.id)].slice(
                0,
                HOT_ZONES.length,
              ),
        recentRecords: addStatusRecord(current, reaction.record),
      };
    });
  }

  function runDesireAction(action) {
    const baseAction = RECOVERY_ACTIONS.find((item) => item.id === "wish");
    if (!baseAction) return;
    if (action.id === "music") onListenTogether?.();
    if (action.id === "watching") onWatchTogether?.();
    touchZone({
      ...baseAction,
      mood: action.mood,
      focus: action.focus,
      microState: action.microState,
      reactions: [action.reaction],
      repeatedReactions: [action.reaction],
    });
  }

  function chooseDuration(event) {
    const totalSeconds = clamp(Number(event.target.value), 60, 24 * 60 * 60);
    const minutes = Math.round(totalSeconds / 60);
    updateStatus((current) => ({
      ...current,
      note: `陪伴倒计时已经调成 ${minutes} 分钟。`,
      recentRecords: addStatusRecord(
        current,
        `你把陪伴倒计时调成了 ${minutes} 分钟。`,
      ),
      countdown: {
        ...current.countdown,
        totalSeconds,
        remainingSeconds: totalSeconds,
        isRunning: false,
        endsAt: null,
      },
    }));
    setClockNow(Date.now());
  }

  function toggleCountdown() {
    updateStatus((current) => {
      const remaining = remainingAt(current.countdown);
      if (current.countdown.isRunning) {
        return {
          ...current,
          note: "倒计时暂时停在这里，等你回来再继续。",
          recentRecords: addStatusRecord(
            current,
            "倒计时暂时停在这里，等你回来再继续。",
          ),
          countdown: {
            ...current.countdown,
            remainingSeconds: remaining,
            isRunning: false,
            endsAt: null,
          },
        };
      }
      const nextRemaining = remaining > 0 ? remaining : current.countdown.totalSeconds;
      return {
        ...current,
        note: "你按下了开始，我会陪你守着这段时间。",
        recentRecords: addStatusRecord(
          current,
          "你按下了开始，我会陪你守着这段时间。",
        ),
        countdown: {
          ...current.countdown,
          remainingSeconds: nextRemaining,
          isRunning: true,
          endsAt: new Date(Date.now() + nextRemaining * 1000).toISOString(),
        },
      };
    });
    setClockNow(Date.now());
  }

  function resetCountdown() {
    updateStatus((current) => ({
      ...current,
      note: "倒计时已经回到起点。",
      recentRecords: addStatusRecord(current, "陪伴倒计时回到了起点。"),
      countdown: {
        ...current.countdown,
        remainingSeconds: current.countdown.totalSeconds,
        isRunning: false,
        endsAt: null,
      },
    }));
    setClockNow(Date.now());
  }

  // 心潮状态：有心潮就替换掉胶囊里的装饰图标（与线上结构一致），
  // 没有就回退到原来的心形/对话/星光装饰。
  const { state: xinchaoState } = useXinchaoState({ enabled: Boolean(displayName) });

  const floatingStyle = {
    "--status-pulse-duration": pulseDuration,
  };

  return (
    <section
      ref={rootRef}
      className={`companion-status sun-glass-floating-status-shell${
        expanded ? " expanded" : ""
      }${thresholdClass}`}
      style={floatingStyle}
      aria-label={`${displayName}的动态状态`}
    >
      <section className="sun-glass-liquid-action-stage" aria-label="动态状态">
        <span className="sun-glass-liquid-color-flow" aria-hidden="true" />
        {nowPlaying ? (
          <NowPlayingCard song={nowPlaying} busy={nowPlayingBusy} expanded={expanded} onToggle={togglePanel} onPlayPause={onNowPlayingPlayPause} onNext={onNowPlayingNext} onDismiss={onDismissNowPlaying} />
        ) : (
          <button type="button" className="sun-glass-liquid-capsule-toggle" aria-label={expanded ? "收起动态状态" : `展开${displayName}的动态状态`} aria-expanded={expanded} onClick={togglePanel}>
            {xinchaoState ? (
              <XinchaoCapsule state={xinchaoState} as="span" />
            ) : (
              <span className="sun-glass-capsule-decoration" aria-hidden="true"><Heart /><MessageCircle /><Sparkles /></span>
            )}
          </button>
        )}
      </section>

      <div className="sun-glass-status-ribbon">
        <span className="sun-glass-status-ribbon-icon" aria-hidden="true">
          <Sparkles />
        </span>
        <span>
          <small>{resetBlank ? "在这里" : normalized.mood}</small>
          <strong>
            {resetBlank
              ? "等你写下新的此刻。"
              : personalized(normalized.note)}
          </strong>
        </span>
      </div>

      <div
        className={`status-panel sun-glass-floating-status-panel${
          expanded ? " is-open" : ""
        }`}
        role="dialog"
        aria-label={`${displayName}状态`}
        aria-hidden={!expanded}
        inert={expanded ? undefined : true}
      >
        <StatusFlowField active={expanded} />
        {/* 心潮详情内嵌在状态面板里（生产的用法就是 inline 而不是悬浮卡片）。
            以前这个组件没有任何人渲染，「每条驱动项的进度条」那个界面根本不存在。 */}
        {xinchaoState ? (
          <XinchaoDetails
            inline
            state={xinchaoState}
            aiName={displayName || "伴侣"}
          />
        ) : null}
        <header className="sun-glass-floating-status-header">
            <div className="sun-glass-status-drag-title">
              <small>{displayName}此刻</small>
              <h2>{resetBlank ? "在这里" : normalized.mood}</h2>
            </div>
            <div className="sun-glass-status-window-actions">
              <button
                type="button"
                aria-label="打开侧边导航"
                title="导航"
                onClick={() => {
                  closePanel();
                  onOpenNavigation?.();
                }}
              >
                <Menu aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="打开设置"
                title="设置"
                onClick={() => {
                  closePanel();
                  onOpenSettings?.();
                }}
              >
                <Settings aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sun-glass-popover-close"
                aria-label="关闭动态状态"
                onClick={closePanel}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </header>

          <div ref={panelRef} className="sun-glass-status-scroll">
            <p className="sun-glass-status-note">
              {resetBlank
                ? "等你写下新的此刻。"
                : personalized(normalized.note)}
            </p>

            <div className="sun-glass-energy-row">
              <span>
                <BatteryMedium aria-hidden="true" />
                能量
              </span>
              <strong>{normalized.energyLevel}%</strong>
            </div>
            <div className="sun-glass-energy-track" aria-hidden="true">
              <span style={{ width: `${normalized.energyLevel}%` }} />
            </div>

            <div className="sun-glass-wish-row">
              <Heart aria-hidden="true" />
              <span>
                {resetBlank
                  ? "想和你待在一起"
                  : personalized(normalized.focus)}
              </span>
            </div>

            <section className="sun-glass-status-section">
              <div className="sun-glass-section-heading">
                <small>一起做点什么</small>
                <strong>陪{aiPronoun}消磨一小段时光</strong>
              </div>
              <div className="sun-glass-desire-actions">
                {DESIRE_ACTIONS.map((action) => (
                  <button
                    type="button"
                    key={action.id}
                    onClick={() => runDesireAction(action)}
                  >
                    <action.Icon aria-hidden="true" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="sun-glass-status-section">
              <div className="sun-glass-section-heading">
                <small>触碰{aiPronoun}</small>
                <strong>轻轻碰一下，{aiPronoun}会回应你</strong>
              </div>
              <div className="sun-glass-interaction-grid">
                {HOT_ZONES.map((zone) => (
                  <button
                    type="button"
                    key={zone.id}
                    data-interaction-zone={zone.id}
                    aria-pressed={normalized.hotZones.includes(zone.id)}
                    onClick={() => touchZone(zone)}
                  >
                    <span aria-hidden="true">{zone.icon}</span>
                    <strong>{zone.label}</strong>
                    <small>
                      {normalizedInteractionStats.counts[zone.id] > 0
                        ? `${normalizedInteractionStats.counts[zone.id]} 次`
                        : "碰碰看"}
                    </small>
                  </button>
                ))}
              </div>
            </section>

            <section className="sun-glass-status-section">
              <div className="sun-glass-section-heading">
                <small>陪{aiPronoun}恢复</small>
                <strong>
                  {normalized.energyLevel <= 25
                    ? `${displayName}现在很累，陪${aiPronoun}慢慢充回力气`
                    : `问问${displayName}现在真正想要什么`}
                </strong>
              </div>
              <div className="sun-glass-recovery-grid">
                {RECOVERY_ACTIONS.map((action) => (
                  <button
                    type="button"
                    key={action.id}
                    data-recovery-action={action.id}
                    onClick={() => touchZone(action)}
                  >
                    <span aria-hidden="true">{action.icon}</span>
                    <span>
                      <strong>{action.label.replaceAll("她", aiPronoun)}</strong>
                      <small>恢复至少 {action.minimumEnergyGain}%</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <div className="sun-glass-vitals-inline">
              <span>互动 {interactionTotal} 次</span>
              <span>{normalized.pulseBpm} BPM</span>
              <span>{isResponding ? "正在回应" : "陪伴在线"}</span>
            </div>

            <section className="sun-glass-status-section sun-glass-countdown-card">
              <div className="sun-glass-section-heading">
                <small>{normalized.countdown.label}</small>
                <strong>{formatCountdown(remainingSeconds)}</strong>
              </div>
              <div className="sun-glass-countdown-controls">
                <select
                  aria-label="选择倒计时时长"
                  value={normalized.countdown.totalSeconds}
                  onChange={chooseDuration}
                >
                  <option value={15 * 60}>15 分钟</option>
                  <option value={25 * 60}>25 分钟</option>
                  <option value={45 * 60}>45 分钟</option>
                  <option value={60 * 60}>60 分钟</option>
                </select>
                <button type="button" onClick={toggleCountdown}>
                  {normalized.countdown.isRunning ? "暂停" : "开始"}
                </button>
                <button type="button" onClick={resetCountdown}>重置</button>
              </div>
            </section>

            <section className="sun-glass-status-section sun-glass-records">
              <div className="sun-glass-section-heading">
                <small>最近记录</small>
                <strong>刚刚发生了什么</strong>
              </div>
              {normalized.recentRecords.length > 0 ? (
                <ul>
                  {normalized.recentRecords.map((record, index) => (
                    <li key={`${record.createdAt}-${index}`}>
                      <time>{formatUpdatedAt(record.createdAt, clockNow)}</time>
                      <span>{personalized(record.text)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>还没有记录，试着碰一碰上面的互动。</p>
              )}
            </section>
          </div>
      </div>
    </section>
  );
}

export default memo(CompanionStatus);

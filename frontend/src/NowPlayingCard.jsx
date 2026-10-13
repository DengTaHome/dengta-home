import { Pause, Play, SkipForward, X } from "lucide-react";
import { useId } from "react";
import { nowPlayingActionState } from "./now-playing-capabilities.js";

export default function NowPlayingCard({ song, busy, expanded, onToggle, onPlayPause, onNext, onDismiss }) {
  const hintId = useId();
  const playbackAction = song.isPlaying ? "pause" : "play";
  const playback = nowPlayingActionState(song, playbackAction);
  const next = nowPlayingActionState(song, "next");
  const hint = playback.reason && next.reason && playback.reason !== next.reason
    ? `当前播放器未提供${song.isPlaying ? "暂停" : "播放"}、下一首，请在音乐 App 中操作。`
    : playback.reason || next.reason;
  return (
    <div className="sun-glass-liquid-capsule-toggle has-now-playing" role="group" aria-label={`当前歌曲：${song.title}`} aria-busy={busy}>
      <span className="sun-glass-now-playing">
        <span className={`sun-glass-now-playing-cover${song.isPlaying ? " is-spinning" : ""}`} style={song.cover ? { backgroundImage: `url("${song.cover}")` } : undefined} aria-hidden="true">
          <span className="sun-glass-now-playing-disc" /><span className="sun-glass-now-playing-hole" />
        </span>
        <span className="sun-glass-now-playing-meta">
          <button className="sun-glass-now-playing-title" type="button" aria-label={expanded ? "收起动态状态" : "展开动态状态"} aria-expanded={expanded} onClick={onToggle}><strong>{song.title}</strong></button>
          <small id={hintId}>{busy ? "正在发送指令…" : hint || (song.playbackStateKnown === false ? "播放状态待确认" : song.artist || "系统播放器")}</small>
          <span className="sun-glass-now-playing-controls">
            <button type="button" disabled={busy || !playback.available} title={playback.reason || undefined} aria-describedby={playback.reason ? hintId : undefined} aria-label={song.isPlaying ? "暂停" : "播放"} onClick={onPlayPause}>{song.isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
            <button type="button" disabled={busy || !next.available} title={next.reason || undefined} aria-describedby={next.reason ? hintId : undefined} aria-label="下一首" onClick={onNext}><SkipForward aria-hidden="true" /></button>
            <button type="button" aria-label="收起歌曲胶囊" onClick={onDismiss}><X aria-hidden="true" /></button>
          </span>
        </span>
      </span>
    </div>
  );
}

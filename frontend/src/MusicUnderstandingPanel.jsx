import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ChatErrorLog from "./ChatErrorLog.jsx";
import { useMusicScope } from "./use-music-scope.js";
import { analyzeMusicUnderstandingUi, createMusicAnalysisRecovery, MUSIC_UNDERSTANDING_FEEDBACK, musicAnalysisDetails, musicAnalysisSummary, musicUnderstandingFailure, musicUnderstandingScopeKey, musicUnderstandingViewKey, narrateMusicUnderstandingUi, readMusicUnderstandingLog, readMusicUnderstandingStatus, readMusicUnderstandingUi, validMusicTrackId } from "./music-understanding-ui.js";
import "./music-understanding-ui.css";

export default function MusicUnderstandingPanel(props) {
  return <MusicUnderstandingView key={musicUnderstandingViewKey(props)} {...props} />;
}

function MusicUnderstandingView({ accountScope, companionScope, providerTrackId, title, artist, sessionScope, onSaved }) {
  const musicScope = useMusicScope(accountScope, companionScope), id = useId();
  const [understanding, setUnderstanding] = useState(null), [narration, setNarration] = useState(null), [pending, setPending] = useState(null), [feedback, setFeedback] = useState(null), [notice, setNotice] = useState(""), [invalidCache, setInvalidCache] = useState(false);
  const [progress, setProgress] = useState(null), [progressPending, setProgressPending] = useState(false);
  const resource = useMemo(() => createMusicAnalysisRecovery({ accountScope, companionScope }, providerTrackId), [accountScope, companionScope, providerTrackId]);
  const unknown = useSyncExternalStore(resource.subscribe, resource.getSnapshot, resource.getSnapshot);
  const active = useRef(null), live = useRef(false), confirmed = useRef(null), invalidCacheRef = useRef(false);
  const progressRequest = useRef(null);
  const stopProgress = () => { progressRequest.current?.controller.abort(); progressRequest.current = null; if (live.current) setProgressPending(false); };
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; if (active.current?.kind === "analyze" || active.current?.kind === "repair") resource.uncertain(active.current.recovery); active.current?.controller.abort(); active.current = null; progressRequest.current?.controller.abort(); progressRequest.current = null; }; }, [resource]);
  const valid = validMusicTrackId(providerTrackId) && !!accountScope && !!companionScope;
  const current = token => live.current && active.current === token && musicScope.current(token.scope);
  const saved = (value, ticket) => {
    stopProgress(); setProgress(null);
    confirmed.current = value; invalidCacheRef.current = false; setInvalidCache(false); resource.confirm(ticket); setUnderstanding(value);
    try { Promise.resolve(onSaved?.({ scope: musicUnderstandingScopeKey({ accountScope, companionScope }), providerTrackId: providerTrackId.trim(), sessionScope })).catch(() => {}); } catch { /* A refresh failure does not undo the confirmed music analysis. */ }
  };
  async function run(kind) {
    const writing = kind === "analyze" || kind === "repair";
    if (!live.current || active.current || !valid || ((writing || kind === "expert") && resource.getSnapshot()) || (kind === "expert" && !confirmed.current) || (kind === "repair" && !invalidCacheRef.current) || (kind === "analyze" && invalidCacheRef.current)) return;
    const token = { scope: musicScope.capture(), kind, controller: new AbortController(), recovery: null };
    if (!musicScope.current(token.scope)) return;
    token.recovery = writing ? resource.begin() : resource.getSnapshot();
    if (writing && !token.recovery) return;
    stopProgress(); setProgress(null);
    if (kind === "read") { resource.reviewing(token.recovery); invalidCacheRef.current = false; setInvalidCache(false); }
    active.current = token; setPending(token); setFeedback(null); setNotice("");
    const options = { ...token.scope.options, signal: token.controller.signal };
    // Forward the scope signal even on WebViews without AbortSignal.any.
    const cancelScope = () => token.controller.abort(token.scope.options.signal.reason);
    token.scope.options.signal.addEventListener("abort", cancelScope, { once: true });
    try {
      const input = { providerTrackId, title, artist };
      if (kind === "read") {
        const value = await readMusicUnderstandingUi(providerTrackId, options);
        if (!current(token)) return;
        saved(value, token.recovery); setNotice("已读取当前账号和伴侣保存的分析。成就刷新另行核对。");
      } else if (writing) {
        const value = await analyzeMusicUnderstandingUi(kind === "repair" ? { ...input, reanalyze_invalid_cache: true } : input, options);
        if (!current(token)) return;
        saved(value, token.recovery); setNotice(value.cached ? "这首歌已有保存分析，已直接读取。不会因此新增歌曲计数。" : "服务器已确认分析保存。可继续生成专业解读；成就刷新另行核对。");
      } else {
        const value = await narrateMusicUnderstandingUi({ ...input, tier: kind }, options);
        if (!current(token)) return;
        setNarration(value);
        if (kind === "expert") saved(value.understanding, token.recovery);
        setNotice(kind === "casual" ? "已收到普通解读。此操作没有保存音频分析，也不会单独解锁音乐分析成就。" : "专业解读已收到，已确认保存的分析仍保留。");
      }
    } catch (error) {
      if (writing) resource.uncertain(token.recovery);
      if (!current(token)) return;
      const failure = musicUnderstandingFailure(error);
      if (kind === "read" && failure.status === 404 && failure.code === "music_understanding_not_found") {
        resource.reviewedMissing(token.recovery); confirmed.current = null; setUnderstanding(null);
      } else if (kind === "read" && failure.status === 409 && failure.code === "music_understanding_cached_invalid") {
        resource.reviewedMissing(token.recovery); confirmed.current = null; setUnderstanding(null); invalidCacheRef.current = true; setInvalidCache(true);
      }
      setFeedback(failure);
    } finally {
      token.scope.options.signal.removeEventListener("abort", cancelScope);
      if (active.current === token) { active.current = null; if (live.current && musicScope.current(token.scope)) setPending(null); }
    }
  }
  const cancel = token => {
    if (!live.current || !token || active.current !== token) return;
    if (token.kind === "analyze" || token.kind === "repair") resource.uncertain(token.recovery);
    const error = Object.assign(new Error(), { code: "music_understanding_cancelled" });
    token.controller.abort(error); active.current = null; setPending(null); setFeedback(musicUnderstandingFailure(error));
  };
  async function checkProgress() {
    if (!live.current || !valid || progressRequest.current) return;
    const token = { scope: musicScope.capture(), controller: new AbortController() };
    if (!musicScope.current(token.scope)) return;
    progressRequest.current = token; setProgressPending(true);
    const cancelScope = () => token.controller.abort(token.scope.options.signal.reason);
    token.scope.options.signal.addEventListener("abort", cancelScope, { once: true });
    const isCurrent = () => live.current && progressRequest.current === token && musicScope.current(token.scope);
    try {
      const value = await readMusicUnderstandingStatus(providerTrackId, { ...token.scope.options, signal: token.controller.signal });
      if (!isCurrent()) return;
      setProgress(value); setFeedback(null);
      if (value.state === "running") {
        const ticket = resource.getSnapshot() || resource.begin(); resource.uncertain(ticket); resource.reviewing(ticket);
      } else if (value.state === "saved") {
        const waiting = active.current;
        if (waiting) { active.current = null; waiting.controller.abort(); setPending(null); }
        saved(value.understanding, resource.getSnapshot()); setNotice("服务器已确认这首歌的分析已保存。");
      } else if (value.state === "failed") {
        setFeedback(musicUnderstandingFailure({ code: value.error_code, status: value.http_status }));
      }
    } catch (error) { if (isCurrent()) setFeedback(musicUnderstandingFailure(error)); }
    finally {
      token.scope.options.signal.removeEventListener("abort", cancelScope);
      if (progressRequest.current === token) { progressRequest.current = null; if (live.current && musicScope.current(token.scope)) setProgressPending(false); }
    }
  }
  const loadLog = logId => {
    if (!live.current) return Promise.reject(Object.assign(new Error(), { code: "music_scope_changed" }));
    const token = musicScope.capture();
    musicScope.assertCurrent(token);
    return readMusicUnderstandingLog(logId, token.options);
  };
  const restore = ticket => {
    if (!live.current || active.current || !musicScope.current(musicScope.capture()) || !resource.restore(ticket)) return;
    setFeedback(null); setNotice("分析入口已由你恢复。此前服务器任务仍可能执行，再次分析可能重复耗用；不会自动发起请求。");
  };
  const details = musicAnalysisDetails(understanding?.analysis);
  const statusLabel = { analyze: "正在分析音频并保存，可能需要几分钟…", repair: "正在重新分析音频，收到有效结果后才替换失效缓存…", read: "正在读取已保存分析…", casual: "正在生成普通解读…", expert: "正在生成专业解读…" }[pending?.kind];
  return <section className="music-understanding" aria-labelledby={`${id}-heading`}>
    <details>
      <summary><span><small>从听见到听懂</small><strong id={`${id}-heading`}>音乐理解</strong></span><span className="music-understanding-disclosure" aria-hidden="true" /></summary>
      <p className="music-understanding-track"><strong>{title || "当前曲目"}</strong>{artist && <span>{artist}</span>}</p>
      <p className="music-understanding-intro">先聊听感，或分析这首歌的节奏与编曲并保存。只有主动操作才会请求服务，不会自动播放。</p>
      {!valid && <p className="music-understanding-hint">请先选择带有效网易云歌曲编号的曲目。外部链接、本地音频和歌单内的本机编号不能直接用于分析。</p>}
      <div className="music-understanding-actions">
        <button type="button" onClick={() => void run("casual")} disabled={!valid || !!pending}>聊聊这首歌</button>
        <button type="button" onClick={() => void run(invalidCache ? "repair" : "analyze")} disabled={!valid || !!pending || !!unknown}>{invalidCache ? "重新分析并保存" : "分析并保存"}</button>
        <button type="button" onClick={() => void run("read")} disabled={!valid || !!pending}>读取已保存分析</button>
        <button type="button" onClick={() => void checkProgress()} disabled={!valid || progressPending}>{progressPending ? "正在查看进度…" : "查看分析进度"}</button>
        {understanding && <button type="button" onClick={() => void run("expert")} disabled={!valid || !!pending || !!unknown}>生成专业解读</button>}
        {pending && <button type="button" onClick={() => cancel(pending)}>取消等待</button>}
      </div>
      <small className="music-understanding-hint">普通解读只生成听感文字。分析并保存会下载歌曲音频并调用分析服务；解读还需要可用的聊天模型，可能产生接口用量。</small>
      {invalidCache && <p className="music-understanding-hint">重新分析需要下载音频并调用分析服务；只有收到有效结果后才替换这首歌的失效缓存。不会自动改写其他歌曲或聊天记录。</p>}
      {pending && <p className="music-understanding-feedback" role="status">{statusLabel}</p>}
      {progress && <div className="music-understanding-feedback" role="status"><p>{progress.state === "running" ? ({ queued: "正在等待前一项分析完成。", preparing: "正在准备歌曲资料。", downloading: "正在下载歌曲音频。", analyzing: "正在分析音频。", saving: "正在保存分析结果。" }[progress.stage]) : ({ saved: "已核对保存结果。", failed: "本次分析未成功，已保存资料仍保留。", invalid_cache: "保存缓存无法确认，请读取已保存分析核对后再决定是否修复。", unknown: "当前服务实例无法确认此前任务。无法确认不代表任务已停止，请先读取已保存分析核对。" }[progress.state])}</p></div>}
      {unknown && <div className="music-understanding-feedback" role="status"><p>{unknown.canRestore ? "保存结果尚未确认。核对后可手动恢复入口。" : "保存结果尚未确认，请先“读取已保存分析”核对。取消等待不能撤回服务器已接收的请求。"}</p>
        {unknown.canRestore && <button type="button" onClick={() => restore(unknown)} disabled={!!pending}>我已核对，恢复分析入口</button>}
      </div>}
      {notice && <p className="music-understanding-feedback" role="status">{notice}</p>}
      {feedback && <div className="music-understanding-feedback is-error" role="status">
        <p><strong>原因：</strong>{feedback.reason}</p><p><strong>处理办法：</strong>{feedback.action}</p>
        <p>错误代码：<code>{feedback.code}</code>{feedback.status && <> · HTTP {feedback.status}</>}</p>
        <ChatErrorLog key={`${feedback.code}:${feedback.logId || ""}`} logId={feedback.logId} diagnostic={feedback.diagnostic} feedbackByCode={MUSIC_UNDERSTANDING_FEEDBACK} loadLog={loadLog} />
      </div>}
      {understanding && <article className="music-understanding-analysis">
        <h4>已保存分析</h4><p>{musicAnalysisSummary(understanding.analysis)}</p>
        <details><summary>分析结构与指标</summary>{details.length ? <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p>已保存分析没有这些常用指标。可生成专业解读，缺失数据不会补写成已知结论。</p>}</details>
      </article>}
      {narration && <article className="music-understanding-narration"><h4>{narration.tier === "expert" ? "专业解读" : "聊聊听感"}</h4><p>{narration.narration}</p></article>}
    </details>
  </section>;
}

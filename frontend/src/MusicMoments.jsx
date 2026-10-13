import { useId, useLayoutEffect, useRef, useState } from "react";
import { BookmarkPlus, ChevronDown, CornerDownLeft, Trash2 } from "lucide-react";
import { formatMediaTime } from "./co-watch.js";
import { createMusicMoment, createMusicMomentsStore, MAX_MUSIC_MOMENT_NOTE, musicMomentFeedback, parseMusicMomentTime } from "./music-moments.js";
import "./music-moments.css";

export default function MusicMoments({ accountScope, companionScope, available = false, getCapture, onSeek, currentPlaylistId, currentItemId, internalPlayback, storage }) {
  const scope = JSON.stringify([accountScope, companionScope]);
  return <MusicMomentsPanel key={scope} scope={{ accountScope, companionScope }} available={available} getCapture={getCapture} onSeek={onSeek} currentPlaylistId={currentPlaylistId} currentItemId={currentItemId} internalPlayback={internalPlayback} storage={storage} />;
}
function MusicMomentsPanel({ scope, available, getCapture, onSeek, currentPlaylistId, currentItemId, internalPlayback, storage }) {
  const noteId = useId(), timeId = useId();
  const [initial] = useState(() => {
    try { const store = createMusicMomentsStore(scope, storage); return { store, cards: store.read(), error: "" }; }
    catch (error) { return { store: null, cards: [], error: musicMomentFeedback(error) }; }
  });
  const [store, setStore] = useState(initial.store), [cards, setCards] = useState(initial.cards);
  const [draft, setDraft] = useState(null), [note, setNote] = useState(""), [manualTime, setManualTime] = useState("0:00");
  const [feedback, setFeedback] = useState(initial.error), [failed, setFailed] = useState(Boolean(initial.error)), [visibleCount, setVisibleCount] = useState(3), [removed, setRemoved] = useState(null);
  const alive = useRef(false), actionLocked = useRef(false), reader = useRef(getCapture);
  const draftRef = useRef(null);
  const cardsRef = useRef(initial.cards), removedRef = useRef(null);
  useLayoutEffect(() => { reader.current = getCapture; }, [getCapture]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; draftRef.current = null; }; }, []);
  function act(action, message) {
    if (!alive.current || actionLocked.current) return;
    actionLocked.current = true;
    try { action(); setFeedback(message); setFailed(false); }
    catch (error) { setFeedback(musicMomentFeedback(error)); setFailed(true); }
    finally { actionLocked.current = false; }
  }
  function begin() {
    if (draftRef.current) return;
    act(() => {
      const capture = reader.current?.();
      const prepared = createMusicMoment(capture);
      const time = formatMediaTime(prepared.positionSeconds);
      draftRef.current = { card: prepared, note: "", time };
      setDraft(prepared); setNote(""); setManualTime(time);
    }, "已标记所选歌曲和时间，填写一句感受后保存。");
  }
  function save(event) {
    event.preventDefault();
    if (!draft || draftRef.current?.card.id !== draft.id) return;
    act(() => {
      const current = draftRef.current;
      const seconds = draft.positionSource === "manual" ? parseMusicMomentTime(current.time) : draft.positionSeconds;
      const prepared = createMusicMoment({ ...draft, positionSeconds: seconds }, current.note, { id: draft.id, createdAt: draft.createdAt });
      const next = store.add(prepared);
      draftRef.current = null;
      cardsRef.current = next;
      setCards(next); setDraft(null); setNote("");
    }, "片段卡已保存到本机。没有自动发送给 AI。");
  }
  function reload() {
    act(() => { const next = createMusicMomentsStore(scope, storage), loaded = next.read(); cardsRef.current = loaded; setCards(loaded); setStore(next); }, "已重新读取本机片段卡。");
  }
  function remove(card) {
    if (!cardsRef.current.some(entry => entry.id === card.id)) return;
    act(() => { const next = store.remove(card.id); cardsRef.current = next; removedRef.current = card; setCards(next); setRemoved(card); }, "已删除片段卡，可在本页撤销。");
  }
  function undo(card) {
    if (removedRef.current?.id !== card.id) return;
    act(() => { const next = store.add(card); cardsRef.current = next; removedRef.current = null; setCards(next); setRemoved(null); }, "已撤销删除，片段卡重新保存在本机。");
  }
  return <section className="music-moments" aria-label="一起听的片段卡">
    <header><div><strong>记住一起听的这一刻</strong><small>只保存在这台设备，按账号和伴侣分别记录。</small></div><button type="button" disabled={!available || !store || Boolean(draft)} onClick={begin}><BookmarkPlus aria-hidden="true" />记住这一刻</button></header>
    {draft && <form onSubmit={save}>
      <p><strong>{draft.title}</strong> · {draft.positionSource === "device" ? `本机位置 ${formatMediaTime(draft.positionSeconds)}` : "外部播放 · 手动记录"}</p>
      {draft.positionSource === "manual" && <label htmlFor={timeId}>片段时间<input id={timeId} value={manualTime} maxLength={9} inputMode="decimal" placeholder="0:30 或秒数" onChange={event => { if (draftRef.current?.card.id === draft.id) { draftRef.current.time = event.target.value; setManualTime(event.target.value); } }} /><small>仅记录时间，不控制网易云播放器或同步云端进度。</small></label>}
      <label htmlFor={noteId}>这一刻的感受（可选）<textarea id={noteId} value={note} maxLength={MAX_MUSIC_MOMENT_NOTE} rows={2} placeholder="例如：想把这句旋律留给明天" onChange={event => { if (draftRef.current?.card.id === draft.id) { draftRef.current.note = event.target.value; setNote(event.target.value); } }} /></label>
      <div className="music-moment-actions"><button type="submit">保存片段卡</button><button type="button" onClick={() => { if (draftRef.current?.card.id === draft.id) { draftRef.current = null; setDraft(null); setNote(""); } }}>取消</button></div>
    </form>}
    {feedback && <p className={failed ? "music-moment-feedback is-error" : "music-moment-feedback"} role="status">{feedback}</p>}
    {failed && <button type="button" onClick={reload}>重试读取片段卡</button>}
    {cards.length > 0 && <details><summary><span>我的片段卡 · {cards.length} 张</span><ChevronDown aria-hidden="true" size={18} /></summary><ul>
      {cards.slice(0, visibleCount).map(card => {
        const canSeek = card.positionSource === "device" && internalPlayback && card.itemId === currentItemId && card.playlistId === currentPlaylistId;
        return <li key={card.id}><div><strong>{card.title}</strong><small>{formatMediaTime(card.positionSeconds)} · {card.positionSource === "device" ? "本机播放位置" : "外部手动记录"}{card.artist ? ` · ${card.artist}` : ""}</small>{card.note && <p>{card.note}</p>}</div>
          <div className="music-moment-actions">{card.positionSource === "device" && <button type="button" disabled={!canSeek} onClick={() => act(() => onSeek(card, scope), "已跳到这个片段，播放状态保持原样。")}><CornerDownLeft aria-hidden="true" />跳回片段</button>}<button type="button" aria-label={`删除片段卡：${card.title}`} onClick={() => remove(card)}><Trash2 aria-hidden="true" />删除</button></div>
          {card.positionSource === "device" && !canSeek && <small>选回对应曲目并载入音频后，可跳回这个片段。</small>}
        </li>;
      })}
    </ul>{visibleCount < cards.length && <button type="button" onClick={() => setVisibleCount(count => count + 10)}>查看更多片段</button>}</details>}
    {removed && <button type="button" onClick={() => undo(removed)}>撤销删除</button>}
    {!available && <small>选择一首已导入的歌曲后，可以标记片段。</small>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { petLocalStorage, petStorageKey, readPetState, savePetState } from './cotton/pet-state.js';
import './cotton-pet.css';

const actions = [['pet', '摸摸头'], ['paw', '抬左爪'], ['pawRight', '抬右爪'], ['greet', '叫名字'], ['feed', '喂点零食'], ['drink', '递水喝'], ['brush', '梳梳毛'], ['ball', '拨球玩']];
const labels = Object.fromEntries([...actions, ['idle', '安静陪伴'], ['rest', '坐着打盹'], ['wake', '醒来看看']]);

function PetVisit({ storageKey, onShare, compact }) {
  const [initial] = useState(() => readPetState(petLocalStorage(), storageKey));
  const [open, setOpen] = useState(compact);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState(compact ? 'loading' : 'idle');
  const [snapshot, setSnapshot] = useState({ stats: initial.stats || {}, action: 'idle' });
  const [quiet, setQuiet] = useState(initial.quiet === true);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState('');
  const canvas = useRef(null), runtime = useRef(null);
  const latest = useRef({ stats: initial.stats || {}, quiet: initial.quiet === true });

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const visit = latest.current;
    let instance;
    import('./cotton/pet-runtime.js').then(({ createPetRuntime }) => {
      if (abort.signal.aborted) return;
      return createPetRuntime(canvas.current, {
        signal: abort.signal, initial: visit,
        onChange(value) {
          if (abort.signal.aborted) return;
          visit.stats = value.stats;
          setSnapshot(value);
          savePetState(petLocalStorage(), storageKey, value.stats, visit.quiet);
        },
        onError() { if (!abort.signal.aborted) setStatus('error'); },
      });
    }).then(value => {
      if (!value) return;
      instance = value;
      if (abort.signal.aborted) { instance.dispose(); return; }
      runtime.current = instance;
      setStatus('ready');
    }).catch(() => { if (!abort.signal.aborted) setStatus('error'); });
    return () => {
      abort.abort();
      if (instance) savePetState(petLocalStorage(), storageKey, instance.snapshot().stats, visit.quiet);
      instance?.dispose();
      runtime.current = null;
    };
  }, [open, attempt, storageKey]);

  function launch() { setStatus('loading'); setPaused(false); setOpen(true); setAttempt(value => value + 1); }
  function toggleQuiet() {
    const next = !quiet;
    setQuiet(next); latest.current.quiet = next;
    runtime.current?.setQuiet(next);
    savePetState(petLocalStorage(), storageKey, latest.current.stats, next);
  }
  function interact(id) {
    const result = runtime.current?.command(id);
    setNotice(result?.accepted ? `${labels[id]}，陪它待一会儿。` : result?.reason || '小棉花还在准备。');
  }

  return <section className={`cotton-pet${compact ? ' cotton-pet-compact' : ''}`} aria-label={compact ? '小棉花陪聊' : '小棉花的小屋'}>
    {!compact && <header className="cotton-heading"><span className="cotton-eyebrow">家里多了一位小伙伴</span><h2>小棉花的小屋</h2><p>不急着说什么，坐一会儿也很好。</p></header>}
    <div className="cotton-layout">
      <div className="cotton-stage">
        {open && <canvas key={attempt} ref={canvas} aria-label="小棉花三维坐姿互动" />}
        {!open && <div className="cotton-welcome"><span aria-hidden="true">✿</span><h3>给日常留一点柔软</h3><p>第一次打开会加载小棉花的模型。</p><button type="button" onClick={launch}>打开小屋</button></div>}
        {status === 'loading' && <div className="cotton-overlay" role="status">小棉花正在过来…</div>}
        {status === 'error' && <div className="cotton-overlay" role="alert"><p>暂时没能打开小屋，请重试或稍后再来。</p><button type="button" onClick={launch}>重新打开</button></div>}
        {status === 'ready' && <span className="cotton-state">{paused ? '暂停陪伴' : labels[snapshot.action] || '安静陪伴'}</span>}
        <span className="cotton-silent">无声陪伴</span>
      </div>
      <aside className="cotton-controls">
        {!compact && <><h3>一起照料的小日常</h3><p>摸摸头、递杯水，也可以各做各的。离开时，小棉花会休息，不需要补签或补喂。</p></>}
        <div className="cotton-actions">{(compact ? actions.slice(0, 1) : actions).map(([id, label]) => <button type="button" key={id} disabled={status !== 'ready' || paused} onClick={() => interact(id)}>{label}</button>)}</div>
        <div className="cotton-options"><button type="button" aria-pressed={quiet} onClick={toggleQuiet}>{quiet ? '✓ 安静陪伴' : '安静陪伴'}</button><button type="button" disabled={status !== 'ready'} onClick={() => { const next = !paused; setPaused(next); runtime.current?.setPaused(next); }}>{paused ? '继续陪伴' : '暂停动画'}</button></div>
        <p className="cotton-feedback" role="status">{notice || '互动由你开始，不会自动发消息。'}</p>
        {status === 'ready' && !compact && <dl className="cotton-stats">{[['mood', '心情'], ['satiety', '饱食'], ['water', '饮水']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Math.round(snapshot.stats[key] || 0)}<span> / 100</span></dd></div>)}</dl>}
        {onShare && <button type="button" className="cotton-share" disabled={status !== 'ready'} onClick={() => onShare('想和你一起陪小棉花待一会儿，聊聊我们的小日常。')}>带回聊天，和伴侣聊聊 ↗</button>}
        {!compact && <small>{storageKey ? '照料状态仅保存在本机，按当前账号和伴侣分别记录。' : '本次体验不保存照料状态。'}<br />这是独立副本的坐姿互动，走跑动作仍在制作。</small>}
      </aside>
    </div>
  </section>;
}

export default function CottonPet({ accountScope = '', companionScope = '', onShare, compact = false }) {
  const key = petStorageKey(accountScope, companionScope);
  return <PetVisit key={`${key || 'guest'}:${compact}`} storageKey={key} onShare={onShare} compact={compact} />;
}

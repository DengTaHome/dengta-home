import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/cozy-theme.css';
import '../src/native-feel.css';
import '../src/apple-ui.css';
import '../src/sun-glass-ui.css';
import '../src/sun-glass-chat.css';
import '../src/interaction-polish.css';
import { resizeComposerInput } from '../src/composer-size.js';
import { streamChat } from '../src/api.js';
import ChatMessage from '../src/ChatMessage.jsx';
import IntimateDuel from '../src/IntimateDuel.jsx';
import Together from '../src/Together.jsx';
import MemoryGatewayStatus from '../src/MemoryGatewayStatus.jsx';
import { createWatchRoom, joinWatchRoom, subscribeRoomEvents } from '../src/watch-room.js';
export function Preview() {
  const [text, setText] = useState(''), [view, setView] = useState('chat'), [content, setContent] = useState(''), [streaming, setStreaming] = useState(false);
  const [session, setSession] = useState(null), [roomResult, setRoomResult] = useState('');
  const input = useRef(null), unsubscribe = useRef(null);
  useLayoutEffect(() => { resizeComposerInput(input.current); }, [text, view]);
  useLayoutEffect(() => () => unsubscribe.current?.(), []);
  async function generate() {
    setContent(''); setStreaming(true);
    try { await streamChat({ message: 'Synthetic fixture' }, event => { if (event.type === 'text') setContent(value => value + event.content); }, { authSession: { getRequestContext: async () => ({}) } }); }
    finally { setStreaming(false); }
  }
  async function room(join = false) {
    const result = join ? await joinWatchRoom('fixture') : await createWatchRoom({ title: 'Synthetic room' });
    setRoomResult(result?.id || 'failure');
    unsubscribe.current?.();
    unsubscribe.current = subscribeRoomEvents(result.id, { onMessage: message => setRoomResult(message.content), onError: error => setRoomResult(error.code) });
  }
  return <div className="app-shell" data-chat-streaming={streaming ? 'true' : 'false'}>
    <main className="main-panel view-chat" style={{ margin: '0 auto', maxWidth: 1000, width: '100%', padding: 12 }}>
      <p style={{ fontSize: 12 }}>交互回归 · 仅虚构测试数据 · 不调用真实模型或记忆正文</p>
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>{['chat','duel','together','memory','room'].map(id => <button key={id} type="button" onClick={() => setView(id)}>{id}</button>)}</nav>
      {view === 'chat' && <><div className="message-list" style={{ minHeight: 180 }}><ChatMessage item={{ id: 'fixture', role: 'assistant', content, isStreaming: streaming }} aiName="测试角色" /></div>
        <div className="composer"><textarea aria-label="测试聊天输入" ref={input} rows={1} value={text} onChange={event => setText(event.target.value)} /><div className="composer-toolbar"><button className="chat-attach-button" type="button" aria-label="添加附件">＋</button><button type="button" className="send-button" disabled={streaming} onClick={() => void generate()} aria-label="流式测试">↑</button></div></div></>}
      {view === 'duel' && <IntimateDuel accountScope="synthetic-browser" companionScope="fixture" aiName="测试角色" userName="测试用户" />}
      {view === 'together' && <Together accountScope="synthetic-browser" aiName="测试角色" session={session} screenState={{ supported: false }} feedback={{ message: '虚构共看测试' }} onStartDirect={async data => { setSession({ id: 'synthetic-session', status: 'active', sourceApp: 'dengta-web-page', title: data.title }); return { ok: true }; }} onStopDirect={async () => { setSession(null); return { ok: true }; }} onReply={async () => true} />}
      {view === 'memory' && <MemoryGatewayStatus />}
      {view === 'room' && <section><button type="button" onClick={() => void room()}>创建测试房间</button><button type="button" onClick={() => void room(true)}>加入测试房间</button><output>{roomResult}</output></section>}
    </main></div>;
}
document.documentElement.dataset.dengtaAppearance = 'day';
document.documentElement.style.setProperty('--theme-ink', '#302d38');
document.documentElement.style.setProperty('--theme-card-rgb', '255 255 255');
document.body.style.background = '#f2ece6';
document.body.style.color = '#302d38';
createRoot(document.getElementById('root')).render(<Preview />);

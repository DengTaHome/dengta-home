import { createRoot } from 'react-dom/client';
import ChatErrorLog from '../src/ChatErrorLog';
import { publicChatErrorMessage } from '../src/chat-errors';
import '../src/index.css';

let calls = 0;
const diagnostic = { error_code: 'context_budget_exceeded', error_source: 'dengta', error_location: 'services/generation-budget.js:8:15' };
const load = async () => {
  if (++calls === 1) throw new Error('fixture');
  return { id: 42, ...diagnostic, request_summary: { version: '0.29.6', context_budget: { capacity: 65536, input: 45000, reservedOutput: 32000, stage: 'transport' } } };
};
const balance = { error_code: 'provider_balance_insufficient', provider_code: 'insufficient_balance', error_source: 'upstream_provider_or_gateway', upstream_status: 429 };
createRoot(document.getElementById('root')).render(
  <main style={{ padding: 24, maxWidth: 600, margin: 'auto', background: '#fff', color: '#222' }}>
    <h1>错误反馈回归预览</h1>
    <p>以下为模拟数据，不调用真实模型。</p>
    <h2>余额不足</h2>
    <p>{publicChatErrorMessage({ ...balance, code: balance.error_code })}</p>
    <ChatErrorLog logId={43} diagnostic={balance} loadLog={async () => balance} />
    <h2>上下文与日志重试</h2>
    <p>第一次模拟网络失败，第二次返回诊断。</p>
    <ChatErrorLog logId={42} diagnostic={diagnostic} loadLog={load} />
  </main>,
);

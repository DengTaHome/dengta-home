#!/usr/bin/env node
// ============================================================================
// mock-onebot.mjs —— 本地模拟 SnowLuma / OneBot v11 正向 WebSocket + HTTP API
//
// 用途：在**不登录真实 QQ、不安装 SnowLuma**的情况下自检 qq-bridge：
//   · 模拟 SnowLuma 的 OneBot v11 正向 WebSocket 服务端（桥接作为客户端连入）
//   · 模拟 OneBot v11 HTTP API（桥接用它发消息 / 查状态）
//   · 提供 /mock/inject 让你伪造一条 QQ 消息（私聊或群聊）推给桥接
//   · 记录桥接发回来的消息，证明「QQ → 桥接 → DSH → 桥接 → QQ」整条链路能跑
//
// 它**不是** SnowLuma 的替代品，也不连接腾讯服务器；只做本地协议仿真。
//
// 用法：
//   node mock-onebot.mjs [--ws-port 3001] [--http-port 3000] [--token <token>]
//                        [--self-id 10000] [--log-file logs/mock-onebot.jsonl]
//                        [--heartbeat-ms 30000]
//
// 注入消息（另开一个终端）：
//   curl -X POST http://127.0.0.1:3000/mock/inject \
//        -H "content-type: application/json" \
//        -d '{"user_id":10001,"text":"你好，只回复两个字：收到"}'
//   # 群消息：{"group_id":20001,"user_id":10001,"text":"..."}
//
// 查看状态 / 已发出的消息：
//   curl http://127.0.0.1:3000/mock/state
//
// 依赖：ws（见同目录 package.json；先 npm install）
// ============================================================================

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 参数 ────────────────────────────────────────────────────────────────────
function argOf(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const WS_PORT = Number(argOf('--ws-port', '3001'));
const HTTP_PORT = Number(argOf('--http-port', '3000'));
const TOKEN = String(argOf('--token', ''));
const SELF_ID = Number(argOf('--self-id', '10000'));
const LOG_FILE = path.resolve(__dirname, argOf('--log-file', 'logs/mock-onebot.jsonl'));
const HEARTBEAT_MS = Number(argOf('--heartbeat-ms', '30000'));

// ── 日志 ────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
function log(level, msg, extra = undefined) {
  const line = { t: new Date().toISOString(), level, msg, ...(extra === undefined ? {} : { extra }) };
  const text = `[mock-onebot] ${line.t} ${level} ${msg}${extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(line) + '\n', 'utf8');
  } catch {
    /* 日志失败不影响协议仿真 */
  }
}

// ── 动态加载 ws（本地 node_modules 优先；也允许回退到 qq-bridge 的依赖树） ──
async function loadWs() {
  try {
    return await import('ws');
  } catch {
    const bridgeRoot = process.env.QQ_BRIDGE_ROOT || 'D:\\GZdeepseek\\_refs\\qq\\qq-bridge';
    const anchor = path.join(bridgeRoot, 'package.json');
    if (!fs.existsSync(anchor)) throw new Error('找不到 ws 模块：请在 tools/qq-bridge-recovery 里执行 npm install');
    const { createRequire } = await import('node:module');
    const req = createRequire(anchor);
    const wsPath = req.resolve('ws');
    return await import(pathToFileURL(wsPath).href);
  }
}
const wsMod = await loadWs();
const { WebSocketServer } = wsMod;

// ── 状态 ────────────────────────────────────────────────────────────────────
const state = {
  startedAt: Date.now(),
  connections: 0,
  totalConnections: 0,
  receivedActions: [],   // 桥接发给 mock 的动作（HTTP / WS）
  sentMessages: [],      // 桥接通过 send_*_msg 发回来的 QQ 消息
  injected: [],          // 我们注入给桥接的 QQ 消息
  heartbeats: 0,
};
let nextMessageId = 1000;
const messageStore = new Map(); // message_id -> 消息事件（供 get_msg 查）
const wsClients = new Set();

function ok(data = {}) {
  return { status: 'ok', retcode: 0, data };
}
function fail(retcode = 1404, wording = 'unsupported action') {
  return { status: 'failed', retcode, data: null, wording };
}

// 记录一条「桥接发来的动作」。token 类字段一律脱敏。
function recordAction(channel, action, params) {
  const redacted = { ...(params ?? {}) };
  for (const k of ['access_token', 'token', 'authorization']) if (k in redacted) redacted[k] = '<redacted>';
  state.receivedActions.push({ t: Date.now(), channel, action, params: redacted });
  log('info', `action ${channel} ${action}`, redacted);
}

// ── OneBot 动作实现（HTTP 与 WS 共用） ──────────────────────────────────────
function handleAction(action, params = {}) {
  const now = Math.floor(Date.now() / 1000);
  switch (action) {
    case 'get_login_info':
      return ok({ user_id: SELF_ID, nickname: 'MockBot' });
    case 'get_status':
    case 'get_status_':
      return ok({ online: true, good: true, app_initialized: true, app_enabled: true, plugins_good: true });
    case 'get_version_info':
      return ok({ app_name: 'mock-onebot', app_version: '0.0.1', protocol_version: 'v11' });
    case 'get_friend_list':
      return ok([]);
    case 'get_group_list':
      return ok([]);
    case 'get_group_info':
      return ok({ group_id: Number(params.group_id) || 0, group_name: 'MockGroup', member_count: 1 });
    case 'get_group_member_list':
    case 'get_group_member_info':
      return ok(action.endsWith('list') ? [] : { user_id: Number(params.user_id) || 0, nickname: 'MockUser' });
    case 'can_send_image':
    case 'can_send_record':
    case 'set_msg_emoji_like':
    case 'delete_msg':
    case 'mark_msg_as_read':
      return ok({});
    case 'get_msg': {
      const id = Number(params.message_id);
      const cached = messageStore.get(id);
      return cached ? ok(cached) : fail(1404, 'message not found');
    }
    case 'fetch_ptt_text':
      return fail(1400, 'mock-onebot 不做语音转写');
    case 'send_private_msg': {
      const messageId = nextMessageId++;
      const msg = {
        t: Date.now(), kind: 'private', messageId,
        user_id: Number(params.user_id), message: params.message, auto_escape: params.auto_escape ?? false,
      };
      state.sentMessages.push(msg);
      log('send', 'send_private_msg', msg);
      return ok({ message_id: messageId });
    }
    case 'send_group_msg': {
      const messageId = nextMessageId++;
      const msg = {
        t: Date.now(), kind: 'group', messageId,
        group_id: Number(params.group_id), message: params.message, auto_escape: params.auto_escape ?? false,
      };
      state.sentMessages.push(msg);
      log('send', 'send_group_msg', msg);
      return ok({ message_id: messageId });
    }
    case 'send_msg': {
      const isGroup = params.message_type === 'group' || params.group_id !== undefined;
      const messageId = nextMessageId++;
      const msg = {
        t: Date.now(), kind: isGroup ? 'group' : 'private', messageId,
        ...(isGroup ? { group_id: Number(params.group_id) } : { user_id: Number(params.user_id) }),
        message: params.message, auto_escape: params.auto_escape ?? false,
      };
      state.sentMessages.push(msg);
      log('send', 'send_msg', msg);
      return ok({ message_id: messageId });
    }
    default:
      log('warn', `未实现的 OneBot 动作：${action}`);
      return fail(1404, `mock-onebot 未实现 ${action}`);
  }
}

// ── HTTP API 服务（OneBot v11 正向 HTTP） ───────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ _raw: raw }); }
    });
    req.on('error', () => resolve({}));
  });
}

function checkHttpToken(req, url) {
  if (!TOKEN) return true;
  const auth = String(req.headers.authorization ?? '');
  if (auth === `Bearer ${TOKEN}`) return true;
  return url.searchParams.get('access_token') === TOKEN;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${HTTP_PORT}`);
  const sendJson = (obj, code = 200) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
  };

  // 自检辅助端点（不模拟 OneBot，前缀独立避免与动作混淆）
  if (url.pathname === '/mock/state' && req.method === 'GET') {
    return sendJson({
      ok: true,
      wsPort: WS_PORT, httpPort: HTTP_PORT, selfId: SELF_ID,
      connections: wsClients.size, totalConnections: state.totalConnections,
      heartbeats: state.heartbeats,
      receivedActions: state.receivedActions.slice(-50),
      sentMessages: state.sentMessages,
      injected: state.injected,
      logFile: LOG_FILE,
    });
  }
  if (url.pathname === '/mock/inject' && req.method === 'POST') {
    const body = await readBody(req);
    const event = buildMessageEvent(body);
    if (!event) return sendJson({ ok: false, error: '需要 text，且 user_id 或 group_id' }, 400);
    state.injected.push({ t: Date.now(), ...body });
    log('inject', '注入 QQ 消息', { message_type: event.message_type, user_id: event.user_id, group_id: event.group_id, text: body.text });
    broadcast(event);
    return sendJson({ ok: true, event });
  }
  if (url.pathname === '/mock/quit' && req.method === 'POST') {
    sendJson({ ok: true });
    setTimeout(() => shutdown(0), 50);
    return;
  }

  if (!checkHttpToken(req, url)) {
    return sendJson(fail(1401, 'token 校验失败'), 401);
  }

  // OneBot v11：动作名作为 URL path，GET / POST 都接受
  let params = {};
  if (req.method === 'POST') params = await readBody(req);
  else params = Object.fromEntries(url.searchParams.entries());
  const action = url.pathname.replace(/^\//, '');
  const result = handleAction(action, params);
  recordAction('http', action, params);
  return sendJson(result);
});

// ── OneBot 消息事件 ─────────────────────────────────────────────────────────
function normalizeSegments(text) {
  // 允许注入里带简单的 CQ 码风格写法；默认整条当纯文本，够自检用。
  return [{ type: 'text', data: { text: String(text) } }];
}

function buildMessageEvent(body) {
  const text = body?.text;
  if (typeof text !== 'string' || !text) return null;
  const messageId = nextMessageId++;
  const time = Math.floor(Date.now() / 1000);
  const base = {
    time,
    self_id: SELF_ID,
    post_type: 'message',
    message_id: messageId,
    message: normalizeSegments(text),
    raw_message: text,
    font: 0,
    sender: { user_id: Number(body.user_id) || 0, nickname: body.nickname || 'MockUser', card: '' },
  };
  let event;
  if (body.group_id !== undefined) {
    event = {
      ...base,
      message_type: 'group',
      sub_type: 'normal',
      group_id: Number(body.group_id),
      user_id: Number(body.user_id) || 0,
      anonymous: null,
      sender: { ...base.sender, user_id: Number(body.user_id) || 0, card: '' },
    };
  } else if (body.user_id !== undefined) {
    event = {
      ...base,
      message_type: 'private',
      sub_type: 'friend',
      user_id: Number(body.user_id),
      sender: { ...base.sender, user_id: Number(body.user_id) },
    };
  } else {
    return null;
  }
  messageStore.set(messageId, event);
  return event;
}

function broadcast(event) {
  const raw = JSON.stringify(event);
  let n = 0;
  for (const client of wsClients) {
    if (client.readyState === 1) { client.send(raw); n += 1; }
  }
  log('event', `已推送：${event.message_type}`, { connections: n, text: event.raw_message });
  return n;
}

// ── 正向 WebSocket 服务（桥接作为 OneBot WS 客户端连入） ────────────────────
const wsHttpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('mock-onebot WebSocket endpoint\n');
});
const wss = new WebSocketServer({ server: wsHttpServer });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://127.0.0.1:${WS_PORT}`);
  if (TOKEN && url.searchParams.get('access_token') !== TOKEN) {
    log('warn', 'WS 连接 token 校验失败，拒绝', { hasToken: Boolean(url.searchParams.get('access_token')) });
    socket.close(1008, 'invalid token');
    return;
  }
  wsClients.add(socket);
  state.totalConnections += 1;
  log('info', '桥接已连入 mock OneBot WebSocket', { remote: req.socket.remoteAddress, clients: wsClients.size });

  // 立刻推一条心跳，让桥接快速进入「上游健康」状态
  sendHeartbeat(socket);

  socket.on('message', (buf) => {
    let frame;
    try { frame = JSON.parse(String(buf)); } catch { return; }
    // OneBot v11 的「动作请求」：{action, params, echo}
    if (frame && typeof frame.action === 'string') {
      const result = handleAction(frame.action, frame.params ?? {});
      recordAction('ws', frame.action, frame.params ?? {});
      try {
        socket.send(JSON.stringify({ ...result, echo: frame.echo ?? null }));
      } catch { /* 连接已断 */ }
    }
  });
  socket.on('close', () => {
    wsClients.delete(socket);
    log('info', '桥接 WebSocket 断开', { clients: wsClients.size });
  });
  socket.on('error', (error) => log('warn', 'WS 客户端错误', { error: String(error?.message ?? error) }));
});

function sendHeartbeat(socket = null) {
  state.heartbeats += 1;
  const heartbeat = {
    time: Math.floor(Date.now() / 1000),
    self_id: SELF_ID,
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
    status: { online: true, good: true },
    interval: HEARTBEAT_MS,
  };
  const raw = JSON.stringify(heartbeat);
  const targets = socket ? [socket] : [...wsClients];
  for (const c of targets) { try { if (c.readyState === 1) c.send(raw); } catch { /* ignore */ } }
}

if (HEARTBEAT_MS > 0) {
  const timer = setInterval(() => {
    if (wsClients.size > 0) sendHeartbeat();
  }, HEARTBEAT_MS);
  timer.unref?.();
}

// ── 启动 / 退出 ─────────────────────────────────────────────────────────────
function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      log('info', `${label} 已监听 http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', '正在关闭 mock-onebot');
  for (const c of wsClients) { try { c.close(1000, 'mock shutdown'); } catch { /* ignore */ } }
  wss.close?.();
  httpServer.close();
  wsHttpServer.close();
  setTimeout(() => process.exit(code), 100);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await listen(httpServer, HTTP_PORT, 'OneBot HTTP API');
  await listen(wsHttpServer, WS_PORT, 'OneBot 正向 WebSocket');
} catch (error) {
  log('error', '端口监听失败（3000/3001 是否被占用？）', { error: String(error?.message ?? error) });
  process.exit(1);
}

log('info', 'mock-onebot 就绪', {
  ws: `ws://127.0.0.1:${WS_PORT}`,
  http: `http://127.0.0.1:${HTTP_PORT}`,
  token: TOKEN ? '<已配置>' : '(无)',
  selfId: SELF_ID,
  logFile: LOG_FILE,
  hint: `注入消息：POST /mock/inject {"user_id":10001,"text":"你好"}`,
});

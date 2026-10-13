import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import process from 'node:process';
import { setImmediate } from 'node:timers';
const root = fileURLToPath(new URL('..', import.meta.url)).replaceAll(String.fromCharCode(92), '/').replace(/\/$/, '');
const require = createRequire(root + '/package.json');
const React = require('react');
const { act } = React;
const TestRenderer = require('react-test-renderer');
const { createServer } = await import(pathToFileURL(require.resolve('vite')));
const { storeDirectMediaSession, readDirectMediaSession } = await import(pathToFileURL(root + '/src/direct-media.js'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const intervals = new Map();
let intervalId = 0;
globalThis.window = { setInterval: fn => { const id = ++intervalId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), setTimeout, clearTimeout };
globalThis.document = { hidden: false, body: { style: {} } };
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const requests = [];
globalThis.__round9Request = (path, options = {}) => path.includes('/page-resolve')
  ? new Promise((resolve, reject) => requests.push({ path, options, resolve, reject }))
  : Promise.resolve({ logged_in: false });
const observations = {};
let vite, Together, tree;
const props = { accountScope: 'fictional-round9-account', companionScope: 'fictional-round9-companion', screenState: {}, feedback: {}, onRefresh() {} };
const sourceApp = 'dengta-direct-media';
const oldUrl = 'https://media.example.test/fictional-old.mp4';
const pageKey = 'dengta_together_web_page_v2:' + JSON.stringify([props.accountScope, props.companionScope]);
const button = text => tree.root.findAllByType('button').find(node => node.children.includes(text));
const urlInput = () => tree.root.findAllByType('input').find(node => node.props.type === 'url');
const titleInput = () => tree.root.findByProps({ placeholder: '电影、剧集或视频标题' });
const directCache = () => readDirectMediaSession(globalThis.sessionStorage, props.accountScope, props.companionScope);
const text = () => JSON.stringify(tree.toJSON());
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const videoMock = () => ({ currentTime: 0, duration: 300, paused: true, currentSrc: oldUrl, error: null, loads: 0, pauses: 0, load() { this.loads++; }, pause() { this.pauses++; this.paused = true; } });
let videos;
async function mount(extra = {}) {
  videos = [];
  await act(async () => { tree = TestRenderer.create(React.createElement(Together, { ...props, ...extra }), { createNodeMock(element) {
    if (element.type === 'video') { const node = videoMock(); node.currentSrc = element.props.src; videos.push(node); return node; }
    return null;
  } }); await flush(); });
}
async function unmount() { if (tree) await act(async () => { tree.unmount(); tree = null; }); }
async function changeUrl(value) { await act(async () => urlInput().props.onChange({ target: { value } })); }
async function parse(value) { await changeUrl(value); await act(async () => { button('解析并载入').props.onClick(); await flush(); }); return requests.at(-1); }
const page = (name, provider = 'fixture') => ({ page_url: 'https://fixture.example.test/' + name, embed_url: 'https://fixture.example.test/embed/' + name, title: name, provider, ...(provider === 'bilibili' ? { bvid: 'BVfictional' + name } : {}) });
before(async () => {
  vite = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true }, plugins: [{ name: 'round9-fictional-api', enforce: 'pre', load(id) {
    if (id.replaceAll('\\', '/').endsWith('/src/api.js')) return 'export const apiRequest = (...args) => globalThis.__round9Request(...args); export const apiFetch = apiRequest; export const API_BASE_URL = "https://fixture.example.test";';
  } }] });
  ({ default: Together } = await vite.ssrLoadModule('/src/Together.jsx'));
});
after(async () => {
  await unmount();
  await vite.close();
  delete globalThis.__round9Request;
});

test('switching out of pending web parse preserves the later direct title', async () => {
  storage.clear(); requests.length = 0;
  let submitted;
  try {
    await mount({ onStartDirect: async options => { submitted = options; return { ok: true, message: 'fictional start confirmed' }; } });
    await act(async () => button('网页一起看').props.onClick());
    const request = await parse('https://fixture.example.test/old-page');
    await act(async () => button('DengTa 视频直链').props.onClick());
    await act(async () => titleInput().props.onChange({ target: { value: '用户后来填写的直链标题' } }));
    await act(async () => { request.resolve({ page: page('旧网页迟到标题') }); await flush(); });
    await changeUrl('https://media.example.test/new.mp4');
    await act(async () => button('载入播放器').props.onClick());
    await act(async () => button('开始直链共看').props.onClick());
    observations.lateWebParse = { abortedOnSwitch: request.options.signal.aborted, selectedDirect: button('DengTa 视频直链').props['aria-selected'], directTitle: titleInput().props.value, submittedTitle: submitted.title, webCacheWritten: storage.has(pageKey) };
    assert.equal(submitted.title, '用户后来填写的直链标题');
    assert.equal(request.options.signal.aborted, true); assert.equal(storage.has(pageKey), false);
  } finally { await unmount(); }
});

test('direct video remount reports paused for the fresh paused player', async () => {
  storage.clear();
  storeDirectMediaSession(globalThis.sessionStorage, props.accountScope, { url: oldUrl }, props.companionScope);
  try {
    await mount();
    videos.at(-1).paused = false;
    await act(async () => tree.root.findByType('video').props.onPlay({ currentTarget: videos.at(-1) }));
    await act(async () => button('网页一起看').props.onClick());
    await act(async () => button('DengTa 视频直链').props.onClick());
    const fresh = videos.at(-1);
    await act(async () => tree.root.findByType('video').props.onLoadedMetadata({ currentTarget: fresh }));
    await act(async () => tree.update(React.createElement(Together, { ...props, session: { id: 'fictional-direct-active', status: 'active', sourceApp } })));
    const status = tree.root.findAllByType('strong').map(node => node.children.filter(value => typeof value === 'string').join('')).filter(value => value === '正在播放' || value === '已暂停');
    observations.directRemount = { videoCount: videos.length, freshPaused: fresh.paused, oldExplicitPauses: videos[0].pauses, displayedStatus: status };
    assert.ok(status.includes('已暂停'), 'a fresh video node is paused but the component still reports playing');
  } finally { await unmount(); }
});

test('Bilibili successful reload clears checking feedback after readiness and play events', async () => {
  storage.clear(); storage.set(pageKey, JSON.stringify(page('ready', 'bilibili')));
  try {
    await mount();
    const node = videos.at(-1);
    node.error = { code: 2 };
    await act(async () => tree.root.findByType('video').props.onError({ currentTarget: node }));
    await act(async () => button('重新载入视频').props.onClick());
    node.error = null; node.paused = false; node.currentTime = 8;
    const dispatched = [];
    for (const name of ['onLoadedMetadata', 'onLoadedData', 'onCanPlay', 'onPlaying', 'onPlay', 'onTimeUpdate']) {
      await act(async () => { const handler = tree.root.findByType('video').props[name]; dispatched.push({ name, registered: typeof handler === 'function' }); handler?.({ currentTarget: node }); });
    }
    observations.bilibiliReload = { loads: node.loads, paused: node.paused, readyEvents: dispatched, checkingRemains: text().includes('正在重新载入视频，请准备好后手动播放。') };
    assert.equal(observations.bilibiliReload.checkingRemains, false);
  } finally { await unmount(); }
});

test('ending then loading a different web video clears the previous animated comment', async () => {
  storage.clear(); requests.length = 0; storage.set(pageKey, JSON.stringify(page('old-bili', 'bilibili')));
  const session = { id: 'fictional-web-old', status: 'active', sourceApp: 'dengta-web-page' };
  const danmaku = [{ text: '上一场的虚构弹幕', media_time_seconds: 0 }];
  try {
    await mount({ session, danmaku, onStopDirect: async () => ({ ok: true }) });
    await act(async () => { for (const fn of intervals.values()) fn(); });
    assert.ok(text().includes('上一场的虚构弹幕'));
    await act(async () => button('结束本场').props.onClick());
    await act(async () => tree.update(React.createElement(Together, { ...props, danmaku })));
    const request = await parse('https://fixture.example.test/new-bili');
    await act(async () => { request.resolve({ page: page('new-bili', 'bilibili') }); await flush(); });
    const comments = tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.startsWith('together-danmaku-item')).map(node => node.children.join(''));
    observations.danmakuReplacement = { newVideo: tree.root.findByType('video').props.src, overlayComments: comments };
    assert.deepEqual(comments, [], 'previous-session overlay is retained on the next video');
  } finally { await unmount(); }
});

test('actual App identity cleanup prevents a previous companion comment appearing after Together remount', async () => {
  storage.clear();
  const source = readFileSync(root + '/src/App.jsx', 'utf8');
  const cleanup = source.match(/useLayoutEffect\(\s*\(\) => (\(\) => \{\s*if \(coWatchReplyJobRef\.current\)[\s\S]*?setCoWatchDialog\(\[\]\);[\s\S]*?\n {4}\}),\s*\[accountStorageScope, companionScope\]/)?.[1];
  assert.ok(cleanup, 'the current App identity cleanup must be extracted without changing its source');
  const state = { danmaku: [{ text: '旧伴侣的虚构弹幕', media_time_seconds: 0 }], dialog: [{ text: 'fictional previous dialog' }], session: { id: 'fictional-old' } };
  const invalidate = () => {};
  const context = {
    coWatchReplyJobRef: { current: null }, coWatchBusyRef: { current: false }, setIsScreenGlanceBusy() {},
    coWatchLifecycleRef: { current: { invalidate } }, coWatchViewScopeRef: { current: { invalidate } },
    musicPlaybackSyncRef: { current: null }, nowPlayingSyncRef: { current: null }, screenGlanceLifecycleRef: { current: { invalidate } },
    releasePendingScreenGlanceTurn() {}, pendingScreenGlanceTurnRef: { current: null }, coWatchSessionRef: { current: state.session },
    clearDirectMediaSession() {}, accountStorageScope: props.accountScope, companionScope: props.companionScope,
    setCoWatchSession: value => { state.session = value; }, setActivityReturn() {}, setCoWatchDialog: value => { state.dialog = value; },
    setCoWatchDanmaku: value => { state.danmaku = value; },
  };
  runInNewContext('(' + cleanup + ')', context)();
  const nextCompanion = 'fictional-different-companion';
  const nextPageKey = 'dengta_together_web_page_v2:' + JSON.stringify([props.accountScope, nextCompanion]);
  storage.set(nextPageKey, JSON.stringify(page('new-companion', 'bilibili')));
  try {
    await mount({ companionScope: nextCompanion, danmaku: state.danmaku, session: { id: 'fictional-next-companion-session', status: 'active', sourceApp: 'dengta-web-page' } });
    await act(async () => { for (const fn of intervals.values()) fn(); });
    const comments = tree.root.findAll(node => typeof node.props.className === 'string' && node.props.className.startsWith('together-danmaku-item')).map(node => node.children.join(''));
    observations.companionDanmakuScope = { cleanupDialogLength: state.dialog.length, cleanupSession: state.session, cleanupDanmakuLength: state.danmaku.length, newCompanion: nextCompanion, overlayComments: comments };
    assert.deepEqual(comments, [], 'the actual cleanup clears session/dialog but leaves previous-companion danmaku for the new keyed Together');
  } finally { await unmount(); }
});

test('a newer parse aborts its old request and ignores the old receipt', async () => {
  storage.clear(); requests.length = 0;
  try {
    await mount(); await act(async () => button('网页一起看').props.onClick());
    const old = await parse('https://fixture.example.test/old');
    const newer = await parse('https://fixture.example.test/new');
    assert.equal(old.options.signal.aborted, true);
    await act(async () => { newer.resolve({ page: page('new') }); await flush(); });
    await act(async () => { old.resolve({ page: page('old') }); await flush(); });
    assert.equal(tree.root.findByType('iframe').props.src, page('new').embed_url);
    assert.equal(JSON.parse(storage.get(pageKey)).title, 'new');
    observations.replacedParseGuard = true;
  } finally { await unmount(); }
});

test('unmount aborts a pending parse and prevents a late storage write', async () => {
  storage.clear(); requests.length = 0;
  await mount(); await act(async () => button('网页一起看').props.onClick());
  const request = await parse('https://fixture.example.test/unmount');
  await unmount();
  assert.equal(request.options.signal.aborted, true);
  await act(async () => { request.resolve({ page: page('unmount') }); await flush(); });
  assert.equal(storage.has(pageKey), false);
  assert.equal(intervals.size, 0);
  observations.unmountGuard = true;
});

test('loading a different direct URL does not restore the old saved seek position', async () => {
  storage.clear(); storeDirectMediaSession(globalThis.sessionStorage, props.accountScope, { url: oldUrl, positionSeconds: 73 }, props.companionScope);
  try {
    await mount(); await changeUrl('https://media.example.test/new.mp4');
    await act(async () => button('载入播放器').props.onClick());
    const node = videos.at(-1); node.currentTime = 0;
    await act(async () => tree.root.findByType('video').props.onLoadedMetadata({ currentTarget: node }));
    assert.equal(node.currentTime, 0); assert.equal(directCache().positionSeconds, 0);
    observations.newDirectUrlSeekGuard = true;
  } finally { await unmount(); }
});

process.on('uncaughtExceptionMonitor', error => { observations.runnerException = error.message; });

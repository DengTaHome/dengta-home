import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const nativeRoot = new URL('../android/app/src/main/java/home/dengta/app/', import.meta.url);
const source = name => fs.readFileSync(new URL(name + '.java', nativeRoot), 'utf8');

function stringExpression(file, name, method = '', bindings = {}) {
  const whole = source(file);
  const start = method ? whole.search(new RegExp('\\b(?:private|protected|public)\\s+(?:static\\s+)?(?:void|boolean|String)\\s+' + method + '\\(')) : 0;
  assert.ok(start >= 0, 'actual native method must exist');
  const declaration = whole.indexOf('String ' + name + ' =', start);
  assert.ok(declaration >= 0, 'actual native string must exist');
  let end = whole.indexOf('=', declaration) + 1;
  const expressionStart = end;
  let quoted = false;
  for (; end < whole.length; end += 1) {
    if (whole[end] === '\\' && quoted) { end += 1; continue; }
    if (whole[end] === '"') quoted = !quoted;
    if (whole[end] === ';' && !quoted) break;
  }
  return vm.runInNewContext(whole.slice(expressionStart, end), {
    JSONObject: { quote: JSON.stringify }, selector: "[data-dengta-pick='1']",
    shopName: '虚构店铺', product: '标准美式', ...bindings,
  }, { timeout: 100 });
}

function element(text, title = '') {
  const attributes = new Map();
  return {
    innerText: text, attributes, children: [],
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: key => attributes.get(key),
    querySelector: () => title ? { innerText: title } : null,
    getBoundingClientRect: () => ({ x: 10, y: 10, width: 120, height: 60 }),
  };
}

function run(script, document = {}, extras = {}) {
  return vm.runInNewContext(script, { document, ...extras }, { timeout: 100 });
}

test('the actual native-generated scripts compile, including dynamic selectors and Unicode names', () => {
  const scripts = [
    ['OrderWebActivity', 'js', 'tapMarked'], ['OrderWebActivity', 'js', 'checkVerification'],
    ['OrderWebActivity', 'waitJs', 'runSearchStep'], ['OrderWebActivity', 'js', 'runSearchStep'],
    ['OrderWebActivity', 'js', 'runOrderStep'], ['OrderWebActivity', 'js', 'reloadShopDoor'],
    ['OrderWebActivity', 'js', 'addProductStep'], ['OrderWebActivity', 'js', 'confirmAddToCart'],
    ['OrderWebActivity', 'js2', 'confirmAddToCart'], ['OrderWebActivity', 'js', 'settlementCheck'],
    ['PersistentBrowserActivity', 'js', 'runSearchExtract'],
    ['BrowserSessionSupport', 'LOGIN_STATE_SCRIPT'], ['LocationFix', 'MOCK_SCRIPT'],
  ];
  for (const [file, name, method] of scripts) {
    const script = stringExpression(file, name, method, { shopName: '虚构店铺"~👋', product: "标准'美式~" });
    assert.doesNotThrow(() => new vm.Script(script), file + '.' + (method || name));
  }
});

test('real search injection reads shop names from text and returns loading while no cards exist', () => {
  const script = stringExpression('OrderWebActivity', 'js', 'runSearchStep');
  const result = run(script, { querySelectorAll: () => [element('虚构店铺\n4.8\n分\n起送¥10')] });
  assert.equal(result.loading, false);
  assert.equal(result.shops.length, 1);
  assert.equal(result.shops[0].name, '虚构店铺');
  const empty = run(script, { querySelectorAll: () => [] });
  assert.equal(empty.loading, true);
  assert.equal(empty.shops.length, 0);
});

test('shop selection never marks another shop or a similar branch when exact name is absent', () => {
  const script = stringExpression('OrderWebActivity', 'js', 'runOrderStep');
  const wrong = element('虚构店铺东门分店\n4.9\n分\n起送¥10');
  const miss = run(script, { querySelectorAll: () => [wrong] });
  assert.equal(miss.status, 'shop_not_found');
  assert.equal(miss.code, 'takeout_shop_not_found');
  assert.equal(wrong.attributes.size, 0);
  assert.equal(miss.candidates.length, 1);
  const right = element('虚构店铺\n4.8\n分\n起送¥10');
  const found = run(script, { querySelectorAll: () => [wrong, right] });
  assert.equal(found.status, 'opening_shop');
  assert.equal(right.attributes.get('data-dengta-pick'), '1');
  assert.equal(wrong.attributes.size, 0);
});

test('product selection distinguishes a named drink from flavors and refuses a first-row fallback', () => {
  const script = stringExpression('OrderWebActivity', 'js', 'addProductStep');
  const wrong = element('果C标准美式\n月售 10\n¥18', '果C标准美式');
  const miss = run(script, { querySelectorAll: () => [wrong] });
  assert.equal(miss.status, 'product_not_found');
  assert.equal(miss.code, 'takeout_product_not_found');
  assert.equal(wrong.attributes.size, 0);
  assert.equal(miss.candidates[0], '果C标准美式');
  const right = element('标准美式\n月售 10\n¥18', '标准 美式');
  const found = run(script, { querySelectorAll: () => [wrong, right] });
  assert.equal(found.status, 'opening_product');
  assert.equal(right.attributes.get('data-dengta-product'), '1');
  assert.equal(wrong.attributes.size, 0);
});

test('login detection requires a visible form and does not mistake a login URL or loading footer for expiry', () => {
  const script = stringExpression('BrowserSessionSupport', 'LOGIN_STATE_SCRIPT');
  const visible = element('');
  const hidden = { getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const probe = (text, inputs) => run(script, {
    body: { innerText: text }, querySelectorAll: selector => selector.startsWith('iframe') ? [] : inputs,
  }, {
    location: { href: 'https://h5.ele.me/login' },
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  }).state;
  assert.equal(probe('收货地址 虚构商圈 月售100', []), 'ready');
  assert.equal(probe('ICP备案号', []), 'unknown');
  assert.equal(probe('手机号登录', [hidden]), 'unknown');
  assert.equal(probe('手机号登录', [visible]), 'login_required');
  assert.equal(probe('虚构店铺 月售80 手机号登录', [visible]), 'login_required');
  assert.equal(probe('', []), 'unknown');
});

test('actual touch injection supplies viewport units and refuses obscured or invalid positions', () => {
  const script = stringExpression('OrderWebActivity', 'js', 'tapMarked');
  const target = element('虚构按钮');
  target.getBoundingClientRect = () => ({ x: 120, y: 90, width: 40, height: 30 });
  target.contains = value => value === target;
  const document = { querySelector: () => target, elementFromPoint: () => target };
  const point = run(script, document, { window: { innerWidth: 390, innerHeight: 700 } });
  assert.equal(point.x, 140);
  assert.equal(point.y, 105);
  assert.equal(point.viewportWidth, 390);
  assert.equal(point.viewportHeight, 700);
  assert.equal(run(script, { ...document, elementFromPoint: () => element('遮挡层') }, { window: { innerWidth: 390, innerHeight: 700 } }), null);
  for (const width of [0, NaN, Infinity]) {
    assert.equal(run(script, document, { window: { innerWidth: width, innerHeight: 700 } }), null);
  }
  target.getBoundingClientRect = () => ({ x: 500, y: 90, width: 40, height: 30 });
  assert.equal(run(script, document, { window: { innerWidth: 390, innerHeight: 700 } }), null);
});
test('login URL recognition works for empty Tiga pages without guessing expiry from a blank shop list', () => {
  const script = stringExpression('BrowserSessionSupport', 'LOGIN_STATE_SCRIPT');
  const probe = location => run(script, { body: { innerText: '' }, querySelectorAll: () => [] }, { window: { location, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } }).state;
  assert.equal(probe({ hostname: 'login.m.taobao.com', pathname: '/login.htm' }), 'login_required');
  assert.equal(probe({ hostname: 'passport.ele.me', pathname: '/' }), 'login_required');
  assert.equal(probe({ hostname: 'h5.ele.me', pathname: '/entry/login' }), 'login_required');
  assert.equal(probe({ hostname: 'h5.ele.me', pathname: '/minisearch/result', search: '?redirect=login' }), 'unknown');
  assert.equal(probe({ hostname: 'h5.ele.me', pathname: '/login-cafe/menu' }), 'unknown');
});
test('order callbacks and delayed steps use the current page authority; recovery never restarts add-to-cart', () => {
  const code = source('OrderWebActivity');
  assert.doesNotMatch(code, /(?:webView|view|targetView)\.(?:evaluateJavascript|postDelayed)\(/);
  assert.match(code, /target\.evaluateJavascript\(script, value -> \{ if \(activePage\(target, generation\)\)/);
  assert.match(code, /target\.postDelayed\(\(\) -> \{ if \(activePage\(target, generation\)\)/);
  assert.match(code, /pageGeneration \+= 1;\s*enterTickPending = false;/, 'navigation must release the old page scheduled-step latch');
  assert.match(code, /private void showTechnicalError\(String code\) \{\s*automationStopped = true;/);
  assert.match(code, /恢复网页，手动核对/);
  assert.match(code, /if \(!technicalErrorCode\.isEmpty\(\)\) \{ returnToDengTa\(technicalErrorResult\(\)\); return; \}/);
});

test('native search receipts retain public reason codes and login errors keep their actual failure category', () => {
  const plugin = source('OrderBrowserPlugin');
  assert.match(plugin, /publicTakeoutSearchErrorCode\(status, parsed\.optString\("code", ""\)\)/);
  assert.match(plugin, /if \(!code\.isEmpty\(\)\) result\.put\("code", code\)/);
  assert.match(plugin, /BrowserSessionSupport\.accountErrorMessage\(code\) : BrowserSessionSupport\.browserErrorMessage\(code\)/);
});

function locationContext(value, deferred = false) {
  const timers = new Map(), queued = [], geolocation = {}, results = [];
  let nextTimer = 0;
  const bridge = { postMessage(id) {
    const deliver = () => bridge.onmessage({ data: JSON.stringify({ id: Number(id), location: value }) });
    if (deferred) queued.push(deliver); else deliver();
  } };
  const window = { DengTaLocation: bridge }; window.top = window;
  return { window, navigator: { geolocation }, results, queued, timers,
    setTimeout(callback, delay) { if (!delay) { callback(); return 0; } const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
}

test('missing or malformed bridge locations report unavailable instead of successful zero coordinates', () => {
  const script = stringExpression('LocationFix', 'MOCK_SCRIPT');
  for (const location of ['', ',', ',,', ' , ,10', 'bad,coords,10', '91,100,10']) {
    const successes = [], errors = [];
    const context = locationContext(location);
    run(script, {}, context);
    context.navigator.geolocation.getCurrentPosition(value => successes.push(value), error => errors.push(error));
    assert.equal(successes.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 2);
  }
});

test('secure location bridge cancels pending watches and never falls back to the origin-unaware native API', () => {
  const script = stringExpression('LocationFix', 'MOCK_SCRIPT');
  const context = locationContext('12.34,56.78,45', true), geolocation = context.navigator.geolocation;
  geolocation.getCurrentPosition = () => assert.fail('native fallback must remain disabled');
  run(script, {}, context); run(script, {}, context);
  const id = geolocation.watchPosition(() => assert.fail('cancelled watch cannot deliver'));
  geolocation.clearWatch(id);
  context.queued.shift()();
  assert.equal(context.timers.size, 0);
  const errors = [];
  geolocation.getCurrentPosition(() => assert.fail('timeout cannot deliver'), error => errors.push(error.code), { timeout: 123 });
  context.timers.values().next().value();
  context.queued.shift()();
  assert.deepEqual(errors, [2]);
});

test('valid real bridge coordinates stay intact and do not fabricate altitude', () => {
  const script = stringExpression('LocationFix', 'MOCK_SCRIPT');
  const context = locationContext('12.34,56.78,45'), geolocation = context.navigator.geolocation;
  const results = [];
  run(script, {}, context);
  geolocation.getCurrentPosition(value => results.push(value));
  assert.equal(results.length, 1);
  assert.equal(results[0].coords.latitude, 12.34);
  assert.equal(results[0].coords.longitude, 56.78);
  assert.equal(results[0].coords.accuracy, 45);
  assert.equal(results[0].coords.altitude, null);
});

test('location bridge is not installed in an iframe or by a legacy synchronous interface', () => {
  const script = stringExpression('LocationFix', 'MOCK_SCRIPT');
  const child = locationContext('12.34,56.78,45'); child.window.top = {};
  run(script, {}, child);
  assert.equal(child.navigator.geolocation.getCurrentPosition, undefined);
  const legacy = locationContext('12.34,56.78,45'); legacy.window.DengTaLocation = { getLocation() { assert.fail('legacy frame bridge must not be read'); } };
  run(script, {}, legacy);
  assert.equal(legacy.navigator.geolocation.getCurrentPosition, undefined);
  assert.doesNotMatch(source('LocationFix'), /addJavascriptInterface|@JavascriptInterface/);
  for (const name of ['OrderWebActivity', 'PersistentBrowserActivity']) assert.doesNotMatch(source(name), /callback\.invoke\(origin, true/);
});

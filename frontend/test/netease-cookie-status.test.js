import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  COOKIE_INVALID_CODE,
  isNeteaseCookieInvalid,
  neteaseCookieStatus,
} from "../src/netease-cookie-status.js";

test("cookie 失效的判定只看 code，不看文案", () => {
  assert.equal(COOKIE_INVALID_CODE, "netease_cookie_invalid");
  assert.equal(isNeteaseCookieInvalid({ code: "netease_cookie_invalid" }), true);
  assert.equal(isNeteaseCookieInvalid("netease_cookie_invalid"), true, "错误码直接以字符串传来时同样成立");
  assert.equal(isNeteaseCookieInvalid({ code: "network_error" }), false);
  assert.equal(isNeteaseCookieInvalid(null), false);
  assert.equal(isNeteaseCookieInvalid(undefined), false);
});

test("四种状态各自的文案", () => {
  const checking = neteaseCookieStatus({ checking: true });
  assert.equal(checking.state, "checking");
  assert.match(checking.title, /正在检查/);
  assert.deepEqual(checking.actions, []);

  const connected = neteaseCookieStatus({ connected: true, account_name: "云村村民178" });
  assert.equal(connected.state, "connected");
  assert.equal(connected.title, "已连接：云村村民178");
  assert.deepEqual(connected.actions, ["disconnect"]);

  const expired = neteaseCookieStatus({ connected: false, expired: true });
  assert.equal(expired.state, "expired");
  assert.match(expired.title, /登录已失效/);
  assert.match(expired.detail, /重新/);
  assert.deepEqual(expired.actions, ["login", "desktopLogin"], "失效时必须给出重新登录入口");

  const disconnected = neteaseCookieStatus({ connected: false });
  assert.equal(disconnected.state, "disconnected");
  assert.match(disconnected.title, /内置浏览器登录/);
});

test("connected 优先级高于 expired，避免残留标记挡住真实连接", () => {
  const both = neteaseCookieStatus({ connected: true, expired: true, account_name: "小明" });
  assert.equal(both.state, "connected");
});

test("音乐页真的接入了这两个函数", async () => {
  const source = readFileSync(new URL("../src/TogetherMusic.jsx", import.meta.url), "utf8");
  assert.match(source, /isNeteaseCookieInvalid\(caught\)/, "读歌单失败时要判定 cookie 是否失效");
  assert.match(source, /setCookieStatus\(\{ checking: false, connected: false, account_name: "", expired: true \}\)/, "失效时要把状态翻成已失效");
  assert.match(source, /neteaseCookieStatus\(cookieStatus\)\.title/, "标题由状态函数生成");
  assert.match(source, /neteaseCookieStatus\(cookieStatus\)\.detail/, "说明由状态函数生成");
});

console.log("NetEase cookie status: invalid detection, four states, and music page wiring passed");

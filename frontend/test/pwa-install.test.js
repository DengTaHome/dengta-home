import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPwaInstallController } from "../src/pwa-install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function createWindow({ standalone = false } = {}) {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    matchMedia(query) {
      return { matches: query === "(display-mode: standalone)" && standalone };
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
}

{
  const windowLike = createWindow();
  const controller = createPwaInstallController({
    windowLike,
    navigatorLike: {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    },
  });

  assert.match(controller.guidance(), /Safari/);
  assert.match(controller.guidance(), /分享/);
  assert.match(controller.guidance(), /添加到主屏幕/);
  assert.match(controller.guidance(), /从新图标打开并登录/);
}

{
  const windowLike = createWindow();
  const controller = createPwaInstallController({
    windowLike,
    navigatorLike: {
      userAgent:
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/132 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    },
  });
  let prevented = false;
  let promptCalls = 0;
  controller.start();
  windowLike.dispatch("beforeinstallprompt", {
    preventDefault() {
      prevented = true;
    },
    async prompt() {
      promptCalls += 1;
    },
    userChoice: Promise.resolve({ outcome: "accepted" }),
  });

  assert.equal(prevented, true);
  assert.equal(controller.canPrompt(), true);
  const result = await controller.install();
  assert.equal(promptCalls, 1);
  assert.equal(result.outcome, "accepted");
  assert.equal(controller.canPrompt(), false);
}

{
  const controller = createPwaInstallController({
    windowLike: createWindow({ standalone: true }),
    navigatorLike: { userAgent: "", standalone: true },
  });
  assert.equal(controller.isInstalled(), true);
  assert.match(controller.guidance(), /已经安装/);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "public", "manifest.webmanifest"), "utf8"),
);
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const authGate = fs.readFileSync(path.join(root, "src", "AuthGate.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const vercel = JSON.parse(
  fs.readFileSync(path.join(root, "vercel.json"), "utf8"),
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

assert.equal(manifest.id, "/");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.ok(
  manifest.icons.some(
    (icon) => icon.sizes === "512x512" && /maskable/.test(icon.purpose),
  ),
);
assert.match(indexHtml, /rel="apple-touch-icon"/);
assert.match(indexHtml, /apple-mobile-web-app-capable/);
assert.match(main, /pwaInstallController\.start\(\)/);
assert.match(authGate, /<WebInstallButton/);
assert.match(app, /<WebInstallButton/);
assert.doesNotMatch(app, /beforeinstallprompt/);
assert.doesNotMatch(app, /installPrompt/);
assert.equal(vercel.buildCommand, "npm run build:web");
assert.match(packageJson.scripts["build:web"], /verify:public-auth-build/);

console.log("Public mobile PWA install flow tests passed");

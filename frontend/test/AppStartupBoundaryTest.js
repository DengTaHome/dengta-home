import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

function textContent(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textContent).join("");
}

class AppStartupBoundaryTest {
  static async verifiesVisibleLoadingAndRecoveryStates() {
  const storage = new Map();
  let reloadCount = 0;
  let preloadErrorListener;
  const originalSessionStorage = globalThis.sessionStorage;
  const originalLocation = globalThis.location;
  const originalAddEventListener = globalThis.addEventListener;
  const originalConsoleError = console.error;

  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.location = { reload: () => reloadCount += 1 };
  globalThis.addEventListener = (type, listener) => {
    if (type === "vite:preloadError") preloadErrorListener = listener;
  };

  const vite = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const {
      AppFailureScreen,
      AppLoadingScreen,
      AppStartupBoundary,
    } = await vite.ssrLoadModule("/src/AppStartupBoundary.jsx");
    const {
      clearLocalUiPreferences,
      installChunkRecovery,
      markAppLoaded,
      startupDiagnosticCode,
    } =
      await vite.ssrLoadModule("/src/app-startup-recovery.js");

    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AppLoadingScreen));
    });
    assert.equal(renderer.root.findByType("main").props["aria-busy"], "true");
    assert.match(textContent(renderer.toJSON()), /正在点亮你的家/);
    assert.match(textContent(renderer.toJSON()), /载入聊天、记忆与伴侣空间/);
    await act(async () => renderer.unmount());

    let signOutCount = 0;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AppFailureScreen, {
        diagnosticCode: "DT-START-PM-01",
        accountScope: "account-1",
        sessionManager: { signOut: async () => { signOutCount += 1; } },
      }));
    });
    const failurePage = renderer.root.findByType("main");
    assert.equal(failurePage.props.role, "alert");
    assert.match(textContent(renderer.toJSON()), /账号和聊天数据不会因此丢失/);
    assert.match(textContent(renderer.toJSON()), /DT-START-PM-01/);
    assert.equal(renderer.root.findAllByType("button").length, 3);
    await act(async () => renderer.root.findAllByType("button")[2].props.onClick());
    assert.equal(signOutCount, 1);
    reloadCount = 0;
    storage.set("dengta:app-chunk-recovery", "attempted");
    await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
    assert.equal(storage.has("dengta:app-chunk-recovery"), false);
    assert.equal(reloadCount, 1);
    await act(async () => renderer.unmount());

    const boundary = new AppStartupBoundary({ children: "application-ready" });
    assert.equal(boundary.render(), "application-ready");
    boundary.state = AppStartupBoundary.getDerivedStateFromError();
    assert.equal(boundary.render().type, AppFailureScreen);
    let loggedFailure;
    console.error = (message, detail) => {
      loggedFailure = { message, detail };
    };
    boundary.componentDidCatch({ name: "ChunkLoadError" });
    assert.equal(loggedFailure.message, "DengTa 应用界面载入失败");
    assert.deepEqual(JSON.parse(loggedFailure.detail), {
      name: "ChunkLoadError",
      diagnosticCode: "DT-START-CH-01",
      message: "",
    });

    assert.equal(
      startupDiagnosticCode(new TypeError("Cannot read properties of null (reading 'catalog')")),
      "DT-START-PM-01",
    );
    const uiStorage = new Map([
      ["dengta.ui-theme.v2", "theme"],
      ["dengta.ui-theme.v2:account-1", "scoped-theme"],
      ["dengta_home_auth_v1", "must-stay-private"],
    ]);
    clearLocalUiPreferences("account-1", {
      removeItem: (key) => uiStorage.delete(key),
    });
    assert.equal(uiStorage.has("dengta.ui-theme.v2"), false);
    assert.equal(uiStorage.has("dengta.ui-theme.v2:account-1"), false);
    assert.equal(uiStorage.get("dengta_home_auth_v1"), "must-stay-private");

    installChunkRecovery();
    assert.equal(typeof preloadErrorListener, "function");
    let preventDefaultCount = 0;
    const preloadError = { preventDefault: () => preventDefaultCount += 1 };
    preloadErrorListener(preloadError);
    assert.equal(storage.get("dengta:app-chunk-recovery"), "attempted");
    assert.equal(reloadCount, 2, "the first stale chunk failure must reload the app");
    preloadErrorListener(preloadError);
    assert.equal(reloadCount, 2, "a persistent chunk failure must not create a reload loop");
    assert.equal(preventDefaultCount, 2);

    markAppLoaded();
    assert.equal(storage.has("dengta:app-chunk-recovery"), false);
    preloadErrorListener(preloadError);
    assert.equal(reloadCount, 3, "a later independent chunk failure may recover again");
  } finally {
    console.error = originalConsoleError;
    await vite.close();
    globalThis.sessionStorage = originalSessionStorage;
    globalThis.location = originalLocation;
    globalThis.addEventListener = originalAddEventListener;
  }
  }
}

test("AppStartupBoundaryTest exposes visible loading and recovery states", () =>
  AppStartupBoundaryTest.verifiesVisibleLoadingAndRecoveryStates());

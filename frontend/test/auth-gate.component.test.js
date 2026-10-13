import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

function createSessionManager({
  signIn = async () => {
    throw new Error("not used");
  },
  signUp = async () => {
    throw new Error("not used");
  },
  verifyRegistrationLink = async () => { throw new Error("not used"); },
  resendVerification = async () => {
    throw new Error("not used");
  },
  requestPasswordReset = async () => {
    throw new Error("not used");
  },
}) {
  let snapshot = {
    status: "anonymous",
    session: null,
    user: null,
    companionId: null,
    error: null,
  };
  const listeners = new Set();

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener({ ...snapshot }));
  }

  return {
    getSnapshot: () => ({ ...snapshot }),
    isConfigured: () => true,
    initialize: async () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRequestContext: async () => ({}),
    signUp: (payload) => signUp({ payload, publish }),
    signIn: (payload) => signIn({ payload, publish }),
    resendVerification: (payload) =>
      resendVerification({ payload, publish }),
    verifyRegistrationLink,
    requestPasswordReset: (payload) =>
      requestPasswordReset({ payload, publish }),
  };
}

function textContent(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textContent).join("");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderGate(AuthGate, sessionManager) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        AuthGate,
        { sessionManager },
        React.createElement("div", null, "authenticated"),
      ),
    );
  });
  return renderer;
}

const vite = await createServer({
  root: projectRoot,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { AuthScreen, default: AuthGate } =
    await vite.ssrLoadModule("/src/AuthGate.jsx");

  {
    let verifiedLink;
    const manager = createSessionManager({
      async verifyRegistrationLink(link) { verifiedLink = link; throw new Error("虚构链接已失效"); },
    });
    const renderer = await renderGate(AuthGate, manager);
    await act(async () => renderer.root.find(node => node.type === "input" && node.props.type === "email").props.onChange({ target: { value: "retry@example.test" } }));
    await act(async () => renderer.root.find(node => node.type === "button" && textContent(node).includes("验证链接失效")).props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => true }) } } }));
    const input = renderer.root.find(node => node.type === "input" && node.props.placeholder === "粘贴邮件中确认按钮的原始链接");
    assert.equal(input.props.type, "password");
    await act(async () => input.props.onChange({ target: { value: "fictional-link" } }));
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    assert.equal(verifiedLink, "fictional-link");
    assert.equal(renderer.root.findByType("input").props.value, "");
    assert.match(textContent(renderer.toJSON()), /虚构链接已失效/);
    await act(async () => renderer.unmount());
  }

  {
    let resendPayload;
    const manager = createSessionManager({
      async resendVerification({ payload }) { resendPayload = payload; },
    });
    const renderer = await renderGate(AuthGate, manager);
    const emailInput = renderer.root.find(node => node.type === "input" && node.props.type === "email");
    await act(async () => emailInput.props.onChange({ target: { value: "retry@example.test" } }));
    const retry = renderer.root.find(node => node.type === "button" && textContent(node).includes("验证链接失效"));
    await act(async () => retry.props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => false }) } } }));
    assert.equal(renderer.root.findAll(node => node.props.className === "auth-verification").length, 0);
    await act(async () => retry.props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => true }) } } }));
    assert.match(textContent(renderer.toJSON()), /retry@example.test/);
    assert.equal(resendPayload, undefined, "opening retry does not send an email");
    await act(async () => renderer.root.find(node => node.type === "button" && textContent(node) === "重新发送验证邮件").props.onClick());
    assert.equal(resendPayload.email, "retry@example.test");
    assert.equal(resendPayload.emailRedirectTo, "https://www.dengtahome.com/");
    await act(async () => renderer.unmount());
  }

  {
    const signUpResponse = deferred();
    let signUpPayload;
    let resendPayload;
    const manager = createSessionManager({
      async signUp({ payload, publish }) {
        signUpPayload = payload;
        publish({ status: "authenticating", error: null });
        await signUpResponse.promise;
        publish({ status: "anonymous", error: null });
        return { emailVerificationRequired: true };
      },
      async resendVerification({ payload }) {
        resendPayload = payload;
      },
    });
    const renderer = await renderGate(AuthGate, manager);

    const tabs = renderer.root.findAll(
      (node) => node.type === "button" && node.props.role === "tab",
    );
    assert.equal(tabs.length, 2);
    await act(async () => tabs[1].props.onClick());

    const inputs = renderer.root.findAll((node) => node.type === "input");
    const nameInput = inputs.find((node) => node.props.type === "text");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInput = inputs.find((node) => node.props.type === "password");
    await act(async () => {
      nameInput.props.onChange({ target: { value: "桃桃" } });
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInput.props.onChange({ target: { value: "example-password" } });
    });

    const form = renderer.root.findByType("form");
    let submitPromise;
    await act(async () => {
      submitPromise = form.props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
    });

    const pendingInputs = renderer.root.findAll(
      (node) => node.type === "input",
    );
    assert.equal(
      pendingInputs.find((node) => node.props.type === "email")?.props.value,
      "taotao@example.test",
      "registration fields must survive the intermediate authenticating state",
    );

    signUpResponse.resolve();
    await act(async () => {
      await submitPromise;
    });

    const verificationPanels = renderer.root.findAll(
      (node) => node.props.className === "auth-verification",
    );
    assert.equal(
      verificationPanels.length,
      1,
      "registration must remain on the verification result when auth status changes",
    );
    assert.match(textContent(renderer.toJSON()), /taotao@example\.test/);
    assert.equal(
      signUpPayload.emailRedirectTo,
      "https://www.dengtahome.com/",
      "signup must pass the resolved public callback",
    );

    const resendButton = renderer.root.find(
      (node) =>
        node.type === "button" &&
        textContent(node) === "重新发送验证邮件",
    );
    await act(async () => resendButton.props.onClick());
    assert.equal(
      resendPayload.emailRedirectTo,
      "https://www.dengtahome.com/",
      "verification resend must use the same resolved callback",
    );
    await act(async () => renderer.unmount());
  }

  {
    let resetPayload;
    const manager = createSessionManager({
      async requestPasswordReset({ payload }) {
        resetPayload = payload;
      },
    });
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(AuthScreen, {
          sessionManager: manager,
          initialMode: "forgot",
        }),
      );
    });
    const emailInput = renderer.root.find(
      (node) => node.type === "input" && node.props.type === "email",
    );
    await act(async () => {
      emailInput.props.onChange({ target: { value: "reset@example.test" } });
    });
    await act(async () => {
      await renderer.root
        .findByType("form")
        .props.onSubmit({ preventDefault() {} });
    });
    assert.equal(
      resetPayload.redirectTo,
      "https://www.dengtahome.com/",
      "password reset must use the resolved callback",
    );
    await act(async () => renderer.unmount());
  }

  {
    const expectedError = "测试登录失败，请重新检查邮箱或密码。";
    const manager = createSessionManager({
      async signUp() {
        throw new Error("not used");
      },
      async signIn({ publish }) {
        publish({ status: "authenticating", error: null });
        await Promise.resolve();
        const error = new Error(expectedError);
        publish({ status: "anonymous", error });
        throw error;
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const inputs = renderer.root.findAll((node) => node.type === "input");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInput = inputs.find((node) => node.props.type === "password");
    await act(async () => {
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInput.props.onChange({ target: { value: "wrong-password" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    assert.match(
      textContent(renderer.toJSON()),
      new RegExp(expectedError),
      "a failed sign-in must keep a visible error instead of silently clearing the form",
    );
    await act(async () => renderer.unmount());
  }
} finally {
  await vite.close();
}

console.log("AuthGate component state regression tests passed");

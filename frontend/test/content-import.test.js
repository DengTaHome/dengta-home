import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const appSource = fs.readFileSync(path.join(projectRoot, "src", "App.jsx"), "utf8");
const componentSource = fs.readFileSync(path.join(projectRoot, "src", "ContentImport.jsx"), "utf8");
const cssSource = fs.readFileSync(path.join(projectRoot, "src", "index.css"), "utf8");

function textContent(node) {
  if (typeof node === "string") return node;
  return (node?.children || []).map(textContent).join("");
}

function buttonByText(renderer, text) {
  return renderer.root.find((node) => node.type === "button" && textContent(node) === text);
}

test("settings has a lazy, standalone data import entry and responsive glass styling", () => {
  assert.match(appSource, /lazy\(\(\) => import\("\.\/ContentImport"\)\)/);
  assert.match(appSource, /id: "data-import"[\s\S]{0,100}label: "数据导入"[\s\S]{0,100}description: "世界书与聊天记录"/);
  const componentIndex = appSource.indexOf('<ContentImport key=');
  const formIndex = appSource.indexOf('<form className="settings-form"', componentIndex);
  assert.ok(componentIndex > 0 && formIndex > componentIndex, "ContentImport must render independently before the main settings form");
  assert.match(appSource.slice(componentIndex, formIndex), /settingsCategory !== "data-import"/);
  assert.match(cssSource, /\.content-import-hero[\s\S]{0,500}backdrop-filter: blur/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.content-import-grid/);
  assert.match(componentSource, /aria-label="选择导入文件"/);
  assert.match(componentSource, /memory[\s\S]*style[\s\S]*world_book[\s\S]*calendar/);
});

test("preview defaults to pending, requires item decisions, commits edits, and dispatches refresh", async () => {
  const previewContent = "成人内容应完整保留：亲密关系与欲望描写";
  const calls = [];
  const api = {
    async apiRequest(path, options) {
      calls.push({ path, options });
      if (path === "/api/v2/imports/") return { imports: [] };
      if (path === "/api/v2/imports/preview") return { ok: true, result: {
        import: { id: "preview-1" },
        count: 2,
        digest: "从旧故事中找到两段候选",
        warnings: ["请核对人物称谓"],
        candidates: [
          { id: "a", candidate_type: "memory", source_label: "聊天第 8 轮", title: "旧称呼", content: previewContent, target: "memories" },
          { id: "b", candidate_type: "world_book", source_label: "Lorebook", title: "海边城市", content: "夜晚会亮起蓝灯", target: "world_book_entries" },
        ],
      } };
      if (path.endsWith("/commit")) return { ok: true, result: { import: { id: "preview-1", status: "committed" }, accepted_count: 1, rejected_count: 1 } };
      throw new Error(`unexpected ${path}`);
    },
  };
  const dispatched = [];
  const previousWindow = globalThis.window;
  const PreviousCustomEvent = globalThis.CustomEvent;
  globalThis.window = { dispatchEvent: (event) => dispatched.push(event) };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
  const vite = await createServer({ root: projectRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });

  try {
    const { default: ContentImport } = await vite.ssrLoadModule("/src/ContentImport.jsx");
    let renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ContentImport, { api })); });
    const inputMode = renderer.root.find((node) => node.type === "select" && node.props["aria-label"] === "输入方式");
    await act(async () => inputMode.props.onChange({ target: { value: "paste" } }));
    const paste = renderer.root.find((node) => node.type === "textarea" && node.props["aria-label"] === "粘贴导入内容");
    await act(async () => paste.props.onChange({ target: { value: previewContent } }));
    await act(async () => buttonByText(renderer, "生成导入预览").props.onClick());

    assert.match(textContent(renderer.toJSON()), /从旧故事中找到两段候选/);
    assert.match(textContent(renderer.toJSON()), /请核对人物称谓/);
    assert.equal(buttonByText(renderer, "请先逐项决定").props.disabled, true);
    const contentEditor = renderer.root.findAll((node) => node.type === "textarea").find((node) => /的内容$/.test(node.props["aria-label"] || ""));
    assert.equal(contentEditor.props.value, previewContent, "adult content must not be filtered in the frontend");
    await act(async () => contentEditor.props.onChange({ target: { value: `${previewContent}\n补充原文` } }));
    const decisionGroups = renderer.root.findAll((node) => node.props.role === "group");
    await act(async () => decisionGroups[0].findAllByType("button")[0].props.onClick());
    await act(async () => decisionGroups[1].findAllByType("button")[1].props.onClick());
    assert.equal(buttonByText(renderer, "确认并提交").props.disabled, false);
    await act(async () => buttonByText(renderer, "确认并提交").props.onClick());

    const commitCall = calls.find((call) => call.path.endsWith("/commit"));
    const payload = JSON.parse(commitCall.options.body);
    assert.deepEqual(payload.decisions.map((item) => item.decision), ["accepted", "rejected"]);
    assert.deepEqual(payload.decisions.map((item) => item.candidate_id), ["a", "b"]);
    assert.equal(payload.decisions[0].content, `${previewContent}\n补充原文`);
    assert.equal(dispatched[0].type, "dengta:memories-imported");
    assert.match(textContent(renderer.toJSON()), /导入完成/);
    await act(async () => renderer.unmount());
  } finally {
    await vite.close();
    globalThis.window = previousWindow;
    globalThis.CustomEvent = PreviousCustomEvent;
  }
});

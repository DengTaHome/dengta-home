import assert from "node:assert/strict";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let view;
try {
  const { default: Feedback } = await server.ssrLoadModule("/src/FunLabsFeedback.jsx");
  let retries = 0;
  const props = { title: "照片", hasSavedData: true, onRetry: () => { retries++; } };
  await act(async () => { view = TestRenderer.create(React.createElement(Feedback, { ...props, section: { status: "busy" } })); });
  assert.match(JSON.stringify(view.toJSON()), /正在更新照片/); assert.equal(view.root.findAllByType("button").length, 0);
  await act(async () => { view.update(React.createElement(Feedback, { ...props, section: { status: "error", diagnostic: { error_code: "daily_shots_read_failed", upstream_status: 503, error_source: "dengta" } } })); });
  assert.match(JSON.stringify(view.toJSON()), /保留上次加载成功的记录/);
  const retry = view.root.findByProps({ "aria-label": "重试照片" }); await act(async () => retry.props.onClick()); assert.equal(retries, 1);
  const log = view.root.findByProps({ "aria-expanded": false }); await act(async () => log.props.onClick());
  assert.match(JSON.stringify(view.toJSON()), /daily_shots_read_failed/); assert.match(JSON.stringify(view.toJSON()), /无需重新上传照片/);
  await act(async () => { view.update(React.createElement(Feedback, { ...props, section: { status: "error", diagnostic: { error_code: "daily_shots_auth_required", http_status: 401 } } })); });
  assert.match(JSON.stringify(view.toJSON()), /请检查登录状态与当前伴侣/);
  await act(async () => { view.update(React.createElement(Feedback, { ...props, section: { status: "success" } })); });
  assert.equal(view.toJSON(), null);
} finally {
  if (view) await act(async () => view.unmount()); await server.close(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
console.log("Fun labs feedback rendering, independent retry and diagnostic fallback passed");

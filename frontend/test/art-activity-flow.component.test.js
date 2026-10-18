import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { backendTestRoot } from "./helpers/backend-test-root.js";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { after, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { buildCompanionActivityRequest } from "../src/companion-activities.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const backendRequire = createRequire(new URL("../../backend/package.json", import.meta.url));
const { COMPANION_ACTIVITY_TOOL, createCompanionActivities } = backendRequire("./services/companion-activities.js");
const { publicMessage } = backendRequire("./services/chat-attachments.js");
const requests = [];
globalThis.__artActivityFixture = async (path, options = {}) => {
  requests.push({ path, method: options.method || "GET" });
  if (path.endsWith("/status")) return { settings: { generation_mode: "confirm" }, provider: { configured: false } };
  if (path.endsWith("/artworks")) return { artworks: [] };
  throw new Error("Unexpected fixture request");
};
const vite = await createServer({ root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, envDir: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "art-activity-no-network", enforce: "pre", load(id) {
  if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return "export const apiRequest=globalThis.__artActivityFixture; export const apiFetch=()=>{throw Error('Unexpected media fetch')};";
  if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession={getSnapshot:()=>({user:{id:'fictional-account'},activeCompanionId:'fictional-companion'})};";
} }] });
after(async () => { await vite.close(); delete globalThis.__artActivityFixture; });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");

test("real chat tool dispatcher returns an art card that opens the independent studio without generating", async () => {
  const server = readFileSync(new URL("../../backend/server.js", import.meta.url), "utf8");
  const start = server.indexOf("function createChatToolExecutor("), end = server.indexOf("function previousReplySuggestionsFromMessages", start);
  assert.ok(start >= 0 && end > start);
  assert.ok(COMPANION_ACTIVITY_TOOL.input_schema.properties.activity.enum.includes("art"));
  assert.equal((server.match(/^\s+COMPANION_ACTIVITY_TOOL,/gm) || []).length, 2, "both provider paths use the imported schema");
  const context = { createCompanionActivities, COMPANION_ACTIVITY_TOOL, supabase: {},
    createCompanionStickerSelector: () => ({}), createCompanionStickerTool: () => ({}),
    createReplySuggestionSelector: () => ({}), sanitizeCompanionStatusSnapshot: value => value,
    bilibiliQrLogin: { recommendations() { throw new Error("Unexpected external call"); } },
  };
  runInNewContext(server.slice(start, end), context);
  const runtime = context.createChatToolExecutor("fictional-conversation", {}, "fictional-request", null, {}, "", [], { userId: "fictional-account", companionId: "fictional-companion" });
  const result = await runtime.executeTool({ name: "open_companion_activity", arguments: JSON.stringify({ activity: "art", query: "想看看你的涂鸦" }) });
  assert.equal(result.ok, true); assert.equal(result.action.kind, "art");
  const message = publicMessage({ id: "fictional-message", role: "assistant", content: "虚构聊天回复", tool_calls: { activity_actions: runtime.getActivityActions() } });
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const handlerStart = app.indexOf("  function openCompanionActivity(action) {"), handlerEnd = app.indexOf("\n  function renderDlnaCastPlayer", handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  let view = "chat";
  const onOpen = new Function("buildCompanionActivityRequest", "accountStorageScope", "companionScope", "changeView", `${app.slice(handlerStart, handlerEnd)};return openCompanionActivity;`)(buildCompanionActivityRequest, "fictional-account", "fictional-companion", next => { view = next; });
  const { default: Cards } = await vite.ssrLoadModule("/src/CompanionActivityCards.jsx");
  await vite.ssrLoadModule("/src/CompanionCreativeStudio.jsx");
  const { default: Studio } = await vite.ssrLoadModule("/src/CompanionArtStudio.jsx");
  let card, studio;
  try {
    await act(async () => { card = TestRenderer.create(React.createElement(Cards, { actions: message.tool_calls.activity_actions, onOpen })); });
    const button = card.root.findByType("button"); assert.equal(text(button), "打开涂鸦画室");
    await act(async () => { button.props.onClick(); }); assert.equal(view, "art");
    await act(async () => { studio = TestRenderer.create(React.createElement(Studio, { aiName: "虚构伙伴", scopeKey: "fictional-account-companion" })); });
    assert.match(text(studio.toJSON()), /想一张涂鸦/);
    assert.deepEqual(requests.map(row => row.method), ["GET", "GET"]);
    assert.ok(requests.every(row => row.path === "/api/v2/creative/status" || row.path === "/api/v2/creative/artworks"));
  } finally { if (card) await act(async () => card.unmount()); if (studio) await act(async () => studio.unmount()); }
});

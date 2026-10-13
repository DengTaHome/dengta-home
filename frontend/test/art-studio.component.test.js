import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer } from "vite";
import { filterFeatures } from "../src/feature-navigation.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requests = [];
globalThis.__artStudioRequest = async (url, options = {}) => {
  requests.push({ url, method: options.method || "GET" });
  if (url.includes("companion-profile")) throw new Error("Fictional profile unavailable");
  if (url.endsWith("/status")) return { settings: { generation_mode: "autonomous" }, provider: { configured: true, enabled: true, auth_configured: true } };
  if (url.endsWith("/artworks")) return { artworks: [] };
  throw new Error("Unexpected request");
};
const vite = await createServer({ configFile: false, envFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true }, plugins: [{ name: "art-studio-fictional-api", enforce: "pre", load(id) {
  if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return "export const apiRequest=globalThis.__artStudioRequest; export const API_BASE_URL=''; export const apiFetch=()=>{throw Error('Unexpected media fetch')};";
  if (id.replaceAll("\\", "/").endsWith("/src/auth-session.js")) return "export const authSession={getSnapshot:()=>({user:{id:'fictional-account'},activeCompanionId:'fictional-companion'})};";
} }] });
after(async () => { await vite.close(); delete globalThis.__artStudioRequest; });
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
test("actual navigation includes a searchable independent drawing entry", () => {
  const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("const navItems = ["), end = source.indexOf("\n];", start) + 3;
  const items = new Function(`${source.slice(start, end)};return navItems;`)();
  assert.equal(filterFeatures(items, "涂鸦")[0]?.id, "art");
  assert.equal(filterFeatures(items, "自主")[0]?.id, "art");
});
test("a profile read failure cannot hide drawing library; opening it performs no image generation or permission write", async () => {
  const { default: Profile } = await vite.ssrLoadModule("/src/CompanionProfile.jsx");
  await vite.ssrLoadModule("/src/CompanionCreativeStudio.jsx");
  const { default: Studio } = await vite.ssrLoadModule("/src/CompanionArtStudio.jsx");
  let profile, studio, opened = 0;
  try {
    await act(async () => { profile = TestRenderer.create(React.createElement(Profile, { aiName: "虚构伙伴" })); });
    assert.match(text(profile.toJSON()), /Fictional profile unavailable/);
    await act(async () => { studio = TestRenderer.create(React.createElement(Studio, { aiName: "虚构伙伴", scopeKey: "fictional-account-companion", onOpenImageProviderSettings: () => opened++ })); });
    const copy = text(studio.toJSON());
    assert.match(copy, /涂鸦画室/); assert.match(copy, /想一张涂鸦/); assert.match(copy, /自主创作/);
    const setup = studio.root.findAllByType("button").find(node => text(node) === "自主涂鸦与图片接口设置");
    await act(async () => setup.props.onClick()); assert.equal(opened, 1);
    assert.equal(requests.filter(row => row.url.includes("/creative/")).length, 2);
    assert.ok(requests.every(row => row.method === "GET"));
  } finally { if (profile) await act(async () => profile.unmount()); if (studio) await act(async () => studio.unmount()); }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, afterEach, test } from "node:test";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { createServer, transformWithOxc } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function extract(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Extract actual App source: ${startMarker}`);
  return appSource.slice(start, end);
}
const stateSource = extract("  const funScope = JSON.stringify(", "\n  const [coWatchDanmaku,");
const refreshSource = extract("  const refreshFunLabs = useCallback(", "\n  async function addCustomAchievement()");
const submitSource = extract("  async function addCustomAchievement()", "\n  async function unlockCustomAchievement(");
const formStart = appSource.indexOf('<div className="fun-achievement-form">');
const formEnd = appSource.indexOf("</div>", formStart);
assert.ok(formStart >= 0 && formEnd > formStart, "Extract the actual custom achievement form JSX");
const formSource = appSource.slice(formStart, formEnd + "</div>".length);

const fixture = {
  calls: [], stateWrites: 0, throwRefresh: false, readFailure: null, holdReads: false, readRows: null,
  request(path, options = {}) {
    const call = { path, options, ...deferred() };
    this.calls.push(call);
    if (options.method !== "POST") {
      if (this.readFailure) call.reject(this.readFailure);
      else if (!this.holdReads) call.resolve({ achievements: this.readRows || [{ code: "custom:fixture", title: "Fixture achievement", unlocked: false }] });
    }
    return call.promise;
  },
};
globalThis.__customAchievementFixture = fixture;

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), appType: "custom", logLevel: "silent",
  server: { middlewareMode: true },
  plugins: [{
    name: "actual-custom-achievement-form",
    resolveId(id) { if (id === "virtual:custom-achievement") return "\0virtual:custom-achievement.jsx"; },
    async load(id) {
      if (id.replaceAll("\\", "/").endsWith("/src/api.js")) return "export const fetchErrorLogById=()=>{throw new Error('Unexpected diagnostic request');};";
      if (id !== "\0virtual:custom-achievement.jsx") return;
      const code = `
        import {useState as realUseState,useRef,useEffect,useMemo,useCallback} from "react";
        import {emptyFunLabsState,refreshFunLabsSections as realRefreshFunLabsSections} from "/src/fun-labs-refresh.js";
        import {freshAchievements} from "/src/achievement-guide.js";
        import {validateAchievementReceipt,achievementFailure,withAchievementDeadline} from "/src/achievement-action.js";
        import {recordOperationFailure} from "/src/operation-diagnostics.js";
        import FunLabsFeedback from "/src/FunLabsFeedback.jsx";
        const fixture=globalThis.__customAchievementFixture;
        function useState(initial) {
          const [value,setValue]=realUseState(initial);
          return [value,next=>{fixture.stateWrites++;setValue(next);}];
        }
        const apiRequest=(...args)=>fixture.request(...args);
        const refreshFunLabsSections=options=>fixture.throwRefresh
          ? Promise.reject(new Error("FICTIONAL_UNEXPECTED_REFRESH_EXCEPTION"))
          : realRefreshFunLabsSections(options);
        export default function CustomAchievementHarness({accountStorageScope,companionScope}) {
          const componentMountedRef=useRef(true);
          useEffect(()=>{componentMountedRef.current=true;return()=>{componentMountedRef.current=false;};},[]);
          const [notice,setNotice]=useState("");
          const unlockedCodesRef=useRef(null);
          const [,setAchievementPopup]=useState(null);
          const privateMediaScope=JSON.stringify([accountStorageScope,companionScope]);
          const getMomentsRequestScope=()=>({current:()=>componentMountedRef.current,options:{}});
          ${stateSource}
          ${refreshSource}
          ${submitSource}
          return <section>
            ${formSource}
            <p className="submit-notice" role="status">{notice}</p>
            <FunLabsFeedback section={funLabsState.sections.achievements} title="成就"
              onRetry={()=>void refreshFunLabs(["achievements"])} />
          </section>;
        }
      `;
      return (await transformWithOxc(code, "custom-achievement.jsx", { lang: "jsx", jsx: { runtime: "automatic" } })).code;
    },
  }],
});
const { default: Harness } = await vite.ssrLoadModule("virtual:custom-achievement");
let tree;
const labels = { title: "成就名称", emoji: "成就图标", description: "完成条件" };
const originalDraft = { title: "  Fixture title  ", emoji: " 🎯 ", description: "  Fixture condition\r\n第二行  " };
const field = key => tree.root.findByProps({ "aria-label": labels[key] });
const draft = () => Object.fromEntries(Object.keys(labels).map(key => [key, field(key).props.value]));
const submitButton = () => tree.root.findByProps({ "aria-label": "添加自定义成就" });
const reviewButton = () => tree.root.findAllByType("button").find(node => node.children.join("").includes("读取当前成就列表"));
const resumeButton = () => tree.root.findAllByType("button").find(node => node.children.join("").includes("我已核对列表，恢复添加"));
const posts = () => fixture.calls.filter(call => call.options.method === "POST");
const reads = () => fixture.calls.filter(call => call.options.method !== "POST");
const snapshot = () => JSON.stringify(tree.toJSON());

async function mount(scope = "fictional-account-a") {
  await act(async () => { tree = TestRenderer.create(React.createElement(Harness, {
    key: scope, accountStorageScope: scope, companionScope: "fictional-companion",
  })); });
}
async function fill(values = originalDraft) {
  await act(async () => Object.entries(values).forEach(([key, value]) => field(key).props.onChange({ target: { value } })));
}
async function submit() { await act(async () => submitButton().props.onClick()); }
function creationReceipt(index = 0, overrides = {}) {
  const submitted = JSON.parse(posts()[index].options.body);
  return { achievement: { id: "custom-fixture-id", code: "custom:fixture", title: submitted.title.replace(/\s+/g, " "),
    description: submitted.description.replace(/\s+/g, " "), emoji: submitted.emoji || "🏆", ...overrides } };
}
async function resolvePost(index = 0, overrides = {}) {
  await act(async () => posts()[index].resolve(creationReceipt(index, overrides)));
}

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  fixture.calls.length = 0; fixture.stateWrites = 0; fixture.throwRefresh = false; fixture.readFailure = null; fixture.holdReads = false; fixture.readRows = null;
});
after(async () => { await vite.close(); delete globalThis.__customAchievementFixture; });

test("same-tick clicks dispatch one POST, expose busy state and clear the unchanged submitted draft", async () => {
  await mount(); await fill();
  await act(async () => { const click = submitButton().props.onClick; click(); click(); });
  assert.equal(posts().length, 1);
  assert.equal(submitButton().props.disabled, true);
  assert.equal(submitButton().props["aria-busy"], true);
  assert.deepEqual(JSON.parse(posts()[0].options.body), Object.fromEntries(Object.entries(originalDraft).map(([key, value]) => [key, value.trim()])));
  await resolvePost();
  assert.deepEqual(draft(), { title: "", emoji: "", description: "" });
  assert.equal(submitButton().props["aria-busy"], false);
  assert.equal(reads().length, 1);
});

test("editing any submitted field while saving preserves all three latest fields exactly", async () => {
  for (const key of Object.keys(labels)) {
    await mount(); await fill(); await submit();
    const latest = { ...originalDraft, [key]: `  新草稿 ${key} 🎵\r\n ` };
    await fill({ [key]: latest[key] });
    assert.deepEqual(JSON.parse(posts().at(-1).options.body), Object.fromEntries(Object.entries(originalDraft).map(([name, value]) => [name, value.trim()])));
    await resolvePost(posts().length - 1);
    assert.deepEqual(draft(), latest);
    assert.equal(submitButton().props.disabled, false);
    await act(async () => tree.unmount()); tree = null;
  }
  assert.equal(posts().length, 3);
});

for (const status of [503, 408, undefined]) test(`unknown creation (${status || "network"}) preserves the draft and blocks all further creation until reviewed`, async () => {
  await mount(); await fill(); await submit();
  await act(async () => posts()[0].reject(Object.assign(new Error("FICTIONAL_PRIVATE_FAILURE_BODY"), { status })));
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, true);
  assert.equal(submitButton().props["aria-busy"], false);
  assert.equal(reads().length, 0);
  assert.match(snapshot(), /结果尚未确认/);
  assert.match(snapshot(), /本页已暂停添加/);
  assert.doesNotMatch(snapshot(), /FICTIONAL_PRIVATE_FAILURE_BODY/);
  await submit();
  await fill({ title: "A different fictional goal" });
  await submit();
  assert.equal(posts().length, 1, "editing a new draft does not release the unknown-creation pause");
});

for (const result of [{}, null]) test(`incomplete HTTP 200 (${JSON.stringify(result)}) cannot clear the draft or permit another POST`, async () => {
  await mount(); await fill(); await submit();
  await act(async () => posts()[0].resolve(result));
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, true);
  assert.equal(reads().length, 0);
  await submit();
  assert.equal(posts().length, 1);
});

for (const mismatch of [{ title: "Different fictional title" }, { description: "A different fictional condition" }, { emoji: "✨" }]) test(`a mismatched ${Object.keys(mismatch)[0]} receipt stays unconfirmed`, async () => {
  await mount(); await fill(); await submit(); await resolvePost(0, mismatch);
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, true);
  assert.equal(reads().length, 0);
  assert.match(snapshot(), /achievements_receipt_invalid/);
});

for (const status of [400, 401, 403, 409, 422]) test(`explicit HTTP ${status} rejection preserves the draft and permits a deliberate retry`, async () => {
  await mount(); await fill(); await submit();
  await act(async () => posts()[0].reject(Object.assign(new Error("FICTIONAL_PRIVATE_REJECTION"), { status })));
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, false);
  assert.match(snapshot(), /这次添加未被接受/);
  assert.doesNotMatch(snapshot(), /FICTIONAL_PRIVATE_REJECTION|本页已暂停添加/);
  await submit(); assert.equal(posts().length, 2); await resolvePost(1);
});

test("ok:false is an explicit rejection even when a receipt-like payload is present", async () => {
  await mount(); await fill(); await submit();
  await act(async () => posts()[0].resolve({ ...creationReceipt(), ok: false, error: "FICTIONAL_PRIVATE_REJECTION" }));
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, false);
  assert.equal(reads().length, 0);
  assert.match(snapshot(), /这次添加未被接受/);
  assert.doesNotMatch(snapshot(), /FICTIONAL_PRIVATE_REJECTION/);
});

test("a scoped GET with an identical goal never confirms the creation or clears the draft; only manual review resumes adding", async () => {
  await mount(); await fill(); await submit();
  fixture.readRows = [{ ...creationReceipt().achievement, unlocked: false, custom: true }];
  await act(async () => posts()[0].reject(Object.assign(new Error("FICTIONAL_PRIVATE_FAILURE_BODY"), { status: 503 })));
  assert.equal(resumeButton(), undefined);
  await act(async () => reviewButton().props.onClick());
  assert.equal(reads().length, 1);
  assert.equal(reads()[0].path, "/api/v2/fun-labs/achievements");
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, true);
  assert.match(snapshot(), /同名目标不代表本次创建成功/);
  await submit(); assert.equal(posts().length, 1);
  await act(async () => resumeButton().props.onClick());
  assert.deepEqual(draft(), originalDraft);
  assert.equal(submitButton().props.disabled, false);
  assert.equal(posts().length, 1, "manual review itself does not create another achievement");
  await submit(); assert.equal(posts().length, 2); await resolvePost(1);
});

test("failed, malformed and overlapping recovery reads keep adding paused until a current complete list is read", async () => {
  await mount(); await fill(); await submit();
  await act(async () => posts()[0].resolve({}));
  fixture.readFailure = Object.assign(new Error("FICTIONAL_PRIVATE_READ_BODY"), { status: 503 });
  await act(async () => reviewButton().props.onClick());
  assert.equal(resumeButton(), undefined);
  assert.equal(submitButton().props.disabled, true);
  assert.doesNotMatch(snapshot(), /FICTIONAL_PRIVATE_READ_BODY/);
  fixture.readFailure = null; fixture.holdReads = true;
  await act(async () => { const click = reviewButton().props.onClick; click(); click(); });
  assert.equal(reads().length, 2, "same-tick recovery clicks share the current read");
  await act(async () => reads()[1].resolve({ achievements: [{ title: "Incomplete fictional row" }] }));
  assert.equal(resumeButton(), undefined); assert.equal(submitButton().props.disabled, true);
  await act(async () => reviewButton().props.onClick());
  await act(async () => reads()[2].resolve({ achievements: [] }));
  assert.ok(resumeButton()); assert.equal(submitButton().props.disabled, true);
  assert.equal(posts().length, 1);
  assert.deepEqual(draft(), originalDraft);
});

test("late recovery GET completion after a parent scope remount cannot resume or change a new account draft", async () => {
  await mount(); await fill(); await submit(); await act(async () => posts()[0].resolve({}));
  fixture.holdReads = true;
  await act(async () => reviewButton().props.onClick());
  const pending = reads()[0];
  await act(async () => tree.update(React.createElement(Harness, {
    key: "fictional-account-b", accountStorageScope: "fictional-account-b", companionScope: "fictional-companion",
  })));
  const latest = { title: "New account fictional goal", emoji: "✨", description: "当前账号原草稿\r\n " };
  await fill(latest);
  const writes = fixture.stateWrites;
  await act(async () => pending.resolve({ achievements: [] }));
  assert.deepEqual(draft(), latest); assert.equal(fixture.stateWrites, writes);
  assert.equal(resumeButton(), undefined); assert.equal(submitButton().props.disabled, false);
});

test("a failed old recovery read cannot release a new scope pause or overwrite its edited draft", async () => {
  await mount(); await fill(); await submit(); await act(async () => posts()[0].resolve({}));
  fixture.holdReads = true;
  await act(async () => reviewButton().props.onClick());
  const oldRead = reads()[0];
  await act(async () => tree.update(React.createElement(Harness, {
    key: "fictional-account-a", accountStorageScope: "fictional-account-b", companionScope: "fictional-companion",
  })));
  const latest = { title: "Another fictional goal", emoji: "✨", description: "new original\r\n " };
  await fill(latest); await submit(); await act(async () => posts()[1].resolve({}));
  const writes = fixture.stateWrites;
  await act(async () => oldRead.reject(new DOMException("FICTIONAL_CANCELLED_OLD_READ", "AbortError")));
  assert.deepEqual(draft(), latest); assert.equal(fixture.stateWrites, writes);
  assert.equal(submitButton().props.disabled, true); assert.equal(resumeButton(), undefined);
  assert.doesNotMatch(snapshot(), /FICTIONAL_CANCELLED_OLD_READ/);
  await submit(); assert.equal(posts().length, 2);
});

test("editing the draft during list review and resuming preserves the exact new draft", async () => {
  await mount(); await fill(); await submit(); await act(async () => posts()[0].resolve({}));
  fixture.holdReads = true;
  await act(async () => reviewButton().props.onClick());
  const latest = { title: "  Edited fictional goal  ", emoji: " 🌱 ", description: "edited original\r\n " };
  await fill(latest);
  await act(async () => reads()[0].resolve({ achievements: [] }));
  await act(async () => resumeButton().props.onClick());
  assert.deepEqual(draft(), latest); assert.equal(posts().length, 1);
  fixture.holdReads = false;
  await submit(); assert.equal(posts().length, 2);
  assert.deepEqual(JSON.parse(posts()[1].options.body), { title: latest.title.trim(), emoji: latest.emoji.trim(), description: latest.description.trim() });
  await resolvePost(1);
});

test("a complete receipt uses backend whitespace normalization and the default icon without changing the draft before confirmation", async () => {
  const submitted = { title: "  Fictional   goal\r\n title  ", emoji: "", description: "  Fictional\r\n  condition  " };
  await mount(); await fill(submitted); await submit();
  assert.deepEqual(draft(), submitted);
  await resolvePost();
  assert.deepEqual(draft(), { title: "", emoji: "", description: "" });
  assert.equal(reads().length, 1); assert.equal(reviewButton(), undefined);
});

test("a late old creation cannot unlock a new creation while a changed-token harness stays mounted", async () => {
  await mount(); await fill(); await submit();
  const oldPost = posts()[0];
  await act(async () => tree.update(React.createElement(Harness, {
    key: "fictional-account-a", accountStorageScope: "fictional-account-b", companionScope: "fictional-companion",
  })));
  const latest = { title: "New scope fictional goal", emoji: "✨", description: "new condition" };
  await fill(latest); await submit();
  assert.equal(posts().length, 2); assert.equal(submitButton().props["aria-busy"], true);
  await act(async () => oldPost.reject(Object.assign(new Error("FICTIONAL_PRIVATE_OLD_ERROR"), { status: 400 })));
  assert.deepEqual(draft(), latest); assert.equal(submitButton().props.disabled, true);
  assert.equal(submitButton().props["aria-busy"], true);
  await resolvePost(1); assert.deepEqual(draft(), { title: "", emoji: "", description: "" });
});

test("late success or failure after the parent scope remount neither clears the current draft nor starts a refresh", async () => {
  for (const success of [true, false]) {
    await mount("fictional-account-a"); await fill(); await submit();
    const pending = posts().at(-1);
    await act(async () => tree.update(React.createElement(Harness, {
      key: "fictional-account-b", accountStorageScope: "fictional-account-b", companionScope: "fictional-companion",
    })));
    const currentDraft = { title: "Current account title", emoji: "✨", description: "当前作用域草稿\r\n " };
    await fill(currentDraft);
    const writes = fixture.stateWrites, readCount = reads().length;
    await act(async () => success ? pending.resolve({ achievement: { code: "custom:old" } }) : pending.reject(new Error("FICTIONAL_OLD_FAILURE")));
    assert.deepEqual(draft(), currentDraft);
    assert.equal(fixture.stateWrites, writes, "the completed old function must not attempt state updates");
    assert.equal(reads().length, readCount);
    assert.equal(tree.root.findByProps({ className: "submit-notice" }).children.length, 0);
    await act(async () => tree.unmount()); tree = null;
  }
});

test("a changed funToken also rejects old results while the harness remains mounted", async () => {
  for (const success of [true, false]) {
    await mount("fictional-account-a"); await fill(); await submit();
    const pending = posts().at(-1);
    await act(async () => tree.update(React.createElement(Harness, {
      key: "fictional-account-a", accountStorageScope: "fictional-account-b", companionScope: "fictional-companion",
    })));
    const currentDraft = { title: "Changed token title", emoji: "✨", description: "新 token 的原文\r\n " };
    await fill(currentDraft);
    const writes = fixture.stateWrites, readCount = reads().length;
    await act(async () => success ? pending.resolve({ achievement: { code: "custom:old" } }) : pending.reject(new Error("FICTIONAL_OLD_FAILURE")));
    assert.deepEqual(draft(), currentDraft);
    assert.equal(fixture.stateWrites, writes);
    assert.equal(reads().length, readCount);
    assert.equal(tree.root.findByProps({ className: "submit-notice" }).children.length, 0);
    await act(async () => tree.unmount()); tree = null;
  }
});

test("an unexpected refresh exception after successful POST reports saved status without repeating the POST", async () => {
  fixture.throwRefresh = true;
  await mount(); await fill(); await submit(); await resolvePost();
  assert.deepEqual(draft(), { title: "", emoji: "", description: "" });
  assert.match(snapshot(), /成就已保存，列表刷新失败/);
  assert.match(snapshot(), /不要再次提交同一操作/);
  assert.doesNotMatch(snapshot(), /保存结果尚未确认|没有保存成功|FICTIONAL_UNEXPECTED_REFRESH_EXCEPTION/);
  assert.equal(posts().length, 1);
  assert.equal(submitButton().props["aria-busy"], false);
});

test("real refresh helper handles a failed list read through retryable section feedback without another POST", async () => {
  fixture.readFailure = Object.assign(new Error("FICTIONAL_PRIVATE_READ_FAILURE"), { code: "achievements_load_failed", status: 503 });
  await mount(); await fill(); await submit(); await resolvePost();
  assert.deepEqual(draft(), { title: "", emoji: "", description: "" });
  assert.match(snapshot(), /成就暂时无法读取/);
  assert.doesNotMatch(snapshot(), /保存结果尚未确认|没有保存成功|FICTIONAL_PRIVATE_READ_FAILURE/);
  assert.equal(posts().length, 1);
  const retry = tree.root.findByProps({ "aria-label": "重试成就" });
  fixture.readFailure = null;
  await act(async () => retry.props.onClick());
  assert.equal(posts().length, 1);
  assert.equal(reads().length, 2);
  assert.equal(tree.root.findAllByProps({ "aria-label": "重试成就" }).length, 0);
});

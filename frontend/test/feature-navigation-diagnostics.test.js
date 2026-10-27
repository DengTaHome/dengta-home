import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recordOperationFailure, readOperationFailures, clearOperationFailures } from "../src/operation-diagnostics.js";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const guardStart = source.indexOf("  const canLeaveWorkspace = useCallback("), guardEnd = source.indexOf("  const registerWorkspaceLeaveGuard", guardStart);
const navigationStart = source.indexOf("  function changeView(view)"), navigationEnd = source.indexOf("  function openSettingsPanel()", navigationStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart && navigationEnd > navigationStart);
const code = source.slice(guardStart, guardEnd) + source.slice(navigationStart, navigationEnd);
function navigation(activeView, guard) {
  const calls = [], workspaceLeaveGuardRef = { current: guard };
  const build = new Function("activeView", "workspaceLeaveGuardRef", "calls", `
    const activeViewRef={current:activeView},useCallback=fn=>fn;
    const hasLoadedSettingsRef={current:false},draftSettingsRef={current:{}};
    const shouldScheduleSettingsOnViewChange=()=>false,scheduleSettingsAutosave=()=>calls.push("save");
    const closeComposerMenu=()=>calls.push("composer"),requestStatusPanelClose=()=>calls.push("status");
    const setActiveView=view=>calls.push(view),setIsSidebarOpen=()=>calls.push("sidebar"),setIsMobileNavOpen=()=>calls.push("nav");
    ${code}
    return {changeView,canLeaveWorkspace};
  `);
  return { ...build(activeView, workspaceLeaveGuardRef, calls), calls };
}
test("cancelled workspace navigation preserves the page and navigation controls", () => {
  const nav = navigation("workspace", () => false); nav.changeView("chat"); assert.deepEqual(nav.calls, []);
});
test("confirmed workspace navigation changes view once", () => {
  let prompts = 0; const nav = navigation("workspace", () => { prompts++; return true; }); nav.changeView("music");
  assert.equal(prompts, 1); assert.deepEqual(nav.calls, ["composer", "status", "music", "sidebar", "nav"]);
});
test("opening the current workspace or another feature does not ask to discard", () => {
  const unexpected = () => { throw Error("unexpected discard prompt"); };
  navigation("workspace", unexpected).changeView("workspace"); navigation("chat", unexpected).changeView("music");
});
test("new and existing chat selection guard before changing session state", () => {
  for (const [start, end, effect] of [["  async function createSession()", "  function chooseSession(", "createSessionPendingRef.current = true"], ["  function chooseSession(", "  function confirmSessionDialog(", "chatScrollControllerRef.current?.open()"]]) {
    const first = source.indexOf(start), body = source.slice(first, source.indexOf(end, first));
    const guard = body.indexOf('if (!canLeaveWorkspace("chat")) return;');
    const effectIndex = body.indexOf(effect);
    // 两个位置都必须真实存在。早先只比较大小：守卫被删掉后 indexOf 返回 -1，
    // 而 -1 < 93 依然成立——这个测试根本拦不住它本该拦的回归。
    assert.ok(guard >= 0, `canLeaveWorkspace guard missing before ${effect}`);
    assert.ok(effectIndex >= 0, `expected effect "${effect}" not found`);
    assert.ok(guard < effectIndex, "the guard must run before the session state changes");
  }
});
test("a cancelled native cast leaves its payload pending and does not change the page", async () => {
  const first = source.indexOf("    const processMedia = async (payload) => {"), last = source.indexOf("\n\n    void DlnaReceiver.addListener", first);
  assert.ok(first >= 0 && last > first);const calls=[];
  const build = new Function("canLeaveWorkspace","setDlnaCastInfo","setActiveView","setIsSidebarOpen","setIsMobileNavOpen","setScreenGlanceFeedback","DlnaReceiver",source.slice(first,last)+"return processMedia;");
  const callback=build(()=>false,...Array.from({length:5},()=>()=>calls.push("state")),{clearPending:async()=>calls.push("clear")});
  await callback({uri:"https://fictional.example.test/video.mp4",title:"fictional video"});assert.deepEqual(calls,[]);
});
for (const [endpoint, code, reasonCode] of [["/api/v2/intimate-duel", "DT-DUEL", "duel_response_invalid"], ["/api/v2/fun-labs/achievements/custom", "DT-ACHIEVEMENTS", "achievements_receipt_invalid"], ["/api/v2/workspace/file", "DT-WORKSPACE", null], ["/api/v2/memory/health", "DT-MEMORY", null], ["/api/v2/memories", "DT-SUMMARIES", "memory_summary_receipt_invalid"], ["/api/v2/memories/00000000-0000-4000-8000-000000000000", "DT-SUMMARIES", "memory_not_found"], ["/api/v2/memories/00000000-0000-4000-8000-000000000000", "DT-SUMMARIES", null]]) test(`${code}: diagnostics contain scoped technical metadata only`, () => {
  const scope = '["fictional-account","fictional-companion"]', other = '["other-account","other-companion"]'; clearOperationFailures(scope); clearOperationFailures(other);
  recordOperationFailure(scope, `${endpoint}?private=FICTIONAL_PRIVATE_QUERY`, {code:reasonCode || "FICTIONAL_SECRET_CODE",message:"FICTIONAL_PRIVATE_BODY",status:503,api_key:"FICTIONAL_PRIVATE_KEY",error_log_id:"00000000-0000-4000-8000-000000000000"}, 100);
  const row = readOperationFailures(scope)[0]; assert.equal(row.code, code); assert.equal(row.status,503); assert.equal(row.reasonCode,reasonCode || undefined);
  assert.equal(readOperationFailures(other).length,0); assert.doesNotMatch(JSON.stringify(row),/FICTIONAL_PRIVATE|FICTIONAL_SECRET/); clearOperationFailures(scope);
});

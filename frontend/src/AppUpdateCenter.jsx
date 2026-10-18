import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { fetchAppUpdate, shouldRemindUpdate, snoozeUpdate } from "./app-updates.js";
import { useBackLayer } from "./useAppBackNavigation.js";
import { useSettingsSheetNavigation } from "./useSettingsSheetNavigation.js";
import "./app-updates.css";

const AppUpdates = registerPlugin("AppUpdates");
export default function AppUpdateCenter({ canPrompt = true }) {
  const [release, setRelease] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [installed, setInstalled] = useState("");
  const [opening, setOpening] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [manualPrompt, setManualPrompt] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState(null);
  const [editing, setEditing] = useState(false);
  const pending = useRef(null);
  const lastCheck = useRef(-Infinity);
  const mounted = useRef(false);
  const panelRef = useRef(null);
  const downloadPending = useRef(false);
  const notificationPending = useRef(false);
  const preferenceRevision = useRef(0);
  const dismiss = useCallback(() => {
    if (release) snoozeUpdate(release);
    setRelease(null);
    setManualPrompt(false);
  }, [release]);
  const visible = Boolean(release && ((canPrompt && !editing) || manualPrompt));
  const closePanel = () => { if (preferencesOpen) setPreferencesOpen(false); else dismiss(); };
  useBackLayer(visible || preferencesOpen, closePanel, 400);
  useSettingsSheetNavigation({ isOpen: visible || preferencesOpen, scopeKey: preferencesOpen ? "app-update-preferences" : "app-update", panelRef, onClose: closePanel });

  const check = useCallback(async (manual = false) => {
    if (Capacitor.getPlatform() !== "android") {
      if (manual) setFeedback("网页版会自动加载已发布的版本；APK 更新提醒在安卓应用中提供。");
      return;
    }
    if (!manual && (pending.current || Date.now() - lastCheck.current < 60 * 60 * 1_000)) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = () => mounted.current && pending.current === controller && !controller.signal.aborted;
    if (manual) setFeedback("正在检查灯塔新版本…");
    try {
      const info = await App.getInfo();
      if (!current()) return;
      const next = await fetchAppUpdate(info.build, { signal: controller.signal });
      if (!current()) return;
      lastCheck.current = Date.now();
      setInstalled(info.version);
      const offered = next && (manual || shouldRemindUpdate(next));
      setRelease(offered ? next : null);
      setManualPrompt(Boolean(offered && manual));
      if (manual) setFeedback(next ? "发现新版本，请查看更新说明。" : "当前没有比已安装版本更新的已发布版本。");
    } catch (error) {
      if (current() && manual) setFeedback(`检查更新失败，请稍后重试。错误码：${error?.code === "app_update_manifest_invalid" ? error.code : "app_update_unavailable"}`);
    } finally { if (pending.current === controller) pending.current = null; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false, handle;
    const request = () => { void check(true); };
    const preferences = () => setPreferencesOpen(true);
    const focus = () => setEditing(Boolean(document.activeElement?.matches?.("input,textarea,[contenteditable='true']")));
    window.addEventListener("dengta:check-app-updates", request);
    window.addEventListener("dengta:app-update-preferences", preferences);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    focus();
    if (Capacitor.getPlatform() === "android") {
      const scheduledAt = preferenceRevision.current;
      void AppUpdates.schedule().then(value => { if (!disposed && scheduledAt === preferenceRevision.current) setNotificationsEnabled(value.enabled === true); }).catch(() => {});
      const resumed = () => {
        const checkedAt = preferenceRevision.current;
        void LocalNotifications.checkPermissions().then(value => { if (!disposed && checkedAt === preferenceRevision.current) setNotificationPermission(value.display); }).catch(() => {});
        void AppUpdates.consumeLaunch().then(value => { if (!disposed) void check(value.available === true); }).catch(() => { if (!disposed) void check(); });
      };
      resumed();
      void App.addListener("appStateChange", ({ isActive }) => { if (isActive) resumed(); }).then(value => { if (disposed) void value.remove(); else handle = value; }).catch(() => {});
    }
    return () => {
      mounted.current = false;
      disposed = true;
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener("dengta:check-app-updates", request);
      window.removeEventListener("dengta:app-update-preferences", preferences);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      void handle?.remove();
    };
  }, [check]);

  async function download() {
    if (downloadPending.current || !release) return;
    downloadPending.current = true;
    setOpening(true);
    try { await AppUpdates.openDownload({ url: release.apk_url }); }
    catch { if (mounted.current) setFeedback("未能打开下载页面，请稍后再试。错误码：app_update_download_failed"); }
    finally { downloadPending.current = false; if (mounted.current) setOpening(false); }
  }
  async function allowNotifications() {
    if (notificationPending.current) return;
    notificationPending.current = true;
    preferenceRevision.current++;
    setNotificationSaving(true);
    try {
      let permission = await LocalNotifications.checkPermissions();
      if (!mounted.current) return;
      if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
      if (!mounted.current) return;
      if (mounted.current) setNotificationPermission(permission.display);
      if (permission.display === "granted") await AppUpdates.setEnabled({ enabled: true });
      if (permission.display === "granted" && mounted.current) setNotificationsEnabled(true);
      if (mounted.current) setFeedback(permission.display === "granted" ? "更新通知已开启。系统允许后台任务运行时会检查新版本。" : "系统未允许通知，打开灯塔后仍可检查更新。");
    } catch { if (mounted.current) setFeedback("通知设置暂时无法打开；应用内更新检查仍可使用。"); }
    finally { notificationPending.current = false; if (mounted.current) setNotificationSaving(false); }
  }
  async function toggleNotifications() {
    if (!notificationsEnabled || notificationPermission !== "granted") return allowNotifications();
    if (notificationPending.current) return;
    notificationPending.current = true;
    preferenceRevision.current++;
    setNotificationSaving(true);
    try {
      await AppUpdates.setEnabled({ enabled: false });
      if (mounted.current) setNotificationsEnabled(false);
    } catch { if (mounted.current) setFeedback("更新通知设置未保存，请重试。"); }
    finally { notificationPending.current = false; if (mounted.current) setNotificationSaving(false); }
  }
  return <>
    {feedback && <div className="app-update-feedback" role="status"><span>{feedback}</span><button type="button" aria-label="关闭更新提示" onClick={() => setFeedback("")}>×</button></div>}
    {preferencesOpen && <div className="app-update-backdrop" onClick={closePanel}><section ref={panelRef} className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-preferences-title" tabIndex={-1} onClick={event => event.stopPropagation()}>
      <h2 id="update-preferences-title">版本更新提醒</h2>
      <p>打开灯塔及返回应用时自动检查更新。后台检查由手机系统调度，通常约 30 分钟或更久，无法保证即时送达。</p>
      <p>只读取公开版本信息，不发送聊天内容或账号凭据。</p>
      {Capacitor.getPlatform() === "android" ? <button type="button" className="app-update-preference-toggle" disabled={notificationSaving} onClick={() => void toggleNotifications()}>{notificationSaving ? "正在保存…" : notificationsEnabled && notificationPermission === "granted" ? "关闭后台更新通知" : "开启后台更新通知"}</button> : <p>后台更新通知在安卓应用中提供。</p>}
      <div className="app-update-actions"><button type="button" onClick={closePanel}>完成</button></div>
    </section></div>}
    {visible && !preferencesOpen && <div className="app-update-backdrop" onClick={dismiss}>
      <section ref={panelRef} className="app-update-dialog" role="dialog" aria-modal="true" aria-labelledby="app-update-title" tabIndex={-1} onClick={event => event.stopPropagation()}>
        <small>DENGTA · 新版本</small><h2 id="app-update-title">灯塔有更新了</h2>
        <p>{installed} → {release.version} · {(release.size_bytes / 1024 / 1024).toFixed(1)} MB</p>
        <ul>{release.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
        <p>下载安装后按系统提示更新。无需卸载当前应用。</p>
        <div className="app-update-actions"><button type="button" onClick={dismiss}>稍后提醒</button><button type="button" disabled={opening} onClick={() => void download()}>{opening ? "正在打开…" : "下载更新"}</button></div>
        <button className="app-update-notifications" type="button" disabled={notificationSaving} onClick={() => void allowNotifications()}>{notificationSaving ? "正在保存…" : "允许后台更新通知"}</button>
      </section>
    </div>}
  </>;
}

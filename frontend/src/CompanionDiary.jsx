import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import {
  createScopedSettingsSession,
  settingsSaveScope,
} from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";
import FeatureAtmosphere from "./FeatureAtmosphere";

function requestFailureMessage(error) {
  const { code, reason, action } = describeOperationError(error);
  return `${reason}${action}（错误代码：${code}）`;
}

function formatDiaryDate(value) {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSourceWindow(entry) {
  if (!entry?.source_window_start || !entry?.source_window_end) return "";
  return `${formatDiaryDate(entry.source_window_start)} 至 ${formatDiaryDate(
    entry.source_window_end,
  )}`;
}

function isDiaryEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.title === "string" &&
    typeof entry.content === "string" &&
    (entry.mood == null || typeof entry.mood === "string") &&
    (entry.source_message_count == null ||
      (Number.isSafeInteger(entry.source_message_count) && entry.source_message_count >= 0))
  );
}

export default function CompanionDiary({
  aiName = "伴侣",
  onNotice,
  scopeKey = settingsSaveScope(authSession.getSnapshot()),
}) {
  const [diary, setDiary] = useState({
    scopeKey,
    entries: [],
    available: null,
    loading: true,
    error: "",
  });
  const noticeRef = useRef(onNotice);
  const readRef = useRef(null);
  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);
  const { entries, available, loading, error } =
    diary.scopeKey === scopeKey
      ? diary
      : { entries: [], available: null, loading: true, error: "" };

  useEffect(() => {
    const controller = new AbortController();
    const scopedSession = createScopedSettingsSession(
      authSession,
      scopeKey,
      controller.signal,
    );
    let inFlight = false;
    const isCurrent = () =>
      !controller.signal.aborted &&
      settingsSaveScope(authSession.getSnapshot()) === scopeKey;

    async function load({ silent = false } = {}) {
      if (inFlight || !isCurrent()) return;
      inFlight = true;
      setDiary(previous => previous.scopeKey === scopeKey
        ? { ...previous, loading: true }
        : { scopeKey, entries: [], available: null, loading: true, error: "" });
      try {
        const data = await apiRequest("/api/v2/diary", {
          signal: controller.signal,
          authSession: scopedSession,
          retry: false,
          timeoutMs: 15 * 1000,
        });
        if (!isCurrent()) return;
        if (
          typeof data?.available !== "boolean" ||
          !Array.isArray(data?.entries) ||
          !data.entries.every(isDiaryEntry)
        ) {
          const error = new Error("日记读取回执无效。");
          error.code = "diary_receipt_invalid";
          throw error;
        }
        setDiary({
          scopeKey,
          available: data.available,
          entries: data.entries,
          loading: false,
          error: "",
        });
      } catch (error) {
        if (!isCurrent()) return;
        const message = requestFailureMessage(error);
        setDiary(previous => ({
          ...previous,
          error: message,
        }));
        if (!silent) noticeRef.current?.(message);
      } finally {
        inFlight = false;
        if (isCurrent()) setDiary(previous => ({ ...previous, loading: false }));
      }
    }

    readRef.current = load;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 20 * 1000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      if (readRef.current === load) readRef.current = null;
    };
  }, [scopeKey]);

  return (
    <section className="feature-page companion-diary-page">
      <FeatureAtmosphere kind="diary" />
      <div
        className="diary-generation-state state-watching"
        role="status"
      >
        <img src="/app-icon-192.png" alt="" />
        <div>
          <strong>记忆手记自动更新</strong>
          <span>
            {loading
              ? "正在读取记忆手记…"
              : error
                ? "本次读取未完成，可重新读取。"
                : "页面打开时每 20 秒检查新手记。"}
          </span>
        </div>
      </div>

      {error && (
        <div className="diary-empty" role="alert">
          <h3>记忆手记读取未完成</h3>
          <p>{error}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => readRef.current?.()}
          >
            重新读取
          </button>
        </div>
      )}
      {available === false ? (
        <div className="diary-empty">
          <h3>记忆手记暂时不可用</h3>
          <p>服务器暂时无法读取记忆手记，请稍后再试。</p>
          {!error && (
            <button
              type="button"
              disabled={loading}
              onClick={() => readRef.current?.()}
            >
              重新读取
            </button>
          )}
        </div>
      ) : loading && entries.length === 0 && !error ? (
        <div className="diary-empty">正在读取我们的记忆手记…</div>
      ) : entries.length === 0 && !error ? (
        <div className="diary-empty">
          <h3>第一页还留着空白</h3>
          <p>
            再自然地聊几轮。达到双向消息数量后，{aiName}
            会自己写下第一篇，不会用模板故事填满这里。
          </p>
        </div>
      ) : entries.length > 0 ? (
        <div className="diary-entry-list">
          {entries.map((entry, index) => (
            <article className="diary-entry" key={entry.id}>
              <div className="diary-entry-index" aria-hidden="true">
                {String(entries.length - index).padStart(2, "0")}
              </div>
              <header>
                <div>
                  <time>{formatDiaryDate(entry.created_at)}</time>
                  <h3>{entry.title}</h3>
                </div>
                {entry.mood && <span>{entry.mood}</span>}
              </header>
              <p>{entry.content}</p>
              <footer>
                <span>
                  依据 {entry.source_message_count || 0} 条真实消息
                </span>
                <small>{formatSourceWindow(entry)}</small>
              </footer>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

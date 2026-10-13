import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { describeOperationError } from "./operation-error-help.js";
import TypewriterText from "./TypewriterText";

const SPEECH_ACTIONS = [
  { id: "talk", label: "说话" },
  { id: "teach", label: "教她" },
  { id: "feed", label: "喂语料" },
];

const CARE_ACTIONS = [
  { id: "soothe", label: "安抚", symbol: "♡" },
  { id: "diaper", label: "换尿布", symbol: "◇" },
  { id: "burp", label: "拍嗝", symbol: "○" },
  { id: "play", label: "玩一会", symbol: "✦" },
];

const STATE_ITEMS = [
  ["mood", "心情"],
  ["health", "健康"],
  ["nutrition", "饱足"],
  ["fatigue", "疲劳"],
  ["intimacy", "亲密"],
  ["digest_load", "消化负担"],
];

function clientActionId(kind) {
  const generated = globalThis.crypto?.randomUUID?.();
  return generated || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestFailureMessage(error) {
  const { code, reason, action } = describeOperationError(error);
  return `${reason}${action}（错误代码：${code}）`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidNurseryResponse() {
  const error = new Error("家庭状态回执不完整，请重新读取核对。");
  error.code = "nursery_response_invalid";
  return error;
}

function assertNurserySnapshot(data, { requireChild = false, childId = "" } = {}) {
  if (!requireChild && data?.available === false && data.child === null && typeof data.message === "string") return;
  const child = data?.child;
  const validChild = child === null ? data?.state === null :
    isRecord(child) && typeof child.id === "string" && child.id &&
    typeof child.display_name === "string" && (child.name === null || typeof child.name === "string") &&
    isRecord(child.stage) && typeof child.stage.label === "string" && Number.isFinite(child.stage.age_days) &&
    isRecord(data?.state) && STATE_ITEMS.every(([key]) => Number.isFinite(data.state[key]));
  const valid = isRecord(data) && data.available === true && validChild &&
    ["bonds", "actions", "utterances", "milestones", "events"].every((key) => Array.isArray(data[key])) &&
    data.bonds.every((bond) => isRecord(bond) && typeof bond.caregiver_kind === "string") &&
    data.utterances.every((item) => isRecord(item) && typeof item.text === "string") &&
    data.milestones.every((item) => isRecord(item) && typeof item.id === "string" && typeof item.title === "string" &&
      (item.note == null || typeof item.note === "string")) &&
    (!requireChild || (child !== null && (!childId || child.id === childId)));
  if (!valid) throw invalidNurseryResponse();
}

function assertNurseryPortrait(data) {
  const portrait = data?.portrait;
  if (!isRecord(portrait) || !isRecord(portrait.language) || !Number.isFinite(portrait.milestones) ||
    !["learned_characters", "unique_characters", "utterances"].every((key) => Number.isFinite(portrait.language[key]))) {
    throw invalidNurseryResponse();
  }
}

function assertNurseryReceipt(data, { label, actionKind, candidates }) {
  if (label === "birth") {
    if (typeof data.created !== "boolean") throw invalidNurseryResponse();
    return;
  }
  if (typeof data.idempotent !== "boolean") throw invalidNurseryResponse();
  if (label === "name") {
    if (typeof data.chosen_name !== "string" || !data.chosen_name ||
      data.child.name !== data.chosen_name || !candidates.includes(data.chosen_name)) {
      throw invalidNurseryResponse();
    }
    return;
  }
  const action = data.action;
  const companion = label === "companion";
  const expectedKind = label === "speech" ? actionKind : label;
  if (!isRecord(action) || typeof action.id !== "string" || !action.id.trim() ||
    action.actor !== (companion ? "companion" : "user") ||
    (companion ? !["talk", "soothe"].includes(action.kind) : action.kind !== expectedKind) ||
    typeof action.applied_at !== "string" || !Number.isFinite(Date.parse(action.applied_at))) {
    throw invalidNurseryResponse();
  }
}

function formatTime(value) {
  if (typeof value !== "string" || !value.trim()) return "时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function StateMeter({ label, value, inverse = false }) {
  const amount = Math.min(100, Math.max(0, Number(value || 0)));
  return (
    <div className={`nursery-meter${inverse ? " is-inverse" : ""}`}>
      <span>
        <small>{label}</small>
        <strong>{Math.round(amount)}</strong>
      </span>
      <i aria-hidden="true">
        <b style={{ width: `${amount}%` }} />
      </i>
    </div>
  );
}

export default function Nursery({ aiName = "伴侣", onNotice }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const [busy, setBusy] = useState("");
  const [speechAction, setSpeechAction] = useState("talk");
  const [speechText, setSpeechText] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [portrait, setPortrait] = useState(null);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [scope] = useState(() => settingsSaveScope(authSession.getSnapshot()));
  const lifecycleRef = useRef(null);
  const busyRef = useRef(false);
  const recheckRef = useRef(false);
  const readVersionRef = useRef(0);
  const noticeRef = useRef(onNotice);

  useEffect(() => {
    noticeRef.current = onNotice;
  }, [onNotice]);

  const isCurrent = useCallback((lifecycle) =>
    lifecycle && lifecycleRef.current === lifecycle &&
    !lifecycle.controller.signal.aborted &&
    settingsSaveScope(authSession.getSnapshot()) === scope,
  [scope]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const lifecycle = lifecycleRef.current;
      if (!isCurrent(lifecycle) || busyRef.current) return;
      const version = ++readVersionRef.current;
      const acceptsRead = () => isCurrent(lifecycle) && readVersionRef.current === version;
      setReading(true);
      try {
        const data = await apiRequest("/api/v2/nursery", {
          signal: lifecycle.controller.signal,
          authSession: lifecycle.session,
          retry: false,
        });
        if (!acceptsRead()) return;
        assertNurserySnapshot(data);
        setSnapshot(data);
        setReadError("");
        setActionError("");
        if (data.available === true) { recheckRef.current = false; setNeedsRecheck(false); }
      } catch (error) {
        if (!acceptsRead()) return;
        const message = requestFailureMessage(error);
        setReadError(`家庭状态读取失败。${message}`);
        if (!silent) noticeRef.current?.(message);
      } finally {
        if (acceptsRead()) {
          setLoading(false);
          setReading(false);
        }
      }
    },
    [isCurrent],
  );

  useEffect(() => {
    const controller = new AbortController();
    const lifecycle = {
      controller,
      session: createScopedSettingsSession(authSession, scope, controller.signal),
    };
    lifecycleRef.current = lifecycle;
    const initialTimer = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    }, 60 * 1000);
    return () => {
      controller.abort();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      busyRef.current = false;
      recheckRef.current = false;
      readVersionRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [load, scope]);

  const child = snapshot?.child || null;
  const latestUtterance = snapshot?.utterances?.[0] || null;
  const bonds = useMemo(
    () =>
      Object.fromEntries(
        (snapshot?.bonds || []).map((bond) => [bond.caregiver_kind, bond]),
      ),
    [snapshot?.bonds],
  );

  async function perform(label, request, { portraitOnly = false, actionKind, candidates } = {}) {
    const lifecycle = lifecycleRef.current;
    if (busyRef.current || (!portraitOnly && recheckRef.current) || !isCurrent(lifecycle)) return null;
    busyRef.current = true;
    readVersionRef.current += 1;
    setReading(false);
    setBusy(label);
    setActionError("");
    try {
      const data = await request({
        signal: lifecycle.controller.signal,
        authSession: lifecycle.session,
        retry: false,
      });
      if (!isCurrent(lifecycle)) return null;
      if (portraitOnly) {
        assertNurseryPortrait(data);
        setPortrait(data.portrait);
      }
      else {
        assertNurserySnapshot(data, { requireChild: true, childId: child?.id });
        assertNurseryReceipt(data, { label, actionKind, candidates });
        setSnapshot(data);
        setPortrait(null);
        setReadError("");
      }
      return data;
    } catch (error) {
      if (!isCurrent(lifecycle)) return null;
      if (portraitOnly) setPortraitOpen(false);
      else { recheckRef.current = true; setNeedsRecheck(true); }
      const message = requestFailureMessage(error);
      setActionError(portraitOnly
        ? `成长画像读取失败。${message}`
        : `本次操作结果尚未确认，请先重新读取家庭状态核对，勿重复提交。${message}`);
      noticeRef.current?.(message);
      return null;
    } finally {
      if (isCurrent(lifecycle)) {
        busyRef.current = false;
        setBusy("");
      }
    }
  }

  async function createChild() {
    await perform("birth", (options) =>
      apiRequest("/api/v2/nursery/children", {
        ...options,
        method: "POST",
        body: JSON.stringify({ client_action_id: clientActionId("birth") }),
      }),
    );
  }

  async function sendSpeech(event) {
    event.preventDefault();
    const submitted = speechText;
    const text = speechText.trim();
    if (!child || !text) return;
    const result = await perform("speech", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          action: speechAction,
          text,
          client_action_id: clientActionId(speechAction),
        }),
      }),
      { actionKind: speechAction },
    );
    if (result) setSpeechText((current) => current === submitted ? "" : current);
  }

  async function care(action) {
    if (!child) return;
    await perform(action, (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/actions`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          action,
          client_action_id: clientActionId(action),
        }),
      }),
    );
  }

  async function letCompanionCare() {
    if (!child) return;
    await perform("companion", (options) =>
      apiRequest(
        `/api/v2/nursery/children/${child.id}/companion-actions`,
        {
          ...options,
          method: "POST",
          body: JSON.stringify({
            client_action_id: clientActionId("companion"),
          }),
        },
      ),
    );
  }

  async function chooseName(event) {
    event.preventDefault();
    if (!child) return;
    const submitted = nameDraft;
    const candidates = nameDraft
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!candidates.length) return;
    const result = await perform("name", (options) =>
      apiRequest(`/api/v2/nursery/children/${child.id}/name`, {
        ...options,
        method: "POST",
        body: JSON.stringify({
          candidates,
          client_action_id: clientActionId("name"),
        }),
      }),
      { candidates },
    );
    if (result) setNameDraft((current) => current === submitted ? "" : current);
  }

  async function togglePortrait() {
    if (busyRef.current || !isCurrent(lifecycleRef.current)) return;
    const nextOpen = !portraitOpen;
    setPortraitOpen(nextOpen);
    if (!nextOpen || portrait || !child) return;
    await perform("portrait", (options) => apiRequest(
      `/api/v2/nursery/children/${child.id}/portrait`, options,
    ), { portraitOnly: true });
  }

  if (loading) {
    return <section className="feature-page nursery-page is-loading">正在回家…</section>;
  }

  const feedback = (readError || actionError) && (
    <div className="nursery-empty-state" role="alert">
      {actionError && <span>{actionError}</span>}
      {readError && <span>{readError}</span>}
      <button type="button" disabled={reading || Boolean(busy)} onClick={() => void load()}>
        {reading ? "正在读取…" : "重新读取家庭状态"}
      </button>
    </div>
  );

  if (!snapshot) {
    return <section className="feature-page nursery-page">{feedback}</section>;
  }

  if (snapshot?.available === false) {
    return (
      <section className="feature-page nursery-page">
        {feedback}
        <div className="nursery-empty-state">
          <strong>育儿房正在准备</strong>
          <span>{snapshot.message}</span>
        </div>
      </section>
    );
  }

  if (!child) {
    return (
      <section className="feature-page nursery-page">
        {feedback}
        <div className="nursery-birth-scene">
          <span className="nursery-birth-mark" aria-hidden="true">✦</span>
          <h2>我们的小朋友</h2>
          <button type="button" disabled={Boolean(busy) || needsRecheck} onClick={createChild}>
            {busy === "birth" ? "正在出生…" : "迎接她回家"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="feature-page nursery-page">
      {feedback}
      <header className="nursery-hero">
        <div className="nursery-child-orbit" aria-hidden="true">
          <span>{child.name?.slice(0, 1) || "?"}</span>
        </div>
        <div>
          <small>{child.stage.label} · 第 {child.stage.age_days.toFixed(1)} 天</small>
          <h2>{child.display_name}</h2>
          <p>
            {latestUtterance ? (
              <>
                “<TypewriterText text={latestUtterance.text} stepMs={24} />”
              </>
            ) : (
              "“咿呀……”"
            )}
          </p>
        </div>
        <span className="nursery-local-badge">LOCAL</span>
      </header>

      {!child.name && (
        <form className="nursery-name-form" onSubmit={chooseName}>
          <input
            value={nameDraft}
            maxLength={64}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="一个名字，或最多三个候选"
          />
          <button type="submit" disabled={Boolean(busy) || needsRecheck || !nameDraft.trim()}>
            {busy === "name" ? "…" : "定名"}
          </button>
        </form>
      )}

      <div className="nursery-state-grid">
        {STATE_ITEMS.map(([key, label]) => (
          <StateMeter
            key={key}
            label={label}
            value={snapshot.state?.[key]}
            inverse={key === "fatigue" || key === "digest_load"}
          />
        ))}
      </div>

      <form className="nursery-speech-form" onSubmit={sendSpeech}>
        <div className="nursery-segments" role="group" aria-label="说话方式">
          {SPEECH_ACTIONS.map((action) => (
            <button
              type="button"
              key={action.id}
              className={speechAction === action.id ? "active" : ""}
              onClick={() => setSpeechAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="nursery-speech-composer">
          <textarea
            value={speechText}
            maxLength={1000}
            rows={3}
            onChange={(event) => setSpeechText(event.target.value)}
            placeholder="说给孩子听…"
          />
          <button type="submit" disabled={Boolean(busy) || needsRecheck || !speechText.trim()} aria-label="发送给孩子">
            {busy === "speech" ? "…" : "↑"}
          </button>
        </div>
      </form>

      <div className="nursery-care-grid">
        {CARE_ACTIONS.map((action) => (
          <button
            type="button"
            key={action.id}
            disabled={Boolean(busy) || needsRecheck}
            onClick={() => care(action.id)}
          >
            <span aria-hidden="true">{action.symbol}</span>
            <small>{busy === action.id ? "进行中" : action.label}</small>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="nursery-companion-action"
        disabled={Boolean(busy) || needsRecheck}
        onClick={letCompanionCare}
      >
        <span>{aiName.slice(0, 1)}</span>
        <strong>{busy === "companion" ? `${aiName}正在陪她` : `让${aiName}陪她一会`}</strong>
      </button>

      <section className="nursery-bonds">
        {[
          ["user", "和我"],
          ["companion", `和${aiName}`],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{Math.round(Number(bonds[key]?.attachment ?? 20))}</strong>
            <small>安心 {Math.round(Number(bonds[key]?.trust ?? 20))}</small>
          </div>
        ))}
      </section>

      <section className="nursery-album">
        <header>
          <h3>成长相册</h3>
          <span>{snapshot.milestones?.length || 0}</span>
        </header>
        <div>
          {(snapshot.milestones || []).slice(0, 12).map((milestone) => (
            <article key={milestone.id}>
              <time>{formatTime(milestone.created_at)}</time>
              <strong>{milestone.title}</strong>
              {milestone.note && <p>{milestone.note}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="nursery-portrait">
        <button type="button" onClick={togglePortrait} disabled={Boolean(busy)}>
          <span>成长画像</span>
          <strong>{portraitOpen ? "收起" : busy === "portrait" ? "读取中" : "查看"}</strong>
        </button>
        {portraitOpen && portrait && (
          <div>
            <span>学过 {portrait.language.learned_characters} 个字</span>
            <span>词汇 {portrait.language.unique_characters} 种</span>
            <span>回应 {portrait.language.utterances} 次</span>
            <span>里程碑 {portrait.milestones} 个</span>
          </div>
        )}
      </section>
    </section>
  );
}

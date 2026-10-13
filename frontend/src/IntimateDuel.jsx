import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";
import { authSession } from "./auth-session.js";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope.js";
import { assertDuelNarration, awaitDuelResponse, duelFailureFeedback } from "./duel-request.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import {
  DUEL_SKILLS,
  beginDuelRound,
  completeDuelRound,
  createDuelState,
  normalizeDuelState,
  skillAvailability,
  winnerLabel,
} from "./intimate-duel";

const STORAGE_KEY = "dengta_intimate_duel_v3";

function duelStorageKey(accountScope = "", companionScope = "") {
  const scope = String(accountScope || "").trim();
  return scope && companionScope ? `${STORAGE_KEY}:${JSON.stringify([scope, companionScope])}` : null;
}

function readStoredDuel(names, storageKey) {
  let stored;
  try {
    stored = storageKey ? localStorage.getItem(storageKey) : null;
  } catch {
    return { duel: createDuelState(names), problem: "duel_archive_read_failed" };
  }
  if (stored === null || stored === undefined) return { duel: createDuelState(names), problem: null };
  try {
    const value = JSON.parse(stored);
    const record = (item) => item && typeof item === "object" && !Array.isArray(item);
    const fighter = (item) => record(item) && typeof item.name === "string" &&
      ["stamina", "pleasure", "combo"].every((field) => Number.isFinite(item[field])) && record(item.cooldowns);
    if (!record(value) || value.version !== 3 || typeof value.id !== "string" || !value.id ||
      !Number.isInteger(value.round) || value.round < 1 || !["active", "finished"].includes(value.status) ||
      !["player", "companion", "draw", null].includes(value.winner) || !fighter(value.player) || !fighter(value.companion) ||
      !Array.isArray(value.logs) || !value.logs.length || value.logs.some((entry) =>
        !record(entry) || typeof entry.id !== "string" || typeof entry.title !== "string" || typeof entry.text !== "string")) {
      return { duel: createDuelState(names), problem: "duel_archive_invalid" };
    }
    const duel = normalizeDuelState(value, names);
    return { duel, savedDuel: duel, problem: null };
  } catch {
    return { duel: createDuelState(names), problem: "duel_archive_invalid" };
  }
}

function FighterCard({ fighter, tone }) {
  return (
    <article className={`duel-fighter-card ${tone}`}>
      <header>
        <span className="duel-avatar" aria-hidden="true">
          {fighter.name.slice(0, 1)}
        </span>
        <div>
          <strong>{fighter.name}</strong>
          <small>{fighter.combo > 1 ? `COMBO ×${fighter.combo}` : "READY"}</small>
        </div>
      </header>
      <div className="duel-meter-row stamina">
        <span>体力</span>
        <strong>{fighter.stamina}/100</strong>
        <div className="duel-meter" aria-label={`体力 ${fighter.stamina}`}>
          <span style={{ width: `${fighter.stamina}%` }} />
        </div>
      </div>
      <div className={`duel-meter-row pleasure${fighter.pleasure >= 78 ? " warning" : ""}`}>
        <span>快感</span>
        <strong>{fighter.pleasure}/100</strong>
        <div className="duel-meter" aria-label={`快感 ${fighter.pleasure}`}>
          <span style={{ width: `${fighter.pleasure}%` }} />
        </div>
      </div>
    </article>
  );
}

export default function IntimateDuel(props) {
  const key = JSON.stringify([props.accountScope || "", props.companionScope || ""]);
  return <DuelSession key={key} {...props} />;
}

function DuelSession({
  aiName,
  userName,
  conversationId,
  accountScope = "",
  companionScope = "",
}) {
  const storageKey = duelStorageKey(accountScope, companionScope);
  const names = useMemo(
    () => ({
      playerName: String(userName || "你").trim() || "你",
      companionName: String(aiName || "伴侣").trim() || "伴侣",
    }),
    [aiName, userName],
  );
  const [initialArchive] = useState(() => readStoredDuel(names, storageKey));
  const [duel, setDuel] = useState(initialArchive.duel);
  const [isNarrating, setIsNarrating] = useState(false);
  const [notice, setNotice] = useState(null);
  const [retrySkill, setRetrySkill] = useState(null);
  const [storageProblem, setStorageProblem] = useState(initialArchive.problem);
  const archiveRef = useRef({ ...initialArchive });
  const logRef = useRef(null);
  const requestRef = useRef(null);
  const lifecycleRef = useRef(null);
  const scope = JSON.stringify([String(accountScope || "").trim(), companionScope || ""]);

  useLayoutEffect(() => {
    const lifecycle = {};
    lifecycleRef.current = lifecycle;
    return () => {
      const request = requestRef.current;
      requestRef.current = null;
      request?.controller.abort();
      window.clearTimeout(request?.timeout);
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!storageKey || isNarrating || archiveRef.current.problem || archiveRef.current.savedDuel === duel ||
      settingsSaveScope(authSession.getSnapshot()) !== scope) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(duel));
      archiveRef.current.savedDuel = duel;
    } catch {
      archiveRef.current.problem = "duel_archive_write_failed";
      const lifecycle = lifecycleRef.current;
      queueMicrotask(() => {
        if (lifecycleRef.current === lifecycle && archiveRef.current.problem === "duel_archive_write_failed" &&
          settingsSaveScope(authSession.getSnapshot()) === scope) setStorageProblem("duel_archive_write_failed");
      });
    }
  }, [storageKey, scope, duel, isNarrating]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "auto" });
  }, [duel.logs, isNarrating]);

  function rereadArchive() {
    if (!storageKey || !lifecycleRef.current || requestRef.current || isNarrating ||
      settingsSaveScope(authSession.getSnapshot()) !== scope) return;
    const archive = readStoredDuel(names, storageKey);
    archiveRef.current = archive;
    setStorageProblem(archive.problem);
    if (archive.problem) return;
    setDuel(archive.duel);
    setNotice(null);
    setRetrySkill(null);
  }

  function restart() {
    const request = requestRef.current;
    requestRef.current = null;
    request?.controller.abort();
    window.clearTimeout(request?.timeout);
    setDuel(createDuelState(names));
    setIsNarrating(false);
    setNotice(null);
    setRetrySkill(null);
  }

  function cancelRound() {
    const request = requestRef.current;
    if (!request) return;
    requestRef.current = null;
    request.controller.abort();
    window.clearTimeout(request.timeout);
    setDuel(request.pending.current);
    setIsNarrating(false);
    setNotice({ message: "本回合已取消，体力与回合已恢复。已发出的模型请求可能仍在运行。" });
    setRetrySkill(null);
  }

  async function handleSkill(skill) {
    if (requestRef.current || isNarrating || duel.status !== "active" || !storageKey ||
      settingsSaveScope(authSession.getSnapshot()) !== scope) return;
    if (!skillAvailability(duel.player, skill).available) return;
    const controller = new AbortController();
    const request = { controller, lifecycle: lifecycleRef.current, pending: null, timedOut: false };
    requestRef.current = request;
    request.timeout = window.setTimeout(() => { request.timedOut = true; controller.abort(); }, 90_000);
    const isCurrent = () => requestRef.current === request && lifecycleRef.current === request.lifecycle &&
      settingsSaveScope(authSession.getSnapshot()) === scope;
    let pending;
    try {
      pending = beginDuelRound(duel, skill.id);
      request.pending = pending;
      setDuel(pending.previewState);
      setIsNarrating(true);
      setNotice(null);
      setRetrySkill(null);
      const turn = pending.turn;
      const data = await awaitDuelResponse(apiRequest("/api/v2/intimate-duel/narrate", {
        method: "POST",
        signal: controller.signal,
        authSession: createScopedSettingsSession(authSession, scope, controller.signal),
        retry: false,
        body: JSON.stringify({
          conversation_id: conversationId || undefined,
          duel_id: pending.current.id,
          round: turn.round,
          player_name: turn.player.name,
          companion_name: turn.companion.name,
          player_skill: turn.playerSkill.id,
          companion_skill: null,
          available_companion_skills: turn.availableCompanionSkills,
          player: {
            stamina: turn.player.stamina,
            pleasure: turn.player.pleasure,
          },
          companion: {
            stamina: turn.companion.stamina,
            pleasure: turn.companion.pleasure,
          },
          player_combo: turn.playerCombo,
          companion_combo: turn.companionCombo,
          winner: turn.winner,
        }),
      }), controller.signal);
      if (!isCurrent()) return;
      assertDuelNarration(data, turn);
      const result = completeDuelRound(pending, {
        companionSkillId: data?.companion_skill || null,
        reaction: data?.reaction || "",
        narration: data?.narration || "",
      });
      setDuel(result.state);
    } catch (error) {
      if (!isCurrent()) return;
      setDuel(pending?.current || duel);
      setRetrySkill(skill);
      const feedback = duelFailureFeedback(request.timedOut ? { code: "duel_request_timeout" } : error);
      if (["duel_response_invalid", "duel_narration_missing", "duel_request_timeout"].includes(feedback.code)) {
        recordOperationFailure(scope, "/api/v2/intimate-duel/narrate", {
          code: feedback.code, status: feedback.status, error_log_id: feedback.logId,
        });
      }
      setNotice({ ...feedback, message: `本回合未完成，体力与回合已恢复。${feedback.message}` });
    } finally {
      window.clearTimeout(request.timeout);
      if (requestRef.current === request) {
        requestRef.current = null;
        if (lifecycleRef.current === request.lifecycle) setIsNarrating(false);
      }
    }
  }

  return (
    <section className="feature-page intimate-duel" aria-label="成人双人回合对战">
      <header className="duel-stage-header">
        <div>
          <span>ADULT PRIVATE MATCH</span>
          <h2>{duel.status === "finished" ? winnerLabel(duel) : `ROUND ${duel.round}`}</h2>
        </div>
        <button type="button" className="duel-restart" onClick={restart}>
          {duel.status === "finished" ? "再来一局" : "重新开始"}
        </button>
      </header>

      <p className="duel-help">选择招式 → 查看伴侣回应 → 进入下一回合。等待时可以取消，不会扣除本回合体力。</p>
      {storageProblem && (
        <div role="status">
          <p>
            {storageProblem === "duel_archive_invalid"
              ? "本机存档格式无法识别，原存档未被覆盖。"
              : storageProblem === "duel_archive_read_failed"
                ? "本机存档不可用，读取失败，原存档未被覆盖。"
                : "本机存档不可用，当前进度未保存。"}
            当前仍可继续；临时进度在离开后可能无法恢复。重新读取成功后，将用本机存档替换临时进度。
            <small>（错误代码：{storageProblem}）</small>
          </p>
          <button type="button" className="duel-restart" disabled={isNarrating} onClick={rereadArchive}>重新读取本机存档</button>
        </div>
      )}
      {!storageKey && <p role="status">登录并选择伴侣后，再开始互动挑战。</p>}

      <div className="duel-fighters">
        <FighterCard fighter={duel.player} tone="player" />
        <FighterCard fighter={duel.companion} tone="companion" />
      </div>

      <section ref={logRef} className="duel-log" aria-live="polite">
        {duel.logs.map((entry) => (
            <article key={entry.id} className={entry.kind}>
              <small>{entry.title}</small>
              {entry.reaction && (
                <div className="duel-visible-reaction">
                  <small>{duel.companion.name}此刻的反应</small>
                  <span>{entry.reaction}</span>
                </div>
              )}
              <p>{entry.text}</p>
            </article>
        ))}
        {isNarrating && (
          <div className="duel-narrating" role="status">
            <span aria-hidden="true" />
            {duel.companion.name}正在感受这一招并选择回应…
          </div>
        )}
      </section>

      {notice && (
        <div className="duel-notice" role="status">
          <span>
            {notice.message}
            {notice.code && <small>（错误代码：{notice.code}{notice.status ? `；HTTP ${notice.status}` : ""}）</small>}
            {notice.logId && <small>日志编号：{notice.logId}。可在设置的错误日志中核对。</small>}
          </span>
          <button type="button" aria-label="关闭提示" onClick={() => { setNotice(null); setRetrySkill(null); }}>×</button>
        </div>
      )}

      {(isNarrating || retrySkill) && (
        <div className="duel-recovery-actions">
          {isNarrating
            ? <button type="button" className="duel-restart" onClick={cancelRound}>取消本回合</button>
            : <button type="button" className="duel-restart" onClick={() => handleSkill(retrySkill)}>重试这一招</button>}
        </div>
      )}

      <section className="duel-skills" aria-label="选择招式">
        <h3>{duel.status === "finished" ? "本局已经结束" : "选择你的招式"}</h3>
        <div className="duel-skill-grid">
          {DUEL_SKILLS.map((skill) => {
            const availability = skillAvailability(duel.player, skill);
            const disabled = !availability.available || isNarrating || duel.status !== "active" || !storageKey;
            return (
              <button
                type="button"
                key={skill.id}
                className={skill.kind}
                disabled={disabled}
                onClick={() => handleSkill(skill)}
              >
                <span className="duel-skill-heading">
                  <strong>{skill.name}</strong>
                  <em>
                    {availability.reason === "cooldown"
                      ? `${availability.cooldown} 回合`
                      : availability.reason === "stamina"
                        ? "体力不足"
                      : availability.reason === "full"
                        ? "已恢复"
                      : skill.kind === "recover"
                        ? "恢复"
                        : `-${skill.staminaCost} 体力`}
                  </em>
                </span>
                <small>{skill.description}</small>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}

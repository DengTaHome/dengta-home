import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";
import {
  PROFILE_IDENTITY_FIELDS,
  PROFILE_STABLE_FIELDS,
  createProfileActionId,
  describeProfileChanges,
  hasLearnedProfileDetails,
  normalizeProfilePayload,
} from "./companion-profile";

function formatProfileTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function identityLabel(field) {
  return (
    PROFILE_IDENTITY_FIELDS.find((item) => item.key === field)?.label ||
    "身份信息"
  );
}

export default function CompanionProfile({
  aiName = "伴侣",
  onNotice,
  onOpenCreativeStudio,
}) {
  const [payload, setPayload] = useState(() => normalizeProfilePayload());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [expandedVersion, setExpandedVersion] = useState(null);
  const [restoreCandidate, setRestoreCandidate] = useState(null);

  const loadProfile = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/api/v2/companion-profile");
      setPayload(normalizeProfilePayload(data));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/v2/companion-profile")
      .then((data) => {
        if (!cancelled) setPayload(normalizeProfilePayload(data));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmIdentity(proposal) {
    setBusyAction(`identity:${proposal.id}`);
    try {
      await apiRequest("/api/v2/companion-profile/identity/confirm", {
        method: "POST",
        body: JSON.stringify({
          proposal_ids: [proposal.id],
          client_action_id: createProfileActionId(),
        }),
      });
      await loadProfile({ silent: true });
      onNotice?.(`已把“${proposal.proposed_value}”写进角色档案。`);
    } catch (actionError) {
      await loadProfile({ silent: true });
      onNotice?.(actionError.message);
    } finally {
      setBusyAction("");
    }
  }

  async function restoreVersion(version) {
    setBusyAction(`restore:${version}`);
    try {
      await apiRequest(
        `/api/v2/companion-profile/versions/${version}/restore`,
        {
          method: "POST",
          body: JSON.stringify({
            client_action_id: createProfileActionId(),
          }),
        },
      );
      await loadProfile({ silent: true });
      setRestoreCandidate(null);
      onNotice?.(`已恢复角色档案版本 ${version}，原版本仍保留在历史里。`);
    } catch (actionError) {
      await loadProfile({ silent: true });
      onNotice?.(actionError.message);
    } finally {
      setBusyAction("");
    }
  }

  const profile = payload.profile;
  const learned = hasLearnedProfileDetails(profile);

  return (
    <section className="companion-profile" aria-labelledby="profile-title">
      <div className="companion-profile-hero">
        <div className="companion-profile-avatar" aria-label={`${aiName}的头像占位`}>
          <span>{Array.from(aiName)[0] || "灯"}</span>
          <small>头像还在构思</small>
        </div>
        <div className="companion-profile-intro">
          <span className="eyebrow">会随相处慢慢长大的档案</span>
          <h2 id="profile-title">{aiName}，正在认识自己</h2>
          <p>{profile.introduction}</p>
          <div className="companion-profile-meta">
            <span>
              {payload.latest_version
                ? `档案 v${payload.latest_version}`
                : "还没有形成第一个版本"}
            </span>
            <span>长期特征需 3 条消息 · 跨 2 次对话</span>
          </div>
        </div>
        <button
          type="button"
          className="companion-profile-refresh"
          disabled={loading}
          onClick={() => loadProfile()}
        >
          {loading ? "读取中…" : "刷新档案"}
        </button>
      </div>

      {error && (
        <div className="companion-profile-error" role="status">
          <strong>角色档案暂时没有读到</strong>
          <p>{error}</p>
          <button type="button" onClick={() => loadProfile()}>
            再试一次
          </button>
        </div>
      )}

      {!error && loading ? (
        <div className="companion-profile-loading" role="status">
          正在翻一翻我们聊过的事情…
        </div>
      ) : (
        !error && (
          <>
            {profile.current_mood && (
              <article className="profile-mood-card">
                <span className="profile-mood-symbol" aria-hidden="true">
                  ♡
                </span>
                <div>
                  <small>只属于此刻的心情</small>
                  <strong>{profile.current_mood.label}</strong>
                  {profile.current_mood.note && (
                    <p>{profile.current_mood.note}</p>
                  )}
                  <span>
                    {profile.current_mood.expires_at
                      ? `这份心情会在 ${formatProfileTime(
                          profile.current_mood.expires_at,
                        )} 后淡出`
                      : "心情只会短暂停留"}
                  </span>
                </div>
              </article>
            )}

            <div className="profile-section-heading">
              <div>
                <span className="eyebrow">被聊天证明过的我</span>
                <h3>性格与偏好</h3>
              </div>
              <small>{learned ? "只记录重复出现的线索" : "还在慢慢认识"}</small>
            </div>
            <div className="profile-trait-grid">
              {PROFILE_STABLE_FIELDS.map((field) => (
                <article className="profile-trait-card" key={field.key}>
                  <span>{field.label}</span>
                  {profile.stable[field.key].length ? (
                    <div className="profile-tag-list">
                      {profile.stable[field.key].map((item) => (
                        <em key={item}>{item}</em>
                      ))}
                    </div>
                  ) : (
                    <p>还没聊到足够多，先不乱猜。</p>
                  )}
                </article>
              ))}
            </div>

            <div className="profile-identity-card">
              <div className="profile-section-heading">
                <div>
                  <span className="eyebrow">由我和你一起确认</span>
                  <h3>身份与关系</h3>
                </div>
                <small>后台不会擅自改写</small>
              </div>
              <dl>
                {PROFILE_IDENTITY_FIELDS.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{profile.identity[field.key] || "暂时不想定义"}</dd>
                  </div>
                ))}
              </dl>
              {profile.pending_identity_changes.length > 0 && (
                <div className="profile-proposal-list">
                  <strong>{aiName}有一些新的自我理解，想先问问你</strong>
                  {profile.pending_identity_changes.map((proposal) => (
                    <div className="profile-proposal" key={proposal.id}>
                      <div>
                        <small>{identityLabel(proposal.field)}</small>
                        <p>{proposal.proposed_value}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => confirmIdentity(proposal)}
                      >
                        {busyAction === `identity:${proposal.id}`
                          ? "写入中…"
                          : "确认写入"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {onOpenCreativeStudio && <button type="button" className="profile-art-studio-link" onClick={onOpenCreativeStudio}>打开涂鸦画室 · 头像、涂鸦与小礼物</button>}

            <div className="profile-section-heading profile-history-heading">
              <div>
                <span className="eyebrow">最多保留 30 个版本</span>
                <h3>档案成长记录</h3>
              </div>
              <small>恢复不会删除现在的版本</small>
            </div>
            <div className="profile-version-list">
              {payload.versions.length === 0 ? (
                <div className="profile-version-empty">
                  我们还没有积累出足够稳定的线索。再聊一阵子，这里才会出现第一页。
                </div>
              ) : (
                payload.versions.map((entry, index) => {
                  const previous = payload.versions[index + 1];
                  const changes = describeProfileChanges(
                    entry.profile,
                    previous?.profile,
                  );
                  const isExpanded = expandedVersion === entry.version;
                  const isLatest = index === 0;
                  const isConfirmingRestore =
                    restoreCandidate === entry.version;
                  return (
                    <article className="profile-version-card" key={entry.id}>
                      <div className="profile-version-summary">
                        <div>
                          <strong>
                            v{entry.version}
                            {isLatest && <em>当前</em>}
                          </strong>
                          <small>{formatProfileTime(entry.created_at)}</small>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedVersion(
                              isExpanded ? null : entry.version,
                            )
                          }
                        >
                          {isExpanded ? "收起" : "查看比较"}
                        </button>
                      </div>
                      <p>
                        {entry.change_reason || "这一版没有留下额外说明。"}
                      </p>
                      <div className="profile-version-changes">
                        {(changes.length ? changes : ["初始档案"]).map(
                          (change) => (
                            <span key={change}>{change}</span>
                          ),
                        )}
                      </div>
                      {isExpanded && (
                        <div className="profile-version-detail">
                          <p>{entry.profile.introduction}</p>
                          <dl>
                            {PROFILE_STABLE_FIELDS.map((field) => (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>
                                  {entry.profile.stable[field.key].join("、") ||
                                    "未记录"}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {!isLatest &&
                            (isConfirmingRestore ? (
                              <div className="profile-restore-confirm">
                                <span>恢复到 v{entry.version}？</span>
                                <button
                                  type="button"
                                  onClick={() => setRestoreCandidate(null)}
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(busyAction)}
                                  onClick={() => restoreVersion(entry.version)}
                                >
                                  {busyAction === `restore:${entry.version}`
                                    ? "恢复中…"
                                    : "确认恢复"}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="profile-restore-button"
                                onClick={() =>
                                  setRestoreCandidate(entry.version)
                                }
                              >
                                恢复这一版
                              </button>
                            ))}
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </>
        )
      )}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "./api";
import { authSession } from "./auth-session";
import { createScopedSettingsSession, settingsSaveScope } from "./settings-save-scope";
import {
  buildCcSwitchBridgeHtml,
  buildCcSwitchDeepLink,
  ccSwitchBridgeFileName,
  ccSwitchTargetsForProtocol,
} from "./cc-switch-bridge";
import {
  beijingDateTimeInputValue,
  beijingDateTimePayload,
  formatBeijingDateTime,
  providerHealthView,
  providerIsExpired,
  providerIsRoutable,
} from "./ai-provider-health";
import {
  reasoningEffortForProvider,
  reasoningEffortOptions,
} from "./provider-reasoning-effort";
import {
  providerCredentialNeedsRecovery,
  settingsServiceErrorDetail,
  settingsServiceErrorMessage,
} from "./settings-service-errors";

const PROTOCOL_OPTIONS = [
  {
    value: "openai-chat",
    label: "OpenAI Chat 兼容接口",
    help: "适合 New API、LiteLLM 和大多数中转站，聊天请求使用 /v1/chat/completions。",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses / Sub2API / Codex 网关",
    help: "适合明确要求 Responses 协议的网关，聊天请求使用 /v1/responses。",
  },
  {
    value: "anthropic",
    label: "Claude / Anthropic 原生接口",
    help: "直接使用 Anthropic Messages 协议，不是 OpenAI 兼容模式。",
  },
  {
    value: "gemini",
    label: "Gemini 原生接口",
    help: "直接使用 Google Gemini generateContent 协议。",
  },
];

const EMPTY_PROVIDER_DRAFT = {
  name: "",
  protocol: "openai-chat",
  base_url: "",
  auth_type: "bearer",
  credential: "",
  default_model: "",
  reasoning_effort: "",
  enabled: false,
  is_default: false,
  priority: 100,
  billing_url: "",
  expires_at: "",
  notes: "",
};

function protocolLabel(value) {
  return PROTOCOL_OPTIONS.find((item) => item.value === value)?.label || value;
}

function providerErrorMessage(code, fallback) {
  const message = settingsServiceErrorMessage({ code, message: fallback }, fallback);
  return typeof message === "string" ? message : fallback;
}

async function requestAiProvider(
  path,
  { method = "GET", body, signal, authSession: scopedSession } = {},
) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await apiFetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      retry: false,
      signal,
      authSession: scopedSession,
    });
  } catch (error) {
    throw new Error(
      providerErrorMessage(
        error?.code,
        "无法连接 DengTa 后端，请稍后再试 / Unable to connect to the DengTa backend. Try again shortly.",
      ),
      { cause: error },
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const rawCode = data.error || data.code;
    const code = typeof rawCode === "string" && /^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(rawCode)
      ? rawCode : "AI_PROVIDER_REQUEST_FAILED";
    const error = new Error(
      providerErrorMessage(
        code,
        `请求失败（HTTP ${response.status}）/ Request failed (HTTP ${response.status}).`,
      ),
    );
    error.code = code;
    error.status = response.status;
    error.upstreamStatus = data.upstream_status;
    throw error;
  }
  return data;
}

function inputDateTime(value) {
  return beijingDateTimeInputValue(value);
}

function payloadDateTime(value) {
  return beijingDateTimePayload(value);
}

function providerPayload(profile) {
  return {
    name: profile.name,
    protocol: profile.protocol,
    base_url: profile.base_url,
    auth_type: profile.auth_type,
    credential: profile.credential || "",
    default_model: profile.default_model,
    reasoning_effort: reasoningEffortForProvider(
      profile.protocol,
      profile.reasoning_effort,
    ),
    enabled: profile.enabled === true,
    is_default: profile.is_default === true && !providerIsExpired(profile),
    priority: Number(profile.priority) || 100,
    billing_url: profile.billing_url || "",
    expires_at: payloadDateTime(profile.expires_at),
    notes: profile.notes || "",
  };
}

function catalogLabel(profile) {
  return providerHealthView(profile).label;
}

function ProviderExpiryBadge({ value }) {
  const formatted = formatBeijingDateTime(value);
  if (!formatted) return null;
  return <span>到期（北京时间）：{formatted}</span>;
}

function ProviderHealthSummary({ profile }) {
  const health = providerHealthView(profile);
  return (
    <section
      className={`provider-health provider-health-${health.state}`}
      aria-label={`接口健康状态：${health.label}`}
    >
      <span className="provider-health-indicator">{health.label}</span>
      <div>
        <strong>{health.summary}</strong>
        <p>{health.detail}</p>
        <time dateTime={health.checkedAtIso || undefined}>{health.checkedAtLabel}</time>
      </div>
    </section>
  );
}

function ProviderFields({ value, onChange, models = [], editing = false }) {
  const protocol = PROTOCOL_OPTIONS.find((item) => item.value === value.protocol);
  const effortOptions = reasoningEffortOptions(value.protocol);
  const reasoningHelp = value.protocol === "openai-responses"
    ? "作为 reasoning.effort 发送。xhigh / max 可能明显增加等待时间与费用；实际请求会写入安全回执。"
    : value.protocol === "openai-chat"
      ? "为保留 DengTa 的函数工具，Chat 兼容接口只能显式使用 none；需要高推理请改用 Responses。"
      : "当前原生协议不使用 OpenAI 推理强度参数。";
  const expired = providerIsExpired(value);
  const modelListId = editing
    ? "provider-models-" + (value.id || "edit")
    : "provider-models-new";
  return (
    <div className="provider-form-grid">
      <label>
        显示名称
        <input
          value={value.name || ""}
          onChange={(event) => onChange("name", event.target.value)}
          placeholder="例如：我的 New API"
          maxLength="80"
        />
        <small>只是给你自己看的名称，不会发给模型。</small>
      </label>
      <label>
        接口类型
        <select
          value={value.protocol || "openai-chat"}
          onChange={(event) => onChange("protocol", event.target.value)}
        >
          {PROTOCOL_OPTIONS.map((item) => (
            <option value={item.value} key={item.value}>{item.label}</option>
          ))}
        </select>
        <small>{protocol?.help}</small>
      </label>
      <label className="provider-wide-field">
        Base URL
        <input
          type="url"
          value={value.base_url || ""}
          onChange={(event) => onChange("base_url", event.target.value)}
          placeholder="https://你的网关域名/v1"
          autoCapitalize="none"
          spellCheck="false"
        />
        <small>填服务商给你的 API 根地址；不要填控制台网页地址、付款页或带账号密码的链接。</small>
      </label>
      <label>
        授权方式
        <select
          value={value.auth_type || "bearer"}
          onChange={(event) => onChange("auth_type", event.target.value)}
        >
          <option value="bearer">Bearer API Key（常用）</option>
          <option value="none">不需要密钥（仅限可信私有网关）</option>
        </select>
        <small>New API、Sub2API 和普通中转通常都选择 Bearer。</small>
      </label>
      {value.auth_type !== "none" && (
        <label>
          {editing ? "更新网关 API Key（可留空）" : "网关 API Key"}
          <input
            type="password"
            value={value.credential || ""}
            onChange={(event) => onChange("credential", event.target.value)}
            placeholder={editing && value.auth_configured
              ? "已加密保存；只在更换密钥时填写"
              : "粘贴服务商生成的 API Key"}
            autoComplete="new-password"
            spellCheck="false"
          />
          <small>这里只能填调用网关用的 API Key，不能填 Cookie、OAuth Refresh Token、auth.json 或卡密 JSON。</small>
        </label>
      )}
      <label>
        默认模型
        <input
          list={modelListId}
          value={value.default_model || ""}
          onChange={(event) => onChange("default_model", event.target.value)}
          placeholder="例如：gpt-5.5"
          autoCapitalize="none"
          spellCheck="false"
        />
        <datalist id={modelListId}>
          {models.map((model) => <option value={model} key={model} />)}
        </datalist>
        <small>模型目录可读取后可从发现的模型中选择；也可按服务商说明手动填写。</small>
      </label>
      <label>
        推理强度
        <select
          value={reasoningEffortForProvider(
            value.protocol,
            value.reasoning_effort,
          )}
          onChange={(event) => onChange("reasoning_effort", event.target.value)}
          disabled={effortOptions.length === 1}
        >
          {effortOptions.map((item) => (
            <option value={item.value} key={item.value || "default"}>{item.label}</option>
          ))}
        </select>
        <small>{reasoningHelp}</small>
      </label>
      <label>
        优先级
        <input
          type="number"
          min="1"
          max="9999"
          value={value.priority || 100}
          onChange={(event) => onChange("priority", event.target.value)}
        />
        <small>数字越小越靠前，仅用于接口排序；当前不会自动切换供应商。</small>
      </label>
      <label>
        到期时间（北京时间，可选）
        <input
          type="datetime-local"
          value={inputDateTime(value.expires_at)}
          onChange={(event) => onChange("expires_at", event.target.value)}
        />
        <small>到期后 DengTa 不再选择这个接口，方便管理临时中转或短期密钥。</small>
      </label>
      <label className="provider-wide-field">
        付款页 / 控制台地址（可选）
        <input
          type="url"
          value={value.billing_url || ""}
          onChange={(event) => onChange("billing_url", event.target.value)}
          placeholder="https://服务商的账单或控制台页面"
        />
        <small>保存后会显示可点击入口；它不会被当成模型接口使用。</small>
      </label>
      <label className="provider-wide-field">
        备注（可选）
        <textarea
          rows="3"
          maxLength="1000"
          value={value.notes || ""}
          onChange={(event) => onChange("notes", event.target.value)}
          placeholder="例如：月付、适合聊天、额度页面在哪里、出现 429 时联系谁……"
        />
      </label>
      <label className="provider-checkbox-row">
        <input
          type="checkbox"
          checked={value.enabled === true}
          onChange={(event) => onChange("enabled", event.target.checked)}
        />
        <span><strong>启用这个接口</strong><small>只有启用且未到期的接口才可能接管聊天。</small></span>
      </label>
      <label className="provider-checkbox-row">
        <input
          type="checkbox"
          checked={value.is_default === true && !expired}
          disabled={expired}
          onChange={(event) => onChange("is_default", event.target.checked)}
        />
        <span>
          <strong>保存后设为下次聊天首选</strong>
          <small>{expired
            ? "该接口已到期，不参与路由；更新到期时间后才能设为首选。"
            : "必须同时启用；它会成为下一次聊天请求优先使用的接口。"}</small>
        </span>
      </label>
    </div>
  );
}

export default function AiProviderCenter({ onStatusChange = null } = {}) {
  const [status, setStatus] = useState({ checking: true });
  const [profiles, setProfiles] = useState([]);
  const [draft, setDraft] = useState({ ...EMPTY_PROVIDER_DRAFT });
  const [draftModels, setDraftModels] = useState([]);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [ccSwitchProfile, setCcSwitchProfile] = useState(null);
  const [ccSwitchTarget, setCcSwitchTarget] = useState("");
  const [ccSwitchApiKey, setCcSwitchApiKey] = useState("");
  const [ccSwitchFeedback, setCcSwitchFeedback] = useState("");
  const scopeRef = useRef(null);
  const operationRef = useRef(null);
  const profileReadRevisionRef = useRef(0);
  const statusReadRevisionRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const profileEditsRef = useRef(new Map());

  function isCurrent(scope = scopeRef.current) {
    return scope && scopeRef.current === scope && !scope.controller.signal.aborted &&
      settingsSaveScope(authSession.getSnapshot()) === scope.key;
  }

  const aiProviderRequest = useCallback((path, options = {}) => {
    const scope = scopeRef.current;
    if (!scope || scope.controller.signal.aborted || settingsSaveScope(authSession.getSnapshot()) !== scope.key) {
      return Promise.reject(new Error("本次设置操作已取消。"));
    }
    return requestAiProvider(path, {
      ...options,
      signal: scope.controller.signal,
      authSession: createScopedSettingsSession(authSession, scope.key, scope.controller.signal),
    });
  }, []);

  function startOperation(name) {
    if (operationRef.current || !isCurrent()) return null;
    const operation = { name, scope: scopeRef.current };
    operationRef.current = operation;
    setBusy(name);
    setFeedback("");
    return operation;
  }

  function operationCurrent(operation) {
    return operationRef.current === operation && isCurrent(operation.scope);
  }

  function finishOperation(operation) {
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    if (isCurrent(operation.scope)) setBusy("");
  }

  function mergeProfileEdits(nextProfiles) {
    return nextProfiles.map(profile => ({ ...profile, ...profileEditsRef.current.get(profile.id) }));
  }

  function clearSavedProfileEdits(profile) {
    const edits = { ...profileEditsRef.current.get(profile.id) };
    for (const field of Object.keys(edits)) if (edits[field] === profile[field]) delete edits[field];
    if (Object.keys(edits).length) profileEditsRef.current.set(profile.id, edits);
    else profileEditsRef.current.delete(profile.id);
  }

  async function refreshStatus() {
    const scope = scopeRef.current;
    const revision = ++statusReadRevisionRef.current;
    try {
      const data = await aiProviderRequest("/api/ai-providers/status");
      if (!isCurrent(scope) || revision !== statusReadRevisionRef.current) return;
      setStatus({ ...data, checking: false });
      onStatusChange?.(data);
      return data;
    } catch (error) {
      if (!isCurrent(scope) || revision !== statusReadRevisionRef.current) return;
      const failed = { checking: false, available: null, message: error.message };
      setStatus(failed);
      onStatusChange?.(failed);
      return failed;
    }
  }

  async function refreshProfiles() {
    const scope = scopeRef.current;
    const revision = ++profileReadRevisionRef.current;
    const data = await aiProviderRequest("/api/ai-providers/manage");
    if (!isCurrent(scope) || revision !== profileReadRevisionRef.current) return;
    const nextProfiles = mergeProfileEdits(Array.isArray(data.profiles) ? data.profiles : []);
    setProfiles(nextProfiles);
    return nextProfiles;
  }

  async function refreshProfilesAfterProbeFailure() {
    try {
      await refreshProfiles();
    } catch {
      // Preserve the probe error; a list refresh failure must not hide it.
    }
    await refreshStatus();
  }

  async function refreshCenter() {
    const operation = startOperation("refresh");
    if (!operation) return;
    try {
      const [statusResult, profilesResult] = await Promise.allSettled([refreshStatus(), refreshProfiles()]);
      if (!operationCurrent(operation)) return;
      const failures = [statusResult.status === "fulfilled" && statusResult.value?.available === null
        ? statusResult.value.message : "", profilesResult.status === "rejected" ? profilesResult.reason.message : ""].filter(Boolean);
      setFeedback(failures.length ? `列表刷新失败，请稍后重试。\n${failures.join("\n")}` : "接口列表与状态已刷新。");
    } finally {
      finishOperation(operation);
    }
  }

  useEffect(() => {
    let active = true;
    const scope = { key: settingsSaveScope(authSession.getSnapshot()), controller: new AbortController() };
    scopeRef.current = scope;
    const statusRevision = ++statusReadRevisionRef.current;
    const profileRevision = ++profileReadRevisionRef.current;
    Promise.allSettled([
      aiProviderRequest("/api/ai-providers/status"),
      aiProviderRequest("/api/ai-providers/manage"),
    ])
      .then(([statusResult, profilesResult]) => {
        if (!active || !isCurrent(scope)) return;
        if (!operationRef.current) setBusy("");
        if (statusResult.status === "fulfilled" && statusRevision === statusReadRevisionRef.current) {
          setStatus({ ...statusResult.value, checking: false });
          onStatusChange?.(statusResult.value);
        } else if (statusResult.status === "rejected" && statusRevision === statusReadRevisionRef.current) {
          const failed = {
            checking: false,
            available: null,
            message: statusResult.reason.message,
          };
          setStatus(failed);
          onStatusChange?.(failed);
        }
        if (profilesResult.status === "fulfilled" && profileRevision === profileReadRevisionRef.current) {
          setProfiles(
            mergeProfileEdits(Array.isArray(profilesResult.value.profiles)
              ? profilesResult.value.profiles
              : []),
          );
        }
        const failures = [statusRevision === statusReadRevisionRef.current ? statusResult : null,
          profileRevision === profileReadRevisionRef.current ? profilesResult : null].filter(Boolean)
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason.message);
        if (failures.length > 0) setFeedback([...new Set(failures)].join("\n"));
      });
    return () => {
      active = false;
      scope.controller.abort();
      if (scopeRef.current === scope) operationRef.current = null;
    };
  }, [onStatusChange, aiProviderRequest]);

  const routableCount = useMemo(
    () => profiles.filter((profile) => providerIsRoutable(profile)).length,
    [profiles],
  );

  function updateDraft(field, value) {
    draftRevisionRef.current += 1;
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "protocol") {
        next.reasoning_effort = reasoningEffortForProvider(
          value,
          current.reasoning_effort,
        );
      }
      return next;
    });
    if (["base_url", "protocol", "credential", "auth_type"].includes(field)) {
      setDraftModels([]);
    }
  }

  function editProfile(id, field, value) {
    profileEditsRef.current.set(id, { ...profileEditsRef.current.get(id), [field]: value });
    if (field === "is_default" && value === true) {
      profiles.filter(profile => profile.id !== id).forEach(profile => {
        profileEditsRef.current.set(profile.id, { ...profileEditsRef.current.get(profile.id), is_default: false });
      });
    }
    setProfiles((current) => current.map((profile) => {
      if (profile.id === id) {
        const next = { ...profile, [field]: value };
        if (field === "protocol") {
          next.reasoning_effort = reasoningEffortForProvider(
            value,
            profile.reasoning_effort,
          );
          profileEditsRef.current.set(id, { ...profileEditsRef.current.get(id), reasoning_effort: next.reasoning_effort });
        }
        return next;
      }
      if (field === "is_default" && value === true) {
        return { ...profile, is_default: false };
      }
      return profile;
    }));
  }

  function openCcSwitchBridge(profile) {
    const target = ccSwitchTargetsForProtocol(profile.protocol)[0];
    setCcSwitchProfile({ ...profile });
    setCcSwitchTarget(target.value);
    setCcSwitchApiKey(profile.credential || "");
    setCcSwitchFeedback("");
  }

  function closeCcSwitchBridge() {
    setCcSwitchProfile(null);
    setCcSwitchTarget("");
    setCcSwitchApiKey("");
    setCcSwitchFeedback("");
  }

  function currentCcSwitchLink() {
    return buildCcSwitchDeepLink({
      name: ccSwitchProfile?.name,
      protocol: ccSwitchProfile?.protocol,
      baseUrl: ccSwitchProfile?.base_url,
      apiKey: ccSwitchApiKey,
      model: ccSwitchProfile?.default_model,
      targetApp: ccSwitchTarget,
    });
  }

  function launchCcSwitch() {
    try {
      const link = currentCcSwitchLink();
      setCcSwitchFeedback("正在请求打开 CC Switch，请在应用里核对配置并确认导入。");
      window.location.href = link;
      window.setTimeout(() => setCcSwitchApiKey(""), 1200);
    } catch (error) {
      setCcSwitchFeedback(error.message);
    }
  }

  async function copyCcSwitchLink() {
    try {
      const link = currentCcSwitchLink();
      await navigator.clipboard.writeText(link);
      setCcSwitchFeedback("一次性导入链接已复制。链接包含 API Key，请勿发送给别人，用完后覆盖剪贴板。");
    } catch (error) {
      setCcSwitchFeedback(error?.message || "浏览器不允许复制，请直接使用打开按钮。");
    }
  }

  function downloadCcSwitchBridge() {
    try {
      const html = buildCcSwitchBridgeHtml(ccSwitchProfile, ccSwitchTarget);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ccSwitchBridgeFileName(ccSwitchProfile);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setCcSwitchFeedback("离线桥接文件已下载，文件内没有 API Key。传到装有 CC Switch 的电脑后直接打开。");
    } catch (error) {
      setCcSwitchFeedback(error.message || "生成离线桥接文件失败。");
    }
  }

  async function testDraft() {
    const operation = startOperation("test-draft");
    if (!operation) return;
    const submitted = { ...draft };
    const revision = draftRevisionRef.current;
    try {
      const data = await aiProviderRequest("/api/ai-providers/manage/test", {
        method: "POST",
        body: providerPayload(submitted),
      });
      if (!operationCurrent(operation) || revision !== draftRevisionRef.current) return;
      setDraftModels(data.models || []);
      setFeedback("模型目录可读取，发现 " + (data.models?.length || 0) + " 个模型。检查不会保存密钥。");
    } catch (error) {
      if (!operationCurrent(operation) || revision !== draftRevisionRef.current) return;
      setDraftModels([]);
      setFeedback(
        settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  async function createProfile(event) {
    event.preventDefault();
    const operation = startOperation("create");
    if (!operation) return;
    const submitted = { ...draft };
    const revision = draftRevisionRef.current;
    let saved = false;
    try {
      await aiProviderRequest("/api/ai-providers/manage", {
        method: "POST",
        body: providerPayload(submitted),
      });
      saved = true;
      if (!operationCurrent(operation)) return;
      setDraft(current => Object.keys(submitted).every(field => current[field] === submitted[field])
        ? { ...EMPTY_PROVIDER_DRAFT } : current);
      if (revision === draftRevisionRef.current) setDraftModels([]);
      await refreshProfiles();
      if (!operationCurrent(operation)) return;
      setFeedback("接口已加密保存。启用并设为下次聊天首选后，新的聊天请求才会优先使用它。");
      await refreshStatus();
    } catch (error) {
      if (!operationCurrent(operation)) return;
      setFeedback(
        (saved
          ? "接口已加密保存，列表刷新失败。请先刷新接口列表核对，勿重复保存。"
          : "保存结果尚未确认。请先刷新接口列表核对，勿重复保存。") + "\n" +
          settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  async function saveProfile(profile) {
    const operation = startOperation("save-" + profile.id);
    if (!operation) return;
    const submitted = { ...profile };
    let saved = false;
    try {
      await aiProviderRequest("/api/ai-providers/manage/" + profile.id, {
        method: "PUT",
        body: providerPayload(submitted),
      });
      saved = true;
      if (!operationCurrent(operation)) return;
      clearSavedProfileEdits(submitted);
      await refreshProfiles();
      if (!operationCurrent(operation)) return;
      setFeedback("接口设置已保存，并会用于下一次新的模型请求。");
      await refreshStatus();
    } catch (error) {
      if (!operationCurrent(operation)) return;
      setFeedback(
        (saved
          ? "接口设置已保存，列表刷新失败。请先刷新接口列表核对。"
          : "保存结果尚未确认。请先刷新接口列表核对后再重试。") + "\n" +
          settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  async function testProfile(profile) {
    const operation = startOperation("test-" + profile.id);
    if (!operation) return;
    try {
      const data = await aiProviderRequest(
        "/api/ai-providers/manage/" + profile.id + "/test",
        { method: "POST" },
      );
      if (!operationCurrent(operation)) return;
      await refreshProfiles();
      if (!operationCurrent(operation)) return;
      setFeedback("模型目录可读取，发现 " + (data.models?.length || 0) + " 个模型。");
      await refreshStatus();
    } catch (error) {
      if (!operationCurrent(operation)) return;
      await refreshProfilesAfterProbeFailure();
      if (!operationCurrent(operation)) return;
      setFeedback(
        settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  async function makeDefault(profile) {
    const operation = startOperation("default-" + profile.id);
    if (!operation) return;
    const submittedDefaults = new Map([...profileEditsRef.current].map(([id, edits]) => [id, edits.is_default]));
    let saved = false;
    try {
      await aiProviderRequest(
        "/api/ai-providers/manage/" + profile.id + "/default",
        { method: "POST" },
      );
      saved = true;
      if (!operationCurrent(operation)) return;
      for (const [id, edits] of profileEditsRef.current) {
        if (submittedDefaults.has(id) && submittedDefaults.get(id) === edits.is_default) {
          const nextEdits = { ...edits };
          delete nextEdits.is_default;
          profileEditsRef.current.set(id, nextEdits);
        }
      }
      await refreshProfiles();
      if (!operationCurrent(operation)) return;
      setFeedback("下次聊天首选已更新；这不表示接口正在运行，新的聊天请求才会使用它。");
      await refreshStatus();
    } catch (error) {
      if (!operationCurrent(operation)) return;
      setFeedback(
        (saved
          ? "下次聊天首选已更新，列表刷新失败。请先刷新接口列表核对。"
          : "首选更新结果尚未确认。请先刷新接口列表核对后再重试。") + "\n" +
          settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  async function removeProfile(profile) {
    if (!window.confirm("确定删除接口“" + profile.name + "”吗？删除后密钥无法恢复。")) return;
    const operation = startOperation("delete-" + profile.id);
    if (!operation) return;
    let deleted = false;
    try {
      await aiProviderRequest("/api/ai-providers/manage/" + profile.id, {
        method: "DELETE",
      });
      deleted = true;
      if (!operationCurrent(operation)) return;
      profileEditsRef.current.delete(profile.id);
      await refreshProfiles();
      if (!operationCurrent(operation)) return;
      setFeedback("接口及其加密密钥已删除。");
      await refreshStatus();
    } catch (error) {
      if (!operationCurrent(operation)) return;
      setFeedback(
        (deleted
          ? "接口及其加密密钥已删除，列表刷新失败。请先刷新接口列表核对。"
          : "删除结果尚未确认。请先刷新接口列表核对后再重试。") + "\n" +
          settingsServiceErrorDetail(error, "供应商请求失败 / Provider request failed."),
      );
    } finally {
      finishOperation(operation);
    }
  }

  return (
    <div className="settings-card ai-provider-center">
      <div className="provider-center-heading">
        <div>
          <span className="settings-kicker">模型接入</span>
          <h3>多供应商 API 控制台</h3>
          <p>统一管理正规 API、自建 New API、Sub2API、CPA 或其他兼容网关。这里保存的接口会真实接入聊天后端。</p>
          <p>API Key 只发送到后端加密保存，页面不会回显已保存的密钥。</p>
        </div>
        <span className={status.available ? "provider-state ready" : "provider-state pending"}>
          {status.checking ? "检查中" : status.available === true ? "数据库已就绪" : status.available === false ? "等待数据库迁移" : "状态未确认"}
        </span>
      </div>

      <div className="provider-safety-note" role="note">
        <strong>只填网关输出，不填账号登录材料</strong>
        <p>如果某个教程要求 auth.json、OAuth 凭据、卡密 JSON、Cookie 或账号 Token，请在你自己信任的 Sub2API / CPA / Cockpit 工具里完成登录或导入。DengTa 这里只接收最终的 Base URL、对外 API Key 和模型名。</p>
      </div>

      <div className="provider-recovery-note" role="note">
        <strong>迁移后无法聊天？重新保存活动 GPT 密钥 / Chat unavailable after migration?</strong>
        <p>
          更换 Render 服务或后端加密密钥后，旧接口仍会显示在列表里，但原密文不能继续使用。无需删除接口：在对应卡片重新粘贴 API Key，确认“启用这个接口”，保存修改，检查模型目录，再设为下次聊天首选。
        </p>
        <small>
          After a backend migration, re-enter the API key on the existing profile, enable and save it, check the model catalog, then make it the next-chat default.
        </small>
      </div>

      <div className="provider-summary-grid">
        <span><strong>{profiles.length}</strong><small>已保存接口</small></span>
        <span>
          <strong>{routableCount}</strong>
          <small>当前可路由</small>
        </span>
        <span><strong>{status.active_profile?.name || "旧版接口"}</strong><small>下次聊天首选</small></span>
      </div>

      {feedback && <p className="provider-feedback" role="status">{feedback}</p>}
      <div className="provider-card-actions">
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={refreshCenter}>
          {busy === "refresh" ? "刷新中" : "刷新接口列表"}
        </button>
      </div>

      <>
        <form className="provider-create-card" onSubmit={createProfile}>
            <div className="provider-section-title">
              <div><strong>新增一个接口</strong><small>可先检查模型目录而不保存；确认无误后再保存并启用。</small></div>
            </div>
            <ProviderFields value={draft} onChange={updateDraft} models={draftModels} />
            <div className="provider-card-actions">
              <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={testDraft}>
                {busy === "test-draft" ? "检查中" : "检查模型目录但不保存"}
              </button>
              <button className="primary-button" disabled={Boolean(busy)}>
                {busy === "create" ? "保存中" : "安全保存接口"}
              </button>
            </div>
        </form>

        <div className="provider-profile-list">
            {profiles.map((profile) => (
              <article className={profile.is_default ? "provider-profile-card default" : "provider-profile-card"} key={profile.id}>
                <div className="provider-profile-head">
                  <div>
                    <strong>{profile.name}</strong>
                    <small>{protocolLabel(profile.protocol)} · {catalogLabel(profile)}</small>
                  </div>
                  <div className="provider-badges">
                    {profile.is_default && (
                      <span>{providerIsExpired(profile) ? "原首选已到期" : "下次聊天首选"}</span>
                    )}
                    <span>{profile.enabled
                      ? providerIsExpired(profile)
                        ? "已启用 · 已到期不参与路由"
                        : "可参与路由"
                      : "已停用"}</span>
                    <ProviderExpiryBadge value={profile.expires_at} />
                  </div>
                </div>
                <ProviderHealthSummary profile={profile} />
                {providerCredentialNeedsRecovery(profile) && (
                  <div className="provider-recovery-note is-required" role="alert">
                    <strong>此接口需要重新保存 API Key / This provider key must be saved again</strong>
                    <p>在下方密钥框粘贴新值并点“保存修改”，再点“检查模型目录”。其他资料不需要重填。</p>
                  </div>
                )}
                <ProviderFields
                  value={profile}
                  editing
                  models={profile.discovered_models || []}
                  onChange={(field, value) => editProfile(profile.id, field, value)}
                />
                {profile.billing_url && (
                  <a className="provider-billing-link" href={profile.billing_url} target="_blank" rel="noreferrer">
                    打开付款页或服务商控制台
                  </a>
                )}
                <div className="provider-card-actions">
                  <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => testProfile(profile)}>
                    {busy === "test-" + profile.id ? "检查中" : "检查模型目录"}
                  </button>
                  <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => saveProfile(profile)}>
                    {busy === "save-" + profile.id ? "保存中" : "保存修改"}
                  </button>
                  <button type="button" className="secondary-button" disabled={Boolean(busy) || !profile.enabled || profile.is_default || providerIsExpired(profile)} onClick={() => makeDefault(profile)}>
                    {providerIsExpired(profile)
                      ? "已到期，不可设为首选"
                      : profile.is_default
                        ? "已设为下次聊天首选"
                        : "设为下次聊天首选"}
                  </button>
                  <button type="button" className="danger-outline-button" disabled={Boolean(busy)} onClick={() => removeProfile(profile)}>
                    删除
                  </button>
                  <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => openCcSwitchBridge(profile)}>
                    交给 CC Switch
                  </button>
                </div>
                {ccSwitchProfile?.id === profile.id && (
                  <section className="cc-switch-bridge" aria-label="CC Switch 本机桥接">
                    <div className="cc-switch-bridge-heading">
                      <div>
                        <span className="settings-kicker">本机桥接</span>
                        <strong>导入“{ccSwitchProfile.name}”到 CC Switch</strong>
                        <small>使用 CC Switch 3.17.0 官方 V1 深度链接；导入前仍需你在 CC Switch 中确认。</small>
                      </div>
                      <button type="button" className="text-button" onClick={closeCcSwitchBridge}>关闭</button>
                    </div>
                    <div className="cc-switch-bridge-grid">
                      <label>
                        目标工具
                        <select
                          value={ccSwitchTarget}
                          onChange={(event) => {
                            setCcSwitchTarget(event.target.value);
                            setCcSwitchFeedback("");
                          }}
                        >
                          {ccSwitchTargetsForProtocol(ccSwitchProfile.protocol).map((target) => (
                            <option value={target.value} key={target.value}>{target.label}</option>
                          ))}
                        </select>
                        <small>{ccSwitchTargetsForProtocol(ccSwitchProfile.protocol).find((target) => target.value === ccSwitchTarget)?.help}</small>
                      </label>
                      <label>
                        本机临时 API Key
                        <input
                          type="password"
                          value={ccSwitchApiKey}
                          onChange={(event) => {
                            setCcSwitchApiKey(event.target.value);
                            setCcSwitchFeedback("");
                          }}
                          placeholder="重新粘贴给 CC Switch 使用的网关 Key"
                          autoComplete="off"
                          spellCheck="false"
                        />
                        <small>只保存在当前页面内存，不提交 DengTa 后端；关闭本面板即清除。</small>
                      </label>
                    </div>
                    {ccSwitchProfile.protocol === "openai-chat" && (
                      <p className="cc-switch-protocol-note">
                        这个接口当前是 OpenAI Chat 协议，所以不能直接导入 Codex。若服务商同时支持 Responses，请在 DengTa 新建一个“OpenAI Responses”接口后再导入 Codex。
                      </p>
                    )}
                    <div className="cc-switch-preview">
                      <span><small>Base URL</small><strong>{ccSwitchProfile.base_url}</strong></span>
                      <span><small>默认模型</small><strong>{ccSwitchProfile.default_model || "由服务商决定"}</strong></span>
                    </div>
                    {ccSwitchFeedback && <p className="provider-feedback" role="status">{ccSwitchFeedback}</p>}
                    <div className="provider-card-actions">
                      <button type="button" className="primary-button" onClick={launchCcSwitch}>在本机打开 CC Switch</button>
                      <button type="button" className="secondary-button" onClick={downloadCcSwitchBridge}>下载无密钥离线桥接文件</button>
                      <button type="button" className="secondary-button" onClick={copyCcSwitchLink}>复制一次性导入链接</button>
                    </div>
                    <p className="cc-switch-security">
                      不会读取 CC Switch 数据库、OAuth、Cookie、auth.json 或账号 Token。离线文件不含密钥；一次性链接包含密钥，只能自己使用。
                    </p>
                  </section>
                )}
              </article>
            ))}
            {profiles.length === 0 && <p className="provider-empty">还没有保存活动接口。请在上方填写并保存一个供应商配置，之后新聊天会使用它。</p>}
        </div>
      </>

      <details className="provider-tutorial">
        <summary>零基础填写教程：New API、Sub2API、CPA 和普通模型 API</summary>
        <div>
          <h4>你最终只需要准备三样东西</h4>
          <ol>
            <li><strong>Base URL：</strong>例如服务商提供的 HTTPS API 根地址，常见结尾是 <code>/v1</code>。</li>
            <li><strong>网关 API Key：</strong>由该服务商或你自己的网关生成，通常类似 <code>sk-...</code>。不要使用网页登录密码。</li>
            <li><strong>模型名：</strong>先点“检查模型目录”，能读到列表就直接选择；读取不到时按服务商文档填写。</li>
          </ol>
          <h4>如果教程给你的是 auth.json、OAuth、Cookie 或账号 JSON</h4>
          <ol>
            <li>只在你自己拥有、信任的电脑或服务器上打开对应的 Sub2API、CPA 或 Cockpit 管理后台。</li>
            <li>在那个工具内部使用“添加账号 / OpenAI OAuth / 导入 JSON”，只导入你拥有或获授权使用的账号。</li>
            <li>让该工具生成一个对外 Base URL 和独立 API Key。若再套 New API，则在 New API 中生成给 DengTa 使用的令牌。</li>
            <li>回到本页面，只粘贴最终 Base URL 和 API Key。原始登录凭据永远留在外部工具内。</li>
          </ol>
          <h4>本机地址为什么不能直接填</h4>
          <p><code>127.0.0.1</code>、<code>localhost</code>、<code>192.168.x.x</code> 只代表你自己的电脑或局域网。DengTa 后端运行在 Render，无法访问这些地址。你需要把网关部署到自己的服务器，或使用你信任的 HTTPS 隧道，再填写公开 HTTPS 地址。</p>
          <h4>协议怎么选</h4>
          <p>普通 New API 或写着 OpenAI Compatible 的服务选择“OpenAI Chat 兼容接口”；明确写着 Responses、Codex provider 或 Sub2API Responses 的服务选择“OpenAI Responses”；Claude 与 Gemini 官方原生地址选择各自原生协议。</p>
          <p>ChatGPT、Claude 或其他网页会员不等于官方 API 额度。是否允许通过第三方网关调用，取决于服务条款和你获得的授权；临时账号和不明来源凭据可能随时失效，建议在备注和到期时间里记录来源与有效期。</p>
          <h4>怎么与 CC Switch 配合</h4>
          <ol>
            <li>先在 DengTa 保存一个最终可调用的 Base URL、API Key 和模型名。</li>
            <li>在该接口卡片底部点击“交给 CC Switch”，重新粘贴一次网关 API Key。</li>
            <li>电脑上操作时可直接打开 CC Switch；手机上操作时下载无密钥离线桥接文件，再把文件传到电脑。</li>
            <li>CC Switch 会显示导入预览。确认 Base URL、模型和目标工具无误后再导入并测试。</li>
          </ol>
          <p>这里只使用 CC Switch 官方 <code>ccswitch://v1/import</code> 协议，不会直接写入 <code>cc-switch.db</code>。官方下载地址：<a href="https://github.com/farion1231/cc-switch/releases" target="_blank" rel="noreferrer">farion1231/cc-switch Releases</a>。</p>
        </div>
      </details>
    </div>
  );
}

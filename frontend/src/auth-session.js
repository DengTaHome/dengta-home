import { GoTrueClient } from "@supabase/auth-js";
import { resolveAuthStorage } from "./auth-native-storage.js";
import { createAuthStorageLease } from "./auth-storage-lease.js";
import { clearAccountRuntimeData } from "./account-cleanup.js";
import { accountCacheStorage } from "./account-cache-vault.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPANION_STORAGE_PREFIX = "dengta_active_companion_id_v1:";
const AUTH_STORAGE_KEY = "dengta_home_auth_v1";

const DEFAULT_SUPABASE_URL = String(
  import.meta.env?.VITE_SUPABASE_URL || "",
).trim();
const DEFAULT_SUPABASE_ANON_KEY = String(
  import.meta.env?.VITE_SUPABASE_ANON_KEY || "",
).trim();

function createAuthOnlyClient(supabaseUrl, supabaseAnonKey, options = {}) {
  return {
    auth: new GoTrueClient({
      url: `${supabaseUrl}/auth/v1`,
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        "X-Client-Info": "dengta-home/auth-js",
      },
      ...options.auth,
    }),
  };
}

export const AUTH_STATUS = Object.freeze({
  unconfigured: "unconfigured",
  loading: "loading",
  anonymous: "anonymous",
  authenticating: "authenticating",
  recovery: "recovery",
  authenticated: "authenticated",
  expired: "expired",
  error: "error",
});

export class AuthSessionError extends Error {
  constructor(message, { code = "auth_error", status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuthSessionError";
    this.code = code;
    this.status = status;
  }
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function storageForBrowser(candidate) {
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  ) {
    return candidate;
  }
  return undefined;
}

function companionStorageKey(userId) {
  return `${COMPANION_STORAGE_PREFIX}${userId}`;
}

function readCompanionId(storage, userId) {
  if (!storage || !userId) return "";
  try {
    const scoped = accountCacheStorage(userId, storage);
    const value = String(scoped.getItem(companionStorageKey(userId)) || "");
    return UUID_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

function storeCompanionId(storage, userId, companionId) {
  if (!storage || !userId || !UUID_PATTERN.test(companionId)) return;
  try {
    accountCacheStorage(userId, storage).setItem(companionStorageKey(userId), companionId);
  } catch {
    // A blocked storage backend only disables companion persistence.
  }
}

function authFailure(error, fallbackMessage) {
  const code = String(error?.details?.code || error?.code || "auth_error");
  if (/^(?:ios_auth_storage|auth_storage|account_cleanup)_/.test(code)) return new AuthSessionError(
    "安全登录存储暂不可用，请解锁设备后重试。", { code },
  );
  // 已经翻译成人话的错误码不再把诊断代码贴给用户。
  const FRIENDLY_AUTH_CODES = new Set([
    "invalid_credentials",
    "email_not_confirmed",
    "user_already_exists",
    "weak_password",
    "rate_limited",
    "network_error",
    "session_expired",
    "auth_error"
  ]);

  const messages = {
    invalid_credentials: "邮箱或密码不正确。",
    email_not_confirmed: "邮箱尚未验证。请打开最新的验证邮件；链接失效时可在这里重新发送，不需要重新注册。",
    otp_expired: "邮箱验证链接已过期或已使用。若已完成验证，请用注册时的邮箱和密码登录；否则重新发送验证邮件并打开最新一封。",
    access_denied: "邮箱验证未完成，请重新发送验证邮件并打开最新链接。",
    user_already_exists: "这个邮箱已经注册，请直接登录。",
    user_already_registered: "这个邮箱已经注册，请直接登录。",
    over_email_send_rate_limit: "验证邮件发送得太频繁，请稍后再试。",
    weak_password: "密码强度不足，请换一个更长、更难猜的密码。",
    validation_failed: "邮箱或密码格式不正确。",
  };
  return new AuthSessionError(
    FRIENDLY_AUTH_CODES.has(code)
      ? messages[code] || fallbackMessage || "账号操作失败，请稍后再试。"
      : `${messages[code] || fallbackMessage || "账号操作失败，请稍后再试。"}（错误代码：${/^[a-z0-9_]{1,80}$/i.test(code) ? code : "auth_error"}）`,
    {
      code,
      status: Number(error?.status || 0),
      cause: error,
    },
  );
}

function publicUser(session) {
  const user = session?.user;
  if (!user?.id) return null;
  return Object.freeze({
    id: user.id,
    email: user.email || "",
    displayName: String(user.user_metadata?.display_name || "")
      .trim()
      .slice(0, 80),
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  });
}

function configured(supabaseUrl, supabaseAnonKey) {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function createAuthSessionManager({
  supabaseUrl = DEFAULT_SUPABASE_URL,
  supabaseAnonKey = DEFAULT_SUPABASE_ANON_KEY,
  storage = globalThis.localStorage,
  createClientFn = createAuthOnlyClient,
  resolveStorageFn = resolveAuthStorage,
  clearAccountDataFn = clearAccountRuntimeData,
} = {}) {
  const normalizedUrl = String(supabaseUrl || "").trim().replace(/\/$/, "");
  const normalizedKey = String(supabaseAnonKey || "").trim();
  const persistentStorage = storageForBrowser(storage);
  const listeners = new Set();
  let client = null;
  let initialization = null;
  let clientCreation = null;
  let clientStorage = null;
  let lifecycleRevision = 0;
  let accountData = Promise.resolve();
  const cleanupTasks = new Set();
  let authSubscription = null;
  let session = null;
  let sessionRevision = 0;
  let scopeRevision = 0;
  let accountDataRevision = 0;
  let passwordRecovery = false;
  let identityOperation = null;
  let callbackInitializationChecked = false;
  let snapshot = Object.freeze({
    status: configured(normalizedUrl, normalizedKey)
      ? AUTH_STATUS.loading
      : AUTH_STATUS.unconfigured,
    user: null,
    activeCompanionId: "",
    error: null,
  });

  function publish(next) {
    const previous = snapshot;
    snapshot = Object.freeze({ ...snapshot, ...next });
    if (previous.user?.id !== snapshot.user?.id) accountDataRevision += 1;
    if (previous.user?.id !== snapshot.user?.id || previous.activeCompanionId !== snapshot.activeCompanionId) scopeRevision += 1;
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  function runCleanupTask(task) {
    task.status = "pending";
    let result;
    try { result = task.run(); } catch (error) { result = Promise.reject(error); }
    task.promise = Promise.resolve(result).then(() => {
      task.status = "done";
      cleanupTasks.delete(task);
    }, error => {
      task.status = "failed";
      throw error;
    });
    void task.promise.catch(() => {});
  }

  function rebuildAccountDataBarrier() {
    accountData = Promise.all([...cleanupTasks].map(task => task.promise)).then(() => {});
    void accountData.catch(() => {});
    return accountData;
  }

  function queueCleanup(run) {
    const task = { run, promise: null, status: "pending" };
    cleanupTasks.add(task);
    // Run now: sealing and storage retirement must precede App unmount.
    runCleanupTask(task);
    rebuildAccountDataBarrier();
    return task.promise;
  }

  function queueAccountCleanup(accountId) {
    if (!accountId) return accountData;
    return queueCleanup(() => clearAccountDataFn(accountId, { localStorage: persistentStorage }));
  }

  function retryFailedCleanups() {
    for (const task of cleanupTasks) if (task.status === "failed") runCleanupTask(task);
    return rebuildAccountDataBarrier();
  }

  async function waitForAccountData({ retry = false } = {}) {
    if (retry) retryFailedCleanups();
    while (true) {
      const pending = accountData;
      try { await pending; }
      catch {
        throw new AuthSessionError("安全数据清理尚未完成，请解锁设备后重试。", { code: "account_cleanup_failed" });
      }
      if (pending === accountData) return;
    }
  }

  function staleOperation() {
    return new AuthSessionError("账号或伴侣已切换，本次操作已取消。", { code: "settings_scope_changed" });
  }

  async function runIdentityOperation(operation) {
    if (identityOperation) throw new AuthSessionError("正在处理账号操作，请稍候再试。", { code: "auth_operation_in_progress" });
    const ticket = { generation: lifecycleRevision };
    identityOperation = ticket;
    const assertIdentity = () => {
      if (identityOperation !== ticket || ticket.generation !== lifecycleRevision) throw staleOperation();
    };
    try { return await operation(assertIdentity); }
    finally { if (identityOperation === ticket) identityOperation = null; }
  }

  function requireCurrentClient(authClient) {
    if (authClient !== client) throw staleOperation();
  }

  function applySession(nextSession, status) {
    const previousAccount = session?.user?.id;
    const nextAccount = nextSession?.user?.id;
    if (previousAccount && previousAccount !== nextAccount) queueAccountCleanup(previousAccount);
    session = nextSession || null;
    sessionRevision += 1;
    const user = publicUser(session);
    return publish({
      status:
        status ||
        (session ? AUTH_STATUS.authenticated : AUTH_STATUS.anonymous),
      user,
      activeCompanionId: readCompanionId(persistentStorage, user?.id),
      error: null,
    });
  }

  function applyRecoverySession(nextSession) {
    passwordRecovery = true;
    return applySession(nextSession, AUTH_STATUS.recovery);
  }

  function requireConfiguration() {
    if (!configured(normalizedUrl, normalizedKey)) {
      throw new AuthSessionError(
        "DengTa Home 尚未配置 Supabase 登录服务。",
        { code: "auth_not_configured" },
      );
    }
  }

  async function ensureClient() {
    requireConfiguration();
    if (client) return client;
    if (clientCreation) return clientCreation;
    retryFailedCleanups();
    const generation = lifecycleRevision;
    const previousBarrier = accountData;
    const creating = (async () => {
      // Capture the old barrier: a logout must be allowed to await this
      // creation without the creation then awaiting that new logout barrier.
      try { await previousBarrier; } catch {
        throw new AuthSessionError("安全数据清理尚未完成，请解锁设备后重试。", { code: "account_cleanup_failed" });
      }
      if (generation !== lifecycleRevision) throw staleOperation();
      const resolvedStorage = await resolveStorageFn({ storage: persistentStorage });
      const lease = createAuthStorageLease(resolvedStorage);
      if (generation !== lifecycleRevision) {
        if (lease) await queueCleanup(() => lease.retireAndClear());
        throw staleOperation();
      }
      const created = createClientFn(normalizedUrl, normalizedKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: lease,
          storageKey: AUTH_STORAGE_KEY,
        },
      });
      clientStorage = lease;
      client = created;
      return created;
    })();
    clientCreation = creating;
    try { return await creating; }
    finally { if (clientCreation === creating) clientCreation = null; }
  }

  async function initialize() {
    if (!configured(normalizedUrl, normalizedKey)) return snapshot;
    if (initialization) return initialization;

    const generation = lifecycleRevision;
    initialization = (async () => {
      const authClient = await ensureClient();
      requireCurrentClient(authClient);
      publish({ status: AUTH_STATUS.loading, error: null });

      // getSession() awaits SDK initialization but does not return its callback error.
      // Consume that result once so a failed email link cannot block password login.
      if (!callbackInitializationChecked && authClient.auth.initialize) {
        callbackInitializationChecked = true;
        const { error } = await authClient.auth.initialize();
        requireCurrentClient(authClient);
        if (error) {
          const restored = await authClient.auth.getSession();
          if (!restored.data?.session?.user?.id) {
            throw authFailure(error, "邮箱链接验证失败，请重新发送验证邮件，或使用已验证的邮箱和密码登录。");
          }
        }
      }

      if (!authSubscription) {
        const result = authClient.auth.onAuthStateChange(
          (event, nextSession) => {
            if (authClient !== client) return;
            // A refresh/update belongs to the existing account. A late A
            // refresh cannot act as a sign-in for A after B was accepted.
            if (["TOKEN_REFRESHED", "USER_UPDATED", "INITIAL_SESSION"].includes(event) &&
                session?.user?.id && nextSession?.user?.id !== session.user.id) return;
            if (event === "PASSWORD_RECOVERY") {
              applyRecoverySession(nextSession);
              return;
            }
            if (event === "SIGNED_OUT") {
              void exitAccount(AUTH_STATUS.anonymous).catch(() => {});
              return;
            }
            applySession(
              nextSession,
              passwordRecovery ? AUTH_STATUS.recovery : undefined,
            );
          },
        );
        authSubscription = result?.data?.subscription || null;
      }

      const restoringRevision = sessionRevision;
      const { data, error } = await authClient.auth.getSession();
      requireCurrentClient(authClient);
      if (restoringRevision !== sessionRevision) return snapshot;
      if (error) {
        throw authFailure(error, "无法恢复登录状态，请重新登录。");
      }
      return passwordRecovery
        ? applyRecoverySession(data?.session || null)
        : applySession(data?.session || null);
    })().catch((error) => {
      if (generation !== lifecycleRevision) throw staleOperation();
      initialization = null;
      publish({
        status: AUTH_STATUS.error,
        error:
          error instanceof AuthSessionError
            ? error
            : authFailure(error, "无法恢复登录状态，请重新登录。"),
      });
      throw error;
    });

    return initialization;
  }

  async function signUp({
    email,
    password,
    displayName = "",
    emailRedirectTo,
  } = {}) {
    return runIdentityOperation(async (assertIdentity) => {
      requireConfiguration();
      await initialize();
      assertIdentity();
      publish({ status: AUTH_STATUS.authenticating, error: null });
      const options = {};
      const normalizedDisplayName = String(displayName || "").trim().slice(0, 80);
      if (normalizedDisplayName) {
        options.data = { display_name: normalizedDisplayName };
      }
      if (emailRedirectTo) {
        options.emailRedirectTo = String(emailRedirectTo);
      }
      const authClient = await ensureClient();
      const { data, error } = await authClient.auth.signUp({
        email: cleanEmail(email),
        password: String(password || ""),
        ...(Object.keys(options).length ? { options } : {}),
      });
      requireCurrentClient(authClient);
      if (error) {
        const failure = authFailure(error, "注册失败，请稍后再试。");
        publish({ status: AUTH_STATUS.anonymous, error: failure });
        throw failure;
      }
      applySession(data?.session || null);
      return {
        user: data?.user || null,
        session: data?.session || null,
        emailVerificationRequired: !data?.session,
      };
    });
  }

  async function signIn({ email, password } = {}) {
    return runIdentityOperation(async (assertIdentity) => {
      requireConfiguration();
      await initialize();
      assertIdentity();
      publish({ status: AUTH_STATUS.authenticating, error: null });
      const authClient = await ensureClient();
      const { data, error } = await authClient.auth.signInWithPassword({
        email: cleanEmail(email),
        password: String(password || ""),
      });
      requireCurrentClient(authClient);
      if (error || !data?.session) {
        const failure = authFailure(
          error || { code: "invalid_session" },
          "登录失败，请检查邮箱和密码。",
        );
        publish({ status: AUTH_STATUS.anonymous, error: failure });
        throw failure;
      }
      applySession(data.session);
      return { user: data.user || data.session.user, session: data.session };
    });
  }

  async function resendVerification({ email, emailRedirectTo } = {}) {
    requireConfiguration();
    await initialize();
    const options = emailRedirectTo
      ? { emailRedirectTo: String(emailRedirectTo) }
      : undefined;
    const { error } = await (await ensureClient()).auth.resend({
      type: "signup",
      email: cleanEmail(email),
      ...(options ? { options } : {}),
    });
    if (error) {
      throw authFailure(error, "验证邮件发送失败，请稍后再试。");
    }
  }

  async function requestPasswordReset({ email, redirectTo } = {}) {
    requireConfiguration();
    await initialize();
    const options = redirectTo
      ? { redirectTo: String(redirectTo) }
      : undefined;
    const { error } = await (await ensureClient()).auth.resetPasswordForEmail(
      cleanEmail(email),
      options,
    );
    if (error) {
      throw authFailure(error, "密码重置邮件发送失败，请稍后再试。");
    }
  }

  async function verifyRegistrationLink(rawLink) {
    return runIdentityOperation(async (assertIdentity) => {
      requireConfiguration();
      let tokenHash;
      let type;
      try {
        const link = new URL(String(rawLink || "").trim());
        const project = new URL(normalizedUrl);
        type = link.searchParams.get("type");
        tokenHash = link.searchParams.get("token_hash") || link.searchParams.get("token");
        if (link.origin !== project.origin || link.pathname !== `${project.pathname.replace(/\/$/, "")}/auth/v1/verify` ||
            link.username || link.password || !["email", "signup"].includes(type) ||
            !/^[a-z0-9_-]{16,256}$/i.test(tokenHash || "")) throw new Error();
      } catch {
        throw new AuthSessionError("请粘贴本次灯塔注册邮件中“Confirm email address”按钮的原始链接；不要粘贴网页地址、其他网站或重置密码链接。", { code: "invalid_registration_link" });
      }
      await initialize();
      assertIdentity();
      const authClient = await ensureClient();
      const { data, error } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type });
      requireCurrentClient(authClient);
      if (error || !data?.session?.user?.id) {
        throw authFailure(error || { code: "invalid_session" }, "邮箱验证未完成，请重新发送验证邮件并复制最新链接。");
      }
      applySession(data.session);
      return { ok: true };
    });
  }

  async function updatePassword({ password } = {}) {
    return runIdentityOperation(async (assertIdentity) => {
      requireConfiguration();
      await initialize();
      assertIdentity();
      if (!session?.user?.id || !passwordRecovery) {
        throw new AuthSessionError("密码重置链接已失效，请重新申请。", {
          code: "password_recovery_required",
          status: 401,
        });
      }
      const authClient = await ensureClient();
      const { data, error } = await authClient.auth.updateUser({
        password: String(password || ""),
      });
      requireCurrentClient(authClient);
      if (error) {
        throw authFailure(error, "新密码保存失败，请重新申请重置邮件。");
      }
      passwordRecovery = false;
      applySession(session, AUTH_STATUS.authenticated);
      return { user: data?.user || session.user };
    });
  }

  function exitAccount(status, error = null, revokeRemote = false) {
    const oldClient = client;
    const oldStorage = clientStorage;
    const oldCreation = clientCreation;
    const accountId = session?.user?.id;
    const accessToken = session?.access_token;
    lifecycleRevision += 1;
    identityOperation = null;
    scopeRevision += 1;
    client = null;
    clientStorage = null;
    clientCreation = null;
    initialization = null;
    callbackInitializationChecked = false;
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    passwordRecovery = false;
    session = null;
    sessionRevision += 1;
    // Retirement is synchronous even though the physical Keychain deletion
    // waits for an operation already in flight. New clients wait below.
    if (oldStorage) queueCleanup(() => oldStorage.retireAndClear());
    if (oldCreation) queueCleanup(() => oldCreation.catch(async failure => {
      if (failure?.code === "settings_scope_changed") return;
      // A failed migration may not have yielded a lease. A fresh resolution
      // after unlocking must prove the shared store empty before B starts.
      const resolved = await resolveStorageFn({ storage: persistentStorage });
      await createAuthStorageLease(resolved)?.retireAndClear();
    }));
    queueAccountCleanup(accountId);
    try { void Promise.resolve(oldClient?.auth.stopAutoRefresh?.()).catch(() => {}); } catch { /* Already stopped. */ }

    if (revokeRemote && oldClient?.auth.admin?.signOut && accessToken) {
      // Explicit access-token revocation has no authority over local storage.
      // An offline server must never prevent a local privacy wipe.
      try { void Promise.resolve(oldClient.auth.admin.signOut(accessToken, "local")).catch(() => {}); } catch { /* Offline. */ }
    } else if (oldClient?.auth.signOut) {
      try {
        void Promise.resolve(oldClient.auth.signOut({ scope: "local" })).catch(() => {});
      } catch { /* Offline. */ }
    }
    publish({ status, user: null, activeCompanionId: "", error });
    return waitForAccountData();
  }

  async function signOut() {
    if (cleanupTasks.size && !session && !client && !clientCreation && !initialization) {
      await waitForAccountData({ retry: true });
      return;
    }
    await exitAccount(AUTH_STATUS.anonymous, null, true);
  }

  async function getRequestContext() {
    if (!configured(normalizedUrl, normalizedKey)) return {};
    if (!client && !initialization && [AUTH_STATUS.anonymous, AUTH_STATUS.expired].includes(snapshot.status)) return {};
    const startingScope = snapshot.user?.id ? scopeRevision : null;
    await initialize();
    await waitForAccountData();
    const requestScope = startingScope ?? scopeRevision;
    function assertRequestScope() {
      if (requestScope === scopeRevision && session?.user?.id === snapshot.user?.id) return;
      throw new AuthSessionError("账号或伴侣已切换，本次请求已取消。", { code: "settings_scope_changed" });
    }
    assertRequestScope();
    if (!session?.access_token) return {};
    // 缺陷 5 修复：主动检查 token 是否临近/已过期，避免仅依赖后台定时器刷新。
    // 后台标签页定时器可能被节流，回前台时携带过期 token 导致 401 强制登出。
    if (
      session.expires_at &&
      client?.auth &&
      typeof client.auth.refreshSession === "function"
    ) {
      const expiresAt = Number(session.expires_at) * 1000;
      const now = Date.now();
      // 剩余有效期不足 30 秒时主动刷新一次
      if (expiresAt - now < 30_000) {
        const refreshRevision = sessionRevision;
        const refreshUserId = session.user?.id;
        try {
          const refreshed = await client.auth.refreshSession();
          // SDK events can publish a newer session before this promise settles.
          if (requestScope === scopeRevision && refreshRevision === sessionRevision && refreshed?.data?.session?.user?.id === refreshUserId && refreshed.data.session.access_token) {
            session = refreshed.data.session;
            sessionRevision += 1;
            publish({ status: AUTH_STATUS.authenticated });
          }
        } catch {
          // 刷新失败保持现状，让请求层的 401 处理兜底
        }
      }
    }
    assertRequestScope();
    const context = {
      accessToken: session.access_token,
      companionId: snapshot.activeCompanionId,
    };
    // Metadata is authoritative but non-enumerable so existing consumers which
    // forward the old two-field object cannot leak internal account metadata.
    Object.defineProperties(context, {
      accountId: { value: session.user.id },
      scopeRevision: { value: scopeRevision },
    });
    return Object.freeze(context);
  }

  function hydrateAccountPreferences(accountId, expectedRevision = accountDataRevision) {
    if (snapshot.status !== AUTH_STATUS.authenticated || snapshot.user?.id !== accountId ||
        expectedRevision !== accountDataRevision) return "";
    // Native cold start restores credentials before the encrypted cache has
    // hydrated. Read the private preference once that cache is prepared; never
    // choose plaintext as a fallback, or replace a newer explicit selection.
    if (snapshot.activeCompanionId) return snapshot.activeCompanionId;
    const companionId = readCompanionId(persistentStorage, accountId);
    if (companionId) publish({ activeCompanionId: companionId });
    return companionId;
  }

  function setActiveCompanionId(companionId) {
    const normalized = String(companionId || "").trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new AuthSessionError("伴侣编号格式不正确。", {
        code: "invalid_companion_id",
      });
    }
    if (!session?.user?.id) {
      throw new AuthSessionError("请先登录后再切换 AI 伴侣。", {
        code: "authentication_required",
        status: 401,
      });
    }
    storeCompanionId(persistentStorage, session.user.id, normalized);
    publish({ activeCompanionId: normalized });
    return normalized;
  }

  function captureCompanionFromResponse(response, expectedScope) {
    if (expectedScope && (expectedScope.accountId !== (snapshot.user?.id || "") ||
        expectedScope.companionId !== snapshot.activeCompanionId || expectedScope.revision !== scopeRevision)) return "";
    const companionId = String(
      response?.headers?.get?.("X-DengTa-Companion-Id") || "",
    ).trim();
    if (!session?.user?.id || !UUID_PATTERN.test(companionId)) return "";
    storeCompanionId(persistentStorage, session.user.id, companionId);
    if (snapshot.activeCompanionId !== companionId) {
      publish({ activeCompanionId: companionId });
    }
    return companionId;
  }

  async function invalidateSession(message = "登录状态已经失效，请重新登录。") {
    await exitAccount(AUTH_STATUS.expired, new AuthSessionError(message, {
      code: "invalid_session", status: 401,
    }));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot);
    return () => listeners.delete(listener);
  }

  function destroy() {
    authSubscription?.unsubscribe?.();
    authSubscription = null;
    try { void Promise.resolve(client?.auth.stopAutoRefresh?.()).catch(() => {}); } catch { /* Already stopped. */ }
    listeners.clear();
  }

  // 缺陷 1 修复：处理 dengta://auth#access_token=... 深度链接回跳。
  // 用户点击邮箱验证/密码重置链接后回跳到 App，把 fragment 里的 token
  // 交给 GoTrueClient 换成正式会话。
  async function handleAuthCallbackUrl(rawUrl) {
    return runIdentityOperation(async (assertIdentity) => {
      requireConfiguration();
      await initialize();
      assertIdentity();
      const generation = lifecycleRevision;
      try {
        const parsed = new URL(String(rawUrl || ""));
        const fragment = parsed.hash?.replace(/^#/, "") || "";
        const params = new URLSearchParams(fragment);
        if (params.get("error") || params.get("error_code")) throw authFailure({ code: params.get("error_code") || "access_denied" }, "邮箱链接已失效，请重新申请。 ");
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (!accessToken || !refreshToken) {
          return { ok: false, reason: "missing_tokens" };
        }
        const authClient = await ensureClient();
        // The SDK can emit SIGNED_IN synchronously from setSession. Mark recovery
        // first so that the protected business app never briefly mounts.
        passwordRecovery = params.get("type") === "recovery";
        const { data, error } = await authClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        requireCurrentClient(authClient);
        if (error) {
          throw authFailure(error, "回跳登录失败，请重新登录。");
        }
        passwordRecovery = params.get("type") === "recovery";
        applySession(
          data?.session || null,
          passwordRecovery ? AUTH_STATUS.recovery : undefined,
        );
        return { ok: true };
      } catch (error) {
        if (generation !== lifecycleRevision || error?.code === "settings_scope_changed") throw staleOperation();
        publish({
          status: AUTH_STATUS.error,
          error:
            error instanceof AuthSessionError
              ? error
              : authFailure(error, "回跳登录失败，请重新登录。"),
        });
        throw error;
      }
    });
  }

  return Object.freeze({
    initialize,
    signUp,
    signIn,
    signOut,
    resendVerification,
    verifyRegistrationLink,
    requestPasswordReset,
    updatePassword,
    handleAuthCallbackUrl,
    getRequestContext,
    waitForAccountData,
    hydrateAccountPreferences,
    getAccountDataRevision: () => accountDataRevision,
    setActiveCompanionId,
    captureCompanionFromResponse,
    invalidateSession,
    subscribe,
    destroy,
    getSnapshot: () => snapshot,
    getRequestScope: () => Object.freeze({
      accountId: snapshot.user?.id || "",
      companionId: snapshot.activeCompanionId || "",
      revision: scopeRevision,
    }),
    isConfigured: () => configured(normalizedUrl, normalizedKey),
  });
}

export const authSession = createAuthSessionManager();

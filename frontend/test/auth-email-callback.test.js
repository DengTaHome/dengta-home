import assert from "node:assert/strict";
import { test } from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import { createAuthSessionManager } from "../src/auth-session.js";

test("SDK callback initialization failure is visible and password login remains retryable", async () => {
  let sdkInitializations = 0;
  const manager = createAuthSessionManager({
    supabaseUrl: "https://auth.example.test",
    supabaseAnonKey: "fictional-public-key",
    storage: undefined,
    createClientFn: () => ({ auth: {
      initialize: async () => {
        sdkInitializations += 1;
        return { error: { details: { code: "otp_expired" }, message: "private upstream detail" } };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { session: {
        access_token: "fictional-token", user: { id: "fictional-user" },
      } }, error: null }),
    } }),
  });
  await assert.rejects(manager.initialize(), { code: "otp_expired" });
  assert.equal(manager.getSnapshot().status, "error");
  assert.match(manager.getSnapshot().error.message, /已过期或已使用/);
  assert.doesNotMatch(manager.getSnapshot().error.message, /private upstream/);
  await manager.signIn({ email: "fiction@example.test", password: "fictional-password" });
  assert.equal(manager.getSnapshot().status, "authenticated");
  assert.equal(sdkInitializations, 1);
  manager.destroy();
});

test("real installed SDK swallows callback error in getSession; manager now surfaces it", async () => {
  const auth = new GoTrueClient({
    url: "https://auth.example.test/auth/v1", persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false,
    fetch: () => { throw new Error("test must not contact any provider"); },
  });
  await auth.initialize();
  auth.initializePromise = Promise.resolve({ error: {
    details: { code: "otp_expired" }, message: "fictional expired callback",
  } });
  assert.equal((await auth.getSession()).error, null);
  const manager = createAuthSessionManager({
    supabaseUrl: "https://auth.example.test", supabaseAnonKey: "fictional-public-key",
    storage: undefined, createClientFn: () => ({ auth }),
  });
  await assert.rejects(manager.initialize(), { code: "otp_expired" });
  manager.destroy();
  auth.stopAutoRefresh();
});

test("registration link fallback uses the current project's actual SDK verify endpoint", async () => {
  const calls = [];
  let expired = false;
  const auth = new GoTrueClient({
    url: "https://auth.example.test/auth/v1", persistSession: false,
    autoRefreshToken: false, detectSessionInUrl: false,
    fetch: async (url, options) => {
      calls.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
      return new Response(JSON.stringify(expired ? { code: "otp_expired", msg: "private upstream" } : {
        access_token: "fictional-access", refresh_token: "fictional-refresh", token_type: "bearer", expires_in: 3600,
        user: { id: "fictional-user", email: "fiction@example.test", email_confirmed_at: "2026-10-01T00:00:00Z" },
      }), { status: expired ? 403 : 200, headers: { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" } });
    },
  });
  const manager = createAuthSessionManager({
    supabaseUrl: "https://auth.example.test", supabaseAnonKey: "fictional-public-key", storage: undefined,
    createClientFn: () => ({ auth }),
  });
  const tokenHash = "a".repeat(64);
  for (const link of [
    `https://other.example.test/auth/v1/verify?token=${tokenHash}&type=email`,
    `https://auth.example.test/auth/v1/verify?token=${tokenHash}&type=recovery`,
    `https://auth.example.test/other?token=${tokenHash}&type=email`,
    "not a link", `https://auth.example.test/auth/v1/verify?type=email`,
    `https://auth.example.test/auth/v1/verify?token=short&type=email`,
    `https://user:password@auth.example.test/auth/v1/verify?token=${tokenHash}&type=email`,
  ]) await assert.rejects(manager.verifyRegistrationLink(link), { code: "invalid_registration_link" });
  assert.equal(calls.length, 0);
  const link = `https://auth.example.test/auth/v1/verify?token=${tokenHash}&type=email&redirect_to=https://ignored.example.test`;
  assert.equal((await manager.verifyRegistrationLink(link)).ok, true);
  assert.equal(manager.getSnapshot().status, "authenticated");
  assert.equal(calls[0].url, "https://auth.example.test/auth/v1/verify");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.token_hash, tokenHash);
  assert.equal(calls[0].body.type, "email");
  assert.equal(calls[0].body.redirect_to, undefined);
  expired = true;
  await assert.rejects(manager.verifyRegistrationLink(link), { code: "otp_expired" });
  assert.doesNotMatch(manager.getSnapshot().error?.message || "", /private upstream/);
  manager.destroy();
  await auth.dispose();
});

test("a failed reused link does not hide an already valid device session", async () => {
  const existing = { access_token: "fictional-existing", user: { id: "fictional-existing-user" } };
  const manager = createAuthSessionManager({
    supabaseUrl: "https://auth.example.test", supabaseAnonKey: "fictional-public-key", storage: undefined,
    createClientFn: () => ({ auth: {
      initialize: async () => ({ error: { details: { code: "otp_expired" } } }),
      getSession: async () => ({ data: { session: existing }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }),
  });
  await manager.initialize();
  assert.equal(manager.getSnapshot().status, "authenticated");
  assert.equal(manager.getSnapshot().user.id, "fictional-existing-user");
  manager.destroy();
});

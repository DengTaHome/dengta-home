import { apiRequest } from "./api.js";

export async function startXhsLogin({ client = apiRequest } = {}) {
  return client("/api/v2/xhs/login/start", {
    method: "POST",
    timeoutMs: 45_000,
    body: JSON.stringify({}),
  });
}

export async function readXhsLoginStatus(session, { client = apiRequest } = {}) {
  return client(
    `/api/v2/xhs/login/status?session=${encodeURIComponent(session)}`,
    { timeoutMs: 15_000 }
  );
}

export async function readXhsMe({ client = apiRequest } = {}) {
  return client("/api/v2/xhs/me", { timeoutMs: 20_000 });
}

export async function logoutXhs({ client = apiRequest } = {}) {
  return client("/api/v2/xhs/logout", { method: "DELETE", timeoutMs: 20_000 });
}

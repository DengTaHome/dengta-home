import { apiRequest, apiFetch } from "./api.js";

/**
 * 放映厅（多人联机一起看房间）前端 API。
 *
 * 对应于后端 routes/co-watch-rooms.js + services/co-watch-rooms.js。
 */

export async function createWatchRoom(input = {}) {
  const data = await apiRequest("/api/v2/co-watch/rooms", {
    method: "POST",
    body: JSON.stringify({ ...input, display_name: input.display_name ?? input.displayName ?? input.userName }),
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function joinWatchRoom(joinCode, input = {}) {
  const data = await apiRequest("/api/v2/co-watch/rooms/join", {
    method: "POST",
    body: JSON.stringify({ ...input, display_name: input.display_name ?? input.displayName ?? input.userName, join_code: String(joinCode || "").trim().toUpperCase() }),
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function readWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}`, {
    timeoutMs: 10_000,
  });
  return data || null;
}

export async function updateRoomPlayback(roomId, input = {}) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/playback`, {
    method: "PATCH",
    body: JSON.stringify(input),
    timeoutMs: 10_000,
  });
  return data?.room || null;
}

export async function sendRoomMessage(roomId, content, mediaPositionSeconds = 0) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, media_position_seconds: mediaPositionSeconds }),
    timeoutMs: 10_000,
  });
  return data?.message || null;
}

export async function sendRoomAiMessage(roomId, content, mediaPositionSeconds = 0, aiName = "") {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/ai-messages`, {
    method: "POST",
    body: JSON.stringify({ content, media_position_seconds: mediaPositionSeconds, ai_name: aiName }),
    timeoutMs: 10_000,
  });
  return data?.message || null;
}

export async function readRoomMessages(roomId, limit = 50, beforeId = null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeId) query.set("before_id", String(beforeId));
  const data = await apiRequest(
    `/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/messages?${query}`,
    { timeoutMs: 10_000 },
  );
  return Array.isArray(data?.messages) ? data.messages : [];
}

export async function leaveWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: "POST",
    timeoutMs: 10_000,
  });
  return data;
}

export async function endWatchRoom(roomId) {
  const data = await apiRequest(`/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/end`, {
    method: "POST",
    timeoutMs: 10_000,
  });
  return data;
}

/**
 * 放映厅实时事件订阅（SSE，通过 fetch + 手动解析，支持 Bearer 鉴权）。
 *
 * 返回一个 abort 函数，调用后断开连接且不再重连。
 * 连接意外断开（网络错误/服务端重启/流结束）自动按指数退避重连：
 * 1s → 2s → 4s → 8s → 16s → 封顶 30s；连接成功送达事件后重置退避。
 * 回调：
 *   onPlaybackSync(room)    — 播放状态、进度、revision 变化
 *   onMessage(msg)          — 新聊天消息
 *   onParticipantJoin(info) — 有人加入
 *   onParticipantLeave(info)- 有人离开
 *   onRoomEnded({roomId})   — 放映厅结束
 *   onConnected()          — 已建立事件流，可重新读取状态与近期消息
 *   onError(error)          — 连接出错
 *   onDisconnect()          — 连接断开、进入重连前触发（主动 abort 不触发）
 */
export function subscribeRoomEvents(roomId, handlers = {}) {
  const controller = new AbortController();
  const url = `/api/v2/co-watch/rooms/${encodeURIComponent(roomId)}/events`;

  let stopped = false;
  let attempt = 0; // 连续失败次数：驱动指数退避
  let retryTimer = null;
  let buffer = "";
  let currentEvent = "";

  function scheduleReconnect() {
    if (stopped || controller.signal.aborted) return;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt);
    attempt += 1;
    handlers.onDisconnect?.();
    retryTimer = setTimeout(run, delay);
  }

  async function run() {
    if (stopped || controller.signal.aborted) return;
    // 每个连接周期重置解析状态，防止跨连接残留半行文本或上一个事件名
    buffer = "";
    currentEvent = "";
    try {
      const response = await apiFetch(url, {
        signal: controller.signal,
        retry: false,
      });
      if (stopped || controller.signal.aborted) return;
      if (!response.ok) {
        const reason = { 401: "登录已失效，请重新登录", 403: "当前账号没有访问权限，请核对房间邀请", 404: "房间不存在或已结束，请退出当前房间后重新加入", 410: "房间已结束，请退出后加入新的房间" }[response.status] || "服务暂时不可用，将自动重连";
        const error = new Error(`${reason}（HTTP ${response.status}）。`);
        error.code = `room_stream_http_${response.status}`;
        handlers.onError?.(error);
        if ([401, 403, 404, 410].includes(response.status)) { stopped = true; return; }
        scheduleReconnect();
        return;
      }
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        const error = new Error("放映厅接口未返回实时事件流，请检查服务器版本。");
        error.code = "room_stream_invalid_response";
        handlers.onError?.(error);
        stopped = true;
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
      handlers.onConnected?.();
      while (true) {
        const { done, value } = await reader.read();
        if (done || stopped || controller.signal.aborted) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            try {
              const parsed = JSON.parse(data);
              switch (currentEvent) {
                case "playback_sync": handlers.onPlaybackSync?.(parsed); break;
                case "message": handlers.onMessage?.(parsed); break;
                case "participant_join": handlers.onParticipantJoin?.(parsed); break;
                case "participant_leave": handlers.onParticipantLeave?.(parsed); break;
                case "room_ended": stopped = true; handlers.onRoomEnded?.(parsed); break;
              }
              // 成功送达事件说明连接健康，重置退避
              attempt = 0;
            } catch {
              console.warn("[watch-room] room_stream_event_invalid");
            }
            // SSE 规范：每个事件处理完即清空事件名，漏写 event: 的 data 不会错分到上一个事件
            currentEvent = "";
          }
        }
        if (stopped) break;
      }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      // 流正常结束（服务端关闭/重启）→ 自动重连
      scheduleReconnect();
    } catch {
      if (stopped || controller.signal.aborted) return;
      const error = new Error("放映厅实时连接中断，请检查网络；将自动重连。");
      error.code = "room_stream_network_error";
      handlers.onError?.(error);
      scheduleReconnect();
    }
  }

  run();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller.abort();
  };
}

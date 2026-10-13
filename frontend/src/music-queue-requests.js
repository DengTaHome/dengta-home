export function createMusicQueueRequests({ getIdentity, readQueue, applyOperation, onQueue, onBusy, idFactory = () => crypto.randomUUID() }) {
  let sessionId = "", generation = 0, controller = new AbortController(), queued = 0, tail = Promise.resolve(), alive = true;
  let latestQueue = null;
  const retries = new Map();
  const scope = () => JSON.stringify(getIdentity());
  const stamp = () => ({ sessionId, generation, scope: scope(), options: { ...getIdentity(), signal: controller.signal } });
  const current = token => alive && token.sessionId === sessionId && token.generation === generation && token.scope === scope() && !token.options.signal.aborted;
  const assertCurrent = token => { if (!current(token)) throw Object.assign(new Error("账号、伴侣或听歌会话已切换，旧队列操作已取消。"), { code: "music_queue_scope_changed" }); };
  const valid = (queue, token) => queue?.sessionId === token.sessionId && Number.isSafeInteger(queue.revision) && queue.revision >= 0;
  async function acceptQueue(queue, token) {
    assertCurrent(token);
    if (latestQueue && queue.revision < latestQueue.revision) return latestQueue;
    latestQueue = queue;
    await onQueue(queue);
    assertCurrent(token);
    return latestQueue;
  }
  async function read(token) {
    assertCurrent(token);
    const queue = await readQueue(token.sessionId, token.options);
    assertCurrent(token);
    if (!valid(queue, token)) throw Object.assign(new Error("服务器没有返回本场听歌的有效队列，请重试。"), { code: "music_queue_receipt_invalid" });
    return acceptQueue(queue, token);
  }
  return {
    bind(id = "") {
      if (id === sessionId && alive) return;
      generation++; controller.abort(); controller = new AbortController(); sessionId = id; alive = true; latestQueue = null; retries.clear(); queued = 0; tail = Promise.resolve(); onBusy(false);
    },
    invalidate() { generation++; alive = false; controller.abort(); latestQueue = null; queued = 0; retries.clear(); onBusy(false); },
    async read(id = sessionId) { const token = stamp(); if (id !== token.sessionId || !id) throw Object.assign(new Error("请先开始本场一起听歌。"), { code: "music_queue_session_changed" }); return read(token); },
    operate(operation, { retryConflict = false, sessionId: expectedId = sessionId } = {}) {
      const token = stamp();
      if (!expectedId || expectedId !== token.sessionId) return Promise.reject(Object.assign(new Error("听歌会话已改变，请重试。"), { code: "music_queue_session_changed" }));
      const key = JSON.stringify(operation);
      queued++; onBusy(true);
      const execute = async () => {
        try {
          assertCurrent(token);
          if (!retries.has(key)) retries.set(key, { id: idFactory() });
          const intent = retries.get(key);
          let queue = await read(token);
          for (let attempt = 0; ; attempt++) {
            try {
              assertCurrent(token);
              const result = await applyOperation(token.sessionId, { operation, requestId: intent.id, expectedRevision: queue.revision }, token.options);
              assertCurrent(token);
              if (!valid(result?.queue, token)) throw Object.assign(new Error("服务器未确认队列修改，请重试；当前播放器仍保留。"), { code: "music_queue_receipt_invalid" });
              const acceptedQueue = await acceptQueue(result.queue, token);
              if (retries.get(key) === intent) retries.delete(key);
              return acceptedQueue;
            } catch (error) {
              assertCurrent(token);
              if (attempt || !retryConflict || error?.status !== 409 || error.code !== "music_queue_revision_conflict") throw error;
              queue = await read(token);
            }
          }
        } finally {
          if (generation === token.generation) { queued--; onBusy(queued > 0); }
        }
      };
      const run = tail.then(execute, execute); tail = run.catch(() => {}); return run;
    },
  };
}

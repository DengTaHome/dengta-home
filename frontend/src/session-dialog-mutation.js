/**
 * 会话重命名 / 删除的提交流程。
 *
 * 从 App.jsx 抽出来：这段逻辑原本只能靠「从 App.jsx 切源码 + new Function 注入
 * 22 个变量」来测，测的是文本能不能拼起来，不是行为。现在它是一个接收依赖上下文的
 * 纯函数，测试直接传一份假上下文就能验证锁、竞态、回执和失败分支。
 */
export async function confirmSessionDialogMutation(context, event) {
  const {
    dialog,
    dialogRef,
    sessionsRef,
    activeSessionIdRef,
    sessionDialogPendingRef,
    sessionDialogRequest,
    setSessions,
    setDialog,
    setSessionDialogBusy,
    setSessionDialogFeedback,
    setNotice,
    setActiveSessionId,
    setMessages,
    storeSessionChatModel,
    clearStoredMessageReferencesForSession,
    abortChatRequest,
    chatRequestRef,
    recordOperationFailure,
    privateMediaScope,
    readSessionRename,
    readSessionDelete,
    sessionDialogFailure,
    MAX_SESSION_TITLE
  } = context;
  event.preventDefault();
  if (!dialog?.session || sessionDialogPendingRef.current || !sessionDialogRequest.isCurrent()) return;
  const submitted = dialog;
  const title = String(submitted.value || "").trim();
  if (submitted.type === "rename" && (!title || title.length > MAX_SESSION_TITLE)) return;
  const pending = {};
  const path = `/api/v2/sessions/${encodeURIComponent(submitted.session.id)}`;
  sessionDialogPendingRef.current = pending;
  setSessionDialogBusy(true);
  setSessionDialogFeedback("");

  try {
    if (submitted.type === "rename") {
      const saved = await sessionDialogRequest.request(path, {
        method: "PATCH",
        body: { title },
        responseReader: (response) => readSessionRename(response, submitted.session.id, title),
      });
      if (!sessionDialogRequest.isCurrent()) return;
      setSessions((current) =>
        current.map((item) =>
          item.id === submitted.session.id ? { ...item, ...saved } : item,
        ),
      );
    } else {
      await sessionDialogRequest.request(path, {
        method: "DELETE",
        responseReader: readSessionDelete,
      });
      if (!sessionDialogRequest.isCurrent()) return;
      storeSessionChatModel(submitted.session.id, "");
      clearStoredMessageReferencesForSession(submitted.session.id);
      const remaining = sessionsRef.current.filter(
        (item) => item.id !== submitted.session.id,
      );
      setSessions((current) => current.filter((item) => item.id !== submitted.session.id));
      if (activeSessionIdRef.current === submitted.session.id) {
        abortChatRequest(chatRequestRef, "session-deleted");
        activeSessionIdRef.current = remaining[0]?.id || null;
        setActiveSessionId(activeSessionIdRef.current);
        setMessages([]);
      }
    }
    if (dialogRef.current === submitted) setDialog(null);
  } catch (error) {
    if (sessionDialogRequest.isCurrent()) {
      recordOperationFailure(privateMediaScope, path, error);
      const feedback = sessionDialogFailure(error);
      if (dialogRef.current === submitted) setSessionDialogFeedback(feedback);
      else setNotice(feedback);
    }
  } finally {
    if (sessionDialogPendingRef.current === pending) {
      sessionDialogPendingRef.current = null;
      if (sessionDialogRequest.isCurrent()) setSessionDialogBusy(false);
    }
  }
}


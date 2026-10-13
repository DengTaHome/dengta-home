// Test fixture extracted from the actual App preparation block; no network or account.
import { awaitChatPreparation } from '../src/chat-send-preparation.js';
export async function prepare({isSendingRef,setIsSending,activeSessionIdRef,abortChatRequest,chatRequestRef,preserveComposer,attachmentsToSend,refreshDeviceActivityContext,setSendPreparationStage,flushLatestSettingsDraft,sessionModelSaveQueueRef,componentMountedRef,releaseChatRequestAttachments,setNotice,onReady}) {
    isSendingRef.current = true;
    setIsSending(true);
    const startingSessionId = activeSessionIdRef.current;
    abortChatRequest(chatRequestRef, "replaced");
    const request = {
      controller: new AbortController(),
      attachments: preserveComposer ? attachmentsToSend : [],
      attachmentsReleased: false,
      cancelReason: "",
    };
    chatRequestRef.current = request;
    const deviceActivityRefresh = refreshDeviceActivityContext({ silent: true });
    try {
      setSendPreparationStage("settings");
      if (!(await awaitChatPreparation(flushLatestSettingsDraft, request.controller.signal))) {
        throw Object.assign(new Error("发送前设置未保存"), { code: "chat_preparation_settings_unsaved" });
      }
      if (startingSessionId) {
        setSendPreparationStage("model");
        await awaitChatPreparation(() => sessionModelSaveQueueRef.current, request.controller.signal);
      }
      if (request.controller.signal.aborted || chatRequestRef.current !== request ||
          !componentMountedRef.current || activeSessionIdRef.current !== startingSessionId) {
        throw new DOMException("发送准备已取消", "AbortError");
      }
    } catch (error) {
      if (preserveComposer) releaseChatRequestAttachments(request);
      if (chatRequestRef.current === request) {
        chatRequestRef.current = null;
        isSendingRef.current = false;
        if (componentMountedRef.current) {
          setIsSending(false);
          setSendPreparationStage("");
          setNotice(error?.name === "AbortError"
            ? `发送准备已停止，本轮尚未发送。${preserveComposer ? "临时画面已释放。" : "文字和附件仍保留在输入框中。"}`
            : error?.code === "chat_preparation_settings_unsaved"
              ? "最新角色设置还没有保存成功，这条消息没有发送。请恢复网络后重试。（Code: chat_preparation_settings_unsaved）"
              : "最新设置或模型未确认，本轮没有发送，请检查设置保存状态后重试。（Code: chat_preparation_failed）");
        }
      }
      return;
    }
    setSendPreparationStage("");
    request.attachments = attachmentsToSend;
    request.attachmentsReleased = false;


 void deviceActivityRefresh;
 onReady();
}

import { memo } from "react";
import ChatMessage from "./ChatMessage.jsx";
import { getMessageSkinPresentation } from "./chat-skin.js";
import { innerMonologueForMessage, visibleMonologueForMessage } from "./inner-monologue.js";
import { useLatestCallback } from "./use-latest-callback.js";

const Entry = memo(function Entry({ item, previousRole, nextRole, preferences, monologueRecord, ...props }) {
  const neighbors = [previousRole === undefined ? undefined : {role:previousRole}, item,
    nextRole === undefined ? undefined : {role:nextRole}];
  const visible = visibleMonologueForMessage(item);
  const cached = innerMonologueForMessage({[item.id]:monologueRecord},item.id);
  const incomplete = !visible || !String(visible.text || "").trim() ||
    ["missing", "failed", "truncated"].includes(visible.state) || visible.display_truncated;
  const supplemented = cached?.generated_with_reply === false && cached?.state === "complete";
  const monologue = supplemented && incomplete ? cached
    : visible?.text ? visible : cached || visible;
  return <ChatMessage {...props} item={item} skin={preferences.skin} reduceMotion={preferences.reduceMotion === true}
    skinPresentation={getMessageSkinPresentation(neighbors,1,preferences)} innerMonologue={monologue} />;
});

export default function ChatTranscript({ messages, preferences, innerMonologues, innerMonologuePending,
  innerMonologueErrors, onPreview, onReference, onDismissError, onOpenActivity, onRequestInnerMonologue, onCancelInnerMonologue, ...props }) {
  const preview = useLatestCallback(onPreview), reference = useLatestCallback(onReference);
  const dismiss = useLatestCallback(onDismissError), activity = useLatestCallback(onOpenActivity);
  const requestMonologue = useLatestCallback(onRequestInnerMonologue);
  const cancelMonologue = useLatestCallback(onCancelInnerMonologue);
  return messages.map((item,index)=><Entry key={item.renderKey ?? item.id} {...props} item={item}
    previousRole={messages[index-1]?.role} nextRole={messages[index+1]?.role} preferences={preferences}
    monologueRecord={innerMonologues?.[item.id]} innerMonologuePending={innerMonologuePending?.[item.id]===true}
    innerMonologueError={innerMonologueErrors?.[item.id] || ""} onPreview={preview} onReference={reference}
    onDismissError={dismiss} onOpenActivity={activity} onRequestInnerMonologue={requestMonologue}
    onCancelInnerMonologue={typeof onCancelInnerMonologue === "function" ? cancelMonologue : undefined} />);
}

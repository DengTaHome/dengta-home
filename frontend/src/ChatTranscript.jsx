import { memo } from "react";
import ChatMessage from "./ChatMessage.jsx";
import { getMessageSkinPresentation } from "./chat-skin.js";
import { innerMonologueForMessage, visibleMonologueForMessage } from "./inner-monologue.js";
import { useLatestCallback } from "./use-latest-callback.js";

const Entry = memo(function Entry({ item, previousRole, nextRole, preferences, monologueRecord, ...props }) {
  const neighbors = [previousRole === undefined ? undefined : {role:previousRole}, item,
    nextRole === undefined ? undefined : {role:nextRole}];
  const visible = visibleMonologueForMessage(item);
  const monologue = visible?.text ? visible
    : innerMonologueForMessage({[item.id]:monologueRecord},item.id) || visible;
  return <ChatMessage {...props} item={item} skin={preferences.skin}
    skinPresentation={getMessageSkinPresentation(neighbors,1,preferences)} innerMonologue={monologue} />;
});

export default function ChatTranscript({ messages, preferences, innerMonologues, innerMonologuePending,
  innerMonologueErrors, onPreview, onReference, onDismissError, onOpenActivity, onRequestInnerMonologue, ...props }) {
  const preview = useLatestCallback(onPreview), reference = useLatestCallback(onReference);
  const dismiss = useLatestCallback(onDismissError), activity = useLatestCallback(onOpenActivity);
  const requestMonologue = useLatestCallback(onRequestInnerMonologue);
  return messages.map((item,index)=><Entry key={item.id} {...props} item={item}
    previousRole={messages[index-1]?.role} nextRole={messages[index+1]?.role} preferences={preferences}
    monologueRecord={innerMonologues?.[item.id]} innerMonologuePending={innerMonologuePending?.[item.id]===true}
    innerMonologueError={innerMonologueErrors?.[item.id] || ""} onPreview={preview} onReference={reference}
    onDismissError={dismiss} onOpenActivity={activity} onRequestInnerMonologue={requestMonologue} />);
}

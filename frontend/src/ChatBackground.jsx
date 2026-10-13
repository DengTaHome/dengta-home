import { usePrivateMediaSource } from "./use-private-media";

export default function ChatBackground({ src }) {
  const media = usePrivateMediaSource(src);
  if (!media.url) return null;
  return (
    <div className="private-chat-background" aria-hidden="true">
      <img src={media.url} alt="" decoding="async" />
    </div>
  );
}

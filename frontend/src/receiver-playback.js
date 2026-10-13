import { validateDirectMediaUrl } from "./direct-media.js";

export const RECEIVER_POLL_INTERVAL_MS = 1_000;
export const RECEIVER_ACK_INTERVAL_MS = 5_000;
export const RECEIVER_DRIFT_SECONDS = 1.5;

export function normalizeReceiverSession(data) {
  const value = data?.session || data || {};
  const mediaUrl = String(value.media_url || value.direct_media?.media_url || "").trim();
  const validation = validateDirectMediaUrl(mediaUrl);
  return Object.freeze({
    id: String(value.id || ""),
    status: value.status === "ended" ? "ended" : "active",
    title: String(value.title || "").trim().slice(0, 180),
    mediaUrl: validation.ok ? validation.url : "",
    mediaError: validation.ok ? "" : validation.message,
    revision: Math.max(0, Number(value.playback_revision ?? value.revision) || 0),
    playbackState: value.playback_state === "playing" ? "playing" : "paused",
    positionSeconds: Math.max(0, Number(value.media_position_seconds) || 0),
  });
}

export function shouldApplyReceiverRevision(lastRevision, nextRevision) {
  return Number(nextRevision) > Number(lastRevision);
}

export function shouldSeekReceiver(currentTime, targetTime) {
  return Math.abs((Number(currentTime) || 0) - (Number(targetTime) || 0)) > RECEIVER_DRIFT_SECONDS;
}

export async function applyReceiverPlayback(video, session) {
  if (!video || !session) return { seeked: false, autoplayBlocked: false };
  let seeked = false;
  if (shouldSeekReceiver(video.currentTime, session.positionSeconds)) {
    video.currentTime = session.positionSeconds;
    seeked = true;
  }
  if (session.playbackState === "paused") {
    video.pause();
    return { seeked, autoplayBlocked: false };
  }
  try {
    await video.play();
    return { seeked, autoplayBlocked: false };
  } catch (error) {
    if (error?.name === "NotAllowedError") {
      return { seeked, autoplayBlocked: true };
    }
    throw error;
  }
}

export function detectPlannedCastProviders(scope = globalThis) {
  return Object.freeze([
    Object.freeze({ id: "cast_receiver", label: "浏览器接收端", status: "ready", detected: true }),
    Object.freeze({ id: "chromecast", label: "Chromecast", status: "planned", detected: Boolean(scope.chrome?.cast) }),
    Object.freeze({ id: "dlna", label: "DLNA", status: "planned", detected: Boolean(scope.navigator?.presentation) }),
  ]);
}

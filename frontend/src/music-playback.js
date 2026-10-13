import { validateDirectAudioUrl } from "./music-listening.js";

export const MUSIC_PLAYBACK_MODES = Object.freeze({
  direct: "direct_https",
  local: "local_blob",
  external: "external_netease",
  resolved: "netease_resolved",
});

export function resolveMusicPlayback(item) {
  const mode = String(item?.playbackMode || item?.playback_mode || "");
  const url = String(item?.url || "");
  if (mode === MUSIC_PLAYBACK_MODES.resolved) {
    const direct = validateDirectAudioUrl(url);
    return Object.freeze({ mode: MUSIC_PLAYBACK_MODES.direct, url: direct.ok ? direct.url : "", validation: direct });
  }
  if (mode === MUSIC_PLAYBACK_MODES.external || item?.providerTrackId || item?.provider_track_id) {
    return Object.freeze({ mode: MUSIC_PLAYBACK_MODES.external, resourceType: "song", resourceId: String(item?.providerTrackId || item?.provider_track_id || "") });
  }
  if (mode === MUSIC_PLAYBACK_MODES.local || url.startsWith("blob:")) {
    return Object.freeze({ mode: MUSIC_PLAYBACK_MODES.local, url });
  }
  const direct = validateDirectAudioUrl(url);
  return Object.freeze({ mode: MUSIC_PLAYBACK_MODES.direct, url: direct.ok ? direct.url : "", validation: direct });
}

export function musicPlaybackIsInternal(playback) {
  return playback?.mode === MUSIC_PLAYBACK_MODES.direct || playback?.mode === MUSIC_PLAYBACK_MODES.local;
}

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { coWatchRequestOptions } from "./co-watch-request-scope.js";
import { createBuiltInNowPlaying } from "./built-in-now-playing.js";

export function useBuiltInNowPlaying({ scope, accountScope, companionScope, enabled, externalAvailable, readExternal, onSong, onBusy, onFeedback, onStartupFeedback }) {
  const callbacks = useRef({});
  const player = useRef(null);
  useLayoutEffect(() => { callbacks.current = { onSong, onBusy, onFeedback, onStartupFeedback, externalAvailable, readExternal }; });
  useLayoutEffect(() => {
    const instance = createBuiltInNowPlaying({
      scope,
      request: (path, options) => apiRequest(path, { ...options, retry: false, ...coWatchRequestOptions(options, authSession) }),
      onSong: song => callbacks.current.onSong(song), onBusy: value => callbacks.current.onBusy(value),
      onFeedback: message => callbacks.current.onFeedback(message), onStartupFeedback: value => callbacks.current.onStartupFeedback(value),
    });
    player.current = instance;
    return () => { instance.dispose(); if (player.current === instance) player.current = null; };
  }, [scope, accountScope, companionScope]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const instance = player.current, token = scope.capture();
    let randomEnabled = false;
    try { randomEnabled = window.localStorage.getItem("dengta_random_play_enabled") === "1"; } catch { /* Storage may be unavailable. */ }
    if (!randomEnabled) return;
    const timer = window.setTimeout(async () => {
      if (!active || !scope.current(token)) return;
      if (callbacks.current.externalAvailable()) {
        const song = await callbacks.current.readExternal().catch(() => null);
        if (!active || !scope.current(token) || (song?.title && song.isPlaying !== false)) return;
      }
      await instance?.start();
    }, 2500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [scope, accountScope, companionScope, enabled]);
  return useMemo(() => ({
    control: (action, song) => player.current?.control(action, song),
    yieldToExternal: () => player.current?.yieldToExternal(),
    onLocalPlaybackChange: event => player.current?.localPlaybackChanged(event),
  }), []);
}

export function useLocalPlaybackHandoff({ accountScope, companionScope, generation, onLocalPlaybackChange }) {
  const callback = useRef(onLocalPlaybackChange), lifetime = useRef(null);
  useLayoutEffect(() => { callback.current = onLocalPlaybackChange; });
  useLayoutEffect(() => {
    const value = { accountScope, companionScope, owner: null, phase: null };
    lifetime.current = value;
    return () => {
      if (value.owner) callback.current?.({ ...value, phase: "released" });
      if (lifetime.current === value) lifetime.current = null;
    };
  }, [accountScope, companionScope, generation]);
  return useMemo(() => (phase, expectedOwner) => {
    const value = lifetime.current;
    if (!value || (expectedOwner && value.owner !== expectedOwner)) return null;
    if (!value.owner && ["pending", "playing"].includes(phase)) value.owner = {};
    if (!value.owner) return null;
    const owner = value.owner;
    value.phase = phase;
    callback.current?.({ accountScope: value.accountScope, companionScope: value.companionScope, owner, phase });
    if (!["pending", "playing"].includes(phase)) value.owner = null;
    return owner;
  }, []);
}

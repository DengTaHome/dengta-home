import { useEffect, useRef, useState } from "react";
import { COAST_VIDEO_SCENES, coastSceneForSky, createCoastVideoLifecycle } from "./coast-video-lifecycle.js";
import "./coast-video-backdrop.css";

export default function CoastVideoBackdrop({ sky, weatherMode = "clear", reducedMotion = false }) {
  const scene = coastSceneForSky(sky);
  const videoRef = useRef(null);
  const layerRef = useRef(null);
  const [playback, setPlayback] = useState({ scene, posterScene: scene, state: "static" });
  const asset = COAST_VIDEO_SCENES[scene];
  const poster = COAST_VIDEO_SCENES[playback.posterScene];
  const state = playback.scene === scene ? playback.state : "static";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let disposed = false;
    let posterTimer = null;
    const lifecycle = createCoastVideoLifecycle(video, {
      source: asset.video,
      reducedMotion,
      applicationRoot: layerRef.current?.closest(".app-shell"),
      onState: next => {
        clearTimeout(posterTimer);
        setPlayback(current => ({
          scene,
          state: next,
          // Keep the previous still under the new clip during its initial fade.
          posterScene: next === "loading" || next === "playing" ? current.posterScene : scene,
        }));
        if (next === "playing") {
          posterTimer = setTimeout(() => {
            if (!disposed) setPlayback(current => current.scene === scene && current.state === "playing" ? { ...current, posterScene: scene } : current);
          }, 950);
        }
      },
    });
    return () => { disposed = true; clearTimeout(posterTimer); lifecycle.dispose(); };
  }, [asset.video, reducedMotion, scene]);

  return (
    <div ref={layerRef} className="coast-video-backdrop" data-scene={scene} data-playback={state} data-weather={weatherMode} aria-hidden="true">
      <img className="coast-video-poster" src={poster.poster} alt="" decoding="async" />
      <video ref={videoRef} className="coast-video-loop" muted loop playsInline preload="none" tabIndex={-1} disablePictureInPicture onTransitionEnd={event => {
        if (event.propertyName === "opacity") setPlayback(current => current.scene === scene && current.state === "playing" ? { ...current, posterScene: scene } : current);
      }} />
      <div className="coast-video-weather-shade" />
    </div>
  );
}

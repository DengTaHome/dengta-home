import { createVisualLoop } from "./visual-loop.js";
import { useEffect, useMemo, useRef } from "react";
import { getSunGlassSky, weatherModeFromAmbient, rainIntensityFromAmbient } from "./sun-glass-sky.js";
import useReducedVisualMotion from "./use-reduced-visual-motion.js";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sizeCanvas(canvas, maximumRatio) {
  const ratio = Math.min(window.devicePixelRatio || 1, maximumRatio);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  return ratio;
}

function drawCloudShape(context, x, y, size, alpha, darkness) {
  context.save();
  context.translate(x, y);
  context.scale(size, size * 0.74);
  context.filter = `blur(${6 + size * 3}px)`;
  const cloudPath = (offsetY = 0) => {
    context.beginPath();
    context.ellipse(-58, 8 + offsetY, 67, 28, 0, 0, Math.PI * 2);
    context.ellipse(-18, -11 + offsetY, 52, 38, 0, 0, Math.PI * 2);
    context.ellipse(32, -4 + offsetY, 61, 34, 0, 0, Math.PI * 2);
    context.ellipse(73, 12 + offsetY, 51, 24, 0, 0, Math.PI * 2);
  };
  context.fillStyle = `rgba(${Math.round(82 - darkness * 30)},${Math.round(105 - darkness * 24)},${Math.round(136 - darkness * 18)},${alpha * (0.2 + darkness * 0.28)})`;
  cloudPath(9);
  context.fill();
  context.fillStyle = `rgba(${Math.round(246 - darkness * 126)},${Math.round(248 - darkness * 120)},${Math.round(250 - darkness * 102)},${alpha})`;
  cloudPath();
  context.fill();
  context.restore();
}

function usePrototypeAtmosphere({ starsRef, cloudsRef, weatherRef, sky, mode, rainIntensity = 1, reduceMotion }) {
  const skyRef = useRef(sky);
  const loopRef = useRef(null);
  const starsVisible = sky.night > 0.08;

  useEffect(() => {
    skyRef.current = sky;
    loopRef.current?.invalidate();
  }, [sky]);

  useEffect(() => {
    const starsCanvas = starsRef.current;
    const cloudCanvas = cloudsRef.current;
    const weatherCanvas = weatherRef.current;
    if (!starsCanvas || !cloudCanvas || !weatherCanvas) return undefined;

    const starsContext = starsCanvas.getContext("2d");
    const cloudContext = cloudCanvas.getContext("2d");
    const weatherContext = weatherCanvas.getContext("2d");
    if (!starsContext || !cloudContext || !weatherContext) return undefined;
    let starPoints = [];
    let galaxyPoints = [];
    let cloudPoints = [];
    let rainDrops = [];
    let glassDrops = [];
    let ripples = [];
    let nextRippleAt = 0;
    let nextLightningAt = performance.now() + 480;
    let lightningUntil = 0;
    let lightningSegments = [];


    const resize = () => {
      sizeCanvas(starsCanvas, 2);
      sizeCanvas(cloudCanvas, 1.5);
      sizeCanvas(weatherCanvas, 1.5);
      starPoints = Array.from({ length: 190 }, (_, index) => ({
        x: ((index * 73) % 997) / 997,
        y: (((index * 137 + 31) % 719) / 719) * 0.78,
        radius: 0.35 + ((index * 19) % 13) / 10,
        phase: (index * 0.71) % (Math.PI * 2),
        steady: index % 4 === 0,
        speed: 900 + (index % 7) * 230,
      }));
      galaxyPoints = Array.from({ length: 520 }, (_, index) => {
        const x = ((index * 89) % 997) / 997;
        const spread =
          ((((index * 149 + 47) % 1009) / 1009) - 0.5) * 0.2;
        return {
          x,
          y: 0.66 - x * 0.5 + spread,
          radius: 0.25 + ((index * 17) % 11) / 14,
          alpha: 0.14 + ((index * 23) % 17) / 29,
        };
      });
      cloudPoints = Array.from({ length: 9 }, (_, index) => ({
        x: ((index * 0.19 + 0.07) % 1.28) - 0.14,
        y: [0.2, 0.31, 0.47, 0.66, 0.26, 0.55, 0.39, 0.72, 0.16][index],
        scale: 0.62 + ((index * 29) % 7) / 8,
        speed: 0.65 + (index % 5) * 0.16,
        depth: 0.56 + (index % 3) * 0.18,
      }));
      rainDrops = Array.from({ length: Math.round(94 * rainIntensity) }, (_, index) => ({
        x: ((index * 83) % 991) / 991,
        y: ((index * 131) % 977) / 977,
        speed: (0.52 + (index % 11) / 14) * Math.sqrt(rainIntensity),
        length: (11 + (index % 9) * 2.2) * Math.sqrt(rainIntensity),
      }));
      glassDrops = Array.from({ length: 38 }, (_, index) => ({
        x: ((index * 97 + 23) % 991) / 991,
        y: ((index * 151 + 41) % 977) / 977,
        size: 1.8 + (index % 8) * 0.7,
        phase: index * 0.81,
      }));
    };

    const createLightning = (now) => {
      let x = window.innerWidth * (0.2 + Math.random() * 0.6);
      let y = -10;
      lightningSegments = [];
      while (y < window.innerHeight * 0.68) {
        const nextX = x + (Math.random() - 0.5) * 58;
        const nextY = y + 34 + Math.random() * 42;
        lightningSegments.push([x, y, nextX, nextY]);
        x = nextX;
        y = nextY;
      }
      lightningUntil = now + 430;
      nextLightningAt = now + 4600 + Math.random() * 5200;
    };

    const paint = (now) => {
      const currentSky = skyRef.current;
      const starsRatio = Math.min(window.devicePixelRatio || 1, 2);
      const cloudRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = starsCanvas.width / starsRatio;
      const height = starsCanvas.height / starsRatio;

      starsContext.setTransform(starsRatio, 0, 0, starsRatio, 0, 0);
      starsContext.clearRect(0, 0, width, height);
      if (currentSky.night > 0.08) {
        starsContext.save();
        starsContext.globalAlpha = clamp((currentSky.night - 0.24) * 1.2);
        starsContext.translate(width * 0.52, height * 0.31);
        starsContext.rotate(-0.42);
        const galaxyBand = starsContext.createLinearGradient(
          0,
          -height * 0.2,
          0,
          height * 0.2,
        );
        galaxyBand.addColorStop(0, "rgba(152,172,226,0)");
        galaxyBand.addColorStop(0.35, "rgba(157,179,230,.16)");
        galaxyBand.addColorStop(0.5, "rgba(255,239,219,.48)");
        galaxyBand.addColorStop(0.65, "rgba(191,166,224,.2)");
        galaxyBand.addColorStop(1, "rgba(121,151,215,0)");
        starsContext.fillStyle = galaxyBand;
        starsContext.filter = "blur(10px)";
        starsContext.fillRect(-width, -height * 0.2, width * 2, height * 0.4);
        starsContext.restore();
        starsContext.save();
        starsContext.globalAlpha = clamp((currentSky.night - 0.28) * 1.35);
        for (const point of galaxyPoints) {
          starsContext.beginPath();
          starsContext.fillStyle = `rgba(232,227,255,${point.alpha})`;
          starsContext.arc(
            point.x * width,
            point.y * height,
            point.radius,
            0,
            Math.PI * 2,
          );
          starsContext.fill();
        }
        starsContext.restore();
      }
      if (starsVisible) {
        for (const point of starPoints) {
          const pulse = point.steady
            ? 0.6
            : 0.5 + Math.sin(now / point.speed + point.phase) * 0.34;
          const alpha = clamp(pulse) * (0.72 + currentSky.night * 0.28);
          starsContext.beginPath();
          starsContext.fillStyle = `rgba(255,250,231,${alpha})`;
          starsContext.shadowColor = point.steady
            ? "transparent"
            : "rgba(210,225,255,.72)";
          starsContext.shadowBlur = point.steady ? 0 : 4;
          starsContext.arc(
            point.x * width,
            point.y * height,
            point.radius,
            0,
            Math.PI * 2,
          );
          starsContext.fill();
        }
      }
      starsContext.shadowBlur = 0;

      const cloudWidth = cloudCanvas.width / cloudRatio;
      const cloudHeight = cloudCanvas.height / cloudRatio;
      const cloudStrength = mode === "cloudy" || mode === "rain" ? 1 : 0;
      cloudContext.setTransform(cloudRatio, 0, 0, cloudRatio, 0, 0);
      cloudContext.clearRect(0, 0, cloudWidth, cloudHeight);
      if (cloudStrength) {
        const darkness = clamp(
          (1 - currentSky.daylight) * 0.45 + (mode === "rain" ? 0.5 : 0),
        );
        for (const cloud of cloudPoints) {
          const travel = (now * 0.0000032 * cloud.speed) % 1.4;
          const x =
            (((cloud.x + travel + 0.18) % 1.4) - 0.18) * cloudWidth;
          drawCloudShape(
            cloudContext,
            x,
            cloud.y * cloudHeight,
            Math.max(0.72, cloudWidth / 780) * cloud.scale,
            cloud.depth * (mode === "rain" ? 0.7 : 0.4),
            darkness,
          );
        }
      }

      const weatherWidth = weatherCanvas.width / cloudRatio;
      const weatherHeight = weatherCanvas.height / cloudRatio;
      weatherContext.setTransform(cloudRatio, 0, 0, cloudRatio, 0, 0);
      weatherContext.clearRect(0, 0, weatherWidth, weatherHeight);
      if (mode === "rain") {
        weatherContext.lineCap = "round";
        weatherContext.strokeStyle = "rgba(230,244,255,.18)";
        for (const drop of rainDrops) {
          const y =
            ((drop.y + now * 0.00055 * drop.speed) % 1.18) * weatherHeight -
            weatherHeight * 0.1;
          const x = drop.x * weatherWidth + y * 0.035;
          weatherContext.lineWidth = 0.7 + drop.speed;
          weatherContext.beginPath();
          weatherContext.moveTo(x, y - drop.length);
          weatherContext.lineTo(x + 2.4, y + drop.length);
          weatherContext.stroke();
        }
        for (const drop of glassDrops) {
          weatherContext.beginPath();
          weatherContext.fillStyle = "rgba(236,247,255,.16)";
          weatherContext.shadowColor = "rgba(255,255,255,.28)";
          weatherContext.shadowBlur = 5;
          weatherContext.ellipse(
            drop.x * weatherWidth,
            drop.y * weatherHeight + Math.sin(now / 1300 + drop.phase) * 0.8,
            drop.size * 0.72,
            drop.size,
            0.18,
            0,
            Math.PI * 2,
          );
          weatherContext.fill();
        }
        weatherContext.shadowBlur = 0;
        if (now > nextRippleAt) {
          ripples.push({
            x: weatherWidth * (0.08 + Math.random() * 0.84),
            y: weatherHeight * (0.16 + Math.random() * 0.72),
            born: now,
          });
          nextRippleAt = now + 260 + Math.random() * 520;
        }
      }
      ripples = ripples.filter(
        (ripple) => now - ripple.born < 1450 && mode === "rain",
      );
      for (const ripple of ripples) {
        const progress = (now - ripple.born) / 1450;
        weatherContext.strokeStyle = `rgba(225,241,255,${(1 - progress) * 0.28})`;
        weatherContext.lineWidth = 1.2 - progress * 0.7;
        weatherContext.beginPath();
        weatherContext.ellipse(
          ripple.x,
          ripple.y,
          4 + progress * 34,
          (4 + progress * 34) * 0.38,
          0,
          0,
          Math.PI * 2,
        );
        weatherContext.stroke();
      }
      if (mode === "storm" && now > nextLightningAt) createLightning(now);
      if (mode === "storm" && now < lightningUntil) {
        const flash = clamp((lightningUntil - now) / 430);
        weatherContext.fillStyle = `rgba(216,229,255,${flash * 0.2})`;
        weatherContext.fillRect(0, 0, weatherWidth, weatherHeight);
        weatherContext.strokeStyle = `rgba(240,245,255,${0.72 + flash * 0.28})`;
        weatherContext.shadowColor = "rgba(164,197,255,.9)";
        weatherContext.shadowBlur = 18;
        weatherContext.lineWidth = 1.35;
        weatherContext.beginPath();
        for (const [x1, y1, x2, y2] of lightningSegments) {
          weatherContext.moveTo(x1, y1);
          weatherContext.lineTo(x2, y2);
        }
        weatherContext.stroke();
        weatherContext.shadowBlur = 0;
      }

    };

    resize();
    const hasVisibleMotion = starsVisible || mode === "cloudy" || mode === "rain" || mode === "storm";
    const loop = createVisualLoop(paint, { animated: hasVisibleMotion, reducedMotion: reduceMotion, interval: () => {
      if (document.documentElement.dataset.timeScrubbing === "true") return 120;
      if (document.querySelector(".settings-sheet, .message-list.is-scrolling")) return 180;
      if (document.querySelector('[data-chat-streaming="true"]')) return 100;
      return 33;
    } });
    loopRef.current = loop;
    const handleResize = () => { resize(); loop.invalidate(); };
    window.addEventListener("resize", handleResize);
    return () => {
      loop.dispose();
      loopRef.current = null;
      window.removeEventListener("resize", handleResize);
    };
  }, [cloudsRef, mode, rainIntensity, starsRef, starsVisible, weatherRef, reduceMotion]);
}

export default function CelestialBackdrop({
  snapshot,
  weather = null,
  weatherModeOverride = null,
}) {
  const starsRef = useRef(null);
  const cloudsRef = useRef(null);
  const weatherRef = useRef(null);
  const reduceMotion = useReducedVisualMotion();
  const minute = Number.isFinite(snapshot.minute)
    ? snapshot.minute
    : snapshot.hour * 60;
  const sky = useMemo(() => getSunGlassSky(minute, snapshot), [minute, snapshot]);
  const weatherMode = ["clear", "cloudy", "rain", "storm"].includes(
    weatherModeOverride,
  )
    ? weatherModeOverride
    : weatherModeFromAmbient(weather);
  const rainIntensity = weatherModeOverride
    ? weatherMode === "storm" ? 1.6 : 1
    : rainIntensityFromAmbient(weather);
  usePrototypeAtmosphere({
    starsRef,
    cloudsRef,
    weatherRef,
    sky,
    mode: weatherMode,
    rainIntensity,
    reduceMotion,
  });

  const style = Object.fromEntries([
    ...sky.colors.map((color, index) => [`--sky-${index + 1}`, color]),
    ["--sun-x", `${sky.sunX}%`],
    ["--sun-y", `${sky.sunY}%`],
    ["--sun-opacity", sky.sunOpacity],
    ["--moon-x", `${sky.moonX}%`],
    ["--moon-y", `${sky.moonY}%`],
    ["--moon-opacity", sky.moonOpacity],
    ["--prototype-star-opacity", sky.night],
    ["--milky-opacity", sky.milkyOpacity],
    ["--horizon-opacity", sky.horizonOpacity],
    ["--sunset-opacity", sky.sunset],
    ["--day-aura-opacity", sky.dayAura],
    ["--sunrise-aura-opacity", sky.sunriseAura],
    ["--sunset-aura-opacity", sky.sunsetAura],
    ["--blue-aura-opacity", sky.blueAura],
    ["--solar-falloff-opacity", sky.falloffOpacity],
    ["--chromatic-opacity", sky.chromaticOpacity],
  ]);

  return (
    <div
      className="celestial-backdrop celestial-prototype-sky"
      aria-hidden="true"
      data-weather={weatherMode}
      data-minute={Math.round(sky.minute)}
      data-solar-minute={Math.round(sky.solarMinute)}
      style={style}
    >
      <canvas className="celestial-stars-canvas" ref={starsRef} />
      <div className="celestial-milky-way" />
      <div className="celestial-chromatic-light" />
      <div className="celestial-sunset-glow" />
      <div className="celestial-solar-falloff" />
      <div className="celestial-aura celestial-aura-day" />
      <div className="celestial-aura celestial-aura-sunrise" />
      <div className="celestial-aura celestial-aura-sunset" />
      <div className="celestial-aura celestial-aura-blue" />
      <div className="celestial-sun" />
      <div className="celestial-moon" />
      <canvas className="celestial-weather-clouds" ref={cloudsRef} />
      <div className="celestial-horizon-glow" />
      <div className="celestial-glass-dome">
        <div className="celestial-glass-haze" />
        <canvas className="celestial-glass-weather" ref={weatherRef} />
        <div className="celestial-glass-sheen" />
      </div>
    </div>
  );
}

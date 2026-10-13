import { useEffect, useMemo, useState } from "react";
import {
  formatSolarTime,
  getSolarSchedule,
  phaseProgress,
} from "./solar-cycle.js";
import { readAccountStorage, writeAccountStorage } from "./account-storage.js";

export const DENGTA_THEME_STORAGE_KEY = "dengta.ui-theme.v2";
export const DENGTA_FONT_MODE_STORAGE_KEY = "dengta.font-mode.v1";
const LEGACY_THEME_STORAGE_KEY = "dengta.ui-theme.v1";

export const THEME_PRESETS = [
  {
    id: "ivory",
    label: "象牙纸张",
    accent: "#a96854",
    card: "#fffdf8",
    background: "#eee9df",
    ink: "#24211f",
  },
  {
    id: "moon-sand",
    label: "月沙",
    accent: "#c6768f",
    card: "#fbf4f2",
    background: "#d9c6c7",
    ink: "#352e31",
  },
  {
    id: "milk-orange",
    label: "奶油甜橙",
    accent: "#dd8a2e",
    card: "#fff9ed",
    background: "#ecd8bd",
    ink: "#382e25",
  },
  {
    id: "mist-mountain",
    label: "雾山",
    accent: "#709078",
    card: "#f5faf6",
    background: "#b9c8bf",
    ink: "#25302a",
  },
  {
    id: "fog-blue",
    label: "雾蓝",
    accent: "#4f78d3",
    card: "#f3f8ff",
    background: "#bfd0e4",
    ink: "#202a3a",
  },
  {
    id: "ink",
    label: "墨白",
    accent: "#242628",
    card: "#fbfbfa",
    background: "#d8d8d4",
    ink: "#171819",
  },
];

export const DEFAULT_THEME_PREFERENCES = {
  preset: "ivory",
  accent: "#a96854",
  card: "#fffdf8",
  cardOpacity: 0.18,
  appearance: "auto",
  fontMode: "standard",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const APPEARANCE_MODES = new Set(["auto", "day", "night"]);
const FONT_MODES = new Set(["standard", "system"]);

function safeColor(value, fallback) {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;
}

function boundedOpacity(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : DEFAULT_THEME_PREFERENCES.cardOpacity;
}

function temporalProximity(date, center, radiusMs) {
  return Math.max(
    0,
    Math.min(1, 1 - Math.abs(date.valueOf() - center.valueOf()) / radiusMs),
  );
}

export function normalizeThemePreferences(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const preset =
    THEME_PRESETS.find((item) => item.id === source.preset) ||
    THEME_PRESETS[0];
  return {
    preset: preset.id,
    accent: safeColor(source.accent, preset.accent),
    card: safeColor(source.card, preset.card),
    cardOpacity: boundedOpacity(source.cardOpacity),
    appearance: APPEARANCE_MODES.has(source.appearance)
      ? source.appearance
      : DEFAULT_THEME_PREFERENCES.appearance,
    fontMode: FONT_MODES.has(source.fontMode)
      ? source.fontMode
      : DEFAULT_THEME_PREFERENCES.fontMode,
  };
}

export function readThemePreferences(
  storage = globalThis.localStorage,
  accountScope = "",
) {
  try {
    const stored = readAccountStorage(
      storage,
      DENGTA_THEME_STORAGE_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    if (stored) return normalizeThemePreferences(JSON.parse(stored));
    const legacy = readAccountStorage(
      storage,
      LEGACY_THEME_STORAGE_KEY,
      accountScope,
      { migrateLegacy: true },
    );
    if (!legacy) return DEFAULT_THEME_PREFERENCES;
    const parsed = JSON.parse(legacy);
    return normalizeThemePreferences({
      ...parsed,
      cardOpacity:
        Number(parsed?.cardOpacity) === 0.82
          ? DEFAULT_THEME_PREFERENCES.cardOpacity
          : parsed?.cardOpacity,
    });
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(
  preferences,
  storage = globalThis.localStorage,
  accountScope = "",
) {
  const normalized = normalizeThemePreferences(preferences);
  try {
    writeAccountStorage(
      storage,
      DENGTA_THEME_STORAGE_KEY,
      accountScope,
      JSON.stringify(normalized),
    );
    storage?.setItem(DENGTA_FONT_MODE_STORAGE_KEY, normalized.fontMode);
  } catch {
    // A private WebView can reject storage; the in-memory theme still works.
  }
  return normalized;
}

function hexToRgbChannels(value) {
  return hexToRgb(value).join(" ");
}

function hexToRgb(value) {
  const normalized = safeColor(value, "#ffffff").slice(1);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16),
  );
}

function mixRgbChannels(parts) {
  return [0, 1, 2]
    .map((channel) =>
      Math.round(
        parts.reduce(
          (total, part) => total + part.rgb[channel] * part.weight,
          0,
        ),
      ),
    )
    .join(" ");
}

function chinaTimeParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function dateAtChinaMinute(date, minute) {
  const parts = chinaTimeParts(date);
  const normalizedMinute = Math.max(0, Math.min(1439, Math.round(minute)));
  const hour = String(Math.floor(normalizedMinute / 60)).padStart(2, "0");
  const minutePart = String(normalizedMinute % 60).padStart(2, "0");
  return new Date(
    `${parts.year}-${parts.month}-${parts.day}T${hour}:${minutePart}:00+08:00`,
  );
}

function stablePatternIndex(value, count) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

export function getCelestialSnapshot(
  date = new Date(),
  appearance = "auto",
  coordinates,
) {
  const parts = chinaTimeParts(date);
  const hour = Number(parts.hour) + Number(parts.minute) / 60;
  const schedule = getSolarSchedule(date, coordinates);
  const previousSchedule = getSolarSchedule(date, coordinates, -1);
  const nextSchedule = getSolarSchedule(date, coordinates, 1);
  const dawnEnd = new Date(
    schedule.sunrise.valueOf() +
      Math.max(
        60 * 60 * 1000,
        (schedule.sunset.valueOf() - schedule.sunrise.valueOf()) * 0.1,
      ),
  );
  const duskStart = new Date(
    schedule.sunset.valueOf() -
      Math.max(
        60 * 60 * 1000,
        (schedule.sunset.valueOf() - schedule.sunrise.valueOf()) * 0.1,
      ),
  );
  const phase =
    date >= schedule.civilDawn && date < dawnEnd
      ? "dawn"
      : date >= dawnEnd && date < duskStart
        ? "day"
        : date >= duskStart && date < schedule.civilDusk
          ? "dusk"
          : "night";
  const resolvedAppearance =
    appearance === "auto"
      ? phase === "night"
        ? "night"
        : "day"
      : appearance;
  const patterns = ["cat", "grid", "diamond", "botanical"];
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const pattern =
    patterns[stablePatternIndex(`${dateKey}:${phase}`, patterns.length)];
  const isSun = date >= schedule.civilDawn && date < schedule.civilDusk;
  const nightStart =
    date < schedule.civilDawn
      ? previousSchedule.civilDusk
      : schedule.civilDusk;
  const nightEnd =
    date < schedule.civilDawn ? schedule.civilDawn : nextSchedule.civilDawn;
  const progress = isSun
    ? phaseProgress(date, schedule.civilDawn, schedule.civilDusk)
    : phaseProgress(date, nightStart, nightEnd);
  const arc = Math.sin(Math.PI * progress);
  const sunIntensity = 1;
  const moonIntensity = 1;
  const activeIntensity =
    (isSun ? sunIntensity : moonIntensity) * (0.44 + arc * 0.56);
  const sunriseAura = temporalProximity(
    date,
    schedule.sunrise,
    105 * 60 * 1000,
  );
  const sunsetAura = temporalProximity(
    date,
    schedule.sunset,
    105 * 60 * 1000,
  );
  const blueHourAura = Math.max(
    temporalProximity(date, schedule.civilDawn, 80 * 60 * 1000),
    temporalProximity(date, schedule.civilDusk, 80 * 60 * 1000),
  );

  return {
    dateKey,
    hour,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    phase,
    pattern,
    resolvedAppearance,
    isSun,
    progress,
    arc,
    activeIntensity,
    sunIntensity,
    moonIntensity,
    lightAngle: -18 + progress * 36,
    lightSource: schedule.source,
    sunrise: schedule.sunrise.toISOString(),
    sunset: schedule.sunset.toISOString(),
    sunriseLabel: formatSolarTime(schedule.sunrise),
    sunsetLabel: formatSolarTime(schedule.sunset),
    moonPeak: phase === "night" && (hour >= 22 || hour < 2),
    sunriseAura,
    sunsetAura,
    blueHourAura,
  };
}

export function applyGlassLevel(value, root, { includeBlur = false } = {}) {
  if (!root) return;
  const glassAmount = boundedOpacity(value);
  root.style.setProperty("--theme-card-opacity", String(glassAmount));
  root.style.setProperty("--dengta-glass-level", glassAmount.toFixed(3));
  root.style.setProperty(
    "--dengta-glass-panel-alpha",
    (0.025 + glassAmount * 0.46).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-bubble-alpha",
    (0.035 + glassAmount * 0.5).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-popover-alpha",
    (0.045 + glassAmount * 0.56).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-control-alpha",
    (0.045 + glassAmount * 0.34).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-dome-alpha",
    (glassAmount * 0.13).toFixed(3),
  );
  if (includeBlur) {
    root.style.setProperty(
      "--dengta-glass-panel-blur",
      `${(glassAmount * 30).toFixed(1)}px`,
    );
    root.style.setProperty(
      "--dengta-glass-dome-blur",
      `${(glassAmount * 10).toFixed(1)}px`,
    );
    root.style.setProperty(
      "--dengta-glass-saturation",
      (1.03 + glassAmount * 0.36).toFixed(3),
    );
  }
  root.style.setProperty(
    "--dengta-glass-border-alpha",
    (0.32 + glassAmount * 0.38).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-haze-opacity",
    (0.015 + glassAmount * 0.9).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-sheen-opacity",
    (0.12 + glassAmount * 0.7).toFixed(3),
  );
}

export function applyThemePreferences(preferences, snapshot, root) {
  if (!root) return;
  const normalized = normalizeThemePreferences(preferences);
  const preset =
    THEME_PRESETS.find((item) => item.id === normalized.preset) ||
    THEME_PRESETS[0];
  const isNight = snapshot.resolvedAppearance === "night";
  const isGoldenHour = ["dawn", "dusk"].includes(snapshot.phase);
  const accentRgb = hexToRgbChannels(normalized.accent);
  const cardSource = hexToRgb(normalized.card);
  const presetBackground = hexToRgb(preset.background);
  const cardSourceRgb = cardSource.join(" ");
  const cardRgb = isNight
    ? mixRgbChannels([
        { rgb: cardSource, weight: 0.14 },
        { rgb: [22, 26, 32], weight: 0.86 },
      ])
    : mixRgbChannels([
        { rgb: cardSource, weight: 0.16 },
        { rgb: presetBackground, weight: 0.28 },
        { rgb: [255, 255, 255], weight: 0.56 },
      ]);
  const resolvedBackground = isNight ? "#171a20" : preset.background;
  const backgroundRgb = hexToRgbChannels(resolvedBackground);
  const resolvedInk = isNight ? "#eef0f0" : preset.ink;
  const inkRgb = hexToRgbChannels(resolvedInk);
  const themeMuted = `rgb(${inkRgb} / ${isNight ? 0.68 : 0.56})`;
  const themeInkSoft = `rgb(${inkRgb} / ${isNight ? 0.84 : 0.72})`;
  const themeControlBorder = isNight
    ? `rgb(${inkRgb} / 0.24)`
    : `rgb(${inkRgb} / 0.12)`;
  const themeControlBackground = isNight
    ? `rgb(${cardRgb} / 0.78)`
    : `rgb(${cardRgb} / 0.66)`;
  const glassAmount = normalized.cardOpacity;
  root.dataset.dengtaTheme = normalized.preset;
  root.dataset.dengtaAppearance = snapshot.resolvedAppearance;
  root.dataset.dengtaPhase = snapshot.phase;
  root.dataset.dengtaFontMode = normalized.fontMode;
  root.style.setProperty("--theme-accent", normalized.accent);
  root.style.setProperty("--theme-accent-rgb", accentRgb);
  root.style.setProperty("--theme-card-source-rgb", cardSourceRgb);
  root.style.setProperty("--theme-card-rgb", cardRgb);
  root.style.setProperty(
    "--theme-card-opacity",
    String(normalized.cardOpacity),
  );
  root.style.setProperty("--dengta-glass-level", glassAmount.toFixed(3));
  root.style.setProperty(
    "--dengta-glass-panel-alpha",
    (0.025 + glassAmount * 0.46).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-bubble-alpha",
    (0.035 + glassAmount * 0.5).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-popover-alpha",
    (0.045 + glassAmount * 0.56).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-control-alpha",
    (0.045 + glassAmount * 0.34).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-dome-alpha",
    (glassAmount * 0.13).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-panel-blur",
    `${(glassAmount * 30).toFixed(1)}px`,
  );
  root.style.setProperty(
    "--dengta-glass-dome-blur",
    `${(glassAmount * 10).toFixed(1)}px`,
  );
  root.style.setProperty(
    "--dengta-glass-saturation",
    (1.03 + glassAmount * 0.36).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-border-alpha",
    (0.32 + glassAmount * 0.38).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-haze-opacity",
    (0.015 + glassAmount * 0.9).toFixed(3),
  );
  root.style.setProperty(
    "--dengta-glass-sheen-opacity",
    (0.12 + glassAmount * 0.7).toFixed(3),
  );
  root.style.setProperty("--theme-background", resolvedBackground);
  root.style.setProperty("--theme-background-rgb", backgroundRgb);
  root.style.setProperty("--theme-ink", resolvedInk);
  root.style.setProperty("--theme-ink-rgb", inkRgb);
  root.style.setProperty("--theme-muted", themeMuted);
  root.style.setProperty("--theme-ink-soft", themeInkSoft);
  root.style.setProperty("--theme-control-border", themeControlBorder);
  root.style.setProperty(
    "--theme-control-background",
    themeControlBackground,
  );
  root.style.setProperty("--theme-wallpaper-tint-rgb", accentRgb);
  root.style.setProperty(
    "--theme-wallpaper-tint-opacity",
    String(isNight ? 0.38 : isGoldenHour ? 0.26 : 0.18),
  );
  root.style.setProperty(
    "--theme-wallpaper-veil-opacity",
    String(isNight ? 0.52 : isGoldenHour ? 0.34 : 0.24),
  );
  root.style.setProperty(
    "--theme-glass-highlight",
    `rgb(${cardRgb} / ${isNight ? 0.2 : 0.72})`,
  );
  root.style.setProperty(
    "--theme-glass-shadow",
    isNight ? "rgb(5 9 16 / 0.3)" : `rgb(${inkRgb} / 0.11)`,
  );
  root.style.setProperty(
    "--theme-glass-border",
    `rgb(${cardRgb} / ${isNight ? 0.24 : 0.78})`,
  );
  root.style.setProperty(
    "--celestial-light-intensity",
    snapshot.activeIntensity.toFixed(3),
  );
  root.style.setProperty(
    "--sun-light-intensity",
    "1",
  );
  root.style.setProperty(
    "--moon-light-intensity",
    "1",
  );
}

export function useDengTaTheme(coordinates = null, accountScope = "") {
  const [preferences, setPreferences] = useState(() =>
    readThemePreferences(globalThis.localStorage, accountScope),
  );
  const [clock, setClock] = useState(() => new Date());
  const [previewMinute, setPreviewMinute] = useState(null);
  const displayedClock = useMemo(
    () =>
      Number.isFinite(previewMinute)
        ? dateAtChinaMinute(clock, previewMinute)
        : clock,
    [clock, previewMinute],
  );
  const snapshot = useMemo(
    () =>
      getCelestialSnapshot(
        displayedClock,
        preferences.appearance,
        coordinates,
      ),
    [
      displayedClock,
      coordinates,
      preferences.appearance,
    ],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const normalized = writeThemePreferences(
      preferences,
      globalThis.localStorage,
      accountScope,
    );
    applyThemePreferences(normalized, snapshot, document.documentElement);
  }, [accountScope, preferences, snapshot]);

  function updateTheme(patch) {
    setPreferences((current) =>
      normalizeThemePreferences({
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      }),
    );
  }

  return {
    preferences,
    snapshot,
    updateTheme,
    previewMinute,
    setPreviewMinute,
  };
}

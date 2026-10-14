const DAY_KEYS = Object.freeze([
  { minute: 0, colors: ["#020613", "#061027", "#0a1735", "#111d3b", "#182545"] },
  { minute: 300, colors: ["#030817", "#09132d", "#121c3b", "#1d284a", "#2c3456"] },
  { minute: 390, colors: ["#233b69", "#52688f", "#8c89a9", "#c79fae", "#e5b59f"] },
  { minute: 450, colors: ["#9cc8dc", "#b9d9d3", "#dce4bd", "#ffd590", "#ffb879"] },
  { minute: 510, colors: ["#8fc5e0", "#b8dbd5", "#e4e3bd", "#ffd88c", "#ffc178"] },
  { minute: 720, colors: ["#72acd7", "#a8d0da", "#d8dfc9", "#f5d69a", "#f7c683"] },
  { minute: 930, colors: ["#78a5cd", "#a7c2d1", "#d6cfc4", "#efba9b", "#ef9c88"] },
  { minute: 1020, colors: ["#587ca9", "#887fa8", "#bb7fa1", "#eb7d86", "#ff6d62"] },
  { minute: 1080, colors: ["#385d93", "#726c9e", "#b76892", "#ef5e70", "#ff493f"] },
  { minute: 1120, colors: ["#173f76", "#315b91", "#506ea0", "#7181a7", "#9a91ab"] },
  { minute: 1180, colors: ["#101d42", "#1d315b", "#344873", "#55577e", "#796683"] },
  { minute: 1260, colors: ["#050a1b", "#0a1430", "#101e42", "#1a294c", "#263457"] },
  { minute: 1440, colors: ["#020613", "#061027", "#0a1735", "#111d3b", "#182545"] },
]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseHex(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((index) =>
    Number.parseInt(clean.slice(index, index + 2), 16),
  );
}

function mixColor(left, right, amount) {
  const a = parseHex(left);
  const b = parseHex(right);
  const channels = a.map((value, index) =>
    Math.round(value + (b[index] - value) * amount),
  );
  return `rgb(${channels.join(" ")})`;
}

function triangle(minute, center, radius) {
  return clamp(1 - Math.abs(minute - center) / radius);
}

export function solarSkyMinute(minute, snapshot) {
  const current = ((Number(minute) % 1440) + 1440) % 1440;
  const rise = Date.parse(snapshot?.sunrise);
  const set = Date.parse(snapshot?.sunset);
  if (!Number.isFinite(current) || !Number.isFinite(rise) || !Number.isFinite(set)) return minute;
  const duration = (set - rise) / 60000;
  if (duration <= 0 || duration >= 1440) return minute;
  // The application clock and solar labels use China Standard Time.
  const riseMinute = ((rise / 60000 + 480) % 1440 + 1440) % 1440;
  const elapsed = (current - riseMinute + 1440) % 1440;
  return elapsed <= duration
    ? 450 + (elapsed / duration) * 720
    : (1170 + ((elapsed - duration) / (1440 - duration)) * 720) % 1440;
}

export function getSunGlassSky(minute, snapshot) {
  const actualMinute = Number(minute);
  const solarDuration = Date.parse(snapshot?.sunset) - Date.parse(snapshot?.sunrise);
  const hasSolarSchedule = Number.isFinite(solarDuration) && solarDuration > 0 && solarDuration < 86400000;
  minute = solarSkyMinute(minute, snapshot);
  const input = Number(minute);
  const normalized = Number.isFinite(input) ? ((input % 1440) + 1440) % 1440 : 0;
  const rightIndex = DAY_KEYS.findIndex((key) => key.minute >= normalized);
  const right = DAY_KEYS[Math.max(1, rightIndex)];
  const left = DAY_KEYS[Math.max(0, rightIndex - 1)];
  const amount =
    (normalized - left.minute) / Math.max(1, right.minute - left.minute);
  const eased = amount * amount * (3 - 2 * amount);
  const colors = left.colors.map((color, index) =>
    mixColor(color, right.colors[index], eased),
  );
  const daylight = Math.max(
    0,
    Math.min(1, (normalized - 420) / 90, (1230 - normalized) / 90),
  );
  const sunrise = triangle(normalized, 485, 115);
  const sunset = triangle(normalized, 1085, 105);
  const blueHour = Math.max(
    triangle(normalized, 1125, 95),
    triangle(normalized, 400, 65),
  );
  const night = clamp(1 - daylight * 1.5 + blueHour * 0.22);
  const progress = clamp((normalized - 450) / 720);
  // Reset the night trajectory at noon while the moon is completely hidden.
  const nightMinute = normalized < 720 ? normalized + 1440 : normalized;
  const moonProgress = clamp((nightMinute - 1230) / 630);
  const transitionLight = Math.max(sunrise, sunset, blueHour);

  return {
    minute: Number.isFinite(actualMinute) ? ((actualMinute % 1440) + 1440) % 1440 : 0,
    solarMinute: normalized,
    colors,
    daylight,
    sunrise,
    sunset,
    blueHour,
    night,
    progress,
    sunX: 7 + progress * 86,
    sunY: 76 - Math.sin(progress * Math.PI) * 58,
    sunOpacity: hasSolarSchedule
      ? clamp(Math.min((normalized - 450) / 30, (1170 - normalized) / 30))
      : daylight,
    moonX: 7 + moonProgress * 86,
    moonY: 76 - Math.sin(moonProgress * Math.PI) * 56,
    moonOpacity: clamp((night - 0.18) * 1.18),
    milkyOpacity: clamp((night - 0.28) * 1.35),
    horizonOpacity: 0.04 + daylight * 0.78 + sunset * 0.18,
    dayAura: daylight * (1 - transitionLight * 0.82) * 0.58,
    sunriseAura: sunrise * daylight,
    sunsetAura: sunset * daylight,
    blueAura: blueHour * 0.86,
    falloffOpacity: clamp(
      sunrise * 0.18 + sunset * 0.38 + blueHour * 0.25,
    ),
    chromaticOpacity:
      0.018 + daylight * 0.15 + sunset * 0.25 + blueHour * 0.1,
  };
}

export function weatherModeFromAmbient(weather) {
  const code = Number(weather?.weatherCode);
  const description = String(weather?.description || "").toLowerCase();
  if (
    (Number.isFinite(code) && code >= 95) ||
    /雷|storm|thunder/.test(description)
  ) {
    return "storm";
  }
  if (
    (Number.isFinite(code) && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))) ||
    /雨|rain|drizzle|shower/.test(description)
  ) {
    return "rain";
  }
  if (
    (Number.isFinite(code) && code >= 2) ||
    /云|阴|cloud|overcast|fog|雾|雪|snow/.test(description)
  ) {
    return "cloudy";
  }
  return "clear";
}

export function rainIntensityFromAmbient(weather) {
  const code = Number(weather?.weatherCode);
  const description = String(weather?.description || "").toLowerCase();
  if ([65, 67, 82, 95, 96, 99].includes(code) || /暴雨|大雨|heavy rain|downpour|torrential/.test(description)) return 1.6;
  if ([51, 53, 61, 80].includes(code) || /小雨|毛毛雨|light rain|drizzle/.test(description)) return 0.5;
  return 1;
}

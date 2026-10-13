const STAT_KEYS = ['mood', 'intimacy', 'satiety', 'water', 'energy', 'cleanliness'];

export function petLocalStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function petStorageKey(account, companion) {
  if (!String(account || '').trim() || !String(companion || '').trim()) return null;
  return `dengta_cotton_v1:${JSON.stringify([account, companion])}`;
}

export function readPetState(storage, key) {
  if (!key) return {};
  try {
    const value = JSON.parse(storage?.getItem(key));
    if (value?.schema !== 1) return {};
    const stats = {};
    for (const name of STAT_KEYS) {
      const number = value.stats?.[name];
      if (typeof number === 'number' && Number.isFinite(number)) stats[name] = Math.min(100, Math.max(0, number));
    }
    return { stats, quiet: value.quiet === true };
  } catch { return {}; }
}

export function savePetState(storage, key, stats, quiet) {
  if (!key) return false;
  try {
    const safe = {};
    for (const name of STAT_KEYS) if (Number.isFinite(stats[name])) safe[name] = Math.min(100, Math.max(0, stats[name]));
    const serialized = JSON.stringify({ schema: 1, stats: safe, quiet: quiet === true });
    if (storage?.getItem(key) !== serialized) storage?.setItem(key, serialized);
    return Boolean(storage);
  } catch { return false; }
}

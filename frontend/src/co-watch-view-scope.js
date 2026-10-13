const SESSION_MODES = Object.freeze({
  external: "screen",
  direct: "direct_media",
  web: "web_page",
  music: "listening",
});

function entryKind(viewKind) {
  return viewKind === "music" ? "music" : "together";
}

function sessionMode(mode, entry) {
  if (entry === "music") return "listening";
  const normalized = SESSION_MODES[mode] || mode;
  return ["screen", "direct_media", "web_page"].includes(normalized) ? normalized : "";
}

export function createCoWatchViewScope({ getIdentity, getViewKind }) {
  let scope = "", viewKind = "", revision = 0;
  let modes = {};
  let sequences = {};
  function synchronize() {
    const identity = getIdentity();
    const nextScope = JSON.stringify([identity?.accountScope || "", identity?.companionScope || ""]);
    const nextView = String(getViewKind() || "together");
    if (nextScope !== scope) {
      scope = nextScope;
      modes = {};
      sequences = {};
      revision += 1;
    }
    if (nextView !== viewKind) { viewKind = nextView; revision += 1; }
  }
  return {
    capture({ mode = "", fallbackMode = "screen", channel = "manual" } = {}) {
      synchronize();
      const entry = entryKind(viewKind);
      const selected = sessionMode(mode, entry);
      const nextMode = selected || modes[entry] || sessionMode(fallbackMode, entry) || "screen";
      if (nextMode !== modes[entry]) { modes[entry] = nextMode; revision += 1; }
      const sequence = sequences[channel] = (sequences[channel] || 0) + 1;
      return { scope, viewKind, revision, channel, sequence, sessionMode: nextMode };
    },
    current(stamp) {
      synchronize();
      return Boolean(stamp && stamp.scope === scope && stamp.viewKind === viewKind && stamp.revision === revision && stamp.sequence === sequences[stamp.channel]);
    },
    invalidate() { revision += 1; },
  };
}

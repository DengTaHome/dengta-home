const destinations = Object.freeze({
  listening: { view: "music", entryMode: "music", label: "一起听" },
  direct_media: { view: "together", entryMode: "direct", label: "一起看" },
  web_page: { view: "together", entryMode: "web", label: "一起看" },
  screen: { view: "together", entryMode: "external", label: "一起看" },
});

export function createActivityReturn(session, identity, fromView) {
  const destination = destinations[session?.sessionMode];
  if (!destination || destination.view !== fromView || session?.status !== "active" ||
    typeof session.id !== "string" || !session.id ||
    !identity?.accountScope || !identity?.companionScope) return null;
  return Object.freeze({
    accountScope: identity.accountScope,
    companionScope: identity.companionScope,
    sessionId: session.id,
    sessionMode: session.sessionMode,
  });
}

export function resolveActivityReturn(bookmark, identity, session) {
  const destination = destinations[bookmark?.sessionMode];
  if (!destination || !identity?.accountScope || !identity?.companionScope ||
    bookmark.accountScope !== identity.accountScope || bookmark.companionScope !== identity.companionScope ||
    !bookmark.sessionId || bookmark.sessionId !== session?.id ||
    session.status !== "active" || session.sessionMode !== bookmark.sessionMode) return null;
  return Object.freeze({
    ...destination,
    sessionId: session.id,
    title: typeof session.title === "string" ? Array.from(session.title.trim()).slice(0, 180).join("") : "",
  });
}

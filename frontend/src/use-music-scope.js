import { useLayoutEffect, useState } from "react";
import { authSession } from "./auth-session.js";
import { createMusicRequestScope } from "./music-request-scope.js";

export function useMusicScope(accountScope, companionScope) {
  const [scope] = useState(() => createMusicRequestScope(authSession));
  useLayoutEffect(() => {
    scope.bind({ accountScope, companionScope });
    return () => scope.invalidate();
  }, [scope, accountScope, companionScope]);
  return scope;
}

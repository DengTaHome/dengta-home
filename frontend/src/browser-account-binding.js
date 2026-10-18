import { Capacitor, registerPlugin } from "@capacitor/core";
import { authSession } from "./auth-session.js";

export const BrowserLauncher = registerPlugin("BrowserLauncher");
const accountError = () => Object.assign(new Error("账号已变化，请从当前灯塔账号重新打开网页。"), { code: "browser_account_changed" });

export function createBrowserAccountBinding({ session, plugin, available = () => true }) {
  let unsubscribe, owner = null, epoch = 0, binding = Promise.resolve();
  function synchronize() {
    const account = String(session.getSnapshot()?.user?.id || "");
    if (account === owner) return;
    owner = account;
    epoch++;
    binding = Promise.resolve(plugin.setAccount({ accountScope: account }));
    void binding.catch(() => {});
  }
  return {
    start() {
      if (!available() || unsubscribe) return () => {};
      unsubscribe = session.subscribe(synchronize);
      return () => {
        unsubscribe?.(); unsubscribe = null;
        owner = null; epoch++;
        void Promise.resolve(plugin.setAccount({ accountScope: "" })).catch(() => {});
      };
    },
    async request(action) {
      if (!available()) throw Object.assign(new Error("内置浏览器仅安卓应用可用。"), { code: "browser_account_isolation_unavailable" });
      synchronize();
      const account = owner, revision = epoch;
      if (!account) throw accountError();
      await binding;
      const current = () => revision === epoch && owner === account && session.getSnapshot()?.user?.id === account;
      if (!current()) throw accountError();
      const result = await action({ accountScope: account });
      if (!current()) throw accountError();
      return result;
    },
  };
}

const browserAccount = createBrowserAccountBinding({ session: authSession, plugin: BrowserLauncher,
  available: () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BrowserLauncher") });
export const installBrowserAccountBinding = () => browserAccount.start();
export const withBrowserAccount = action => browserAccount.request(action);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("native Keychain uses the restricted device-only policy and no plaintext persistence", async () => {
  const store = await read("ios/App/App/DengTaKeychainStore.swift");
  assert.match(store, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(store, /kSecAttrSynchronizable as String: false/);
  assert.match(store, /static let service = "home\.dengta\.app\.auth"/);
  for (const key of ["dengta_home_auth_v1", "dengta_home_auth_v1-code-verifier", "dengta_home_auth_v1-user"]) {
    assert.ok(store.includes(`"${key}"`));
  }
  assert.doesNotMatch(store, /UserDefaults|localStorage|kSecAttrAccessibleAfterFirstUnlock|kSecAttrSynchronizableAny|print\(/);
  const plugin = await read("ios/App/App/DengTaKeychainPlugin.swift");
  for (const method of ["get", "set", "remove"]) {
    assert.match(plugin, new RegExp(`CAPPluginMethod\\(name: "${method}", returnType: CAPPluginReturnPromise\\)`));
  }
  assert.doesNotMatch(plugin, /print\(|NSLog|localizedDescription|SecCopyErrorMessageString/);
});

test("Keychain bridge is registered before WKWebView load and compiled into App", async () => {
  const controller = await read("ios/App/App/DengTaBridgeViewController.swift");
  assert.match(controller, /override func capacitorDidLoad\(\)/);
  assert.match(controller, /CAPLog.enableLogging = false/);
  // Capacitor also emits JS bridge responses according to this configuration.
  // Disabling only the Swift logger would leave session payloads exposed in Debug.
  const config = JSON.parse(await read("capacitor.config.json"));
  assert.equal(config.ios.loggingBehavior, "none");
  assert.match(controller, /bridge\?\.registerPluginInstance\(DengTaKeychainPlugin\(\)\)/);
  const storyboard = await read("ios/App/App/Base.lproj/Main.storyboard");
  assert.match(storyboard, /customClass="DengTaBridgeViewController" customModule="App" customModuleProvider="target"/);
  const project = await read("ios/App/App.xcodeproj/project.pbxproj");
  for (const source of ["DengTaKeychainStore.swift", "DengTaKeychainPlugin.swift", "DengTaBridgeViewController.swift"]) {
    assert.ok(project.includes(`${source} in Sources`));
  }
  assert.ok(project.includes("Security.framework in Frameworks"));
});

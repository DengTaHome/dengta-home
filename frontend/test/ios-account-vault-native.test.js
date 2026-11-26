import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("account vault's native policy is encrypted, device-only, protected and bounded", async () => {
  const store = await read("ios/App/App/AccountVaultStore.swift");
  for (const term of ["AES.GCM.seal", "AES.GCM.open", "SHA256.hash", "kSecAttrAccessibleWhenUnlockedThisDeviceOnly", "kSecAttrSynchronizable as String: false", ".completeFileProtection", "FileProtectionType.complete", "resources.isExcludedFromBackup = true", "maxPlaintextBytes = 2 * 1024 * 1024", "maxEnvelopeBytes = 3 * 1024 * 1024"]) {
    assert.ok(store.includes(term), `Missing native policy ${term}`);
  }
  assert.doesNotMatch(store, /UserDefaults|localStorage|kSecAttrAccessibleAfterFirstUnlock|kSecAttrSynchronizableAny|NSLog|print\(/);
  const plugin = await read("ios/App/App/DengTaAccountVaultPlugin.swift");
  assert.match(plugin, /DispatchQueue\(label: "home\.dengta\.app\.account-vault"\)/);
  assert.doesNotMatch(plugin, /NSLog|print\(|localizedDescription|SecCopyErrorMessageString/);
  for (const method of ["read", "write", "clear"]) assert.ok(plugin.includes(`CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`));
});

test("account vault is registered and compiled into the native bridge", async () => {
  const controller = await read("ios/App/App/DengTaBridgeViewController.swift");
  assert.match(controller, /registerPluginInstance\(DengTaAccountVaultPlugin\(\)\)/);
  const project = await read("ios/App/App.xcodeproj/project.pbxproj");
  for (const file of ["DengTaAccountVaultPlugin.swift", "AccountVaultStore.swift"]) assert.ok(project.includes(`${file} in Sources`));
});

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { validateIOSEnvironment } from "../scripts/verify-ios-env.mjs";

const root = new URL("../", import.meta.url);
const read = file => readFile(new URL(file, root), "utf8");
const configured = {
  VITE_API_URL: "https://api.dengta.test",
  VITE_SUPABASE_URL: "https://dengtatest.supabase.co",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_local_test_public_value",
};

test("iOS packaging rejects unreachable/placeholder services and server credentials", () => {
  assert.doesNotThrow(() => validateIOSEnvironment(configured));
  for (const url of ["", "http://localhost:3000", "https://127.0.0.1", "https://your-api.example.com", "https://user:pass@api.dengta.test"]) {
    assert.throws(() => validateIOSEnvironment({ ...configured, VITE_API_URL: url }), /VITE_API_URL/);
  }
  for (const key of ["", "sb_secret_private", "sb_publishable_your_public_key", `e30.${Buffer.from('{"role":"service_role"}').toString("base64url")}.signature`]) {
    assert.throws(() => validateIOSEnvironment({ ...configured, VITE_SUPABASE_ANON_KEY: key }), /public publishable\/anon key/);
  }
  const anon = `e30.${Buffer.from('{"role":"anon"}').toString("base64url")}.signature`;
  assert.doesNotThrow(() => validateIOSEnvironment({ ...configured, VITE_SUPABASE_ANON_KEY: anon }));
});

test("iOS native project wires deep links, permission purposes and privacy resources", async () => {
  const plist = await read("ios/App/App/Info.plist");
  for (const purpose of ["NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "NSLocationWhenInUseUsageDescription"]) {
    assert.match(plist, new RegExp(`<key>${purpose}</key>\\s*<string>[^<]+</string>`));
  }
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>dengta<\/string>/);
  assert.doesNotMatch(plist, /NSAllowsArbitraryLoads|UIBackgroundModes/);
  const project = await read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(project, /PrivacyInfo.xcprivacy in Resources/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 15.0/);
  const privacy = await read("ios/App/App/PrivacyInfo.xcprivacy");
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults/);
  assert.match(privacy, /CA92.1/);
  const delegate = await read("ios/App/App/AppDelegate.swift");
  assert.match(delegate, /ApplicationDelegateProxy.shared.application\(app, open: url/);
  const config = JSON.parse(await read("capacitor.config.json"));
  assert.equal(config.ios.contentInset, "never");
  assert.equal(config.server.url, undefined);
  assert.equal(config.plugins?.CapacitorHttp?.enabled, undefined);
});

test("iOS icon uses existing opaque artwork and SPM dependencies match runtime", async () => {
  const iconPath = fileURLToPath(new URL("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", root));
  const icon = sharp(iconPath);
  const meta = await icon.metadata();
  assert.equal(meta.width, 1024); assert.equal(meta.height, 1024);
  assert.equal((await icon.stats()).isOpaque, true);
  const packageSwift = await read("ios/App/CapApp-SPM/Package.swift");
  for (const product of ["CapacitorApp", "CapacitorBrowser", "CapacitorClipboard", "CapacitorLocalNotifications", "CapacitorPreferences"]) {
    assert.ok(packageSwift.includes(product), `Missing SPM product ${product}`);
  }
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.dependencies["@capacitor/ios"], pkg.dependencies["@capacitor/core"]);
});

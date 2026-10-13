import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const verifier = path.resolve(
  testDirectory,
  "..",
  "scripts",
  "verify-public-auth-build.mjs",
);
const publicUrl = "https://fixture7example.supabase.co";
const publicKey = "sb_publishable_your_fixture_key_9";

function runVerifier({ bundle = "", env = {} } = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "dengta-auth-build-"));
  const assets = path.join(project, "dist", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "index-test.js"), bundle);
  const result = spawnSync(process.execPath, [verifier], {
    cwd: project,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  fs.rmSync(project, { recursive: true, force: true });
  return result;
}

const missingEnvironment = runVerifier();
assert.notEqual(missingEnvironment.status, 0);
assert.match(missingEnvironment.stderr, /VITE_SUPABASE_URL/);
assert.match(missingEnvironment.stderr, /VITE_SUPABASE_ANON_KEY/);

const omittedKey = runVerifier({
  bundle: JSON.stringify(publicUrl),
  env: {
    VITE_SUPABASE_URL: publicUrl,
    VITE_SUPABASE_ANON_KEY: publicKey,
  },
});
assert.notEqual(omittedKey.status, 0);
assert.match(omittedKey.stderr, /VITE_SUPABASE_ANON_KEY/);
assert.doesNotMatch(omittedKey.stderr, new RegExp(publicKey));

const configuredBundle = runVerifier({
  bundle: JSON.stringify(`${publicUrl}|${publicKey}`),
  env: {
    VITE_SUPABASE_URL: publicUrl,
    VITE_SUPABASE_ANON_KEY: publicKey,
  },
});
assert.equal(configuredBundle.status, 0, configuredBundle.stderr);
assert.match(configuredBundle.stdout, /contains the configured public auth/);
assert.doesNotMatch(configuredBundle.stdout, new RegExp(publicKey));

console.log("Public auth build verifier tests passed");

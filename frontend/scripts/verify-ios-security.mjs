import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, process.env.IOS_SECURITY_OUTPUT || "../artifacts/ios-phase3-security");
const files = [
  "ios-auth-keychain-storage.test.js", "auth-storage-lease.test.js",
  "auth-account-lifecycle.test.js", "auth-refresh-scope.test.js", "auth-email-callback.test.js",
  "account-cache-vault.test.js", "account-runtime-isolation.test.js",
  "voice-account-isolation.test.js", "workspace-cache-lifecycle.test.js",
  "ios-private-cache-helpers.test.js", "ios-peripheral-storage.test.js", "ios-app-storage-epoch.test.js", "ios-app-diagnostics-epoch.test.js",
  "api-account-isolation.test.js", "account-data-gate.component.test.js", "settings-save-scope.test.js",
  "nonreact-diagnostic-epoch.test.js",
  "ios-component-diagnostics.test.js",
  "ios-keychain-native.test.js", "ios-account-vault-native.test.js", "native-app-runtime.test.js",
  "auth-session.test.js", "auth-gate.test.js",
];
mkdirSync(output, { recursive: true });
const results = [];
for (const file of files) {
  const path = resolve(root, "test", file);
  const started = Date.now();
  // One process per file avoids shared auth fixtures and proves that node:test
  // actually ran its named cases, rather than accepting an empty worker pass.
  const run = spawnSync(process.execPath, [path], {
    cwd: root, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  const log = `${run.stdout || ""}${run.stderr || ""}`;
  const count = name => { const match = log.match(new RegExp(`(?:#|ℹ) ${name} (\\d+)`)); return match ? Number(match[1]) : null; };
  const expectsCases = /from\s+["']node:test["']/.test(readFileSync(path, "utf8"));
  const tests = count("tests"), passed = count("pass"), failed = count("fail");
  const ok = run.status === 0 && !run.signal && !run.error && (!expectsCases || (tests > 0 && failed === 0 && passed === tests));
  const result = { file, ok, tests, passed, failed, durationMs: Date.now() - started, exitCode: run.status, signal: run.signal, error: run.error?.code || null };
  results.push(result);
  writeFileSync(resolve(output, `${file}.log`), log);
  console.log(`${ok ? "PASS" : "FAIL"} ${file}${tests === null ? " (assertion script)" : ` (${passed}/${tests} cases)`}`);
  if (!ok) console.error(run.error?.code || log.slice(-6000) || "Named test summary missing");
}
const report = {
  generatedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  scope: "Targeted JavaScript security and integration checks; not native device or UI certification",
  files: results.length, passedFiles: results.filter(result => result.ok).length,
  namedCases: results.reduce((sum, result) => sum + (result.tests || 0), 0),
  passedNamedCases: results.reduce((sum, result) => sum + (result.passed || 0), 0),
  assertionScripts: results.filter(result => result.tests === null).length,
  results,
};
writeFileSync(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Security checks: ${report.passedFiles}/${report.files} files; ${report.passedNamedCases}/${report.namedCases} named cases; ${report.assertionScripts} assertion scripts.`);
if (report.passedFiles !== report.files) process.exitCode = 1;

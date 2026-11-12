#!/usr/bin/env bash
# Capture-only native layout evidence. A reviewer must inspect the PNGs.
# No signing, live login, deployment, Appium, or visual pass/fail assertion.
set -euo pipefail

ios_app_path="${1:-${RUNNER_TEMP:-/tmp}/dengta-ios/Build/Products/Debug-iphonesimulator/App.app}"
ios_output_path="${2:-artifacts/ios-layout}"
ios_created_devices=()
ios_phase="environment"
ios_probe_temp=""

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Native layout capture requires macOS and an installed Xcode iOS Simulator runtime." >&2
  exit 1
fi
for ios_command in xcrun xcodebuild node sips plutil; do
  if ! command -v "$ios_command" >/dev/null 2>&1; then
    echo "Missing required command: $ios_command" >&2
    exit 1
  fi
done
if [[ ! -f "$ios_app_path/Info.plist" ]]; then
  echo "Built simulator App.app is missing: $ios_app_path" >&2
  exit 1
fi
ios_supported_platforms="$(plutil -extract CFBundleSupportedPlatforms json -o - "$ios_app_path/Info.plist")"
node - "$ios_supported_platforms" <<'NODE_PLATFORM'
const platforms = JSON.parse(process.argv[2]);
if (!Array.isArray(platforms) || !platforms.includes('iPhoneSimulator')) {
  throw new Error('App.app is not built for iPhoneSimulator. Refusing to install a device/signed app in this capture-only workflow.');
}
NODE_PLATFORM

mkdir -p "$ios_output_path"
ios_output_path="$(cd "$ios_output_path" && pwd)"
ios_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ios_app_path/Info.plist")"
ios_app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ios_app_path/Info.plist")"
ios_build_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$ios_app_path/Info.plist")"
ios_commit="$(git rev-parse HEAD)"
xcodebuild -version > "$ios_output_path/xcode-version.txt"

node - "$ios_output_path" "$ios_bundle_id" "$ios_app_version" "$ios_build_version" "$ios_commit" "$ios_supported_platforms" <<'NODE_MANIFEST'
const fs = require('node:fs');
const [output, bundleIdentifier, appVersion, buildVersion, commit, platforms] = process.argv.slice(2);
fs.writeFileSync(`${output}/manifest.json`, JSON.stringify({
  schemaVersion: 1,
  status: 'capturing',
  capturedAt: new Date().toISOString(),
  evidence: 'Native iOS Simulator screenshots; capture only, requires human visual review.',
  scope: 'Portrait login UI using fictional CI public auth values. No live login, keyboard automation, landscape rotation, or authenticated screens verified.',
  readiness: 'Bootstatus and app process liveness, then a 6-second prelude settle and up to 60 seconds of native screenshot Vision OCR polling. The login title, email, password and primary action must be visible; loading or auth/storage errors cannot pass. Human layout review is still required.',
  build: { bundleIdentifier, appVersion, buildVersion, supportedPlatforms: JSON.parse(platforms), commit, xcode: fs.readFileSync(`${output}/xcode-version.txt`, 'utf8').trim() },
  devices: [],
}, null, 2) + '\n');
NODE_MANIFEST

ios_cleanup() {
  ios_exit_code=$?
  trap - EXIT
  set +e
  set +u
  for ios_device in "${ios_created_devices[@]}"; do
    xcrun simctl shutdown "$ios_device" >/dev/null 2>&1
    xcrun simctl delete "$ios_device" >/dev/null 2>&1
  done
  if [[ -n "$ios_probe_temp" ]]; then rm -rf "$ios_probe_temp"; fi
  node - "$ios_output_path/manifest.json" "$ios_exit_code" "$ios_phase" <<'NODE_COMPLETE'
const fs = require('node:fs');
const [file, exitCode, phase] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
manifest.status = exitCode === '0' ? 'captured-awaiting-visual-review' : 'capture-failed';
manifest.completedAt = new Date().toISOString();
manifest.exitCode = Number(exitCode);
if (exitCode !== '0') manifest.failedPhase = phase;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
NODE_COMPLETE
  exit "$ios_exit_code"
}
trap ios_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# macOS does not ship GNU timeout. Keep native boot commands bounded with Node.
ios_run_bounded() {
  node - "$@" <<'NODE_TIMEOUT'
const { spawnSync } = require('node:child_process');
const [seconds, command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, { stdio: 'inherit', timeout: Number(seconds) * 1000, killSignal: 'SIGTERM' });
if (result.error) console.error(`${command}: ${result.error.code || 'command_failed'}`);
process.exit(result.status ?? 1);
NODE_TIMEOUT
}

ios_phase="compile-and-verify-login-readiness-probe"
ios_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios_repo_dir="$(cd "$ios_script_dir/../.." && pwd)"
ios_probe_temp="$(mktemp -d "${TMPDIR:-/tmp}/dengta-login-probe.XXXXXX")"
ios_probe_bin="$ios_probe_temp/native-login-readiness"
xcrun --sdk macosx swiftc -swift-version 5 "$ios_script_dir/native-ios-login-readiness.swift" -o "$ios_probe_bin"
ios_run_bounded 15 "$ios_probe_bin" --test-classification > "$ios_output_path/login-probe-classification.json"
# Exercise the actual OCR against known native screenshots, not only strings.
ios_run_bounded 15 "$ios_probe_bin" "$ios_repo_dir/docs/screenshots/ios-phase2/iphone-15-pro-login-preview.png" > "$ios_output_path/login-probe-positive-fixture.json"
if ios_run_bounded 15 "$ios_probe_bin" "$ios_script_dir/../test/fixtures/ios-native-login-loading.png" > "$ios_output_path/login-probe-loading-fixture.json"; then
  echo "Login readiness incorrectly accepted the known loading screenshot." >&2
  exit 1
else
  ios_fixture_exit=$?
  if [[ "$ios_fixture_exit" -ne 2 ]]; then
    echo "Login readiness loading fixture failed to run." >&2
    exit 1
  fi
fi
node - "$ios_output_path/login-probe-loading-fixture.json" <<'NODE_LOADING_FIXTURE'
const fs = require('node:fs');
const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (receipt.status !== 'loading') throw new Error('Vision OCR must positively recognize the known loading screen.');
NODE_LOADING_FIXTURE

ios_phase="select-device-types-and-runtime"
xcrun simctl list --json > "$ios_output_path/simulator-catalog.json"
node - "$ios_output_path" <<'NODE_SELECT'
const fs = require('node:fs');
const output = process.argv[2];
const catalog = JSON.parse(fs.readFileSync(`${output}/simulator-catalog.json`, 'utf8'));
const requests = [
  { slug: 'iphone-se-3', name: 'iPhone SE (3rd generation)', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation', width: 750, height: 1334 },
  { slug: 'iphone-15-pro', name: 'iPhone 15 Pro', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro', width: 1179, height: 2556 },
  { slug: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro-Max', width: 1290, height: 2796 },
];
const missing = requests.filter(request => !catalog.devicetypes?.some(type => type.identifier === request.identifier));
if (missing.length) throw new Error(`Required Simulator device types are unavailable: ${missing.map(item => item.name).join(', ')}. Install the required Xcode device support; no device is silently skipped.`);
const runtimes = (catalog.runtimes || []).filter(runtime =>
  runtime.isAvailable === true && /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-/.test(runtime.identifier));
const version = value => String(value).split('.').map(Number);
runtimes.sort((left, right) => {
  const a = version(left.version), b = version(right.version);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (b[index] || 0) - (a[index] || 0);
    if (delta) return delta;
  }
  return 0;
});
if (!runtimes.length) throw new Error('No available installed iOS Simulator runtime. Install an iOS runtime in Xcode before capturing.');
const runtime = runtimes[0];
const plan = requests.map(request => ({ ...request, runtime: { identifier: runtime.identifier, name: runtime.name, version: runtime.version, buildVersion: runtime.buildversion || runtime.buildVersion || null } }));
fs.writeFileSync(`${output}/device-plan.json`, JSON.stringify(plan, null, 2) + '\n');
fs.writeFileSync(`${output}/device-plan.tsv`, plan.map(item => [item.slug, item.identifier, item.runtime.identifier, item.width, item.height].join('\t')).join('\n') + '\n');
// Keep the artifact limited to the requested devices, not the runner's unrelated inventory.
fs.unlinkSync(`${output}/simulator-catalog.json`);
NODE_SELECT

while IFS=$'\t' read -r ios_slug ios_device_type ios_runtime ios_expected_width ios_expected_height; do
  ios_phase="${ios_slug}:create"
  ios_udid="$(xcrun simctl create "DengTa layout ${ios_slug}" "$ios_device_type" "$ios_runtime")"
  if [[ ! "$ios_udid" =~ ^[A-Fa-f0-9-]{36}$ ]]; then
    echo "Simulator creation returned an invalid UDID for $ios_slug." >&2
    exit 1
  fi
  ios_created_devices+=("$ios_udid")

  ios_phase="${ios_slug}:boot"
  ios_run_bounded 180 xcrun simctl boot "$ios_udid"
  # Fresh iOS 26 runtimes can spend several minutes in CoreLocationMigrator.
  # Wait for migration to complete; a Booted state alone is not UI readiness.
  ios_run_bounded 660 xcrun simctl bootstatus "$ios_udid" -b
  xcrun simctl status_bar "$ios_udid" override --time '9:41' --batteryState charged --batteryLevel 100 --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4
  ios_phase="${ios_slug}:install-and-launch"
  ios_run_bounded 90 xcrun simctl install "$ios_udid" "$ios_app_path"
  ios_launch_receipt="$(xcrun simctl launch --terminate-running-process "$ios_udid" "$ios_bundle_id")"
  printf '%s\n' "$ios_launch_receipt" > "$ios_output_path/${ios_slug}-launch.txt"
  ios_pid="${ios_launch_receipt##*: }"
  if [[ ! "$ios_pid" =~ ^[0-9]+$ ]]; then
    echo "App launch did not return a valid PID for $ios_slug." >&2
    exit 1
  fi
  ios_phase="${ios_slug}:wait-for-app-process"
  ios_ready=false
  for ((ios_attempt = 0; ios_attempt < 20; ios_attempt++)); do
    if xcrun simctl spawn "$ios_udid" launchctl list | awk -v target="$ios_pid" '$1 == target { found = 1 } END { exit !found }'; then
      ios_ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ios_ready" != true ]]; then
    echo "Launched app PID was not alive in the Simulator launch services for $ios_slug." >&2
    exit 1
  fi
  # Covers the intro; actual readiness below is checked from the screen.
  sleep 6
  ios_phase="${ios_slug}:wait-for-login-screen"
  ios_screenshot="${ios_slug}-portrait.png"
  ios_ready=false
  ios_probe_deadline=$((SECONDS + 60))
  while ((SECONDS <= ios_probe_deadline)); do
    rm -f "$ios_output_path/$ios_screenshot"
    xcrun simctl io "$ios_udid" screenshot --type=png "$ios_output_path/$ios_screenshot" > "$ios_output_path/${ios_slug}-capture.log" 2>&1
    ios_probe_budget=$((ios_probe_deadline - SECONDS))
    if ((ios_probe_budget <= 0)); then break; fi
    if ((ios_probe_budget > 15)); then ios_probe_budget=15; fi
    if ios_run_bounded "$ios_probe_budget" "$ios_probe_bin" "$ios_output_path/$ios_screenshot" > "$ios_output_path/${ios_slug}-login-readiness.json"; then
      ios_ready=true
      break
    else
      ios_probe_exit=$?
      if [[ "$ios_probe_exit" -ne 2 ]]; then
        echo "Native login readiness failed for $ios_slug." >&2
        cat "$ios_output_path/${ios_slug}-login-readiness.json" >&2
        exit 1
      fi
    fi
    sleep 2
  done
  if [[ "$ios_ready" != true ]]; then
    echo "Native login screen was not ready within 60 seconds for $ios_slug." >&2
    cat "$ios_output_path/${ios_slug}-login-readiness.json" >&2
    exit 1
  fi
  ios_phase="${ios_slug}:capture-portrait"
  sips -g pixelWidth -g pixelHeight "$ios_output_path/$ios_screenshot" > "$ios_output_path/${ios_slug}-image.txt"
  node - "$ios_output_path" "$ios_slug" "$ios_udid" "$ios_pid" "$ios_screenshot" "$ios_expected_width" "$ios_expected_height" <<'NODE_RECORD'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const [output, slug, udid, pid, screenshot, expectedWidth, expectedHeight] = process.argv.slice(2);
const info = fs.readFileSync(`${output}/${slug}-image.txt`, 'utf8');
const width = Number(info.match(/pixelWidth:\s*(\d+)/)?.[1]);
const height = Number(info.match(/pixelHeight:\s*(\d+)/)?.[1]);
if (width !== Number(expectedWidth) || height !== Number(expectedHeight)) throw new Error(`Unexpected portrait screenshot geometry for ${slug}: ${width}x${height}; expected ${expectedWidth}x${expectedHeight}.`);
const plan = JSON.parse(fs.readFileSync(`${output}/device-plan.json`, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(`${output}/manifest.json`, 'utf8'));
const readiness = JSON.parse(fs.readFileSync(`${output}/${slug}-login-readiness.json`, 'utf8'));
if (readiness.status !== 'login-ready') throw new Error(`Native login readiness was not verified for ${slug}.`);
manifest.devices.push({ ...plan.find(device => device.slug === slug), udid, launchPid: Number(pid), orientation: 'portrait', screenshot, screenshotSha256: createHash('sha256').update(fs.readFileSync(`${output}/${screenshot}`)).digest('hex'), capturedWidth: width, capturedHeight: height, readiness, visualReview: 'pending' });
fs.writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
NODE_RECORD
  xcrun simctl shutdown "$ios_udid"
done < "$ios_output_path/device-plan.tsv"

ios_phase="complete"
echo "Captured 3 native portrait screenshots in $ios_output_path. Human visual review is still required."

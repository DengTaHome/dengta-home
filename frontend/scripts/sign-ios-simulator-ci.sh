#!/usr/bin/env bash
# Ephemeral ad-hoc signing for Simulator Keychain tests. Never signs device apps.
set -euo pipefail
ios_sign_app="${1:?Simulator App.app is required}"
ios_sign_output="${2:?Evidence directory is required}"
[[ "$(uname -s)" == Darwin ]] || { echo "Simulator signing requires macOS." >&2; exit 1; }
ios_sign_platform="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$ios_sign_app/Info.plist")"
[[ "$ios_sign_platform" == iPhoneSimulator ]] || { echo "Refusing to ad-hoc sign a device app." >&2; exit 1; }
ios_sign_bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ios_sign_app/Info.plist")"
mkdir -p "$ios_sign_output"
node - "$ios_sign_output" "$ios_sign_bundle" <<'NODE_ENTITLEMENTS'
const fs = require('node:fs');
const [output, bundle] = process.argv.slice(2);
if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundle)) throw new Error('Invalid Simulator bundle identifier');
// This fictional prefix is only for disposable Simulator processes. It is not
// an Apple team, certificate, provisioning profile or device signing identity.
const identifier = `DENGTACI00.${bundle}`;
fs.writeFileSync(`${output}/simulator-ci-entitlements.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>${identifier}</string>
<key>com.apple.developer.team-identifier</key><string>DENGTACI00</string>
<key>keychain-access-groups</key><array><string>${identifier}</string></array>
</dict></plist>\n`);
NODE_ENTITLEMENTS

# Sign nested executable code before the containing app. No keychain/certificate
# imports and no network or provisioning updates are involved.
while IFS= read -r -d '' ios_sign_library; do
  codesign --force --sign - "$ios_sign_library"
done < <(find "$ios_sign_app" -type f -name '*.dylib' -print0)
if [[ -d "$ios_sign_app/Frameworks" ]]; then
  while IFS= read -r -d '' ios_sign_framework; do
    codesign --force --sign - "$ios_sign_framework"
  done < <(find "$ios_sign_app/Frameworks" -depth -type d -name '*.framework' -print0)
fi
codesign --force --sign - --generate-entitlement-der --entitlements "$ios_sign_output/simulator-ci-entitlements.plist" "$ios_sign_app"
codesign --verify --deep --strict "$ios_sign_app"
codesign --display --entitlements :- "$ios_sign_app" > "$ios_sign_output/simulator-ci-actual-entitlements.plist" 2>/dev/null
ios_signed_identifier="$(/usr/libexec/PlistBuddy -c 'Print :application-identifier' "$ios_sign_output/simulator-ci-actual-entitlements.plist")"
ios_signed_group="$(/usr/libexec/PlistBuddy -c 'Print :keychain-access-groups:0' "$ios_sign_output/simulator-ci-actual-entitlements.plist")"
[[ "$ios_signed_identifier" == "DENGTACI00.$ios_sign_bundle" && "$ios_signed_group" == "$ios_signed_identifier" ]] || { echo "Simulator Keychain entitlements were not embedded." >&2; exit 1; }
node - "$ios_sign_output" <<'NODE_SIGNED'
require('node:fs').writeFileSync(`${process.argv[2]}/simulator-ci-signature.json`, JSON.stringify({
  schemaVersion: 1, signing: 'ad-hoc-simulator-only', platform: 'iPhoneSimulator',
  signatureVerified: true, applicationIdentifierPresent: true, defaultKeychainGroupPresent: true,
  appleCertificateUsed: false, deviceInstallable: false,
}, null, 2) + '\n');
NODE_SIGNED

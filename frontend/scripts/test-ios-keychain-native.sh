#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Swift Security-framework tests require macOS/Xcode." >&2
  exit 1
fi
ios_frontend_dir="$(cd "$(dirname "$0")/.." && pwd)"
ios_native_test_dir="$(mktemp -d "${TMPDIR:-/tmp}/dengta-keychain-tests.XXXXXX")"
trap 'rm -rf "$ios_native_test_dir"' EXIT
xcrun --sdk macosx swiftc -swift-version 5 \
  "$ios_frontend_dir/ios/App/App/DengTaKeychainStore.swift" \
  "$ios_frontend_dir/ios/App/Tests/KeychainStore/main.swift" \
  -framework Security -o "$ios_native_test_dir/keychain-policy-tests"
"$ios_native_test_dir/keychain-policy-tests"

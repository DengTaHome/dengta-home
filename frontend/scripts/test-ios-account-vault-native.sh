#!/usr/bin/env bash
# Native cryptography/Keychain-call policy tests with fictional injected storage.
# This does not test iOS lock-state or filesystem protection on physical hardware.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Account vault native tests require macOS with Xcode/Swift and Security/CryptoKit." >&2
  exit 1
fi

vault_frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
vault_test_tmp="$(mktemp -d "${TMPDIR:-/tmp}/dengta-account-vault-tests.XXXXXX")"
trap 'rm -rf "$vault_test_tmp"' EXIT

xcrun --sdk macosx swiftc -swift-version 5 \
  "$vault_frontend_root/ios/App/App/AccountVaultStore.swift" \
  "$vault_frontend_root/test/native-account-vault/main.swift" \
  -framework Security -framework CryptoKit \
  -o "$vault_test_tmp/account-vault-tests"
"$vault_test_tmp/account-vault-tests"

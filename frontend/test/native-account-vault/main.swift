import Foundation
import Security
import CryptoKit

// Run on macOS with injected Security/file policy; no real Keychain items are touched.
func require(_ condition: Bool, _ message: String) {
    if !condition { fatalError(message) }
}

func mustThrow(_ body: () throws -> Void, _ message: String) {
    do { try body(); fatalError(message) } catch { }
}

final class FakeSecurity {
    var items: [String: Data] = [:]
    var locked = false
    var reads = 0
    var adds = 0
    var deletes = 0

    func query(_ raw: CFDictionary) -> [String: Any] {
        let value = raw as! [String: Any]
        require(value[kSecAttrService as String] as? String == "home.dengta.app.account-vault", "Dedicated service required")
        require(value[kSecAttrSynchronizable as String] as? Bool == false, "Cloud synchronization forbidden")
        require(value[kSecAttrAccessGroup as String] == nil, "Shared access group forbidden")
        let account = value[kSecAttrAccount as String] as? String ?? ""
        require(account.count == 64 && account.allSatisfy { $0.isHexDigit }, "Account identifiers must be hashed")
        return value
    }

    var calls: AccountVaultKeychain {
        AccountVaultKeychain(copy: { raw, result in
            self.reads += 1
            let query = self.query(raw)
            require(query[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Device-only unlocked read policy required")
            if self.locked { return errSecInteractionNotAllowed }
            guard let data = self.items[query[kSecAttrAccount as String] as! String] else { return errSecItemNotFound }
            result?.pointee = data as CFData
            return errSecSuccess
        }, add: { raw, _ in
            self.adds += 1
            let query = self.query(raw)
            require(query[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Device-only unlocked creation policy required")
            if self.locked { return errSecInteractionNotAllowed }
            let account = query[kSecAttrAccount as String] as! String
            if self.items[account] != nil { return errSecDuplicateItem }
            let data = query[kSecValueData as String] as! Data
            require(data.count == 32, "AES key must have 256 bits")
            self.items[account] = data
            return errSecSuccess
        }, delete: { raw in
            self.deletes += 1
            let query = self.query(raw)
            if self.locked { return errSecInteractionNotAllowed }
            let old = self.items.removeValue(forKey: query[kSecAttrAccount as String] as! String)
            return old == nil ? errSecItemNotFound : errSecSuccess
        })
    }
}

let files = FileManager.default
let temporary = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
try files.createDirectory(at: temporary, withIntermediateDirectories: true)
defer { try? files.removeItem(at: temporary) }
// macOS may enumerate /var-backed URLs through their /private/var spelling.
// Deliberately exercise an alias as well: protection must cover the same actual
// filesystem items regardless of how their URLs were constructed/enumerated.
func canonicalPath(_ url: URL) -> String {
    var path = url.standardizedFileURL.resolvingSymlinksInPath().path
    while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
    return path
}
let storageRoot = temporary.appendingPathComponent("container", isDirectory: true)
let storageAlias = temporary.appendingPathComponent("container-alias", isDirectory: true)
try files.createDirectory(at: storageRoot, withIntermediateDirectories: true)
try files.createSymbolicLink(at: storageAlias, withDestinationURL: storageRoot)
require(storageAlias.path != storageRoot.path, "Fixture must exercise different URL spellings")
require(canonicalPath(storageAlias) == canonicalPath(storageRoot), "Fixture alias must resolve to the actual container")
let security = FakeSecurity()
var protectedPaths = Set<String>()
let store = AccountVaultStore(root: storageAlias, keychain: security.calls, protect: { _ = protectedPaths.insert(canonicalPath($0)) }, writeAtomic: { data, url in try data.write(to: url, options: [.atomic]) })
let accountA = "11111111-1111-4111-8111-111111111111"
let accountB = "22222222-2222-4222-8222-222222222222"
let payloadA = "{\"draft\":\"fictional-private-draft\"}"
let payloadB = "{\"draft\":\"another-fictional-draft\"}"

require(try store.read(accountId: accountA) == nil, "Missing cache must return nil")
require(security.reads == 0 && security.adds == 0, "Missing read must not create/access a Keychain key")
for account in ["../outside", "", "11111111111141118111111111111111", "\(accountA)/../x"] {
    mustThrow({ try store.write(accountId: account, value: payloadA) }, "Unsafe account must reject")
}
mustThrow({ try store.write(accountId: accountA, value: "not-json") }, "Invalid JSON must reject")
mustThrow({ try store.write(accountId: accountA, value: String(repeating: "x", count: AccountVaultStore.maxPlaintextBytes + 1)) }, "Oversize JSON must reject")
require(security.adds == 0, "Invalid input must not create a key")

try store.write(accountId: accountA, value: payloadA)
try store.write(accountId: accountB, value: payloadB)
require(try store.read(accountId: accountA.uppercased()) == payloadA, "Normalized account must read its own payload")
require(try store.read(accountId: accountB) == payloadB, "Another account must have independent payload")
require(security.items.count == 2, "Each account needs an independent encryption key")
let root = storageRoot.appendingPathComponent("DengTaAccounts", isDirectory: true)
let directories = try files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
require(directories.count == 2, "Per-account directories required")
var expectedProtectedPaths = Set([canonicalPath(root)])
for directory in directories {
    require(directory.lastPathComponent.count == 64, "Directory must be hashed")
    let file = directory.appendingPathComponent("cache.json")
    let data = try Data(contentsOf: file)
    let text = String(decoding: data, as: UTF8.self)
    require(!text.contains("fictional-private-draft") && !text.contains("another-fictional-draft"), "Plaintext must never reach disk")
    expectedProtectedPaths.insert(canonicalPath(directory))
    expectedProtectedPaths.insert(canonicalPath(file))
}
require(expectedProtectedPaths.count == 5, "Fixture must identify root, two account directories and two cache files")
require(protectedPaths == expectedProtectedPaths, "Exactly the actual root, both account directories and both caches must request protection")

security.locked = true
mustThrow({ _ = try store.read(accountId: accountA) }, "Locked device must reject reading an existing cache")
mustThrow({ try store.write(accountId: accountA, value: payloadB) }, "Locked device must reject writes")
security.locked = false

// Copying ciphertext across accounts fails authenticated decryption.
let digestA = SHA256.hash(data: Data(accountA.utf8)).map { String(format: "%02x", $0) }.joined()
let digestB = SHA256.hash(data: Data(accountB.utf8)).map { String(format: "%02x", $0) }.joined()
let fileA = root.appendingPathComponent(digestA).appendingPathComponent("cache.json")
let fileB = root.appendingPathComponent(digestB).appendingPathComponent("cache.json")
let cipherB = try Data(contentsOf: fileB)
try cipherB.write(to: fileA, options: [.atomic])
mustThrow({ _ = try store.read(accountId: accountA) }, "Cross-account ciphertext must not decrypt")
try store.write(accountId: accountA, value: payloadA)
var corrupted = try Data(contentsOf: fileA)
corrupted[corrupted.count / 2] ^= 1
try corrupted.write(to: fileA)
mustThrow({ _ = try store.read(accountId: accountA) }, "Tampered envelope must reject")

try store.clear(accountId: accountA)
require(try store.read(accountId: accountA) == nil, "Cleared cache must be absent")
require(security.items[digestA] == nil, "Clear must delete the account encryption key")
require(try store.read(accountId: accountB) == payloadB, "Clear must preserve the other account")
try store.clear(accountId: accountA)
require(security.items.count == 1, "Repeated clear must be idempotent")
print("Account vault native tests passed with injected Security/file policy; iOS file-protection behavior still requires Simulator/device verification.")

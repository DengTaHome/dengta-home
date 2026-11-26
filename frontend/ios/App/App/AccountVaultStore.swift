import Foundation
import Security
import CryptoKit

enum AccountVaultError: Error {
    case invalidAccount
    case invalidData
    case unreadable
    case unavailable
}

// Injectable system calls permit native policy/error tests without live credentials.
struct AccountVaultKeychain {
    var copy: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = SecItemCopyMatching
    var add: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = SecItemAdd
    var delete: (CFDictionary) -> OSStatus = SecItemDelete
}

/// Called exclusively on the plugin's serial queue. Disk contains AES.GCM ciphertext only.
final class AccountVaultStore {
    static let maxPlaintextBytes = 2 * 1024 * 1024
    static let maxEnvelopeBytes = 3 * 1024 * 1024
    private let files: FileManager
    private let root: URL
    private let keychain: AccountVaultKeychain
    private let protect: (URL) throws -> Void
    private let writeAtomic: (Data, URL) throws -> Void
    private let service = "home.dengta.app.account-vault"

    init(
        root: URL? = nil,
        files: FileManager = .default,
        keychain: AccountVaultKeychain = AccountVaultKeychain(),
        protect: @escaping (URL) throws -> Void = AccountVaultStore.protectItem,
        writeAtomic: @escaping (Data, URL) throws -> Void = AccountVaultStore.writeProtected
    ) {
        self.files = files
        self.root = (root ?? files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0])
            .appendingPathComponent("DengTaAccounts", isDirectory: true)
        self.keychain = keychain
        self.protect = protect
        self.writeAtomic = writeAtomic
    }

    func read(accountId: String) throws -> String? {
        let digest = try accountDigest(accountId)
        let file = cacheURL(digest)
        guard files.fileExists(atPath: file.path) else { return nil }
        do {
            let attributes = try files.attributesOfItem(atPath: file.path)
            guard let size = attributes[.size] as? NSNumber,
                  size.intValue > 0, size.intValue <= Self.maxEnvelopeBytes else {
                throw AccountVaultError.unreadable
            }
            let envelope = try Data(contentsOf: file)
            guard envelope.count <= Self.maxEnvelopeBytes,
                  let object = try JSONSerialization.jsonObject(with: envelope) as? [String: Any],
                  object["version"] as? Int == 1,
                  let encoded = object["sealed"] as? String,
                  let combined = Data(base64Encoded: encoded),
                  let keyData = try existingKey(digest) else {
                throw AccountVaultError.unreadable
            }
            let box = try AES.GCM.SealedBox(combined: combined)
            let plaintext = try AES.GCM.open(box, using: SymmetricKey(data: keyData), authenticating: Data(digest.utf8))
            guard plaintext.count <= Self.maxPlaintextBytes,
                  let value = String(data: plaintext, encoding: .utf8),
                  (try? JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])) != nil else {
                throw AccountVaultError.unreadable
            }
            return value
        } catch let error as AccountVaultError {
            throw error
        } catch {
            throw AccountVaultError.unreadable
        }
    }

    func write(accountId: String, value: String) throws {
        let digest = try accountDigest(accountId)
        guard !value.isEmpty, value.utf8.count <= Self.maxPlaintextBytes else {
            throw AccountVaultError.invalidData
        }
        let plaintext = Data(value.utf8)
        guard !plaintext.isEmpty, plaintext.count <= Self.maxPlaintextBytes,
              (try? JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])) != nil else {
            throw AccountVaultError.invalidData
        }
        do {
            let keyData = try keyForWrite(digest)
            let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: keyData), authenticating: Data(digest.utf8))
            guard let combined = sealed.combined else { throw AccountVaultError.unavailable }
            let envelope = try JSONSerialization.data(withJSONObject: ["version": 1, "sealed": combined.base64EncodedString()])
            guard envelope.count <= Self.maxEnvelopeBytes else { throw AccountVaultError.invalidData }
            let directory = root.appendingPathComponent(digest, isDirectory: true)
            try files.createDirectory(at: directory, withIntermediateDirectories: true)
            try protect(root)
            try protect(directory)
            let file = cacheURL(digest)
            try writeAtomic(envelope, file)
            try protect(file)
        } catch let error as AccountVaultError {
            throw error
        } catch {
            throw AccountVaultError.unavailable
        }
    }

    func clear(accountId: String) throws {
        let digest = try accountDigest(accountId)
        // Delete the decryption key first. Even an undeletable leftover file stays opaque.
        let status = keychain.delete(keyQuery(digest) as CFDictionary)
        var failed = status != errSecSuccess && status != errSecItemNotFound
        let directory = root.appendingPathComponent(digest, isDirectory: true)
        do {
            if files.fileExists(atPath: directory.path) { try files.removeItem(at: directory) }
        } catch { failed = true }
        if failed { throw AccountVaultError.unavailable }
    }

    private func accountDigest(_ value: String) throws -> String {
        guard value.count == 36, let uuid = UUID(uuidString: value),
              uuid.uuidString.lowercased() == value.lowercased() else {
            throw AccountVaultError.invalidAccount
        }
        return SHA256.hash(data: Data(uuid.uuidString.lowercased().utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func cacheURL(_ digest: String) -> URL {
        root.appendingPathComponent(digest, isDirectory: true).appendingPathComponent("cache.json", isDirectory: false)
    }

    private func keyQuery(_ digest: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: digest,
         kSecAttrSynchronizable as String: false]
    }

    private func existingKey(_ digest: String) throws -> Data? {
        var query = keyQuery(digest)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = keychain.copy(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count == 32 else {
            throw AccountVaultError.unavailable
        }
        return data
    }

    private func keyForWrite(_ digest: String) throws -> Data {
        if let data = try existingKey(digest) { return data }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }
        var query = keyQuery(digest)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        query[kSecValueData as String] = data
        let status = keychain.add(query as CFDictionary, nil)
        if status == errSecDuplicateItem, let existing = try existingKey(digest) { return existing }
        guard status == errSecSuccess else { throw AccountVaultError.unavailable }
        return data
    }

    static func writeProtected(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        // Native test executables inject their own writer. Production is iOS only.
        throw AccountVaultError.unavailable
        #endif
    }

    static func protectItem(_ url: URL) throws {
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let protection = (attributes[.protectionKey] as? FileProtectionType)?.rawValue
            ?? attributes[.protectionKey] as? String
        guard protection == FileProtectionType.complete.rawValue else {
            throw AccountVaultError.unavailable
        }
        var item = url
        var resources = URLResourceValues()
        resources.isExcludedFromBackup = true
        try item.setResourceValues(resources)
        guard try item.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw AccountVaultError.unavailable
        }
        #else
        throw AccountVaultError.unavailable
        #endif
    }
}

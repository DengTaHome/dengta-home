import Foundation
import Security

// Kept independent of Capacitor so policy and OSStatus handling can be exercised
// with injected Security calls without reading a developer's or CI user's keys.
struct DengTaKeychainSecurityCalls {
    var copyMatching: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    var update: (CFDictionary, CFDictionary) -> OSStatus
    var add: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    var delete: (CFDictionary) -> OSStatus

    static let system = DengTaKeychainSecurityCalls(
        copyMatching: SecItemCopyMatching,
        update: SecItemUpdate,
        add: SecItemAdd,
        delete: SecItemDelete
    )
}

enum DengTaKeychainError: Error, Equatable {
    case invalidKey
    case invalidData
    case unavailable(OSStatus)
}

// A Simulator-only, explicit opt-in CI receipt. It cannot serialize keys,
// credentials, account identifiers, native paths, or arbitrary error messages.
// Release/device builds compile record() to a no-op.
enum DengTaCIKeychainDiagnostics {
    #if DEBUG && targetEnvironment(simulator)
    private static let enabled = ProcessInfo.processInfo.arguments.contains("--dengta-ci-keychain-diagnostics")
    private static let lock = NSLock()
    private static var events: [[String: Any]] = []
    private static let allowedStages: Set<String> = [
        "bridge-created", "bridge-keychain-available", "bridge-keychain-missing",
        "bridge-vault-available", "bridge-vault-missing",
        "protected-data-available", "protected-data-unavailable",
        "keychain-read", "keychain-update", "keychain-add", "keychain-delete",
        "probe-add", "probe-read", "probe-delete", "probe-roundtrip"
    ]
    #endif

    static func record(_ stage: String, status: OSStatus? = nil, verified: Bool? = nil) {
        #if DEBUG && targetEnvironment(simulator)
        guard enabled && allowedStages.contains(stage) else { return }
        lock.lock()
        defer { lock.unlock() }
        if stage == "bridge-created" { events.removeAll() }
        var event: [String: Any] = ["stage": stage]
        if let status { event["status"] = Int(status) }
        if let verified { event["verified"] = verified }
        events.append(event)
        if events.count > 64 { events.removeFirst(events.count - 64) }
        let receipt: [String: Any] = ["schemaVersion": 1, "events": events]
        guard let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]) else { return }
        let file = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("dengta-ci-keychain-diagnostics.json")
        try? data.write(to: file, options: [.atomic])
        #endif
    }

    static func runRoundTripProbe() {
        #if DEBUG && targetEnvironment(simulator)
        guard enabled else { return }
        DispatchQueue.global(qos: .utility).async {
            // Isolated, disposable CI item. Never reuse any authentication key.
            let identity: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "home.dengta.app.ci.keychain-probe",
                kSecAttrAccount as String: UUID().uuidString,
                kSecAttrSynchronizable as String: false
            ]
            let expected = Data("DengTa CI keychain probe".utf8)
            var item = identity
            item[kSecValueData as String] = expected
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            record("probe-add", status: addStatus)
            defer { record("probe-delete", status: SecItemDelete(identity as CFDictionary)) }
            var query = identity
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var result: CFTypeRef?
            let readStatus = SecItemCopyMatching(query as CFDictionary, &result)
            record("probe-read", status: readStatus)
            record("probe-roundtrip", verified: addStatus == errSecSuccess && readStatus == errSecSuccess && (result as? Data) == expected)
        }
        #endif
    }
}

final class DengTaKeychainStore {
    static let service = "home.dengta.app.auth"
    static let allowedKeys: Set<String> = [
        "dengta_home_auth_v1",
        "dengta_home_auth_v1-code-verifier",
        "dengta_home_auth_v1-user"
    ]

    private let security: DengTaKeychainSecurityCalls

    init(security: DengTaKeychainSecurityCalls = .system) {
        self.security = security
    }

    private func identity(for key: String) throws -> [String: Any] {
        guard Self.allowedKeys.contains(key) else { throw DengTaKeychainError.invalidKey }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key,
            // Explicitly local; no synchronizable or shared access group items.
            kSecAttrSynchronizable as String: false
        ]
    }

    func get(_ key: String) throws -> String? {
        var query = try identity(for: key)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = security.copyMatching(query as CFDictionary, &result)
        DengTaCIKeychainDiagnostics.record("keychain-read", status: status)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw DengTaKeychainError.unavailable(status) }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw DengTaKeychainError.invalidData
        }
        return value
    }

    func set(_ key: String, value: String) throws {
        let query = try identity(for: key)
        guard let data = value.data(using: .utf8) else { throw DengTaKeychainError.invalidData }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        var status = security.update(query as CFDictionary, attributes as CFDictionary)
        DengTaCIKeychainDiagnostics.record("keychain-update", status: status)
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            status = security.add(item as CFDictionary, nil)
            DengTaCIKeychainDiagnostics.record("keychain-add", status: status)
            // Another writer may create the item between update and add.
            if status == errSecDuplicateItem {
                status = security.update(query as CFDictionary, attributes as CFDictionary)
                DengTaCIKeychainDiagnostics.record("keychain-update", status: status)
            }
        }
        guard status == errSecSuccess else { throw DengTaKeychainError.unavailable(status) }
    }

    func remove(_ key: String) throws {
        let status = security.delete(try identity(for: key) as CFDictionary)
        DengTaCIKeychainDiagnostics.record("keychain-delete", status: status)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DengTaKeychainError.unavailable(status)
        }
    }
}

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
        if status == errSecItemNotFound {
            var item = query
            attributes.forEach { item[$0.key] = $0.value }
            status = security.add(item as CFDictionary, nil)
            // Another writer may create the item between update and add.
            if status == errSecDuplicateItem {
                status = security.update(query as CFDictionary, attributes as CFDictionary)
            }
        }
        guard status == errSecSuccess else { throw DengTaKeychainError.unavailable(status) }
    }

    func remove(_ key: String) throws {
        let status = security.delete(try identity(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DengTaKeychainError.unavailable(status)
        }
    }
}

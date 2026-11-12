import Foundation
import Security

// Deterministic policy/OSStatus tests. Every Security operation is injected;
// this executable never reads or writes a runner's actual Keychain.
final class FakeSecurity {
    var reads = 0
    var updates = 0
    var additions = 0
    var deletions = 0
    var readStatus = errSecItemNotFound
    var readResult: CFTypeRef?
    var updateStatuses = [errSecSuccess]
    var addStatus = errSecSuccess
    var deleteStatus = errSecSuccess
    var lastQuery: [String: Any] = [:]
    var lastAttributes: [String: Any] = [:]

    func calls() -> DengTaKeychainSecurityCalls {
        DengTaKeychainSecurityCalls(
            copyMatching: { query, result in
                self.reads += 1
                self.lastQuery = query as! [String: Any]
                result?.pointee = self.readResult
                return self.readStatus
            },
            update: { query, attributes in
                self.updates += 1
                self.lastQuery = query as! [String: Any]
                self.lastAttributes = attributes as! [String: Any]
                return self.updateStatuses.count > 1 ? self.updateStatuses.removeFirst() : self.updateStatuses[0]
            },
            add: { item, _ in
                self.additions += 1
                self.lastQuery = item as! [String: Any]
                return self.addStatus
            },
            delete: { query in
                self.deletions += 1
                self.lastQuery = query as! [String: Any]
                return self.deleteStatus
            }
        )
    }
}

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else { fatalError(message) }
}

func expectFailure(_ expected: DengTaKeychainError, _ operation: () throws -> Void) {
    do {
        try operation()
        fatalError("Expected a closed failure.")
    } catch {
        expect(error as? DengTaKeychainError == expected, "Wrong safe error category.")
    }
}

func checkLocalIdentity(_ query: [String: Any]) {
    expect(query[kSecClass as String] as? String == kSecClassGenericPassword as String, "Wrong Keychain class.")
    expect(query[kSecAttrService as String] as? String == "home.dengta.app.auth", "Wrong service scope.")
    expect(query[kSecAttrSynchronizable as String] as? Bool == false, "Cloud synchronization must be explicitly disabled.")
    expect(query[kSecAttrAccessGroup as String] == nil, "Shared access groups must not be added.")
}

let key = "dengta_home_auth_v1"
let fake = FakeSecurity()
let store = DengTaKeychainStore(security: fake.calls())

for invalidKey in ["", "another-app-token", "dengta_home_auth_v1-arbitrary", "../auth"] {
    expectFailure(.invalidKey) { _ = try store.get(invalidKey) }
    expectFailure(.invalidKey) { try store.set(invalidKey, value: "fictional") }
    expectFailure(.invalidKey) { try store.remove(invalidKey) }
}
expect(fake.reads + fake.updates + fake.additions + fake.deletions == 0, "Invalid keys must never reach Security.")

let missingValue = try store.get(key)
expect(missingValue == nil, "A missing secure item must return nil.")
checkLocalIdentity(fake.lastQuery)
expect(fake.lastQuery[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Reads must only accept this-device unlocked items.")
expect(fake.lastQuery[kSecReturnData as String] as? Bool == true, "Reads must ask for data.")
expect(fake.lastQuery[kSecMatchLimit as String] as? String == kSecMatchLimitOne as String, "Reads must be singular.")

fake.readStatus = errSecSuccess
fake.readResult = Data("fictional-session".utf8) as CFData
let restoredValue = try store.get(key)
expect(restoredValue == "fictional-session", "Stored UTF8 must round-trip.")
fake.readResult = Data([0xff]) as CFData
expectFailure(.invalidData) { _ = try store.get(key) }
fake.readStatus = errSecInteractionNotAllowed
expectFailure(.unavailable(errSecInteractionNotAllowed)) { _ = try store.get(key) }

for validKey in DengTaKeychainStore.allowedKeys {
    try store.set(validKey, value: "fictional-session")
    checkLocalIdentity(fake.lastQuery)
    expect(fake.lastQuery[kSecAttrAccount as String] as? String == validKey, "Each SDK auth key needs its own account slot.")
    expect(fake.lastAttributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Updates must enforce this-device unlocked protection.")
}

fake.updateStatuses = [errSecItemNotFound]
try store.set(key, value: "fictional-session")
expect(fake.additions == 1, "A missing item must be added.")
checkLocalIdentity(fake.lastQuery)
expect(fake.lastQuery[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String, "Adds must enforce this-device unlocked protection.")

fake.updateStatuses = [errSecItemNotFound, errSecSuccess]
fake.addStatus = errSecDuplicateItem
let beforeRace = fake.updates
try store.set(key, value: "fictional-session")
expect(fake.updates == beforeRace + 2, "An update/add race must retry update.")

fake.updateStatuses = [errSecInteractionNotAllowed]
expectFailure(.unavailable(errSecInteractionNotAllowed)) { try store.set(key, value: "fictional-session") }
fake.updateStatuses = [errSecItemNotFound]
fake.addStatus = errSecAuthFailed
expectFailure(.unavailable(errSecAuthFailed)) { try store.set(key, value: "fictional-session") }
fake.updateStatuses = [errSecItemNotFound, errSecAuthFailed]
fake.addStatus = errSecDuplicateItem
expectFailure(.unavailable(errSecAuthFailed)) { try store.set(key, value: "fictional-session") }

try store.remove(key)
checkLocalIdentity(fake.lastQuery)
fake.deleteStatus = errSecItemNotFound
try store.remove(key)
fake.deleteStatus = errSecInteractionNotAllowed
expectFailure(.unavailable(errSecInteractionNotAllowed)) { try store.remove(key) }

print("Keychain policy and injected Security failure tests passed. No live Keychain was accessed.")

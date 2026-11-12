import Foundation
import Capacitor

@objc(DengTaAccountVaultPlugin)
public final class DengTaAccountVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DengTaAccountVaultPlugin"
    public let jsName = "DengTaAccountVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let store = AccountVaultStore()
    private let storageQueue = DispatchQueue(label: "home.dengta.app.account-vault")

    @objc public func read(_ call: CAPPluginCall) {
        guard let accountId = call.getString("accountId") else {
            call.reject("Account cache identity is invalid.", "account_vault_invalid_account")
            return
        }
        storageQueue.async {
            do {
                if let value = try self.store.read(accountId: accountId) {
                    call.resolve(["value": value])
                } else {
                    call.resolve(["value": NSNull()])
                }
            } catch { self.reject(call, error: error) }
        }
    }

    @objc public func write(_ call: CAPPluginCall) {
        guard let accountId = call.getString("accountId"), let value = call.getString("value") else {
            call.reject("Account cache input is invalid.", "account_vault_invalid_data")
            return
        }
        storageQueue.async {
            do {
                try self.store.write(accountId: accountId, value: value)
                call.resolve()
            } catch { self.reject(call, error: error) }
        }
    }

    @objc public func clear(_ call: CAPPluginCall) {
        guard let accountId = call.getString("accountId") else {
            call.reject("Account cache identity is invalid.", "account_vault_invalid_account")
            return
        }
        storageQueue.async {
            do {
                try self.store.clear(accountId: accountId)
                call.resolve()
            } catch { self.reject(call, error: error) }
        }
    }

    private func reject(_ call: CAPPluginCall, error: Error) {
        // Fixed errors only: no account IDs, payloads, native paths, or OSStatus details.
        switch error as? AccountVaultError {
        case .invalidAccount?:
            call.reject("Account cache identity is invalid.", "account_vault_invalid_account")
        case .invalidData?:
            call.reject("Account cache input is invalid.", "account_vault_invalid_data")
        case .unreadable?:
            call.reject("Account cache cannot be read.", "account_vault_unreadable")
        default:
            call.reject("Account cache is unavailable. Unlock this device and retry.", "account_vault_unavailable")
        }
    }
}

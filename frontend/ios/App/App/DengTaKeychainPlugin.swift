import Foundation
import Capacitor

@objc(DengTaKeychainPlugin)
public final class DengTaKeychainPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DengTaKeychainPlugin"
    public let jsName = "DengTaKeychain"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private let store = DengTaKeychainStore()
    private let storageQueue = DispatchQueue(label: "home.dengta.app.auth-keychain")

    @objc public func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Secure session key is invalid.", "keychain_invalid_key")
            return
        }
        storageQueue.async {
            do {
                if let value = try self.store.get(key) {
                    call.resolve(["value": value])
                } else {
                    call.resolve(["value": NSNull()])
                }
            } catch { self.reject(call, error: error) }
        }
    }

    @objc public func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("Secure session input is invalid.", "keychain_invalid_data")
            return
        }
        storageQueue.async {
            do {
                try self.store.set(key, value: value)
                call.resolve()
            } catch { self.reject(call, error: error) }
        }
    }

    @objc public func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("Secure session key is invalid.", "keychain_invalid_key")
            return
        }
        storageQueue.async {
            do {
                try self.store.remove(key)
                call.resolve()
            } catch { self.reject(call, error: error) }
        }
    }

    private func reject(_ call: CAPPluginCall, error: Error) {
        // Never expose stored values, request options, or native error details.
        switch error as? DengTaKeychainError {
        case .invalidKey?:
            call.reject("Secure session key is invalid.", "keychain_invalid_key")
        case .invalidData?:
            call.reject("Secure session data is unreadable.", "keychain_invalid_data")
        default:
            call.reject("Secure session storage is unavailable. Unlock this device and retry.", "keychain_unavailable")
        }
    }
}

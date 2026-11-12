import Capacitor
import UIKit

@objc(DengTaBridgeViewController)
final class DengTaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Native bridge response logging can include session payloads in Debug.
        // ios.loggingBehavior must also be "none" for the injected JS bridge.
        CAPLog.enableLogging = false
        bridge?.registerPluginInstance(DengTaKeychainPlugin())
        bridge?.registerPluginInstance(DengTaAccountVaultPlugin())
        DengTaCIKeychainDiagnostics.record("bridge-created")
        DengTaCIKeychainDiagnostics.record(bridge?.plugin(withName: "DengTaKeychain") != nil ? "bridge-keychain-available" : "bridge-keychain-missing")
        DengTaCIKeychainDiagnostics.record(bridge?.plugin(withName: "DengTaAccountVault") != nil ? "bridge-vault-available" : "bridge-vault-missing")
        DengTaCIKeychainDiagnostics.record(UIApplication.shared.isProtectedDataAvailable ? "protected-data-available" : "protected-data-unavailable")
        DengTaCIKeychainDiagnostics.runRoundTripProbe()
    }
}

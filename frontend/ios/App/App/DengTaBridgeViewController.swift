import Capacitor

@objc(DengTaBridgeViewController)
final class DengTaBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Native bridge response logging can include session payloads in Debug.
        // ios.loggingBehavior must also be "none" for the injected JS bridge.
        CAPLog.enableLogging = false
        bridge?.registerPluginInstance(DengTaKeychainPlugin())
        bridge?.registerPluginInstance(DengTaAccountVaultPlugin())
    }
}

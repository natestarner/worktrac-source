import Foundation
import Capacitor
import StoreKit

/// Which country's App Store this install belongs to -- the ONE input to whether the app may link
/// out to Stripe for an upgrade (lib/native/billingChannel.js). Apple's rule is about the App Store
/// storefront, so this deliberately does not look at the device region, the language or the IP.
///
/// Answers `{ countryCode: "USA" }` (ISO 3166-1 alpha-3) or `{}` when the storefront can't be read,
/// which the app treats exactly like a non-US storefront: no purchase UI at all.
@objc(StorefrontPlugin)
public class StorefrontPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorefrontPlugin"
    public let jsName = "Storefront"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCountryCode", returnType: CAPPluginReturnPromise)
    ]

    @objc func getCountryCode(_ call: CAPPluginCall) {
        Task {
            if let storefront = await Storefront.current {
                call.resolve(["countryCode": storefront.countryCode])
            } else {
                call.resolve([:])
            }
        }
    }
}

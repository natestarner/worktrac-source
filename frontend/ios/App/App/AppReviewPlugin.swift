import Foundation
import Capacitor
import StoreKit

/// Asks iOS to show Apple's own "rate this app" sheet (lib/native/review.js). Apple's guideline
/// 5.6.1 requires this API for in-app rating requests; a custom "Enjoying Huddle?" screen in front
/// of it is review gating and is not used.
///
/// iOS alone decides whether the sheet actually appears: at most three times a year per app, usually
/// never again once the person has rated, never in TestFlight, and every time in a Debug build. It
/// reports nothing back, so `{ requested: true }` means only that the request was made.
@objc(AppReviewPlugin)
public class AppReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppReviewPlugin"
    public let jsName = "AppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let scene = self?.bridge?.viewController?.view.window?.windowScene else {
                call.resolve(["requested": false])
                return
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve(["requested": true])
        }
    }
}

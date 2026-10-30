import UIKit
import Capacitor

/// The app's root view controller: Capacitor's bridge, with the window and the WebView painted in
/// the page's own background (`LaunchBackground`, the `--color-bg` token: #faf9f7 light, #171614
/// dark). Capacitor otherwise uses the system background -- pure white or black -- so the moment
/// between the launch screen and the first painted frame, and the bounce area past either end of a
/// scroll, would be a different colour from both. Matching colours is what removes the flash; the
/// splash is NOT held until the page renders, because a bundle that failed to boot would then sit
/// behind a splash forever instead of showing boot-watchdog.js's way out.
class MainViewController: CAPBridgeViewController {
    /// The app's own plugins (not from npm), registered with the bridge the way Capacitor's docs
    /// prescribe for local plugins. Today: the App Store storefront lookup the billing channel needs,
    /// and Apple's rating request (lib/native/review.js).
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StorefrontPlugin())
        bridge?.registerPluginInstance(AppReviewPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UIColor(named: "LaunchBackground")
        view.backgroundColor = background
        webView?.isOpaque = false
        webView?.backgroundColor = background
        webView?.scrollView.backgroundColor = background
    }
}

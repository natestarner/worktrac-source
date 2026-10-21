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
    override func viewDidLoad() {
        super.viewDidLoad()
        let background = UIColor(named: "LaunchBackground")
        view.backgroundColor = background
        webView?.isOpaque = false
        webView?.backgroundColor = background
        webView?.scrollView.backgroundColor = background
    }
}

import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        #if DEBUG
        // The simulator flows' only window into the app (#434). Capacitor prints its bridge log and
        // the page's console to stdout, which is thrown away when Maestro launches the app, so with
        // the launch argument the sign-in subflow passes, write both to Documents/console.log;
        // ios-maestro.sh copies it out after each flow. Debug builds only (TestFlight is Release),
        // and never without the argument, so a run from Xcode keeps its own console.
        if ProcessInfo.processInfo.arguments.contains(where: { $0.contains("huddleConsoleToFile") }),
           let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            let path = documents.appendingPathComponent("console.log").path
            freopen(path, "a", stdout)
            freopen(path, "a", stderr)
            setvbuf(stdout, nil, _IOLBF, 0)
            setvbuf(stderr, nil, _IONBF, 0)
            print("Huddle: launched, arguments \(ProcessInfo.processInfo.arguments.dropFirst())")
        }
        #endif
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    // Backend that knows how to fan a push to every registered device.
    // Must match the live deployment of /api/register-device.
    let pushRegisterURL = URL(string: "https://higrade-invoicing.vercel.app/api/register-device")!

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Ask for notification permission on first launch. iOS only shows
        // the prompt once — subsequent calls return the user's prior choice
        // immediately, so it's safe to call every launch.
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    // Called by iOS once it's negotiated an APNs token for this install. We
    // POST it to /api/register-device which upserts into Supabase.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenStr = deviceToken.map { String(format: "%02x", $0) }.joined()
        registerDeviceWithServer(token: tokenStr)
        // Hand the token to the @capacitor/push-notifications plugin too,
        // so JS-side listeners (if any) still receive a 'registration' event.
        NotificationCenter.default.post(
            name: Notification.Name(rawValue: "didRegisterForRemoteNotificationsWithDeviceToken"),
            object: deviceToken
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("APNs registration failed: \(error.localizedDescription)")
        NotificationCenter.default.post(
            name: Notification.Name(rawValue: "didFailToRegisterForRemoteNotificationsWithError"),
            object: error
        )
    }

    // Show banners + play sound even when the app is in the foreground —
    // otherwise iOS suppresses them, which feels broken to the user.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    // POST { token, platform, bundle_id, app_version } to the backend.
    // Fire-and-forget; on failure we just log so we can investigate later.
    private func registerDeviceWithServer(token: String) {
        let bundleId = Bundle.main.bundleIdentifier ?? "com.higradeplumbing.invoicing"
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let payload: [String: Any] = [
            "token": token,
            "platform": "ios",
            "bundle_id": bundleId,
            "app_version": appVersion,
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
        var req = URLRequest(url: pushRegisterURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req) { _, resp, err in
            if let err = err {
                NSLog("register-device failed: \(err.localizedDescription)")
                return
            }
            if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                NSLog("register-device returned HTTP \(http.statusCode)")
            }
        }.resume()
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

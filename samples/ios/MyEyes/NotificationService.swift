import SwiftUI
import UserNotifications
import UIKit

/// Local notifications supplement the existing scanner. They never keep capture alive.
@MainActor
final class NotificationService: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationService()
    private let center = UNUserNotificationCenter.current()
    private let defaults = UserDefaults.standard
    private static let hazardID = "clarity.scanner.hazard"
    private static let testID = "clarity.notifications.test"
    @Published var enabled: Bool {
        didSet {
            defaults.set(enabled, forKey: "notifications.enabled")
            if !enabled {
                cancelPending()
                message = "System notifications are off. Pending test notifications were cancelled."
            }
        }
    }
    @Published var criticalEnabled: Bool {
        didSet { defaults.set(criticalEnabled, forKey: "notifications.critical") }
    }
    @Published var volume: Double {
        didSet { defaults.set(volume, forKey: "notifications.volume") }
    }
    @Published private(set) var status = "Checking notification permissions…"
    @Published private(set) var message = ""
    @Published private(set) var isBusy = false
    // Enable ONLY alongside an Apple-approved entitlement and matching provisioning profile.
    var supportsCritical: Bool {
        Bundle.main.object(forInfoDictionaryKey: "ClarityCriticalAlertsApproved") as? Bool == true
    }

    private override init() {
        enabled = UserDefaults.standard.bool(forKey: "notifications.enabled")
        criticalEnabled = UserDefaults.standard.bool(forKey: "notifications.critical")
        volume = UserDefaults.standard.object(forKey: "notifications.volume") as? Double ?? 0.5
        super.init()
        center.delegate = self
    }

    func refresh() async {
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: status = "Not requested"
        case .denied: status = "Notifications denied. Enable them in iOS Settings."
        case .authorized: status = "Notifications allowed"
        case .provisional: status = "Quiet delivery only"
        case .ephemeral: status = "Temporarily allowed"
        @unknown default: status = "Unknown permission status"
        }
        if settings.criticalAlertSetting == .enabled {
            status += " · Critical Alerts allowed"
        } else if supportsCritical {
            status += " · Critical Alerts not allowed"
        } else {
            status += " · Standard build (no Critical Alerts entitlement)"
        }
        if settings.soundSetting != .enabled { status += " · Ordinary notification sound disabled" }
        if settings.timeSensitiveSetting == .enabled { status += " · Time Sensitive allowed" }
    }

    func requestPermission() async {
        guard enabled, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        var options: UNAuthorizationOptions = [.alert, .sound]
        if supportsCritical && criticalEnabled { options.insert(.criticalAlert) }
        do {
            let granted = try await center.requestAuthorization(options: options)
            message = granted ? "Permission request completed. Review the status below." : "Permission was not granted. Scanning still works. Open iOS Settings to change your choice."
        } catch { message = "Permission request failed: \(error.localizedDescription)" }
        await refresh()
    }

    func sendTest() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        await schedule(body: "This is a Clarity test notification, not a detected hazard.", test: true)
    }

    func notifyHazard(_ body: String) async {
        await schedule(body: body, test: false)
    }

    private func schedule(body: String, test: Bool) async {
        guard enabled, !Task.isCancelled else { return }
        let settings = await center.notificationSettings()
        guard enabled, !Task.isCancelled else { return }
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
            message = "No notification scheduled. Allow notifications first, or open iOS Settings if denied."
            return
        }
        let critical = supportsCritical && criticalEnabled && settings.criticalAlertSetting == .enabled
        let content = UNMutableNotificationContent()
        content.title = test ? "Clarity notification test" : "Object in camera zone"
        content.body = body
        content.threadIdentifier = "clarity.scanner"
        if critical {
            content.interruptionLevel = .critical
            content.sound = .defaultCriticalSound(withAudioVolume: Float(min(1, max(0, volume))))
        } else {
            content.interruptionLevel = settings.timeSensitiveSetting == .enabled ? .timeSensitive : .active
            content.sound = .default
        }
        let identifier = test ? Self.testID : Self.hazardID
        // Reuse the hazard identifier to avoid stacking repeated scanner warnings.
        let trigger: UNNotificationTrigger? = test ? UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false) : nil
        do {
            try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
            if !enabled { cancelPending(); return }
            if Task.isCancelled {
                center.removePendingNotificationRequests(withIdentifiers: [identifier])
                center.removeDeliveredNotifications(withIdentifiers: [identifier])
                return
            }
            message = test ? "Test scheduled in 5 seconds using \(critical ? "Critical Alert" : "ordinary / Time Sensitive") delivery. Focus, sound and permission settings still apply." : "Scanner notification submitted. Delivery is controlled by iOS."
        } catch { message = "Notification could not be scheduled: \(error.localizedDescription)" }
    }

    func cancelPending() {
        center.removePendingNotificationRequests(withIdentifiers: [Self.hazardID, Self.testID])
        center.removeDeliveredNotifications(withIdentifiers: [Self.hazardID, Self.testID])
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                           willPresent notification: UNNotification,
                                           withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Foreground hazards already use AlertPlayer, so avoid duplicate audio.
        completionHandler(notification.request.identifier == "clarity.notifications.test" ? [.banner, .sound] : [.banner])
    }
}

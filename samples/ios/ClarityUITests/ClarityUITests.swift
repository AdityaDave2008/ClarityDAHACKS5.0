import XCTest

/// Exercises the shipped app, with no launch overrides, mocks, or app-side test hooks.
/// Run on an English-language simulator with a fresh app installation and notification
/// permission not yet requested. XCTest has no notification-authorization reset API.
/// Reinstall on a fresh simulator before repeating the permission tests.
final class ClarityUITests: XCTestCase {
    private var app: XCUIApplication!
    private let settingsLabel = "Offline detector and alert settings"
    private let optInLabel = "Opt in to system notifications"

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons[settingsLabel].waitForExistence(timeout: 10))
    }

    override func tearDownWithError() throws {
        app.terminate()
    }

    private func openSettings() {
        app.buttons[settingsLabel].tap()
        XCTAssertTrue(app.navigationBars["Scan settings"].waitForExistence(timeout: 5))
    }

    private func reveal(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        // SwiftUI Form is a collection view on newer iOS and a table on older iOS.
        let form = app.collectionViews.firstMatch.exists
            ? app.collectionViews.firstMatch : app.tables.firstMatch
        XCTAssertTrue(form.waitForExistence(timeout: 5), file: file, line: line)
        for _ in 0..<24 {
            if element.exists && element.isHittable { return }
            form.swipeUp(velocity: .slow)
        }
        for _ in 0..<24 {
            if element.exists && element.isHittable { return }
            form.swipeDown(velocity: .slow)
        }
        XCTFail("Could not scroll to \(element)", file: file, line: line)
    }

    private func setOptIn(_ enabled: Bool) {
        let toggle = app.switches[optInLabel]
        reveal(toggle)
        if (toggle.value as? String == "1") != enabled {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        }
        let expected = enabled ? "1" : "0"
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", expected), object: toggle)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 5), .completed,
                       "Notification opt-in should become \(expected)")
    }

    private func text(startingWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    func testSettingsSaveDiscardAndConfidenceReset() {
        openSettings()
        let sound = app.switches["Sound"]
        reveal(sound)
        let originalSound = sound.value as? String
        let spoken = app.buttons["Spoken preset"]
        reveal(spoken)
        spoken.tap()
        XCTAssertEqual(sound.value as? String, "0")
        app.navigationBars.buttons["Close"].tap()
        openSettings()
        reveal(sound)
        XCTAssertEqual(sound.value as? String, originalSound, "Close must discard draft alert modes")

        let reset = app.buttons["Restore model confidence default"]
        reveal(reset)
        reset.tap()
        XCTAssertTrue(app.staticTexts["Confidence threshold · 78.75%"].exists)
        app.navigationBars.buttons["Apply"].tap()
        XCTAssertTrue(app.buttons[settingsLabel].waitForExistence(timeout: 5))
        openSettings()
        reveal(reset)
        XCTAssertTrue(app.staticTexts["Confidence threshold · 78.75%"].exists)

        setOptIn(false)
        let request = app.buttons["Request permissions"]
        reveal(request)
        XCTAssertFalse(request.isEnabled)
        XCTAssertFalse(app.buttons["Send test notification"].isEnabled)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Settings opt-out controls"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testFreshAuthorizationLaunchDoesNotPromptForNotifications() {
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons[settingsLabel].waitForExistence(timeout: 10))
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertFalse(springboard.alerts.firstMatch.waitForExistence(timeout: 3),
                       "Launching must not request notification permission")
        XCTAssertFalse(app.alerts.firstMatch.exists)
        openSettings()
        reveal(app.switches[optInLabel])
        let status = app.descendants(matching: .any)["notificationPermissionStatus"]
        reveal(status)
        XCTAssertTrue((status.value as? String)?.hasPrefix("Not requested") == true)
    }

    func testNotificationOptInPersistsAfterClosingAndRelaunching() {
        openSettings()
        let toggle = app.switches[optInLabel]
        reveal(toggle)
        let original = toggle.value as? String == "1"
        setOptIn(!original)
        app.navigationBars.buttons["Close"].tap()
        openSettings()
        reveal(toggle)
        XCTAssertEqual(toggle.value as? String, original ? "0" : "1",
                       "Close must save notifications without Apply")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons[settingsLabel].waitForExistence(timeout: 10))
        openSettings()
        reveal(toggle)
        XCTAssertEqual(toggle.value as? String, original ? "0" : "1")
        setOptIn(original)
    }

    func testCriticalAlertsDisabledInStandardBuild() {
        openSettings()
        let optIn = app.switches[optInLabel]
        reveal(optIn)
        let original = optIn.value as? String == "1"
        setOptIn(true)
        let critical = app.switches["Critical alerts"]
        reveal(critical)
        XCTAssertFalse(critical.isEnabled,
                       "Ordinary opt-in must not enable entitlement-gated Critical alerts")
        setOptIn(original)
    }

    func testRequestPermissionAllowsRealSystemAlertAndSchedulesTest() {
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons[settingsLabel].waitForExistence(timeout: 10))
        openSettings()
        let optIn = app.switches[optInLabel]
        reveal(optIn)
        let original = optIn.value as? String == "1"
        setOptIn(true)
        let request = app.buttons["Request permissions"]
        reveal(request)
        request.tap()

        // Address the real SpringBoard alert, never a simulated app dialog.
        let alert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 10), "Expected a fresh iOS permission alert")
        XCTAssertTrue(alert.label.localizedCaseInsensitiveContains("notification") ||
                      alert.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'notification'")).count > 0)
        let allow = alert.buttons["Allow"]
        XCTAssertTrue(allow.exists)
        allow.tap()
        let completed = app.staticTexts["Permission request completed. Review the status below."]
        XCTAssertTrue(completed.waitForExistence(timeout: 10))
        let status = app.descendants(matching: .any)["notificationPermissionStatus"]
        reveal(status)
        XCTAssertTrue((status.value as? String)?.hasPrefix("Notifications allowed") == true)

        let send = app.buttons["Send test notification"]
        reveal(send)
        XCTAssertTrue(send.isEnabled)
        send.tap()
        let result = app.staticTexts["Test scheduled in 5 seconds using ordinary / Time Sensitive delivery. Focus, sound and permission settings still apply."]
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        let delivered = XCUIApplication(bundleIdentifier: "com.apple.springboard").staticTexts["Clarity notification test"]
        XCTAssertTrue(delivered.waitForExistence(timeout: 15), "Expected iOS to display the scheduled test banner")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Delivered notification banner"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        // Cancels the pending notification rather than leaving it for another test.
        app.navigationBars.buttons["Close"].tap()
        openSettings()
        setOptIn(false)
        setOptIn(original)
    }

    func testZAuthorizedNotificationDelivery() {
        openSettings()
        setOptIn(true)
        let status = app.descendants(matching: .any)["notificationPermissionStatus"]
        reveal(status)
        XCTAssertTrue((status.value as? String)?.hasPrefix("Notifications allowed") == true,
                      "This case requires permission granted through the real iOS prompt")
        let send = app.buttons["Send test notification"]
        reveal(send)
        send.tap()
        XCTAssertTrue(text(startingWith: "Test scheduled in 5 seconds").waitForExistence(timeout: 5))
        let delivered = XCUIApplication(bundleIdentifier: "com.apple.springboard").staticTexts["Clarity notification test"]
        XCTAssertTrue(delivered.waitForExistence(timeout: 15))
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "Actual delivered notification"
        image.lifetime = .keepAlways
        add(image)
        setOptIn(false)
    }

    func testAllFiveFAQEntriesExpandAndRemainScrollable() {
        openSettings()
        let entries = [
            ("Why is camera access needed?", "Camera access is needed to scan for supported objects."),
            ("Are notifications required?", "No. System notifications are optional"),
            ("Can alerts bypass Focus or silent mode?", "Critical alerts require both an Apple-approved entitlement"),
            ("Does Picture in Picture guarantee background scanning?", "No. Picture in Picture does not guarantee camera access"),
            ("Can the Android PWA bypass Do Not Disturb?", "No. The Android PWA cannot programmatically bypass Do Not Disturb.")
        ]
        for (question, answerPrefix) in entries {
            let disclosure = app.buttons[question]
            reveal(disclosure)
            disclosure.tap()
            let answer = text(startingWith: answerPrefix)
            reveal(answer)
            XCTAssertTrue(answer.exists)
            XCTAssertTrue(answer.isHittable)
        }
        app.navigationBars.buttons["Close"].tap()
        openSettings()
        reveal(app.buttons[entries[4].0])
        XCTAssertTrue(app.buttons[entries[4].0].isHittable,
                       "FAQ must remain reachable after reopening settings")
    }
}

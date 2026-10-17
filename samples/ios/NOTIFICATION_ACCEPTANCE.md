# Notification acceptance evidence, October 17, 2026

## Later follow-up

The initial launch blocker below was diagnosed as a missing simulator WebKit runtime library and worked around only in scratch build products. Subsequent real-app tests passed FAQ expansion, save/discard, confidence reset, opt-in persistence, critical gating, and actual ordinary notification banner delivery. See `SETTINGS_REVIEW.md` for exact per-case evidence and failures retained during iteration. Physical-device Critical Alerts and several edge cases remain unverified.

## Original outcome and limits

The feature is integrated and compiles for both simulator Debug and physical-device Release architectures. End-user acceptance is **not verified**. A real-app XCTest run was attempted, not replaced with mocks or a copied-source harness. The simulator environment prevented successful execution, as detailed below. The 61 passing Node checks are source-contract/model regressions, not proof of notification delivery.

## Requirement-to-evidence map

| Requirement or changed output | Concrete check and observed result | Remaining acceptance gap |
| --- | --- | --- |
| Update the Downloads Xcode app without disturbing working repository | Simulator Debug and unsigned iphoneos Release builds both reported BUILD SUCCEEDED. Original working repository status retained exactly the same seven modified/untracked entries. | Signed installation on a real device not tested. |
| Native system notification integrated with scanner | Real target compiled NotificationService and ScanModel call site. Existing cooldown, camera, offline and PiP regression checks passed. | Actual camera-triggered notification not observed. Simulator cannot establish real camera behavior. |
| Critical Alerts bypass capability | Source-contract test verified critical request requires explicit preference and build gate, and delivery additionally checks current iOS critical authorization. Standard entitlement file contains no restricted critical entitlement. | Apple approval, matching profile, user permission, Focus/silent-switch delivery and volume audibility require physical-device acceptance. No claim of functioning bypass in standard build. |
| Normal fallback and permission controls | Notification source-contract tests passed. XCUITest target compiled tests for real iOS permission alert, ordinary test scheduling, and SpringBoard banner appearance. | UI tests did not reach assertions because simulator app launch failed. Grant/deny/re-enable and Settings shortcut behavior remain unverified. |
| Persistent opt-in and opt-out | Source checks verified off removes feature notifications and scheduling checks cancellation before/after permission awaits. Real XCUITest covers Close without Apply and relaunch persistence. | Runtime persistence, opt-out during pending test and scanner-stop races not observed. |
| No unsolicited prompt at launch | XCUITest targets real first launch and asserts no SpringBoard alert, then checks Not requested status. | Compiled but not successfully executed. |
| Five-question permissions FAQ | Source test counted exactly five DisclosureGroups. Real XCUITest scrolls and expands all five answers and reopens settings. | Runtime readability, scrolling, VoiceOver and larger-text behavior remain unverified. |
| Android home-screen web limitation explained | FAQ and research notes explain no programmatic web DND bypass and device-specific exceptions. WHATWG Notifications API reviewed. | No Android implementation was requested or added. No Android device test performed. |
| Build and test packaging | Project/plist lint passed. Added shared Clarity scheme includes ClarityUITests target. Test runner and test bundle compiled successfully under xcodebuild test. | Full XCTest execution blocked below. |

## Actual acceptance attempt

- macOS computer-use permission check: Screen Recording granted, Accessibility not granted. No permission dialog was forced or system privacy setting changed.
- Created an isolated iPhone 16 / iOS 18.5 simulator named `Clarity Notification Acceptance`, UUID `BCDA94B3-CDA3-46FA-85DF-8CD2D20B9C42`, leaving existing simulators untouched.
- Initial boot/install/launch chain timed out after 200 seconds while first-boot migration was still running. Screenshot showed the iOS Apple-logo migration screen, not the app.
- Retried after `simctl bootstatus` reported booted. Installation progressed, but `simctl launch com.dahacks.clarity.v2testing` failed with `FBSOpenApplicationServiceErrorDomain`, code 1, request denied by `SBMainWorkspace`. This is an observed launch failure, not a passing app-launch check.
- In parallel, ran the real project's Clarity scheme with XCTest against that simulator, with parallel testing disabled. The runner compiled and logged `Running tests...`, but did not produce a completed test case or requirement observation. The stalled run was cancelled after more than five minutes. None of its five UI test cases is reported as passed.
- Debug simulator build and unsigned Release iphoneos build succeeded independently. They establish compilation/packaging, not authorization or delivery.

## Reproduce real workflow on a healthy fresh simulator

From `samples/ios`, choose a freshly installed English-language iPhone simulator with notification permission not yet requested, then run:

```sh
xcodebuild -project MyEyes.xcodeproj -scheme Clarity \
  -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UUID' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

The permission test expects a fresh iOS notification prompt. Use a fresh app installation/simulator for a full rerun. Tests exercise the actual app and SpringBoard without app-side launch overrides or mocks. For Critical Alerts and camera-to-notification delivery, follow the physical-device checklist in `NOTIFICATIONS.md` using an Apple-approved signed build.

Evidence retained in the local Jcode scratch directory: `clarity-device-build.log`, `clarity-notifications-final.log`, `clarity-notifications-tests.log`, `clarity-notifications-ui.log`, `clarity-notifications-ui.xcresult`, and `clarity-acceptance-progress.png`. The xcresult is from an interrupted attempt and must not be interpreted as a passing test run.

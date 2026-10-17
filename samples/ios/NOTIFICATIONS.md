# Clarity system notifications

Implemented in the Downloads project on October 17, 2026. The separate working Git repository was not modified.

## What ships

Settings contains an opt-in System notifications section and five permissions FAQ questions. Notification preferences save immediately, independently of Apply. Ordinary notification authorization is requested only by tapping the permission button. Test sends a clearly labeled local notification after five seconds. Existing confirmed scanner alerts also submit a local notification, using the existing detector confirmation and cooldown policy. There is no APNs server or remote push registration in this feature.

Normal builds include Time Sensitive capability, not the restricted Critical Alerts entitlement. Delivery falls back to active notifications if Time Sensitive is disabled. Focus and sound settings remain under the user's control. Camera access and on-device inference are unchanged. Turning off notifications removes this feature's pending and delivered notifications. Foreground scanner banners do not duplicate the existing AlertPlayer sound. Test notifications do request foreground sound.

## Enable Critical Alerts only after Apple approval

1. Request Apple's Critical Alerts entitlement for the app's actual bundle identifier. Describe the real use case accurately: this is an experimental scanner, not a certified safety device. Approval is not guaranteed.
2. After approval, enable the entitlement on the App ID and regenerate/download matching development and distribution provisioning profiles.
3. Add a Boolean `com.apple.developer.usernotifications.critical-alerts` set to YES in `MyEyes/Clarity.entitlements`, alongside the existing Time Sensitive entry.
4. Set Boolean `ClarityCriticalAlertsApproved` to YES in `MyEyes/Info.plist`. This is an explicit build gate, not proof of approval and not a way to bypass provisioning.
5. Sign with the approved profile. In Scan settings, enable System notifications and Use Critical Alerts, then tap the permission button. The request now includes `.criticalAlert`. Both this preference and iOS's current `criticalAlertSetting == .enabled` are required to send a critical notification. Otherwise delivery falls back normally.
6. Select a comfortable critical volume and test on a physical iPhone. Critical delivery uses Apple's built-in critical sound, with volume clamped to 0...1. No missing custom audio file is required.

If Time Sensitive capability is unavailable for your signing account, remove its entitlement to build an ordinary-notification version. Do not add the restricted Critical Alerts entitlement to an unapproved profile.

## Limits and research

Apple's Critical Alerts mechanism can bypass silent mode and Focus with approval and user permission. Time Sensitive delivery can cross Focus only when allowed and does not provide Critical Alerts' silent-switch behavior. Notification authorization does not grant background camera execution. When iOS suspends scanning or capture stops, this implementation cannot detect new objects. A previously scheduled test can still be delivered by iOS. It is not a life-safety system.

AlarmKit on iOS 26 also supports user-authorized alarms that override Focus and silent mode. It is designed for alarms and timers and is not used here as a workaround for restricted scanner Critical Alerts. This app retains its iOS 16 deployment target.

An Android home-screen web app uses the browser's notification APIs. They offer no programmatic DND bypass switch. Any manual exceptions depend on the Android version, browser, and device. This change does not add Android native permissions or a Web Push backend.

Primary references checked October 17, 2026:
- https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.critical-alerts
- https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive
- https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- https://developer.apple.com/documentation/alarmkit/scheduling-an-alarm-with-alarmkit
- https://notifications.spec.whatwg.org/

## Physical-device acceptance checklist

- Fresh install: no unsolicited notification prompt, notifications off, camera requested only by existing scanner workflow.
- Enable notifications, request permission, allow, send test. Verify five-second delivery foreground and background.
- Deny permission: test reports no notification scheduled. Open iOS Settings, enable, return, verify status refresh.
- Toggle notifications off during a pending test: verify no test arrives. Re-launch and check preferences persist.
- Trigger confirmed objects: verify existing cooldown remains respected and foreground audio is not doubled.
- Standard build with Focus/silent mode: verify there is no claim of guaranteed sound or bypass.
- Approved signed build: enable Critical Alerts, grant separate permission, test with Focus and silent switch, then revoke Critical Alerts and verify fallback.
- Stop/lock/background scanner: verify no claim of continuous new detection while suspended.
- Expand all five FAQ entries with VoiceOver and larger text.

## Validation performed

See [requirement-by-requirement acceptance evidence](NOTIFICATION_ACCEPTANCE.md). A real XCTest run was attempted but blocked by simulator migration/launch failure. No UI workflow is claimed as passed. The unsigned iphoneos Release build also succeeded.

- Xcode 26.3 simulator Debug build of the Clarity scheme: BUILD SUCCEEDED, with code signing disabled, including the final source edits.
- `node --test samples/ios/tests/*.test.mjs`: 61 passed, 0 failed. These include five new notification source-contract checks, not end-to-end delivery tests.
- Final notification-only regression rerun: 5 passed, 0 failed.
- `plutil -lint` passed for Info.plist, Clarity.entitlements, and project.pbxproj.
- Existing working repository changes were left untouched. The Downloads source archive has no `.git` directory, so no commit was created there.
- Physical-device permission prompts, Focus/silent behavior, and signed Critical Alerts delivery were not tested.

Build validation is recorded separately from device delivery verification. Simulator compilation cannot prove Critical Alerts entitlement approval, sound audibility, physical camera behavior, or DND breakthrough.

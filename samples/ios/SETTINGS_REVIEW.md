# Clarity Settings review

Reviewed October 17, 2026 in the Downloads native Xcode project. Original working Git repository was not edited. This source archive has no Git metadata, so no commit was created.

## Control-by-control audit

| Section/control | Behavior traced and result | Acceptance status |
| --- | --- | --- |
| Offline detector description/model status | Read-only model identity, on-device processing and prototype limitations match existing model flow. | Source reviewed, existing offline regression tests pass. |
| Standard and Spoken presets | Set draft modes to sound-only or speech-only. Persist only through Apply. | Source reviewed. Real UI test verified preset selection and Close discarding the draft. |
| Sound, Haptics, Spoken alerts toggles | Draft modes deduplicated and kept in enum order. Empty modes are visual-only in-app, separately opted-in notifications may still sound. | Source reviewed, native alert integration compiles. Audibility/hardware untested. |
| System notification opt-in | Saves immediately. Off cancels feature requests. Fixed stale scheduled-success message after opt-out during an async send. | Real UI test passed opt-in persistence through Close and app relaunch. Cancellation source regression passes. Pending-delivery race still untested. |
| Critical alerts | Disabled without approved-build flag or notification opt-in. Added explicit explanation of disabled state. | Real UI test passed: Critical alerts remained disabled with ordinary opt-in enabled. Apple approval and physical-device bypass still required. |
| Critical volume | Shows only with critical preference and supported build. Slider 0...1, disabled when notifications off. Send clamps volume. | Source reviewed. Actual sound volume untested. |
| Permission status | Refreshes when section appears and when returning from Settings. | Added explicit accessibility label/value and stable identifier after a real test exposed an incorrect text query. Authorized status verified live in the passing delivery test. Settings round-trip remains untested. |
| Request permissions | Now disabled while opted out or busy. Service also rejects requests while opted out. | Real iOS permission prompt appeared, Allow was tapped, and completion feedback observed. Opt-out disabled-control assertions passed. Denial not yet exercised. |
| Send test notification | Disabled when off/busy. Requests five-second test and reports errors. | Real UI test passed: scheduled a five-second test and observed the actual SpringBoard notification banner. Screenshot retained in xcresult. DND/critical delivery remains untested. |
| Open iOS Settings | Uses UIApplication.openSettingsURLString for app-specific permissions. | Source reviewed. Runtime navigation unverified. |
| Automatic hardware depth | Draft choice blocked during camera operation. Model independently rejects changing depth during capture. Saves through Apply. | Guard/persistence regression passes. LiDAR requires physical hardware. |
| Capture status / center-surface test | Read-only diagnostic labels. Center depth refreshes every 0.1s and is explicitly not object-distance/safety guidance. | Source reviewed and existing depth tests pass. |
| Confidence threshold | Fixed misleading integer display (78% for default ~78.75%). Now shows two decimals and accessible value. Removed coarse 5-point snapping and added exact model-default restore. | Real UI test verified exact 78.75% restore and persistence after Apply/reopen. Continuous slider dragging remains untested. |
| Repeat interval | Draft stepper 1...10 seconds in one-second increments, applied to existing cooldown policy. | Source reviewed, existing native/model regressions pass. Runtime repeated detections not tested. |
| Camera diagnostics | Read-only support/access/PiP state. No control falsely grants background camera permission. | Source reviewed, existing PiP/camera regressions pass. |
| Five FAQ disclosures | Camera, optional notification permission, Critical vs Time Sensitive, PiP limitations and Android PWA limitations preserved. | Real UI test passed: all five answers expanded, were reachable, and remained reachable after reopening. Screenshot inspected. VoiceOver remains untested. |
| Apply / Close | Apply passes draft to model, persists, then dismisses. Close discards draft scan settings but not immediate notification settings. Added prominent explanation at top of form. | Real UI test passed Close-discard and Apply-save assertions after the simulator runtime issue was diagnosed and worked around. |

## Validation observed

- Final simulator Debug build: **BUILD SUCCEEDED** after all settings edits.
- Full native Node regression suite: **66 passed, 0 failed**, including five new settings source-contract tests. These are not end-to-end UI results.
- Added real XCTest `testSettingsSaveDiscardAndConfidenceReset` to exercise presets, Close discard, exact confidence reset, Apply persistence and disabled notification controls while opted out.
- Real test run on isolated iPhone 16/iOS 18.5 started the test, but failed in setup at `app.launch()` with `Failed to get background assertion for target app with pid 0: No failure details provided`. XCTest recorded **1 test, 1 failure**. No Settings interaction assertions were reached. The outer command later hit its 300-second timeout.
- The isolated simulator was shut down after the attempt. No user's simulator was erased, and no permissions were changed to bypass the blocker.

Evidence: local scratch `clarity-settings-build.log`, `clarity-settings-tests.log`, `clarity-settings-ui.log`, and `clarity-settings-ui.xcresult`. For the earlier notification review and physical-device checklist, see `NOTIFICATION_ACCEPTANCE.md` and `NOTIFICATIONS.md`.

## Runtime follow-up: actual app now exercised

The app-specific crash report identified the prior launch failure as DYLD missing `/usr/lib/swift/libswiftWebKit.dylib`, not a Settings assertion failure. Apple's Frameworks Engineer documents this iOS 18.5 simulator issue and a library-search-path workaround at https://developer.apple.com/forums/thread/785964. The real runtime library exists in the runtime's Cryptex path. A symlink was created only in the scratch simulator build-products directory so the unchanged app can load it. No deployment target, app permissions, shipped source behavior, or OS security policy was changed.

With that runtime workaround, a real XCTest run completed three cases: FAQ expansion/scroll/reopen passed (74.554 seconds), Settings preset/Close-discard/confidence-reset/Apply/opt-out controls passed (102.852 seconds), and critical-gating setup failed because the row-center toggle tap did not change its value. The test helper was corrected to tap the switch thumb and await the value, without changing app state programmatically. A follow-up run checks opt-in persistence, critical gating, and the real permission prompt/test banner.

The screenshot `clarity-settings-runtime-screen.png` was inspected and shows actual native Settings with expanded camera and notification FAQ text, readable wrapping, diagnostics and Close/Apply controls. `clarity-settings-fixed-runtime.xcresult` and its log preserve both passes and the one failure. These newer observations supersede earlier blanket statements that no Settings interaction was exercised.

## Final observed follow-up results

- `testCriticalAlertsDisabledInStandardBuild`: passed, 30.750 seconds. Explicit ordinary opt-in did not enable the unsupported Critical Alerts switch.
- `testNotificationOptInPersistsAfterClosingAndRelaunching`: passed, 39.630 seconds. Changes survived both Close and process relaunch without Apply.
- The permission test interacted with the real SpringBoard prompt and tapped Allow. Its subsequent status lookup failed because it assumed a separate static text node for a combined LabeledContent value. Added an explicit accessible label/value and identifier. This failed run is retained, not counted as a pass.
- `testZAuthorizedNotificationDelivery`: **passed, 33.499 seconds, TEST SUCCEEDED**. It read the authorized status, pressed Send test notification, observed the real SpringBoard `Clarity notification test` banner, retained a screenshot, and switched notifications back off. This used the authorization granted in the previous real prompt, not a mocked authorization or pre-seeded preference.
- Together with the two earlier Settings/FAQ passes, five distinct real-app acceptance cases now have passing observations across the recorded runs. This is not a claim that a full fresh-install suite passed in one run.
- Final evidence: `clarity-settings-permissions.xcresult` and `clarity-notification-delivery.xcresult`, plus matching logs. The last run compiled the final status-accessibility change.

## Remaining acceptance work

On a healthy simulator or signed iPhone, rerun the Settings UI test and all notification UI tests. Check denied permissions, returning from iOS Settings, cancelling a pending test, large text and VoiceOver. Use a physical LiDAR-capable device for depth/camera behavior and an Apple-approved build for Critical Alert sound and Focus bypass. This review does not claim every Settings control was successfully tapped or exercised live.

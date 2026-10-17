# Native iPhone floating camera

The native project at `samples/ios/StepSense.xcodeproj` now includes a sample-buffer Picture in Picture controller. Start a scan, tap **Use floating camera**, wait for the system floating window, then switch apps. Inference continues through the existing backend pipeline only while the scan is running and iOS reports camera multitasking support with PiP active. Camera interruptions stop scanning; closing PiP while backgrounded pauses scanning. Leaving without PiP pauses as before. No automatic background restart occurs.

This is implemented source, not a verified iPhone release. The development machine is Windows, with no Xcode or connected iPhone available. It has not been compiled with Apple's SDK or tested on hardware. The Safari/PWA preview does not acquire this native capability.

## Eligibility is a separate requirement

PiP video playback does not itself grant camera access. Apple's `isMultitaskingCameraAccessSupported` conditions govern this installation. In particular, iOS 18's VoIP allowance applies to video conferencing apps. StepSense is not a calling app and does not declare VoIP or simulate a call. An eligible camera entitlement/provisioning configuration may be required for iPhone; this repository does not have an Apple-approved entitlement or signing profile. If the runtime check is false, the feature explains the limitation and leaves scanning in the foreground. Adding the audio background mode enables native PiP playback configuration; it does not grant camera eligibility.

References: [Apple camera multitasking support](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported), [Apple sample-buffer PiP](https://developer.apple.com/videos/play/wwdc2021/10290/).

## Required Mac and physical iPhone checks

1. Open the existing Xcode project, select your development team and physical iPhone, and build. Configure the existing detection backend address in app Settings; it must be reachable from the phone. Frames are sent to this backend, including during an eligible PiP scan.
2. Confirm camera permission, fresh frame counts, and foreground alerts first.
3. Check the multitasking support diagnostic. If false, confirm floating camera refuses clearly and switching apps releases capture. Resolve Apple eligibility before treating background scanning as available.
4. On an eligible installation, enter PiP before switching apps. Verify moving live frames, advancing inference counts, fresh spoken/sound alerts, and no stale results over at least a minute. PiP contains the raw live camera, not the SwiftUI detection overlays.
5. Close PiP in the background, return to StepSense, and confirm scanning is paused. Test camera interruption by another app, network failure, Stop, screen lock, repeated PiP transitions, and selected sound/speech behaviors alongside other audio.
6. Do not claim background protection until these hardware checks pass. No TestFlight/build download link has been produced on this Windows machine.

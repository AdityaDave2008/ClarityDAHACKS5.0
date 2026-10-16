# Sample validation — October 16, 2026

The browser, iPhone, and Android samples share the existing detection backend. These results distinguish a compilation or controlled test from physical-phone validation.

## Browser

The dependency-free preview ran on port 5180 with the actual ready backend on port 3001. An isolated Chrome session exercised the application over HTTP using its actual module code and same-origin API proxy.

Passed:

- Guided simulation: Start, add an object, confirmation before alert, move outside the marked zone, remove, Stop, and preference presets.
- Desktop layout at 1440 px and mobile layout at 390 px: no horizontal overflow. Screenshots were inspected.
- Real backend integration: the browser received a test-image `MediaStream`, encoded frames, created a real session, and uploaded actual JPEG bytes. COCO-SSD recognized the cat and the second successful observation triggered a backend alert. The measured second frame's browser capture/request/result time was 166 ms in this controlled local run; this is not phone performance or model accuracy evidence.
- Background lifecycle: a simulated visibility transition stopped scanning and released every stream track. No physical app-switch test was performed.
- A real backend alert response was delayed by 2.8 seconds in the test harness. The app skipped that stale result and did not deliver its alert.
- Camera permission denial produced a recoverable error with no active camera stream.
- No JavaScript runtime exceptions in those flows.
- JavaScript syntax checks passed. The preview server's separate HTTP checks covered proxy bytes/headers/methods, fixed-asset access, invalid paths/methods, body limits, and unavailable backend behavior.

The test camera used the previously downloaded official TensorFlow example cat image, outside the repository. No photo or prerecorded video is bundled into live mode. The browser walkthrough is deliberately labeled as simulated at all times. The illustrated scene and icons are original generated vector assets.

Physical camera hardware, iPhone Safari/home-screen mode, Android Chrome/installed mode, audible sound routing, speech voices, actual vibration, HTTPS phone hosting, and home-screen installation remain device checks. A browser API reporting vibration support does not establish that hardware vibrated. The offline service worker caches the app shell, not the detector or API responses.

## Backend regression

All 23 existing backend tests passed. They cover image validation, normalized geometry, temporal confirmation, cooldown, preferences/session isolation, sequencing, concurrency, failures, expiry, and CORS. Those unit/API tests use injected detections and do not establish real-world detection accuracy. The browser integration above separately exercised the actual model.

## Native iPhone

The unsigned generic iOS Simulator build succeeded using Xcode's installed iOS 26.2 SDK. Project/plist validation also passed. See [the native guide](../samples/ios/README.md) for the exact compile command.

The app is a foreground scanner and does not configure VoIP, an active video call, or a background-camera entitlement. A support-property diagnostic does not establish that background scanning is permitted. Simulator/device launch, rear-camera orientation, audio/haptics, permission handling, phone-to-backend networking, and physical app switching remain unverified on an iPhone.

## Native Android

The Gradle project includes the official wrapper, typed camera foreground service, native Camera2 capture, real HTTP API integration, and native sound/vibration. XML, wrapper shell syntax/checksum, and focused source review passed.

The Android build stopped before compilation because this host has no Java runtime or Android SDK. No APK has been built here. Background camera access while Instagram is foreground, notification Stop behavior, camera orientation, audio/vibration, and network recovery must be verified on a physical Android device. See [the Android setup and acceptance checks](../samples/android/README.md).

No sample was deployed or pushed to GitHub by this implementation. Existing unrelated preview/server processes were preserved.

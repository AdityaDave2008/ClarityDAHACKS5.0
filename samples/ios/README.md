# StepSense — native iPhone sample

A dependency-free SwiftUI application using the repository's real Node backend. It shows a rear-camera preview, the backend's image zone and object boxes, editable alert settings, and Start/Stop controls. Sound, speech, and haptics are delivered on the phone only when the backend returns `alert.triggered: true`.

**This scanner can keep running in a floating window.** It adopts Apple's video-call Picture in Picture, the same mechanism FaceTime-style and teleprompter apps use: `AVPictureInPictureController` with an `activeVideoCallSourceView` content source, an `AVPictureInPictureVideoCallViewController`, and the `voip` background mode.

Three separate conditions must all hold for live scanning to continue over another app:

1. The `voip` background mode in `Info.plist`, which this sample declares.
2. An active video-call Picture in Picture window.
3. `AVCaptureSession.isMultitaskingCameraAccessEnabled`, which the app turns on when the hardware reports support.

Where the third condition is unavailable, the floating window still presents, but it shows a clearly marked paused state rather than implying a live camera feed, and the app releases the camera as before. Settings reports all three values after the camera starts. The App Store reviews the `voip` background mode against an app's actual calling functionality; this hackathon sample is not an App Store submission.

## Camera permission before networking

Tapping **Start scanning** checks camera permission before contacting the backend. On the first request, iOS displays its camera permission dialog even when the backend cannot be reached. An existing authorization is reused. Denied or restricted permission produces an error without starting the network scan. After denial, enable access in Settings rather than expecting iOS to show the dialog repeatedly.

This requests permission only. Live capture still waits for a ready backend session, so granting permission alone does not fix a connection failure or provide offline detection. Stop or backgrounding while the dialog is open must not continue startup when the dialog returns.

Run the structural regression guards with `node --test samples/ios/tests/camera-permission.test.mjs` from the repository root. They check source ordering and cancellation guards, not the operating system's permission behavior. Physical acceptance: with an unreachable backend and permission not yet determined, tap Start and verify the camera dialog appears first. Also test Allow, Don't Allow, subsequent starts, and Stop/background transitions. Do not reset an existing device's permissions just to run this test without its owner's consent.

## Run one sample at a time

The shared backend processes one frame globally at a time. Stop the browser or Android scanner before starting the iPhone sample, or competing requests can receive `429` responses.

### 1. Start the backend

Use Node.js 24 or newer. From the repository root:

```sh
cd backend
npm ci
HOST=0.0.0.0 npm start
```

For a physical phone, the backend must listen on a reachable interface such as `0.0.0.0`, rather than its default loopback interface. Keep the phone and laptop on the same network. Allow the Node development server through your laptop's firewall if prompted. The first startup needs internet access to fetch model weights.

Check the backend on the laptop:

```sh
curl http://127.0.0.1:3001/ready
```

Wait for `{"ready":true,"modelState":"ready"}`. A successful `/health` response alone does not mean the detector is ready. See [backend setup](../../backend/README.md) and [the API contract](../../docs/api.md).

If an existing backend already listens only on `127.0.0.1:3001`, keep it running and expose the repository's fixed API proxy on a separate local-network port. From the repository root, in another terminal:

```sh
HOST=0.0.0.0 PORT=3002 npm --prefix frontend start
```

In the native app, use `http://<laptop-LAN-address>:3002` as the backend origin. This forwards API requests to the existing backend without starting another detector. On the iPhone, opening that address followed by `/ready` in Safari is a quick network check; it should show `"ready": true`. The HTTP address is for this native development sample. Browser camera access on a phone still requires trusted HTTPS. If the Wi-Fi isolates connected devices, the local-network address will not be reachable from the phone; use a network that permits device-to-device traffic or an HTTPS-hosted backend.

### 2. Build and install with Xcode

Requirements: a Mac with Xcode and the iOS SDK, plus an iPhone running iOS 16 or newer for live camera and haptic testing. The project uses only Apple frameworks; there are no Swift package dependencies or package-generation steps.

1. Open `samples/ios/StepSense.xcodeproj` in Xcode.
2. Select the **StepSense** target and open **Signing & Capabilities**.
3. Choose your development team. A personal team can be used for local device development where supported.
4. Change `com.dahacks.stepsense.sample` to a unique bundle identifier for your team if Xcode requests it.
5. Connect and select your iPhone. Complete Xcode's device pairing, trust, and Developer Mode prompts if required.
6. Run the **StepSense** scheme. Approve camera and local-network access when asked.

The app is portrait-only to keep preview, frame orientation, and normalized overlays consistent. It declares the `voip` background mode for video-call Picture in Picture. No fake video call is placed and no calling service is contacted.

#### iPhone 18 running iOS 27

The app uses APIs available from iOS 16; do not raise the minimum deployment target just to match the phone's installed OS. The existing successful build used Xcode 26.3 with the iOS 26.2 SDK and has not been run on iOS 27. Pair the actual phone in Xcode and check its run-destination status before concluding that an SDK or OS upgrade is necessary.

Apple distinguishes SDK versions from physical-device support. Xcode 27 includes the iOS 27 SDK and, according to the current [system requirements](https://developer.apple.com/xcode/system-requirements), requires macOS Tahoe 26.6 or later. This workspace's Mac currently runs macOS 15.8.1 with Xcode 26.3, so switching to Xcode 27 would also require a supported macOS version. No operating-system or Xcode upgrade is performed by the sample. Follow Apple's [physical-device signing and run instructions](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices) for pairing, development-team selection, and required device support.

### 3. Connect the phone

Open **Scan settings** using the sliders button. Enter the backend **origin**, with no API path:

- Simulator, on the same Mac: `http://127.0.0.1:3001`.
- Physical iPhone: your laptop's LAN address, such as `http://192.168.1.20:3001`.
- Deployed backend: its reachable HTTPS origin.

`127.0.0.1` on a physical iPhone means the phone itself. Tap **Check connection**, then choose notification channels and **Apply**. Backend URL and preferences are saved on the device; session IDs are kept only in memory. Native `URLSession` requests do not use browser CORS permission, so browser origin configuration is not a substitute for making the server reachable.

The sample's `Info.plist` includes camera/local-network purpose strings and **development HTTP transport exceptions** for connecting to a laptop. Those exceptions are not a production hosting configuration. Use HTTPS and remove unnecessary arbitrary-load exceptions before shipping.

### 4. Try the real flow

1. Tap **Test selected alert modes** using the speaker button and confirm your chosen channels on the actual phone.
2. Tap **Start scanning**. Point the rear camera forward and slightly down toward a controlled scene.
3. Place a supported object, such as a backpack, suitcase, or chair, so its bottom-center falls in the outlined image zone.
4. Two nearby matching detections can produce an alert. A confirmed object can trigger again after the selected cooldown; it does not alert on every frame.
5. Tap **Stop scanning**. The camera stops and late results cannot play another alert.
6. Leave **Use floating window** on, then swipe home while scanning. The scanner should shrink into a floating window showing live camera, the zone, and detection boxes.
7. Open another app, such as Instagram or Maps, and confirm the window stays on top and alerts continue.
8. Tap the window to return to the app, then **Stop scanning**. The camera stops and late results cannot play another alert.

If the window shows "Paused · open StepSense", this device did not grant camera access outside the app. Check **Background camera access** in Settings.

Yellow boxes identify supported objects whose bottom-center is in the zone; teal boxes identify other retained detections. An empty result does not establish a clear path. Potholes, curbs, stairs, cones, and generic construction barriers are outside the selected model's categories. The zone is an image heuristic, not depth or collision prediction.

## Implementation

| File | Responsibility |
| --- | --- |
| `StepSense/APIClient.swift` | Actual session, preferences, metadata/readiness, raw JPEG upload, and error contracts |
| `StepSense/CameraCapture.swift` | Rear camera, portrait buffers/preview, fresh JPEG encoding, and camera diagnostics |
| `StepSense/ScanModel.swift` | Serialized frame loop, increasing sequence, session lifetime, preferences, and stale-result protection |
| `StepSense/AlertPlayer.swift` | Generated beep, speech synthesis, and native warning haptic |
| `StepSense/ScannerView.swift` | Teal-on-black UI, normalized aspect-fit overlay, Picture in Picture controls, and settings |
| `StepSense/PictureInPicture.swift` | Video-call Picture in Picture controller, floating-window rendering, and overlay drawing |

The camera output is sampled only after the previous request completes. Fresh images are resized to a longest edge of at most 640 pixels and JPEG-encoded at quality 0.65. Uploads are serialized and capped at approximately three per second; actual rate depends on network and inference latency. Busy responses wait one second before sampling a new frame. A preference change sends the exact top-level PATCH fields without resetting sequence numbers.

The backend confirms matching detections within 2.5 seconds, measured at backend processing completion. If the complete loop is slower, confirmation may never occur. The client separately rejects results older than 2.5 seconds from frame receipt, using a monotonic clock and including JPEG encoding and the request. Those results display no boxes and produce no alert. Displayed detections also expire after that age if the next request stalls. The screen shows the most recent capture-to-response duration and server processing time; these are measurements for that frame, not a performance guarantee.

Sound and speech use a temporary audio session with ducking. Audio-player and speech delegates track each current alert independently; other audio recovers after both outputs complete. Queued speech counts as pending so a short beep cannot deactivate the session before speech starts. Stop invalidates those completions, stops both outputs, and deactivates immediately.

### Picture in Picture

Every camera frame is sent to the floating window through `AVSampleBufferDisplayLayer`, while uploads stay serialized at roughly three frames per second. The window draws the image zone, detection boxes, and a status banner with Core Animation layers, so what you see floating is the same analysis shown in the app.

`canStartPictureInPictureAutomaticallyFromInline` is enabled, so swiping home during a scan opens the window without an extra tap. The in-app card also offers an explicit button and reports why the window is unavailable instead of failing silently. Picture in Picture start failures are surfaced in that card.

The audio session is configured for playback at launch and stays active while the app runs, because deactivating it would cut background audio alerts while the floating window is scanning. Ducking still yields to other audio.

Settings show `AVCaptureSession.isMultitaskingCameraAccessSupported`, whether background camera access was actually enabled, and the Picture in Picture state after camera startup. Apple's [support conditions](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported) and [video-call PiP documentation](https://developer.apple.com/documentation/avkit/adopting-picture-in-picture-for-video-calls) describe the supported cases.

## Build verification

From the repository root, an unsigned simulator compile can be run without selecting a signing team:

```sh
xcodebuild \
  -project samples/ios/StepSense.xcodeproj \
  -scheme StepSense \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/stepsense-ios-build \
  CODE_SIGNING_ALLOWED=NO build
```

Simulator compilation does not validate camera hardware, lens orientation, sound routing, speech voices, haptics, device permissions, app switching, or the phone-to-backend network. A physical iPhone is required for those checks. There are no prerecorded camera frames or fake detector responses in this application.

The iOS Simulator does not provide a rear camera, so Picture in Picture behavior, background camera access, and the floating window must be checked on a physical iPhone.

Verified on October 16, 2026: the command above completed successfully, including the Picture in Picture sources. `Info.plist` and `project.pbxproj` also passed `plutil -lint`. Simulator services were unavailable in the execution sandbox, so the application was compiled but not launched here; no physical iPhone test was performed.

### Preview independent of detection

Start now requests camera access and starts local capture before constructing the backend client. The preview remains visible during connection and after connection failure. Preview-only mode explicitly provides no detection or obstacle alerts. Stop releases the camera. Stop then Start retries detection. Backgrounding preview-only mode pauses capture. No on-device detector is implemented.

Verification: six structural regression checks passed and the signed device build installed and launched on the connected iPhone. Physical preview, denied permission, background/resume, and restored-backend behavior still require device acceptance. These structural checks do not prove camera hardware behavior.

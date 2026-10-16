# Try the three StepSense samples

Try one scanner at a time: all three use the same real backend, which processes one frame at a time. Camera frames are uploaded for analysis and are not saved by the backend. The existing pretrained model recognizes selected objects such as backpacks, chairs, suitcases, and people; it does not identify every floor hazard or measure distance.

## 1. Browser — quickest to see

From the repository root, with Node.js 24+:

```sh
npm --prefix backend ci
npm run demo
```

Open **http://localhost:5180**.

1. Leave **Walkthrough** selected and click **Start walkthrough**.
2. Click **Add backpack**. Two simulated observations produce a visual alert and your selected sound/voice/vibration.
3. Click **Move to edge** to see an object outside the marked image zone, then **Remove**.
4. Click **Stop scanning**, select **Live camera**, and start. Grant camera access and point it at a supported object. This mode submits actual camera images to the backend.
5. Stop scanning before trying a native sample.

The walkthrough is clearly labeled as simulated. Live camera and detections use the actual backend; no mocked responses are substituted. Adding this sample to the home screen does not enable background scanning. Phone browsers need trusted HTTPS; desktop `localhost` works for development. See [browser instructions](../frontend/README.md).

The combined launcher reuses an existing StepSense backend on port 3001; otherwise it starts one. Ctrl+C stops only servers launched by that command. It leaves existing servers alone. Model weights need an internet connection during startup.

## 2. Native iPhone — camera and native alerts

Open [the Xcode project](ios/StepSense.xcodeproj) on your Mac. Select your signing team and physical iPhone, then Run. In the app's settings, enter the reachable backend origin, choose alert types, and check the connection.

For a physical phone, start the backend with `HOST=0.0.0.0 npm start` from `backend/` and use your laptop's LAN address, such as `http://192.168.1.20:3001`. Keep both devices on the same network. A phone's `localhost` refers to the phone. If another backend already occupies port 3001, stop it from its original terminal before starting the LAN-bound instance.

This sample scans while open. Switching apps pauses it and releases the camera. It displays Apple's runtime multitasking-support diagnostic without pretending to have background camera permission. See [the iPhone guide](ios/README.md) for device signing, permissions, and the actual build verification.

## 3. Native Android — switch apps while scanning

Open `samples/android/` as a project in Android Studio, sync its Gradle project, and Run on a physical Android phone. Configure the same reachable backend origin. Start from the visible app after granting camera permission, then open Instagram. The camera foreground service is designed to keep submitting fresh images, and its persistent notification offers **Stop**.

For the simplest USB setup, run `adb reverse tcp:3001 tcp:3001` and use `http://127.0.0.1:3001` in the app. This reuses a loopback backend without changing its network bind.

This project includes a Gradle wrapper and uses Android platform APIs without third-party app libraries. The current workspace has no JDK/Android SDK, so it has not been compiled or run here. Verify camera access, notification visibility, continued frame counts, and audible/physical alerts on the actual device before treating background behavior as demonstrated. See [the Android guide](android/README.md).

## What the examples establish

| Sample | Actual implementation | Verification |
| --- | --- | --- |
| Browser walkthrough | Illustrated scene, simulated observations, real browser notification delivery | Chrome interaction and mobile layout checks |
| Browser live camera | Browser capture → existing API → actual COCO-SSD result → selected alerts | Real backend exercised with a test-image camera stream; physical camera/device alerts still need testing |
| Native iPhone | AVFoundation capture → same API → native alerts; foreground only | Unsigned simulator compilation; physical phone testing remains |
| Native Android | Camera2 foreground service → same API → sound/vibration | Source/project checks; Android build and hardware testing remain |

Run the backend tests with `npm test` and JavaScript syntax checks with `npm run check` at the repository root. Native build commands live in the individual guides.

See [the sample validation record](../docs/SAMPLE_VALIDATION.md) for the checks actually performed and their limits.

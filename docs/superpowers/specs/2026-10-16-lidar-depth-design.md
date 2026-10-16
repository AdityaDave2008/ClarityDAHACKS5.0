# Optional synchronized LiDAR depth

Approved scope: add offline depth estimates beside detections, with a persisted Settings toggle defaulting OFF. Changing the toggle requires Stop. No image recording, networking, ARSession, new model, distance-driven alerts, or safety inference.

## Capture and alignment
Use one AVFoundation session. OFF retains the wide camera path. ON selects builtInLiDARDepthCamera and compatible RGB/depth formats at zoom 1 and 30 fps. Unsupported hardware/configuration falls back to ordinary detection with an explicit unavailable status. Both output connections must support portrait orientation, no mirroring, and disabled stabilization. A video-primary AVCaptureDataOutputSynchronizer preserves preview/PiP when depth is missing or dropped.

Installed iPhoneOS27.1 SDK AVCaptureDevice.h documents that LiDAR depth is perspective-corrected to the paired YUV image with matching FOV/aspect. AVDepthData.h documents that depth is warped to the image's lens distortion. Therefore normalized top-left detection coordinates map to the same normalized depth coordinates without independently rectifying either map. JPEG is a full-frame uniform resize, not a crop. Require matching actual aspect ratios, finite calibration intrinsics, absolute accuracy, high quality, and unfiltered depth. No Euclidean 3D reconstruction is attempted.

The displayed value is **axial depth**, labeled `depth ~N.N m`, not radial camera-to-object range or nearest surface distance. The representative value is a robust median of the central half of the detected box. Reject invalid boxes, insufficient valid coverage, values outside 0.2–5 m, outliers, and mixed near/far surfaces. This heuristic cannot establish object ownership of every pixel or prove safety.

## Frame identity and lifetime
Copy depth values only for a requested inference frame and attach to that exact CapturedFrame. Never reuse a latest-depth cache. Reject dropped depth and timestamp differences over 1 ms. Convert capture PTS from session synchronizationClock to host clock to include capture queue delay. Reject unknown timestamps and data older than 0.75 seconds, including inference delay. Independently remove distance labels at 0.75 seconds while retaining the existing 2.5-second box expiry. Stop, interruption, preference revision, and run generation invalidate results.

## Settings and UI
A backward-compatible optional persisted preference represents LiDAR OFF for missing keys. Disable the toggle during connecting/scanning/previewing and while applying changes. Model also rejects active capture-mode changes. Other alert preferences remain editable. Display requested/off/active/fallback status. Same detection value can be shown in PiP without changing its lifecycle. Existing detector, zone, confirmation, cooldown, alert modalities, and PiP support gating remain unchanged.

## Verification and risk
Pure Swift tests exercise production estimation and preference migration. Structural tests enforce capture/UI wiring; real signed iOS compilation verifies APIs. Existing offline model/policy tests and real WKWebView inference verify no detector regression. Physical depth accuracy, reflective/transparent surfaces, occlusion, off-axis registration, fallback, and PiP with LiDAR require device acceptance, not synthetic tests. Build/install alone is not acceptance. No camera images are persisted for testing.

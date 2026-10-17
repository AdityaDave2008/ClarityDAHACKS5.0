> Historical implementation notes. For the current native model, startup ordering, hardware-depth defaults and judging setup, use [the iOS guide](../samples/ios/README.md). Issue #37 changes startup to load the model before camera access; initial load failure no longer starts a preview.

> Historical reference selectively preserved from `origin/feature/iphone-pip-test` (`8203fdb`). Descriptions and verification claims below refer to that branch at the time of writing, not acceptance results for the current app. Proposed features are not necessarily implemented.

# Native iPhone floating camera

The supplied ZIP's native implementation now replaces the smaller sample-buffer PiP prototype. Open `samples/ios/MyEyes.xcodeproj`, select your own signing team and physical iPhone, and run the Clarity scheme. See [native instructions](../samples/ios/README.md) and [the integration record](ZIP_UPDATE_REVIEW.md).

Start scanning, then use **Open floating window now**. The archive implementation also arms automatic PiP when a scan starts, subject to iOS support. Its window draws live camera frames, detection overlays and status. Dismissing PiP disarms automatic entry until a new scan or explicit Open request. Stop scanning releases the camera and closes PiP.

Detection now uses the bundled offline COCO-SSD/WASM model: no backend address, server, or model download is needed. The camera can remain in a clearly labeled preview-only state if model initialization fails. Stale boxes expire independently of frame rendering. Optional LiDAR defaults off; ordinary RGB inference works without LiDAR.

## Platform limitations

The imported prototype uses Apple's video-call PiP content source and declares the archive's `voip` background mode. This is a hackathon prototype configuration, not evidence of video-conferencing eligibility or App Store approval. Playback PiP alone does not grant camera access: runtime `isMultitaskingCameraAccessSupported` and `isMultitaskingCameraAccessEnabled` still govern capture. Unsupported capture shows a paused state rather than claiming a live scan.

WebKit may suspend offline inference even while the native camera is visible in PiP. Live video does not establish live object alerts. Background detection is not guaranteed or independently verified by this integration. The Safari/PWA preview does not gain native camera multitasking from these files.

References: [Apple camera multitasking support](https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported), [Apple video-call PiP](https://developer.apple.com/documentation/avkit/adopting-picture-in-picture-for-video-calls).

## Verification still required

All 48 runnable native tests pass on Windows; two Swift execution checks require macOS. Imported README device/build reports belong to the archive author. GitHub's macOS workflow builds the simulator app and runs the native tests. A simulator build cannot verify real camera, PiP or LiDAR behavior.

On a signed physical iPhone, verify foreground detection first, then moving PiP pixels, fresh inference counts and timely alerts after switching apps. Test dismissal, Stop, locking, interruptions from another camera app, recovery, airplane-mode startup and both LiDAR settings. Confirm paused/stale states when capture or inference cannot continue. Do not interpret enqueued frame counts as proof that the floating window is rendering or analyzing fresh frames.

> Historical reference selectively preserved from `origin/feature/iphone-pip-test` (`8203fdb`). Descriptions and verification claims below refer to that branch at the time of writing, not acceptance results for the current app. Proposed features are not necessarily implemented.

# Hackathon decision brief — October 16, 2026

Submission target supplied by the team: October 17 at 2 PM Pacific. October uses PDT (UTC−7). Keep a submission buffer and finish the demo recording before 1 PM.

## Best ideas

| Idea | Small, demonstrable MVP | Main constraint | Recommendation |
| --- | --- | --- | --- |
| Clarity: camera obstacle alerts | Open camera, detect a backpack/chair in a marked zone, confirm across frames, speak an alert | Cannot promise background iPhone capture or detection of all trip hazards | Fastest choice here: backend, browser and native samples already exist |
| PackFit: will it fit, and where? | Confirm bag interior dimensions and 3–5 rectangular item sizes; show a placement order and rotatable arrangement | A bag photo does not reveal usable interior capacity; flexible objects complicate packing | Strongest fresh tabletop demo |
| TrailLens: trail obstacle journal | Foreground photo, user-confirmed obstacle tag, timestamp and location, simple review list | Do not claim validated navigation or automatic safe routing | Good nature theme; less distinctive demo |
| ReBox: reuse a shipping box | Enter box/item dimensions; rank reusable boxes by fit and unused volume | Geometric fit does not establish protective packaging suitability | Simplest packing variant; sustainability pitch |

Decision confirmed by the team: **Clarity**. The alternative ideas below are research context only; no packing-app pivot is planned.

The submission MVP is one foreground camera flow: start scanning, detect supported objects in the marked image zone, confirm across frames, deliver spoken/visual alerts, and stop cleanly. It uses ordinary RGB cameras without requiring LiDAR. Prioritize the existing browser implementation and physical iPhone/Android checks; native Android app-switch scanning is optional. Do not add new models or rewrite the stack solely to include Tesla code.

## Tesla: actual reuse versus inspiration

- [Tesla React Native Camera Kit](https://github.com/teslamotors/react-native-camera-kit), MIT: camera preview/capture and QR/barcode scanning for React Native. It is not a general object detector or depth model. Its documented public API does not supply a general ML frame processor. Preserve its license if shipped. It would fit a new React Native capture workflow, but does not justify rewriting this existing browser/Swift/Android project.
- [Tesla Fleet Telemetry](https://github.com/teslamotors/fleet-telemetry) and [Vehicle Command](https://github.com/teslamotors/vehicle-command), Apache-2.0: vehicle integrations, unrelated to the proposed phone perception workflows.
- [Tesla published sources](https://www.tesla.com/legal/additional-resources#open-source) include vehicle system foundations, not an available phone perception stack.
- [Tesla AI](https://www.tesla.com/AI) describes camera-based perception. No downloadable official FSD/Autopilot perception implementation, trained weights or general phone vision API was identified in the official sources reviewed. Use temporal confirmation and camera-first design as architectural inspiration; do not describe the prototype as powered by Tesla FSD.

Research candidates are not installed dependencies. Record actual shipped packages, versions, model weights and notices in ATTRIBUTION.md. No Tesla code has been added by this research.

## Ordinary phones: preserve the outcome, adapt capture

LiDAR is not required for RGB object detection. The current Clarity backend detects RGB images already. Bounding boxes establish image positions, not metric distance or a safe path. A monocular model can provide relative depth, but metric scale needs calibration or a model validated for that purpose; do not convert an uncalibrated depth map directly into reliable meters.

| Capability | Practical approach | Limits |
| --- | --- | --- |
| Camera phone without AR support | RGB detection; for packing, manually confirmed dimensions or known-size printed marker in guided top/side photos | A marker calibrates its own plane; a separate height measurement is needed. Perspective, lens distortion and soft bags introduce errors |
| Non-LiDAR ARKit iPhone | World tracking, plane detection and user-tapped raycast endpoints | No general LiDAR sceneDepth; plane estimates can change; retain editable measurements |
| ARCore Android with Depth API support | RGB depth-from-motion, optionally fused with hardware depth | Check runtime support; movement and texture matter; not every Android or ARCore phone supports Depth |
| LiDAR iPhone | Optional scene depth and improved capture convenience | Still confirm dimensions; LiDAR does not reveal hidden bag interiors |

Sources: [ARKit world tracking](https://developer.apple.com/documentation/arkit/understanding-world-tracking), [ARKit sceneDepth](https://developer.apple.com/documentation/arkit/arconfiguration/framesemantics-swift.struct/scenedepth), [ARKit raycast](https://developer.apple.com/documentation/arkit/arsession/raycast(_:)), [ARCore depth](https://developers.google.com/ar/develop/depth), [ARCore device list](https://developers.google.com/ar/devices), [OpenCV ArUco](https://docs.opencv.org/4.13.0/d5/dae/tutorial_aruco_detection.html).

For PackFit, all paths feed the same confirmed interior dimensions and item cuboids into one solver. MIT [3dbinpacking](https://github.com/enzoruiz/3dbinpacking) is a candidate if Python fits the stack; evaluate before adding another backend. A heuristic finding no arrangement is not proof none exists. Use clearance and describe results as estimated geometric fit.

## Background camera constraint

- iPhone: ordinary background camera capture is unavailable; switching to another app interrupts capture. Multitasking exceptions require supported configurations and are not a basis for promising scanning behind any app. See [Apple interruption reason](https://developer.apple.com/documentation/AVFoundation/AVCaptureSession/InterruptionReason/videoDeviceNotAvailableInBackground).
- Android: a camera foreground service started while the app is visible can support continuing capture with a persistent notification, subject to permissions, OS rules and device testing. Background-start restrictions apply. See [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).
- Browser/PWA: use foreground capture; installation does not grant native background camera privileges.

The shared Clarity promise should be an active foreground camera session. Android app-switch capture is an optional separately verified capability. Phone orientation must expose the path; software cannot detect hazards outside the camera view. Use a stationary controlled demonstration, with clearly labeled simulation if used.

## Team scope and finish plan

1. Frontend: one start/stop scan flow, camera preview, direction/alert display, connection failure state. For PackFit instead: bag dimensions, item list and arrangement view.
2. Backend/data: retain the existing frame API and confirmation policy; measure actual end-to-end latency. For PackFit instead: validated dimensions and deterministic packing endpoint.
3. UI/UX: improve that single journey, readable alert states and permission guidance. Avoid extra onboarding/screens.
4. Pitch/demo lead: 60–90 second demo, problem and target user, honest technical scope, attribution, README, accessible repo/demo/video and Devpost submission. Assign this role explicitly even if shared.

Today: choose one idea, share repo, assign owners, and prove one live phone-to-result flow. Tomorrow morning: physical-device checks, integration fixes and recording. Target feature freeze by noon, recording by 1 PM, submission by 1:30 PM Pacific.

Existing code must be described accurately under the event's development-period rules. Keep a provenance record of what existed at kickoff and what was built during the event; clarify eligibility with organizers when necessary.

## Repo readiness

The project root is the nested DAHacks26-AD-BW-YT-NQ-DK-main directory containing package.json, backend/, frontend/, samples/ and ATTRIBUTION.md. This inspected copy has no .git directory; Git and gh were not available on PATH. No remote, commit or publication has been established by this research.

After choosing the idea, create the GitHub repo from this project root, exclude credentials/.env/model caches/node_modules using the existing .gitignore, commit the baseline and share its URL. Choose public visibility for judge access when the team is ready, and invite collaborators through GitHub. Keep pre-existing work and hackathon changes traceable.

# Native / web visual alignment acceptance

Verified October 17, 2026. Native UI revision `a8786fd`, web branding `24ff69d`, exact artwork asset `1bad28a`. The later pure floor-calibration core is not registered in the app target and is not a delivered floor detector.

| Requested output | Concrete check | Observed result / limit |
|---|---|---|
| Use supplied coral eye | SHA-256 identity test for packaged source PNG | `be2319576af5fed17dca061dc162469e3bb09e6cf5e311c39cbdfc07ab541dea`, exact existing teammate artwork matching supplied image |
| Native home-screen icon | Actual simulator installation, home-screen screenshot, compiled Assets.car + generated icon metadata test | Coral eye displayed; opaque 1024px icon generated from same artwork |
| Native screen resembles web | Actual iOS Simulator app build/launch and 402×874-point screenshot | Dark background, coral actions, centered eye/Clarity brand, rounded camera card and persistent Home/Settings controls |
| Primary controls remain reachable | First screenshot revealed oversized preview; responsive sizing fix and executable sizing tests; second actual screenshot | Start/test buttons now entirely above bottom navigation at default tested viewport |
| Preserve native capability | Existing native suite with built app inspection | 88 tests passed, zero failures/skips; signed generic device build and simulator build passed. Tests do not establish physical LiDAR accuracy |
| Truthful PiP placeholder | Executable supported/unsupported wording tests + actual unsupported simulator screenshot | Placeholder no longer promises floating-window support on unsupported device |
| Website uses same logo | Actual hosted Chrome155 image load, decoded width1254, exact downloaded SHA-256 and page-error check | Passed on existing HTTPS preview, zero page errors. No camera or model inference was requested by this branding check |
| Offline branding | Real-server precache tests and service-worker/logo tests | All precached asset URLs return HTTP200; v14-clarity-eye includes logo; 246 frontend tests and syntax checks passed |
| Updated phone installation | `devicectl device install app` on user's iPhone15Pro | Installation succeeded. Automatic launch blocked because phone was locked, not a claimed successful physical test |

Existing preview deployment: `3d56ca6f-7639-4288-ad46-e2f595bb4eac` at https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/ . Native bundle remains `com.dahacks.clarity.v2testing` (Clarity V2 Test).

Evidence retained locally under `~/.jcode/scratch/native-web-ui-20261017/`: simulator build logs, signed device build, native suite, `home.png` (installed icon), `app-ready.png` (initial sizing defect), and `app-final.png` (corrected layout). Source-level navigation contracts are not a substitute for tapping Settings/using VoiceOver on the phone. Large Dynamic Type has executable sizing coverage, not a complete visual accessibility audit.

This visual update changes no model weights, confidence threshold, supported-class filtering, physical depth policy or inference runtime. Detection-quality investigation and shared-LiDAR floor mode remain separate work. Do not present this branding release as an accuracy improvement.

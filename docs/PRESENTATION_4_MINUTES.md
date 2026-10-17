# Clarity: four-minute presentation + two-minute Q&A

Use **Clarity** consistently unless the team confirms a different registered project title. StepSense/MyEyes are historical project names; `Clarity V2 Test` is the native experimental bundle label. This is a rehearsal script, not evidence of an installed/validated judging-phone build or a submitted entry.

The Obsidian rubric assigns **25% each** to Functionality, Creativity & Originality, Theme Fit, and Presentation. The theme is **Modern Life and/or Nature Life**. Lead with Modern Life rather than inventing an outdoor/Nature demonstration. Do not present the old personalized passage-width/clearance proposal as implemented.

## Four-minute run of show

| Time | Screen/action | What to say |
| --- | --- | --- |
| 0:00–0:25 | Title + one problem sentence | “The same shared space can be easy for one person and difficult for another. Clarity explores how a phone can turn selected objects in its camera view into feedback you can hear, feel, or see, without needing to keep watching detection boxes. Our theme is Modern Life: using familiar hardware to make everyday awareness more customizable.” |
| 0:25–1:35 | **Main demo**, stationary phone and a previously tested object | “First, the model loads before the camera starts. I can cancel, and a loading failure cannot silently turn the camera on. Now the camera is active. On a supported LiDAR iPhone, we attach fresh depth to a detected object. Moving this object closer changes its band and the selected feedback cadence: farther green, intermediate amber, near red. Beyond our configured range is blue. Unknown distance is gray, not ‘safe.’ I can choose sound, haptics, or speech. Here is Stop: capture and feedback stop.” Pause to let the judge observe the change. Only perform the distance portion if this exact installed build has passed the phone checks below. |
| 1:35–2:25 | One architecture diagram | “The iPhone app is SwiftUI with AVFoundation capture. A bundled YOLOX-Nano candidate runs offline through ONNX Runtime Web inside WebKit. The camera and model are separate lanes. LiDAR depth must match the image and still be fresh. A native policy confirms the object, chooses the closest eligible target, and drives one bounded feedback loop. The same fresh information reaches the main view and native picture-in-picture. The default native path does not upload camera frames to a server.” |
| 2:25–3:20 | Three engineering choices, no code wall | “Our biggest work was not just drawing a box. First, preview is not detection: loading, permission, fresh results, and failure are separate states. Second, stale data must stop influencing feedback. We reject mismatched or expired depth and cancel work on interruptions. Third, confidence is not distance or accuracy. We use measured depth for proximity, preserve confirmation, and keep false-positive and unsupported-class limitations explicit. We also separated the depth policy, alert routing, and scheduler so we could test those behaviors independently.” |
| 3:20–4:00 | Evidence + honest next step + source/demo QR | “Our current software passed 80 native regression tests, a real unsigned iOS build and public CI, plus browser and runtime checks. That is software evidence, not proof of safe navigation or physical distance accuracy. This is an awareness prototype, not a replacement for a cane, guide dog, or attention. Our next steps are reference-distance testing on the judging phone, representative user feedback, and broader hazard coverage. The source and browser demo are available here.” Replace the phone-testing sentence with an actual measured result only after recording it. |

### Optional floor-mode line, only after it is implemented and verified

Replace part of the demo, do not add time: “Tilting down switches to floor mode. The same LiDAR stream can identify some raised geometry even when the object has no trained label, shown as an unclassified obstacle.”

**Current status:** floor mode is **design-only draft PR #40**, not a delivered demo feature. Do not say it detects potholes, every floor obstacle, passage width, or safe clearance. A missing LiDAR return is not a hole detection.

## Five-slide layout

1. **Clarity**: one problem sentence, Modern Life connection, no unsupported statistic.
2. **Live interaction**: large phone view, physical scene visible, minimal labels.
3. **On-device architecture**: camera/model/LiDAR → freshness and confirmation → chosen feedback.
4. **What makes the engineering work**: cancellation, matched timestamps, bounded feedback, honest unknown state.
5. **Evidence and next steps**: exact demo revision, limitations, source/demo QR.

The technical stack supports the story. Do not spend a minute listing packages, show training loss plots instead of the interaction, or claim “AI accuracy” from one high-confidence box.

## Two-minute Q&A preparation

Keep initial answers around 15–20 seconds. Answer the actual question, then offer detail.

**Why use LiDAR as well as a model?**
“The model suggests a supported object label and image box. LiDAR measures surface depth. Confidence and box size are not distance, so we require a matched, fresh depth estimate before proximity feedback.”

**Does it work on every phone?**
“No. Native measured depth requires supported LiDAR hardware and usable sensor data. RGB detection can still run without it, but distance stays unknown. Browser and native PiP support also depend on the platform.”

**How accurate is it?**
“We have software and controlled-fixture evidence, not a universal real-world accuracy number. The experimental native training candidate did not beat its pretrained baseline. Physical distance accuracy and representative hazard coverage require separate measurements.” If asked for training metrics, open `training/RESULTS.md`. **93.230% precision with 20.794% recall belongs to a selected baseline evaluation, not ‘93% accuracy,’ and not the current native candidate.**

**What about shadows, potholes and objects outside the model?**
“Shadow false positives are a known issue. The current native policy exposes a limited class set and does not have a pothole class. Our proposed floor geometry can supplement class recognition for raised surfaces, but is not yet implemented or validated and must not infer holes from missing data.” Update only after verified delivery.

**Where does the video go? Does it need Wi-Fi?**
“The normal native model and runtime are bundled, and camera frames stay on-device. The browser downloads its model/runtime assets on first load, then can use its cache. The optional backend is separate and is not required for the native demo.”

**Why WebKit/ONNX rather than Core ML?**
“We integrated a portable packaged ONNX runtime for offline iteration. Swift owns capture, depth, lifecycle and feedback. A native accelerator path could be evaluated later, but we are not claiming Core ML is running today.”

**Can it alert with the phone locked or bypass Do Not Disturb?**
“We do not claim Apple Critical Alerts entitlement or guaranteed background inference. PiP and camera access are capability-limited, and stale results expire. Our verified software behavior is not a promise of uninterrupted locked-phone navigation.”

**What is original?**
“The contribution is the integrated interaction and reliability work: model-first startup, matched hardware depth, explicit unknown states, selectable bounded feedback and lifecycle-aware overlays. We credit the existing models and runtimes, and we are not claiming to be the first accessibility app.”

**Did you test with blind/low-vision users?**
“Not yet, unless the team has actual consented sessions to report. Representative user testing is a next step. Multiple feedback options alone do not prove accessibility effectiveness.”

## Demo preflight and fallback

- Confirm the exact source revision and installed bundle. A successful GitHub build does not update the phone. `samples/ios/MyEyes.xcodeproj`, scheme `Clarity`, is the current project.
- Complete [physical proximity acceptance](PROXIMITY_ACCEPTANCE.md) with a stationary phone and moved object. Align the reference measurement to the camera axis. Do not ask judges to walk toward hazards or test blindfolded.
- Pick one supported object that works reliably in this lighting. Verify native detection, selected modalities, Stop/Start and near/far transitions before the session. Do not silently lower confidence to hide a miss.
- Verify the model loads offline on the phone and the screen remains readable. Test the chosen volume/haptic setting without disturbing other teams. Native haptics cannot be demonstrated by a Mac build.
- Use one speaker and one demo operator, with clear handoffs. Assign actual team contributions accurately; do not infer them from commit authors.
- Keep an owner-approved recording of a **real** working run, clearly labeled “recorded demonstration.” No bystanders, personal screens or private notifications.
- If the live model misses, say so. Switch once to the labeled recording or browser fallback, not repeated troubleshooting. The browser fallback does **not** prove native LiDAR or haptics.
- Browser fallback: https://stepsense-yolox-v2-preview.stepsense-dahacks.workers.dev/ . The historical hostname does not identify its model; it uses browser COCO-SSD, not the native YOLOX candidate.
- Rehearse with a timer twice: one successful run and one failure/fallback run. Stop the pitch at 4:00 and leave the next two minutes for questions.

## Submission ownership

The previously verified deadline is **October 17, 2026, 2:00 PM PDT / 21:00 UTC**. This script is not a submission. The team must confirm registration/title/contributions, upload required materials, submit and save the confirmation. Do not wait for experimental floor mode to submit the verified core.

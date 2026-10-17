# Submission and presentation draft

A reviewable draft for the team, **not a submitted Devpost entry**. Confirm the public product title, registered team members, individual contributions, eligibility, screenshots and video before publishing. The company name supplied by the team is **Clarity**. Existing project names include StepSense and MyEyes, so this document does not rename the app.

**Official deadline verified October 17, 2026:** October 17 at **2:00 PM PDT / 21:00 UTC**. [Official schedule](https://dahacks5.devpost.com/details/dates). Aim to submit by 1:30 PM PDT and retain confirmation.

## Short description

A camera-based awareness prototype that detects selected everyday objects and offers customizable visual, spoken and sound cues. Browser-local inference, an offline native iPhone implementation, and explicit sensing limitations make it possible to demonstrate the experience without presenting it as a certified navigation aid.

## Inspiration

The same shared space can be experienced differently by people with different mobility and sensory needs. We wanted to explore a practical phone interaction: notice an object in the camera view, explain why the app is alerting, and let the user choose how to receive that cue.

Our Modern Life connection is the everyday phone and the changing urban spaces around it. This prototype is a starting point for evaluation with intended users, not evidence that we have already improved accessibility or made walking safer.

## What it does

- Starts the camera only after the user chooses Start and grants permission.
- Runs the default browser object detector locally and displays supported detections with model scores and an image-coordinate alert zone.
- Uses confirmation and cooldown rather than alerting on every frame. Empty results and missing depth must not be interpreted as a clear path.
- Provides adjustable feedback and color-vision options. Actual accessibility effectiveness still requires representative user testing.
- Offers native browser picture-in-picture on supported browser/source combinations. The floating window shows raw camera preview, not detection overlays. Detection pauses when the page is hidden and resumes in the foreground. Some browsers may pause the camera or reject live-camera PiP.
- Includes a separate offline native iPhone app with experimental optional hardware depth and native PiP. The browser is not the native app streamed over the network.

Describe only features that are present in the exact build being demonstrated. A source commit, a deployed URL and the app installed on the team's iPhone can be different versions.

## How we built it

The shared browser experience uses HTML, CSS and JavaScript. Its browser-local COCO-SSD model runs through bundled TensorFlow.js/WASM. The native iPhone app uses SwiftUI, AVFoundation and a packaged experimental YOLOX-Nano ONNX inference bridge. A separate Node.js/Fastify API retains a COCO-SSD comparison flow. An optional Cloudflare Worker API uses different hosted models and is not equivalent to either local detector.

The project integrates existing models and open-source runtimes. It does not claim to invent YOLOX, COCO-SSD or ONNX Runtime. See [attribution](../ATTRIBUTION.md), [model provenance](../samples/ios/MyEyes/OfflineDetector/PROVENANCE.md), [runtime map](../README.md#which-runtime-am-i-using), and [training results](../training/RESULTS.md).

## Engineering challenges and what we learned

1. **Camera preview is not detection.** Permission, preview, model readiness, fresh results and alerts are separate states. We preserve a useful preview without pretending inference is running when it is not.
2. **Background behavior is platform-dependent.** Web PiP can keep a supported video preview visible, but it does not grant reliable background inference or universal camera access. Lifecycle tests cover pausing detection, clearing stale results and releasing camera tracks.
3. **More confidence is not more accuracy.** A real fine-tuning pilot underperformed its pretrained baseline. We retained the evidence and label the native packaged candidate experimental rather than claiming an improvement. A high threshold can hide missed objects.
4. **Scheduling matters.** On the current COCO browser runtime, a shared-model before/after test of 320 static-fixture inferences measured capture-start intervals of 138.0 ms versus 91.5 ms on the test Mac, with identical outputs and unchanged thresholds. This measures scheduling cadence, not faster model computation, improved accuracy, phone latency, battery life or smoother preview. Historical YOLOX results are recorded separately. See [reproduction and limitations](DETECTOR_RESPONSIVENESS.md).
5. **Integration can break working components.** A duplicate service-worker cache declaration in the merged source prevented registration. Regression checks and real-browser cache/offline tests caught and verified the correction.

## What we can demonstrate honestly

Use the [judge guide](JUDGES.md) and [native guide](../samples/ios/JUDGES.md). Keep a stationary phone and move objects in a controlled scene. Never ask a judge to walk toward a hazard while relying on the prototype.

| Claim | Appropriate evidence | Do not substitute |
| --- | --- | --- |
| Current native source compiles | Unsigned Xcode build of the identified revision | A screenshot of an old Xcode window |
| Browser model executes | Packaged-model inference and visible fresh camera result | Camera preview alone |
| Supported browser PiP works | Real native PiP entry and advancing video while hidden | A CSS floating box or unit mock |
| Restart does not overlap model calls | Deferred-inference regression plus lifecycle checks | Successful single startup |
| Current COCO cadence improved on test host | 320 shared-model before/after fixture inferences, unchanged scores and 0.6 threshold | Higher displayed confidence, phone performance or attributing historical YOLOX timings to current COCO |
| Physical LiDAR distance is accurate | Independent reference distances on the exact phone | Build success or nonzero sensor values |
| Accessibility helps intended users | Representative user evaluation | A list of toggles or colors |

## Two-minute pitch / six-slide outline

1. **0:00–0:20 · Problem and theme.** “People experience the same shared spaces differently. We explored how a phone can turn selected objects in its camera view into customizable awareness cues.” Connect this explicitly to Modern Life.
2. **0:20–0:45 · Start and understand the state.** Start the camera, identify the actual detector/build, and explain preview versus inference readiness.
3. **0:45–1:10 · Live interaction.** Show a supported object, confirmation and an alert. Move it out of the marked image zone. If it is missed, disclose that rather than substituting a canned result as live AI.
4. **1:10–1:30 · Distinctive engineering.** Show supported web PiP or the native app, emphasizing local processing, lifecycle behavior and configurable feedback. Credit pretrained components. Do not claim market novelty without research.
5. **1:30–1:45 · Evidence and limitations.** Briefly state that the training candidate did not beat baseline and that device accuracy and accessibility validation remain next steps. Demonstrate stopping the camera.
6. **1:45–2:00 · Next step and invitation.** Invite judges to inspect public source and the live browser implementation. Next steps are representative user testing, calibrated detection evaluation and physical depth/thermal testing, not an unsupported safety claim.

The recorded rubric gives **25% each** to functionality, originality, theme fit and presentation. One reliable, clearly explained interaction addresses the rubric better than unverified additional features. This is not a prediction of placement.

## Submission-owner checklist

- [ ] Confirm final product title without conflating company, app, scheme and bundle names.
- [ ] Confirm official eligibility and registration with organizers, especially conflicting published wording.
- [ ] List actual registered team members and each person's agreed contributions. Do not infer them solely from Git authors or agent-generated commits.
- [ ] Identify pre-existing code, pretrained models, reused libraries/assets, and work completed during the event.
- [ ] Select exact demo commit, deployed URL and native installed version. Verify links while logged out.
- [ ] Capture approved screenshots and a 2–3 minute recording without bystanders, personal data, tokens or private account screens.
- [ ] Rehearse on the actual judging phone, including permission denial, Stop/Start and fallback. Automated synthetic-camera tests are not this rehearsal.
- [ ] Provide the repository, demo URL, screenshots, technologies, credits and required video in Devpost.
- [ ] Submit before the confirmed deadline and save submission URL/confirmation. No submission was made by preparing this file.

Track remaining work in GitHub [#24](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/24), [#25](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/25), and [#26](https://github.com/AdityaDave2008/DAHacks26-AD-BW-YT-NQ-DK/issues/26).

# Website PiP experiment

The website now also offers **Open floating camera** on the main camera screen
and the retained `/camera.html` live view. The experiment below remains available
for collecting device evidence. See [the website instructions](../frontend/README.md#floating-camera-in-safari).

The separate `/pip-test.html` page uses the same bundled COCO-SSD detector as the
main web scanner. It allows detection while the page is hidden **only if** the
browser reports that this camera video is in Picture in Picture. Its controls are
independent of the main app's settings. It requires no backend and uploads no
camera images.

Start the frontend with `npm --prefix frontend start` and open
`http://127.0.0.1:5180/pip-test.html` on the development computer. On a phone,
open `/pip-test.html` on the same trusted HTTPS host used to preview this checkout.
The changes must actually be served by that host; an existing deployed copy will
not have the new page until updated. A phone's localhost is the phone itself, and
an HTTP laptop LAN address does not provide secure camera access.

## Physical phone test

1. Record the phone model, iOS/browser version, and whether this is Safari or an
   installed home-screen web app. Test those two environments separately.
2. Enable spoken alerts before tapping **Start camera test**. Allow the camera.
   Verify that fresh-input and result counters advance and a supported object
   in the lower central camera area produces an alert in the foreground.
3. Tap **Open floating window** while still on the page. Confirm that an actual
   floating camera window appears. API success alone is insufficient.
4. Switch to an ordinary app for 20–30 seconds. Keep the floating window visible.
   Introduce a new chair/backpack/person, then remove it. A second person holding
   the camera stationary makes this a controlled test. Confirm fresh detections
   and whether new speech is actually audible while the other app stays open.
5. Return and download the JSON report. Check `hiddenInputs`, `hiddenResults`,
   `hiddenObstacleAlerts`, and `hiddenSpeechCompleted`. The report includes a
   bounded event log, browser version, and camera/visibility/PiP state, not images.
6. Repeat, then close PiP while another app is open. Capture should stop. Check
   Stop/restart, denied camera access, screen lock, and another app using the
   camera separately; these can have different platform behavior.

## Interpreting results

- Floating preview only: proves PiP presentation, not background detection.
- Advancing hidden input timestamps: evidence that the video clock progresses;
  muted, ended, unready, and repeated video timestamps are rejected. A real scene
  change is still necessary to prove that physical camera pixels are fresh.
- Hidden completed results: proves the actual model loop completed during that
  observed hidden/PiP state. A nonzero foreground count is not a substitute.
- Hidden obstacle count: proves confirmed detector alerts were generated then.
- Speech completion: a browser callback, **not** proof that a person heard it.
  Confirm delivery by listening on the phone. Vibration and OS notifications are
  intentionally not part of this experiment.
- Zero results or a blocked PiP request: record the error and environment. A
  failure on desktop Chrome or a headless test does not establish an iPhone limit.

This is a feasibility probe, not evidence that background detection is reliable
across iPhones, Safari versions, home-screen apps, or long sessions. This Windows
workspace cannot operate a physical iPhone.

## User-observed phone result

During the interactive test the user reported hearing "Object ahead" after
starting from Safari and switching to Notes or the Home Screen. In contrast, when
launching the experiment from a Home Screen icon, the PiP button became enabled
after about 30 seconds, but tapping it did not open PiP. Phone model, iOS version,
and the exported hidden-result counters have not yet been collected. This is a
user-observed result on one phone, not an independently instrumented background
inference acceptance result or a cross-device guarantee.

This Safari versus standalone behavior matches the open
[WebKit issue 303885](https://bugs.webkit.org/show_bug.cgi?id=303885). Its reports
include Home Screen launches where `document.pictureInPictureEnabled` is true,
but entering PiP is rejected or has no effect. That report supports a likely
platform explanation; it does not prove the cause on this specific phone.
The experiment now records launch mode, both API capability signals, and video
readiness, and reports if a PiP request produces no actual mode change within
three seconds. For the hackathon, the observed Safari route can be evaluated
independently from the Home Screen install route.

The user subsequently reported that the integrated website opens a floating
window after a delay, but shows a crossed-out playback symbol. This confirms a
presentation window, not usable camera playback or continuing detection. The
phone's actual playback and track state have not yet been captured. The shared
controller now reports paused video separately from a muted/interrupted camera
track, offers an explicit **Resume camera** action for paused playback, and no
longer closes a delayed successful entry just because the initial three-second
check expired. Paused video is excluded from fresh detection input. The main
PiP button is available once the camera plays, independent of model loading.
These changes require another phone check; they cannot override a browser or OS
camera interruption.

After these playback changes, the user reported that integrated PiP "works
great." This is a successful user observation on that phone; no exported device
report or independently verified hardware notification/vibration result has
been collected. Confirmed object alerts now have a separate output adapter;
see the main README for the Safari notification and vibration restrictions.

## Local automated observation

An isolated headless Chrome 155.0.8059.39 run on Windows loaded the real bundled
detector, processed synthetic camera frames, entered actual browser-reported
PiP, released the camera on Stop, and made no frame uploads or unhandled page
errors. However, its tabs remained `document.hidden === false` after switching
targets, including with DevTools focus emulation disabled and browser background
throttling exemptions removed. Consequently this run **does not verify hidden
page detection**, a visible OS floating window, audible speech, or iPhone behavior.

The runner is `scripts/pip-browser-smoke.mjs`. Set `PLAYWRIGHT_MODULE` to an
installed `playwright` or `playwright-core/index.mjs` module and optionally
`PIP_BROWSER_PATH` to an installed Chrome executable, then run it with Node.js 24+.
It starts and closes its own loopback server and isolated browser, and saves
`browser-report.json` and `page.png` in ignored `.cache/pip-experiment/`.
No paid service or project dependency installation is required. Playwright must
be available to run the automated check; it is not needed to use the test page.

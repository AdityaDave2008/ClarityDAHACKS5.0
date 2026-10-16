# Mobile web and home-screen integration

Implementation guidance for frontend teammates, checked against primary browser and standards documentation on October 16, 2026. A browser sample, manifest, and shell service worker are now implemented in `frontend/`; see [the sample guide](../samples/README.md). The worker caches only app assets for the guided walkthrough; live detection still requires the backend. Platform/device checks below remain necessary.

## MVP behavior

Use a foreground camera page on iPhone and Android. The user taps **Start scanning**, grants camera access, and keeps the app visible with the rear camera facing the walking area. Show a persistent scanning/paused/error state and large Stop control. Adding the website to the home screen changes how it launches; it does not grant native background camera privileges.

| Capability | iPhone web/home-screen app | Android Chrome web/home-screen app |
| --- | --- | --- |
| Foreground rear camera | Use `getUserMedia`, HTTPS, and user permission. | Same browser API and permission model. |
| Beep | Initialize/resume Web Audio from Start or Test alert. Test volume and audio routing on the demo phone. | Same approach; autoplay can suspend a new audio context. |
| Spoken alert | Feature-detect `speechSynthesis`; use a short phrase and avoid queued repeats. | Same approach; available voices vary. |
| Vibration | Do not make vibration the only alert. Safari/WebKit does not provide the standard Vibration API. | Feature-detect `navigator.vibrate`, then test hardware; a successful API call does not establish that the user felt an alert. |
| Another app open, hidden page, locked screen | Pause this MVP; continuous scanning is not promised. | Pause this MVP; continuous scanning is not promised. |
| Offline | Only components and models actually cached locally can work. A remote backend remains unavailable. | Same architectural constraint. |

Camera API requirements come from [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/). For audio, see [Chrome's Web Audio autoplay guidance](https://developer.chrome.com/blog/web-audio-autoplay). WebKit's [Vibration API removal](https://bugs.webkit.org/show_bug.cgi?id=171766) and [open implementation request](https://bugs.webkit.org/show_bug.cgi?id=288846) explain why iPhone vibration is not an MVP baseline. The [Vibration specification](https://www.w3.org/TR/vibration/) requires prior interaction and permits browsers to reject requests, including for device/user preferences.

## Camera and lifecycle

- Start with `getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } } })`. These are requested preferences, not guaranteed settings. Allow camera selection if the browser chooses an unsuitable lens.
- Attach the stream to `<video autoplay muted playsinline>`; set `srcObject` and handle `video.play()` rejection. Wait for usable `videoWidth`/`videoHeight` before drawing frames. [WebKit explains muted video and inline playback](https://webkit.org/blog/6784/new-video-policies-for-ios/).
- Handle denial/unavailable hardware without leaving a spinning loading indicator. Offer retry instructions. Stop all tracks on Stop.
- On `visibilitychange` to hidden, stop capture and inference requests, cancel outstanding fetches, cancel speech/vibration, and mark the session paused. On return, show **Resume scanning** and reacquire the stream from that gesture. Also handle tracks becoming muted or ending; hide stale detection boxes.
- Keep a frame/request sequence and session token so a response from an old session cannot play an alert after Stop or Resume.

Hidden mobile pages may freeze or be discarded, so foreground continuity must be explicit. [Chrome's page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) describes these states. A service worker is event-driven and can be terminated; it cannot serve as an indefinitely running camera scanner. See the [Service Worker specification](https://w3c.github.io/ServiceWorker/).

## Alerts and accessibility preferences

Use **Alert settings** with independent **Sound**, **Spoken alerts**, **Vibration**, and **Visual alerts** controls. Provide **Standard** and **Accessibility-focused** presets if the team wants the two onboarding choices, then let everyone edit every setting. Avoid “regular user,” a required disability/diagnosis field, or assumptions that all disabled users need the same alert. Keep persistent preferences on-device; send the selected settings to the backend for the current temporary session.

- Put **Test alert** beside the controls. Feature-detect each API and explain unavailable channels. Never silently replace vibration with audible speech without the user's choice.
- Resume/create the audio context directly inside the Start/Test tap handler before waiting on network calls. Check `AudioContext.state`; if suspended, show a control to enable audio.
- Use a cooldown and speak only the newest relevant message. Cancel old speech before a new warning; do not announce the same object every frame.
- Speech synthesis can use local or remote voices. Check `getVoices()` and `voiceschanged`; do not promise offline speech without a tested local voice. See the [Web Speech synthesis specification](https://webaudio.github.io/web-speech-api/#tts-section).
- Give buttons accessible names and visible focus. Announce meaningful state changes through an appropriate live region, without flooding screen readers for every frame. See [W3C guidance on status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Use **Object in camera zone** and **No supported object detected in the last frame**, without declaring the route safe. General object detection does not establish depth, ground geometry, or the absence of holes/curbs. Treat this as the prototype's functional scope when choosing demo objects and labels.

## Frontend/backend boundary

The browser owns the camera, frame sampling, Start/Stop lifecycle, permission UI, and physical alerts. A backend cannot trigger a phone vibration or read its camera by returning JSON. The frontend interprets detection results and generates the user-selected alerts locally.

The backend runs COCO-SSD inference in a CPU worker. Use the implemented REST contract and generated API documentation for complete field definitions:

1. Create a session with `POST /api/v1/sessions`. Preferences offer `standard` and `accessibility` presets and editable channels, without diagnosis information. Sessions are in memory; they are not durable user accounts.
2. Sample frames through a canvas and upload a raw JPEG/PNG `Blob` to `POST /api/v1/sessions/:sessionId/frames`, with the corresponding `Content-Type` and required integer `X-Frame-Sequence` header. Keep at most one inference request in flight. Resize the longest image edge to at most 640 pixels for a conservative starting point; backend limits are 1 MiB encoded data, 1 megapixel, and 1280 pixels per side.
3. Detection boxes use normalized `{ x, y, width, height }` coordinates; multiply by the actual image display dimensions and account for CSS `object-fit` cropping/letterboxing. Responses also include processed-frame dimensions. Preserve image orientation and do not accidentally mirror rear-camera overlays.
4. The response recommends an alert; the frontend chooses an available, user-enabled output. Use the returned sound/vibration/speech recommendation with capability checks and local cooldown. Check the API schema for the exact response fields.
5. Apply a timeout with `AbortController`. Discard results from prior sessions and results older than the accepted alert window. If analysis fails or times out, show **Analysis unavailable**; an empty detection result is different from a failed request. On Stop, immediately invalidate pending local results, stop capture, and `DELETE /api/v1/sessions/:sessionId`.
6. Make camera-frame transmission clear in the Start flow. Send frames only during an active scan. Do not put provider credentials in frontend bundles or log image bodies.

Network and CPU inference latency must be measured on the demo deployment. Tune the sampling rate using those measurements. An on-device browser detector is a future architecture option if latency or offline use requires it; home-screen installation does not move server inference onto the phone.

## Deployment and installation

- Serve the frontend, API, model files, and other fetched resources through HTTPS. An HTTPS page must call an HTTPS API; do not mix a public HTTPS frontend with an HTTP laptop backend. `localhost` on the developer laptop is a special development case; `http://192.168.x.x` opened on a phone is not that phone's localhost. Use an HTTPS test deployment or properly trusted HTTPS development endpoint. See [Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy).
- Prefer a same-origin `/api` reverse proxy. With separate frontend/API origins, configure the API's CORS allowlist for the exact frontend origins and support required `OPTIONS` preflights, including `Content-Type` and `X-Frame-Sequence`. CORS grants browser read access, not authentication. See the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).
- Supply a linked web app manifest with `name`/`short_name`, stable `id`, `start_url`, `scope`, `display: "standalone"`, and 192px/512px icons. Add an Apple touch icon. Chrome install promotion has additional engagement criteria; absence of a prompt does not prove camera failure. See [Chrome install criteria](https://web.dev/articles/install-criteria).
- iPhone install instructions: open the site in Safari, use Share → **Add to Home Screen**, then choose **Open as Web App** if shown. OS versions can present the controls differently. [Apple's current instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios) describe the flow. Android should offer the browser's Install/Add to Home screen action; only show a custom install button when its supporting browser event is available.
- A manifest does not make the product offline. If adding a service worker, cache only versioned app assets and required local model files; keep inference uploads out of caches. Remote inference should clearly show offline/unavailable. Fully offline scanning requires an on-device detector and cached weights; evaluate that separately from the backend MVP.

## Physical-phone acceptance pass

Before claiming support, run this on one iPhone in Safari and installed mode, and one Android in Chrome and installed mode:

1. Grant and deny camera permission; verify rear-camera orientation and usable frame dimensions.
2. Start, detect a supported demo object, and verify each available alert through Test alert and a real result.
3. Stop during an in-flight request; confirm no later alert fires. Switch apps, lock/unlock, and Resume; confirm no stale boxes or results.
4. Disconnect the network during scanning; show analysis unavailability promptly and recover cleanly.
5. Verify readable controls, screen-reader labels, volume/voice behavior, and bounded repeat alerts on the actual devices.

Record measured end-to-end alert latency and which devices/browsers were tested. Desktop emulation alone does not verify vibration, camera lens selection, mobile audio behavior, or OS suspension.

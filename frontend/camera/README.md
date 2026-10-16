# ClearPath: combined design, accessible camera, and AI

The app combines `origin/webpage` (commit `cbcad0b`) with the accessible camera controller and the team's existing COCO-SSD backend. Home, Settings, and the three-tab layout come from that design. No new detector or distance algorithm was added.

Camera frame uploads to the team's backend were explicitly authorized during integration. Start uploads small JPEG frames for AI processing; the page discloses this beside Start. There is no microphone request, video recording, or background capture. The existing backend processes frames without saving them.

## Run on this computer

A checksum-verified official Node 24 runtime is available in the ignored `.cache/camera-qa/` folder. From the **repository root**, install the existing backend dependencies once:

```powershell
$env:PATH = "$PWD\.cache\camera-qa\node-v24.22.0-win-x64;$env:PATH"
npm ci --prefix backend
```

In **PowerShell terminal 1**, from the repository root:

```powershell
$env:SURFACE_MODEL = 'off'
& .\.cache\camera-qa\node-v24.22.0-win-x64\node.exe backend/server.js
```

The first run downloads model weights. Wait for **COCO-SSD model ready**. This command disables the existing optional surface model because this camera integration uses object alerts only; it does not edit backend code or configuration.

In **PowerShell terminal 2**, from the repository root:

```powershell
& .\.cache\camera-qa\node-v24.22.0-win-x64\node.exe frontend/server.js
```

Open **http://127.0.0.1:5180/**. Keep both terminals open; Ctrl+C stops each server. Restart the frontend if an older server is running. On another computer, install [Node.js 24+](https://nodejs.org/en/download), reopen the terminal, then use `npm ci --prefix backend`, `npm --prefix backend start`, and `npm --prefix frontend start`. No frontend installation or build step is required. The temporary runtime is not committed.

After dependencies are installed, you can also launch **both servers from one terminal** using the existing demo helper (stop older frontend/backend terminals first):

```powershell
$env:SURFACE_MODEL = 'off'
& .\.cache\camera-qa\node-v24.22.0-win-x64\node.exe scripts/demo.js
```

With Node installed normally, `npm run demo` launches that same helper.

## Try the combined app

1. **Home → Open camera**, or select the Camera tab. Opening the tab never requests permission.
2. Tap **Start camera**, then Allow. **Camera active** confirms playback. **Detection running** appears only after a frame successfully goes through the backend.
3. Enable speech from Camera, Settings → Spoken alerts, or an explicit click on the existing Blindness mode control. Stored profiles never start speech on reload. Test Speech and Repeat Status work with the camera off.
4. Present a supported object such as a backpack or chair. Only the backend's confirmed `alert.triggered` decisions produce real obstacle alerts. Detection depends on image position, confidence, and temporal confirmation. It does not detect every object or hazard.
5. Stop, leave the Camera tab, switch apps, lock, or navigate away: tracks, uploads, pending cues, and obstacle speech stop. Returning requires Start again.

Settings sound/vibration choices are also connected to confirmed obstacle events; device support varies. Speech settings stay synchronized with Camera. Visible alerts remain available regardless of audio preferences.

**Distance remains Not available.** Bounding boxes and confidence are not distance measurements. No detection or no alert never establishes a safe path.

| URL | Purpose |
| --- | --- |
| `/` or `/index.html` | Combined website |
| `/main.html` | Compatibility alias for the combined website |
| `/camera/` or `/camera/camera.html` | Standalone accessible camera with the same AI adapter |
| `/camera.html` | Original AI walkthrough/live-camera demo from `webpage` |

Add **`?dev=1`** to `/` or the standalone URL for **Simulate Obstacle — development only**. It works with the camera off, visibly labels the simulation, and uses the same cooldown and speech handler. It does not establish that real AI works. Its spoken phrase matches the real “Object ahead.” phrase; keep simulation hidden when demonstrating real detection.

## Permissions, announcements, and phones

- Permission is requested only by Start. Denied, missing/busy camera, insecure context, and playback errors have recovery instructions. After denial, allow camera access in this site's browser permissions, then retry Start.
- Cancel stops the app's request but cannot dismiss the browser prompt. Dismiss it yourself. Start stays unavailable until the old permission promise settles; late-granted streams are immediately stopped.
- Automatic announcements default to Screen reader. Enabling speech selects App voice and silences ARIA live announcements. Choosing Screen reader cancels app speech and turns automatic spoken alerts off. Test Speech and Repeat Status always speak on request. There is no screen-reader detection.
- Options allow a 1–30 second obstacle cooldown (default 3). Backend confirmation uses its existing policy with a 1-second minimum; the camera controller applies the user's cooldown to real and simulated events.
- Speech replaces old utterances. Off and Stop cancel it. Unsupported speech disables speech controls; reported playback errors restore screen-reader announcements without stopping the camera. Voices can load asynchronously; the browser controls voice availability and processing.
- Desktop HTTP localhost/127.0.0.1 works for development. Phones need a **trusted HTTPS preview with its same-origin API proxy**. A phone's localhost refers to the phone, and `http://<computer-IP>:5180` alone is insufficient. See [MDN's camera secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Files and integration

- `../index.html`: friend's design with one accessible camera panel; old inline camera implementation removed.
- `../site.js`: tabs and Settings connected to one controller, including cleanup when leaving Camera. `../integration.css` scopes camera styling; `../homePage.css` is unchanged. Existing `main.html` is preserved but its URL serves the combined page.
- `camera.js`: camera lifecycle, speech, announcements, shared obstacle handler, optional real distance source, and public API. `camera.html`/`camera.css` provide the standalone markup and styles. `standalone.js` connects its controller and backend.
- `backend-detector.js`: connects the existing readiness/session/frame APIs and reuses `captureSize` from `../logic.js`. Resizes to at most 640 pixels, JPEG encodes, serializes uploads with increasing sequences, backs off on busy results, and rejects obstacle results over 2.5 seconds old. Stop aborts requests and best-effort deletes the session; server TTL handles sessions abandoned by network failure. It supplies no distance.
- `../server.js`: explicit routes for the combined assets and retained demo; arbitrary repository files stay blocked. `../package.json` includes camera syntax checks and frontend tests. Original demo and backend scripts remain unchanged.

For embedding, import `mountCamera(root, window, {onState})` and `exposeCamera(feature)` from `camera.js`, then register an adapter before Start. The controller module no longer auto-mounts; `site.js` and `standalone.js` are the entry points. Call `feature.stop()` before hiding Camera in single-page navigation.

An adapter implements `async start({video, signal, onObstacle, onDistance, onStatus, onError})`, resolves after startup, and honors abort including after asynchronous initialization. Call `onObstacle()` only for confirmed events. Only a finite positive real measurement in metres may call `onDistance(value)`; `null` clears it. Measurements expire after three seconds. Old run callbacks are ignored.

`window.clearPathCamera` exposes `video`, `start()`, `stop()`, and `registerDetector(adapter)`. Window events: `camera:started` (`{video, runId}`), `camera:stopped` (`{video, runId, reason}`), `camera:obstacle` (`{simulated}`), and `camera:detection-stopped` (cancels optional sound/vibration cues even if camera playback stays active).

The combination is local on `blind-feature`. Existing staged team work is preserved; no merge commit or push was made.

## Verification

With Node installed, from the repository root:

```powershell
npm run check
npm --prefix frontend test
npm --prefix backend test
```

Frontend: **38 tests passed**, along with repository syntax checks and `git diff --check`. Tests simulate camera, speech, model responses, clocks, and UI events; route checks use an actual local HTTP server. They cover permission races, cleanup, upload cancellation, stale-result rejection, retry sequencing, cooldown, Settings synchronization, and tab navigation. These are not real-device or detector-accuracy tests.

The existing backend's **12 alert-policy/surface-summary tests passed**. Full backend API tests and real model inference could not be verified: backend dependency installation repeatedly failed with **ECONNRESET** while downloading required packages, leaving Sharp's native Windows component unavailable. Retry `npm ci --prefix backend` in your normal PowerShell terminal before starting the AI backend. The backend API test attempt was blocked by that missing dependency; it was not a successful model test.

Browser automation is unavailable here. Hardware permission, audible playback, screen readers, and visual layout require device verification. The compact layout uses dynamic viewport height and safe-area spacing. Enlarged text, expanded options, long errors, and small landscape viewports can scroll without clipping controls.

### iPhone Safari + VoiceOver

- [ ] Use the HTTPS combined app. Swipe through all tabs; headings receive focus, inactive screens are absent, and essential actions work without viewing the preview.
- [ ] Allow/Deny/recover permission and cancel a pending request. Confirm no microphone prompt or duplicate requests.
- [ ] Test Speech/Repeat with camera off. Enable speech from Settings and Camera; verify synchronization and one automatic announcement source.
- [ ] Test simulation separately from real supported objects against the ready backend. Confirm cooldown and “Object ahead.” speech; Off/Stop cancel it immediately. Distance stays Not available.
- [ ] Leave Camera, switch apps, lock, and navigate away/back. Confirm camera indicator turns off and Start is required on return.
- [ ] Check ordinary portrait with browser bars, then enlarged text, rotation, expanded options, and external keyboard focus if available. Every control stays reachable through reflow/scrolling.

### Android Chrome + TalkBack

- [ ] Use the HTTPS combined app; swipe through tabs, permissions, statuses, errors, distance, and controls. Confirm logical focus and one automatic voice.
- [ ] Repeat Allow/Deny/recovery and pending Cancel; test missing/busy camera where possible. No microphone prompt should appear.
- [ ] Test speech with camera off and synchronized Settings/Camera toggles. Separate simulation from real detection. Verify cooldown/cancellation and vibration/sound on supported hardware.
- [ ] Leave Camera, switch apps, lock, and return. Camera/uploads stop and require Start again.
- [ ] Check browser bars, larger font/display size, landscape, and expanded options. Content stays reachable without horizontal clipping.

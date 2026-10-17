# Clarity browser app

The main website (`/`) runs the bundled object detector on the device by default.
The retained `/camera.html` page offers a simulated walkthrough and live camera
mode that uploads frames to the backend. Both camera screens offer browser
Picture in Picture so the camera and alerts can continue while another app is
open, when the browser permits it.

## Floating camera in Safari

1. Open the website over trusted HTTPS in Safari (localhost works on a computer).
2. On the main camera screen, tap **Start scanning**, wait for detection, then
   **Enable Spoken Alerts**. On `/camera.html`, select **Live camera**, choose
   **Spoken alert**, then start the scan; this retained page needs its backend.
3. Tap **Open floating camera** while the website is still in front. Confirm a
   floating camera window appears and shows moving camera video before switching
   to another app. The main button is available once the camera plays, even if
   the detection model is still loading; alerts need the model to finish loading.
4. The floating window shows the camera video; boxes and labels remain on the
   website. Fresh confirmed detections still use the screen's existing alerts.
5. Stop, navigating away, or closing PiP while the page is hidden releases the
   camera. Switching away without active PiP also stops scanning. Frozen or muted
   camera input never counts as another fresh observation. Scanning does not
   automatically restart when returning.

If the window opens with paused playback, return to Safari and tap **Resume
camera** when that action appears. The status distinguishes paused playback
from an interrupted or stopped camera source. If the browser interrupts the
source, return to Safari and restart scanning. Opening a PiP window alone does
not establish that capture or detection continues in the background.

Safari and a Home Screen install can expose different PiP support. A request
that fails or produces no actual mode change shows recovery guidance; scanning
remains available in the foreground. The user reported background speech in the
separate Safari experiment, but the integrated feature still needs acceptance on
the target phone. Screen lock, a camera-using app, and unsupported devices may
interrupt capture. No universal background guarantee is made. See the
[experiment and device test](../docs/PIP_EXPERIMENT.md).

## Confirmed object alerts

The existing detector's confirmed obstacle event drives the main page's visible
banner, selected speech, phone notifications and vibration. This does not add or
change proximity measurement. Use **Enable phone notifications** on the camera
screen, or **Settings → Notifications → Allow**, to grant notification permission.
Detection never requests permission automatically.

**Phone notifications** has an independent Settings switch. Page vibration follows
the **Alert style**, **Vibration alerts**, strength and repeat controls. Turning
vibration off also removes the notification vibration pattern and makes that
notification silent. Changing preferences or stopping detection cancels pending
delivery and page vibration. Repeated notifications replace the previous object
notification instead of accumulating. OS notification sounds and actual hardware
delivery remain subject to device settings.

Ordinary Safari tabs on iPhone do not offer system notifications or the Vibration
API. The camera displays unavailable-output guidance and retains spoken and
on-screen alerts. iOS web notifications require a Home Screen web app; this is
separate from the working Safari PiP route. Other browsers may block page
vibration while hidden; an allowed system notification can carry its own
selected vibration pattern. Validate those outputs on the target device.

## Run locally

Use Node.js 24 or newer, from the repository root:

```sh
npm --prefix frontend start
```

Open **http://127.0.0.1:5180/** and select Camera, then Start. No frontend dependency installation, backend, or build step is needed. The local server serves a fixed asset allowlist rather than arbitrary repository files. Bundled model/runtime files load on first use. Optional experimental depth may fetch separate assets.

### Optional backend comparison

Start the backend separately with `npm --prefix backend ci` and `npm --prefix backend start`, then select **http://127.0.0.1:5180/?detector=backend**. This explicitly uploads frames. `/camera.html` also has a backend Live camera mode. The API downloads model weights during startup; `/health` checks liveness and `/ready` returns 503 until ready. See [backend setup](../backend/README.md).

The preview proxies relative `/api/v1/...`, `/ready`, and `/health` to `http://127.0.0.1:3001`. This proxy is not used by the default object detector. Its server-configured target cannot be changed by a request. It accepts bodies up to 1 MiB and returns 503 when the backend is unavailable.

## Configuration

The server reads process environment variables; it does not automatically load a frontend `.env` file.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Preview bind address. |
| `PORT` | `5180` | Preview HTTP port, from 1 to 65535. |
| `API_ORIGIN` | `http://127.0.0.1:3001` | Backend HTTP/HTTPS origin, with no path, credentials, query, or fragment. |

Example for a backend on another local port:

```sh
API_ORIGIN=http://127.0.0.1:3002 npm start
```

No provider/model credentials belong in browser assets. The preview does not log request bodies, session identifiers, or headers. It is a local development server; choose deployment hosting and access controls separately.

## Physical phones and installation

### Live camera picture in picture

On the main Camera tab, start scanning and select **Open floating camera**. When the browser supports this live camera source, the existing video opens in a native floating window. It shows only the raw camera preview, not detection boxes, depth maps, or application controls.

The default scanner accepts fresh detections while its camera is in browser-confirmed PiP. The user reported working spoken alerts during a Safari phone test; that observation does not establish support across devices or long sessions. Frozen, paused and muted inputs cannot trigger new alerts. Closing PiP while hidden releases the camera. Stop, navigation to another app screen, and leaving the page release both camera and PiP. Browser/OS suspension can still interrupt capture or JavaScript.

The team's conservative preview-only lifecycle remains available at **`/?pip=preview`**. In that mode, hiding the page with PiP open pauses inference and alerts, clears old detections, and retains only the preview where supported. Returning to the foreground starts a fresh detector using the same camera stream.

Support is checked when requesting PiP for the current camera source. A rejected request or one that opens no window shows recovery guidance and leaves foreground scanning available. Ordinary video PiP support on iPhone/iPad does not guarantee PiP for a live camera stream. Installing the PWA does not grant background camera privileges.

Automated native acceptance, using an isolated Chromium profile, synthetic camera, and deterministic inference adapter:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/pip-preview-smoke.mjs
```

Run from the repository root. `PIP_CHROME_PATH` optionally selects an installed Chromium executable. The default is headful, so it exercises the actual native window. The test covers entry, hidden preview/inference pause, foreground resume, hidden close, Stop, and unavailable-API fallback. It does not validate real-model inference or physical iOS support. Before claiming mobile support, test live-source entry/rejection, tab/app switching, interruption, return, and Stop on actual Safari/iOS and Android devices.

`scripts/pip-browser-smoke.mjs` retains the separate experiment check. The default integrated scanner, real model and recorded notification outputs are checked by `scripts/pip-website-smoke.mjs`; that runner uses synthetic hidden state and does not establish iPhone scheduling or hardware vibration.

Camera permission requires a secure context. Desktop loopback HTTP is a development exception; opening `http://<laptop-LAN-IP>:5180` on a phone does not provide that exception. A phone's `127.0.0.1` also refers to the phone itself. Use a properly trusted HTTPS deployment or approved HTTPS development endpoint. Setting `HOST=0.0.0.0` makes the server reachable on a network but does not add TLS or make camera capture available by itself.

For the default detector, host the frontend and bundled assets over HTTPS. For optional backend mode, also expose a same-origin API proxy through HTTPS, or configure the frontend's HTTPS API URL and the backend's exact CORS allowlist. An HTTPS page cannot rely on an HTTP remote backend. Adding the site to the home screen does not grant background camera access. Manifest/service-worker files support only the functionality actually implemented; a remote detector still requires a network connection.

Test live mode separately in iPhone Safari, the iPhone home-screen app, Android Chrome, and Android installed mode. Verify permission recovery, rear-camera selection, Start/Stop, box alignment, sound/spoken alerts, and supported vibration. See [PWA constraints and phone checks](../docs/PWA_INTEGRATION.md) and the [API contract](../docs/api.md).

## Team integration

One shared frontend serves both contributors. Coordinate ownership before editing shared files: design owns the user flow, visual system, reusable controls, and accessibility review; integration owns frame capture, API requests, and loading/error states. Guided mode's simulated results must remain distinguishable from real live detections.

## App entry points and validation

The shared home, settings and Camera tab live in `index.html` with `homePage.css`. Its production camera controller is `camera.js` and its default detector is `local-detector.js`. Optional API mode uses `backend-detector.js`.

The retained `/camera.html` page uses `styles.css`, `app.js` and `logic.js`. Its Walkthrough is simulated, while its Live camera mode uploads frames to the backend. There is no separate `frontend/camera/` implementation.

Run `npm run check` at the repository root and `npm --prefix frontend test`. See the [current judge/runtime guide](../docs/JUDGES.md), [sharing and hosting](../docs/SHARE_AND_HOST.md), and [phone checks](../docs/PWA_INTEGRATION.md). Historical hosting notes may describe backend-only flows.

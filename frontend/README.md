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

Use Node.js 24 or newer. Open two terminals at the repository root.

Terminal 1 starts the real detection backend:

```sh
cd backend
npm ci
cp .env.example .env
npm start
```

The detector downloads its model weights during startup. `/health` checks the HTTP process; `/ready` returns `503` until the detector is ready. See the [backend setup and model scope](../backend/README.md).

Terminal 2 starts the dependency-free browser preview:

```sh
cd frontend
npm run dev
```

Open **http://127.0.0.1:5180**. No frontend dependency installation or build step is needed. `npm start` runs without file watching; `npm run check` checks JavaScript syntax. The local server serves only the sample's fixed asset allowlist. It does not expose the repository or arbitrary filesystem files.

The browser calls relative `/api/v1/...`, `/ready`, and `/health` URLs. The preview proxies those paths to the backend at `http://127.0.0.1:3001`, preserving API responses. It removes the browser's `Origin` header upstream because this local integration uses one browser origin. The target is configured server-side and cannot be changed by a request. The proxy accepts request bodies up to 1 MiB and returns actionable JSON with status `503` if the backend is unavailable.

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

Camera permission requires a secure context. Desktop loopback HTTP is a development exception; opening `http://<laptop-LAN-IP>:5180` on a phone does not provide that exception. A phone's `127.0.0.1` also refers to the phone itself. Use a properly trusted HTTPS deployment or approved HTTPS development endpoint. Setting `HOST=0.0.0.0` makes the server reachable on a network but does not add TLS or make camera capture available by itself.

For deployment, expose the frontend and its same-origin API proxy through HTTPS, or configure the frontend's HTTPS API URL and the backend's exact CORS allowlist. An HTTPS page cannot rely on an HTTP remote backend. Adding the site to the home screen does not grant background camera access. Manifest/service-worker files support only the functionality actually implemented; a remote detector still requires a network connection.

Test live mode separately in iPhone Safari, the iPhone home-screen app, Android Chrome, and Android installed mode. Verify permission recovery, rear-camera selection, Start/Stop, box alignment, sound/spoken alerts, and supported vibration. See [PWA constraints and phone checks](../docs/PWA_INTEGRATION.md) and the [API contract](../docs/api.md).

## Team integration

One shared frontend serves both contributors. Coordinate ownership before editing shared files: design owns the user flow, visual system, reusable controls, and accessibility review; integration owns frame capture, API requests, and loading/error states. Guided mode's simulated results must remain distinguishable from real live detections.

## Combined website

The `webpage` design is combined with the accessible camera and existing AI backend. Run from the repository root with Node.js 24+:

```powershell
npm ci --prefix backend
npm --prefix backend start
```

In a second terminal:

```powershell
npm --prefix frontend start
```

Open **http://127.0.0.1:5180/**, choose Camera, then Start camera. Starting sends frames to the team's backend; no microphone or video recording is used. Wait for the backend model to be ready. Phones require a trusted HTTPS preview and its API proxy. The original AI demo is retained at `/camera.html`.

Existing Settings speech controls are connected to the accessible camera. The AI recognizes selected objects; it does not measure distance or establish that a path is safe.

Camera controller, detector adapter, and their tests live alongside the main app files. Run `npm run check` at the root and `npm --prefix frontend test` for frontend validation.
## Camera page and team design

The shared home, settings, and tab design lives in `index.html` with `homePage.css`. The retained AI camera page is **`camera.html`**, styled by **`styles.css`** and powered by **`app.js`** and **`logic.js`**. There is no separate `frontend/camera/` implementation.

Open **http://127.0.0.1:5180/camera.html**. Choose Live camera, select Accessibility for spoken alerts, then Start camera and allow permission. Live mode sends frames to the running backend. Walkthrough mode uses simulated detections. The main page's own Camera tab currently provides a camera preview; it does not run this page's AI loop. Settings can link directly to `/camera.html`.

Run `npm run check` at the repository root and `npm --prefix frontend test`. See [sharing and hosting](../docs/SHARE_AND_HOST.md) for PowerShell commands and HTTPS phone access, and [phone checks](../docs/PWA_INTEGRATION.md) for device validation.

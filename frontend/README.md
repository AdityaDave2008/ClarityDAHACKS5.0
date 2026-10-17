# Clarity browser app

The main Camera tab runs bundled COCO-SSD locally through TensorFlow.js/WASM. Frames stay in the browser for this default detector. The separate `/camera.html` walkthrough is explicitly simulated unless its backend Live camera mode is selected. Keep the page visible for inference and alerts. PiP can retain the raw preview where supported, but does not promise background scanning.

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

On the main Camera tab, start scanning and select **Picture in picture**. When the browser supports this live camera source, the existing video opens in a native floating window. It shows only the raw camera preview, not detection boxes, depth maps, or application controls.

Switching to another browser tab while this window is open retains the preview where the browser permits, but **pauses inference, uploads, and alerts** and clears old detections. Returning to the visible page starts a fresh detector using the same camera stream. Closing PiP while hidden releases the camera. Stop, navigation to another app screen, and leaving the page release both camera and PiP. Browser/OS suspension can still interrupt the live preview, so this is not background navigation or a safety feature.

Support is checked for the current browser and video source. Unsupported browsers show a disabled control and instructions to keep the page open. In particular, ordinary video PiP support on iPhone/iPad does not guarantee PiP for a live camera stream. Installing the PWA does not grant background camera privileges. A rejected PiP request leaves the inline preview and scanning controls usable.

Automated native acceptance, using an isolated Chromium profile, synthetic camera, and deterministic inference adapter:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/pip-browser-smoke.mjs
```

Run from the repository root. `PIP_CHROME_PATH` optionally selects an installed Chromium executable. The default is headful, so it exercises the actual native window. The test covers entry, hidden preview/inference pause, foreground resume, hidden close, Stop, and unavailable-API fallback. It does not validate real-model inference or physical iOS support. Before claiming mobile support, test live-source entry/rejection, tab/app switching, interruption, return, and Stop on actual Safari/iOS and Android devices.

Camera permission requires a secure context. Desktop loopback HTTP is a development exception; opening `http://<laptop-LAN-IP>:5180` on a phone does not provide that exception. A phone's `127.0.0.1` also refers to the phone itself. Use a properly trusted HTTPS deployment or approved HTTPS development endpoint. Setting `HOST=0.0.0.0` makes the server reachable on a network but does not add TLS or make camera capture available by itself.

For the default detector, host the frontend and bundled assets over HTTPS. For optional backend mode, also expose a same-origin API proxy through HTTPS, or configure the frontend's HTTPS API URL and the backend's exact CORS allowlist. An HTTPS page cannot rely on an HTTP remote backend. Adding the site to the home screen does not grant background camera access. Manifest/service-worker files support only the functionality actually implemented; a remote detector still requires a network connection.

Test live mode separately in iPhone Safari, the iPhone home-screen app, Android Chrome, and Android installed mode. Verify permission recovery, rear-camera selection, Start/Stop, box alignment, sound/spoken alerts, and supported vibration. See [PWA constraints and phone checks](../docs/PWA_INTEGRATION.md) and the [API contract](../docs/api.md).

## Team integration

One shared frontend serves both contributors. Coordinate ownership before editing shared files: design owns the user flow, visual system, reusable controls, and accessibility review; integration owns frame capture, API requests, and loading/error states. Guided mode's simulated results must remain distinguishable from real live detections.

## App entry points and validation

The shared home, settings and Camera tab live in `index.html` with `homePage.css`. Its production camera controller is `camera.js` and its default detector is `local-detector.js`. Optional API mode uses `backend-detector.js`.

The retained `/camera.html` page uses `styles.css`, `app.js` and `logic.js`. Its Walkthrough is simulated, while its Live camera mode uploads frames to the backend. There is no separate `frontend/camera/` implementation.

Run `npm run check` at the repository root and `npm --prefix frontend test`. See the [current judge/runtime guide](../docs/JUDGES.md), [sharing and hosting](../docs/SHARE_AND_HOST.md), and [phone checks](../docs/PWA_INTEGRATION.md). Historical hosting notes may describe backend-only flows.

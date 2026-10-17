# StepSense browser sample

The browser sample has a guided, explicitly simulated mode for learning the flow and a live camera mode that uploads frames to the real backend. Keep the camera page visible during live use. Browser PiP, home-screen installation, and a native application's multitasking privileges are different capabilities; the sample does not promise scanning behind another app.

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

## Camera page and team design

The shared home, settings, and tab design lives in `index.html` with `homePage.css`. The retained AI camera page is **`camera.html`**, styled by **`styles.css`** and powered by **`app.js`** and **`logic.js`**. There is no separate `frontend/camera/` implementation.

Open **http://127.0.0.1:5180/camera.html**. Choose Live camera, select Accessibility for spoken alerts, then Start camera and allow permission. Live mode sends frames to the running backend. Walkthrough mode uses simulated detections. The main page's own Camera tab currently provides a camera preview; it does not run this page's AI loop. Settings can link directly to `/camera.html`.

Run `npm run check` at the repository root and `npm --prefix frontend test`. See [sharing and hosting](../docs/SHARE_AND_HOST.md) for PowerShell commands and HTTPS phone access, and [phone checks](../docs/PWA_INTEGRATION.md) for device validation.

# Share and run the camera page

## Files and GitHub

The camera page to keep is **`frontend/camera.html`**. It uses `frontend/styles.css`, `frontend/app.js`, and `frontend/logic.js`. The duplicate `frontend/camera/` directory and its old integration are removed. The shared home, settings, and tab design remains in `frontend/index.html` and `frontend/homePage.css`.

Settings buttons can link to **`/camera.html`**. That page includes the Accessibility preset, spoken alerts, a simulated Walkthrough, and Live camera with backend AI. The main page's Camera tab currently provides a preview; it does not run the retained page's AI loop.

After the cleanup merges, teammates with clean working trees can update with:

```powershell
git switch main
git pull --ff-only origin main
```

Save or commit unfinished work on your own branch first. Do not commit `.cache`, `node_modules`, or `.env`. Pushing to GitHub shares source code; it does not host the AI server.

## Run on this computer

Use PowerShell in the repository root. Install Node.js 24+ or use this computer's temporary runtime, if it is still present:

```powershell
$env:PATH = "$PWD\.cache\camera-qa\node-v24.22.0-win-x64;$env:PATH"
```

Install backend dependencies once:

```powershell
npm.cmd ci --prefix backend
```

Previous installation attempts on this computer failed with `ECONNRESET`. A successful install is required for live AI detection. Then start both servers:

```powershell
$env:SURFACE_MODEL = 'off'
node scripts/demo.js
```

Open **http://127.0.0.1:5180/camera.html**. Wait for the backend model to be ready, choose **Live camera**, select **Accessibility** for spoken alerts, then **Start camera scan** and allow camera permission. The first model startup needs an Internet connection to download weights. Keep the terminal open; Ctrl+C stops the servers started by the helper.

For frontend-only work, run `npm.cmd --prefix frontend start`. Walkthrough uses simulated detections without backend AI; Live camera requires the backend. Test alert checks the selected alert channels. No simulation or automated route check verifies real model accuracy.

## Open on a phone or another laptop

Phone camera access requires **trusted HTTPS**. `localhost` on a phone refers to the phone itself. Keep the servers running on this computer and expose frontend port **5180** through your team's HTTPS preview or tunnel. The preview already proxies requests to the backend on port 3001.

If Cloudflare's tunnel client is installed, run in a second PowerShell terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:5180
```

Open the printed `https://...trycloudflare.com/camera.html` address in iPhone Safari or Android Chrome. Another laptop can use the same address. Keep this computer awake and both terminals running. The temporary tunnel URL is publicly reachable, carries uploaded frames to this computer, and changes when restarted.

## Device checklist - still requires real-device testing

- iPhone Safari with VoiceOver: navigate controls by label, select Live camera and Accessibility, test speech, allow/deny permission, start/stop, and leave/return to the page. Verify no stale alerts after Stop and readable controls at enlarged text sizes.
- Android Chrome with TalkBack: repeat permission, speech, start/stop, background/return, and enlarged-text checks. Check vibration only on devices that support it.
- Test Walkthrough separately as a simulation. For real AI, wait for model readiness and use a supported object; verify network failures are visible. Do not infer distance or a safe path from detection results.

Run `npm.cmd run check` at the root and `npm.cmd --prefix frontend test` for automated validation. These checks do not verify a physical camera, screen reader, mobile speech playback, or live AI inference. See [PWA and device checks](PWA_INTEGRATION.md) and the [backend guide](../backend/README.md).

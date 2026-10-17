# Share the camera work and host it from your Windows computer

## Share through GitHub

Your original checkout is on `blind-feature`, with existing staged team work preserved. A separate checkout at `.cache/share-accessible-camera` is based on the fetched `origin/main` (`6de0d21`) and contains only the frontend integration, the demo helper's updated launch message, and this guide. Its branch is `share-accessible-camera`. Backend source is unchanged relative to that main commit.

Use this separate checkout for the sharing commands below. Do not use Commit All in the original checkout: it has many already-staged files from the earlier integration. The review copy also preserves the full frontend README from main and appends the combined-app instructions.

From the **original repository root in PowerShell**, review and commit the prepared copy:

```powershell
git -C .cache/share-accessible-camera status --short
git -C .cache/share-accessible-camera add frontend scripts/demo.js docs/SHARE_AND_HOST.md
git -C .cache/share-accessible-camera diff --cached --stat
git -C .cache/share-accessible-camera commit -m "Integrate accessible camera with shared design and AI backend"
git -C .cache/share-accessible-camera push -u origin share-accessible-camera
```

On GitHub, create a pull request with **base: main** and **compare: share-accessible-camera**. Ask a teammate to review it. In Files changed, backend source should not appear. If main changes before merging, update/merge the latest main into this branch and resolve any reported conflicts without overwriting the backend teammate's work. A pull request allows GitHub to check the proposed integration before main changes: [GitHub pull request instructions](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request).

After the pull request is merged, friends with clean working trees can run:

```powershell
git switch main
git pull --ff-only origin main
```

A friend with uncommitted backend work should save/commit that work on their own feature branch before switching branches. They can then merge the updated main into their backend branch. Each developer installs dependencies locally; `.cache`, `node_modules`, and `.env` must not be committed. The repository's existing ignore rules cover them.

This review copy is a snapshot. Later edits in the original checkout do not automatically appear in it. Do not delete its directory while you still need to commit/push it. The `.cache` directory is ignored by Git; OneDrive may still sync it.

## Open the app on this computer

Use the **original repository root** for running the app. Stop any old server with Ctrl+C first.

This computer has a temporary Node runtime in `.cache/camera-qa/`. Add it to this PowerShell terminal's PATH:
Save or commit unfinished work on your own branch first. Do not commit `.cache`, `node_modules`, or `.env`. Pushing to GitHub shares source code; it does not host the AI server.

## Run on this computer

Use PowerShell in the repository root. Install Node.js 24+ or use this computer's temporary runtime, if it is still present:

```powershell
$env:PATH = "$PWD\.cache\camera-qa\node-v24.22.0-win-x64;$env:PATH"
```

The backend dependencies have not installed successfully yet: previous attempts failed with `ECONNRESET`. Run the following once and wait for a successful result before starting AI detection:

```powershell
npm ci --prefix backend
```

Then run both servers with the existing helper:
Install backend dependencies once:

```powershell
npm.cmd ci --prefix backend
```

Previous installation attempts on this computer failed with `ECONNRESET`. A successful install is required for live AI detection. Then start both servers:

```powershell
$env:SURFACE_MODEL = 'off'
node scripts/demo.js
```

Open **http://127.0.0.1:5180/** on this computer. Wait for **COCO-SSD model ready**, then choose Camera → Start camera → Allow. The first backend startup downloads model weights. Keep the terminal open. Ctrl+C stops the servers started by the helper.

For other computers, install Node.js 24+ and reopen PowerShell before using npm/node. The temporary runtime is not shared through GitHub. To run the frontend alone while working with the backend teammate, use `npm --prefix frontend start`; the preview proxies to `http://127.0.0.1:3001` by default. `API_ORIGIN` can select a teammate-provided reachable backend origin, but the default localhost refers to the computer running the preview.

## Open the app on a phone or another laptop

The phone camera needs **trusted HTTPS**. Opening `http://<computer-IP>:5180` does not provide the localhost camera exception, and localhost on your phone refers to the phone itself. Keep both app servers on this computer running and create a temporary HTTPS tunnel to the **frontend port 5180**. That server already proxies the API, so you do not need a second tunnel to port 3001.

Install the official Cloudflare tunnel client using its [Windows download instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). For Windows Package Manager, the package ID is `Cloudflare.cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared --exact
```

Open a **new PowerShell terminal** after installing, then run:
Open **http://127.0.0.1:5180/camera.html**. Wait for the backend model to be ready, choose **Live camera**, select **Accessibility** for spoken alerts, then **Start camera scan** and allow camera permission. The first model startup needs an Internet connection to download weights. Keep the terminal open; Ctrl+C stops the servers started by the helper.

For frontend-only work, run `npm.cmd --prefix frontend start`. Walkthrough uses simulated detections without backend AI; Live camera requires the backend. Test alert checks the selected alert channels. No simulation or automated route check verifies real model accuracy.

## Open on a phone or another laptop

Phone camera access requires **trusted HTTPS**. `localhost` on a phone refers to the phone itself. Keep the servers running on this computer and expose frontend port **5180** through your team's HTTPS preview or tunnel. The preview already proxies requests to the backend on port 3001.

If Cloudflare's tunnel client is installed, run in a second PowerShell terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:5180
```

Open the printed **https://...trycloudflare.com** URL in iPhone Safari or Android Chrome. Another laptop can use that same URL. Choose Camera → Start camera → Allow, and explicitly enable speech if wanted. This is a temporary HTTPS URL provided by [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

The computer is hosting the website and AI backend. Cloudflare forwards the HTTPS traffic, including uploaded camera frames, to it. A basic Quick Tunnel URL is publicly reachable; share it only with the intended testers. The URL changes when the tunnel restarts. Keep the computer awake, connected to the Internet, and both the app and tunnel terminals running. Ctrl+C in the tunnel terminal ends access through that link. No router port forwarding is needed.

Pushing code to GitHub shares the source; it does not start these servers or create this HTTPS link. Real-device camera/speech/screen-reader testing and real model inference still need verification after the backend dependencies install. See [the camera guide](../frontend/camera/README.md) for the test checklist.
Open the printed `https://...trycloudflare.com/camera.html` address in iPhone Safari or Android Chrome. Another laptop can use the same address. Keep this computer awake and both terminals running. The temporary tunnel URL is publicly reachable, carries uploaded frames to this computer, and changes when restarted.

## Device checklist - still requires real-device testing

- iPhone Safari with VoiceOver: navigate controls by label, select Live camera and Accessibility, test speech, allow/deny permission, start/stop, and leave/return to the page. Verify no stale alerts after Stop and readable controls at enlarged text sizes.
- Android Chrome with TalkBack: repeat permission, speech, start/stop, background/return, and enlarged-text checks. Check vibration only on devices that support it.
- Test Walkthrough separately as a simulation. For real AI, wait for model readiness and use a supported object; verify network failures are visible. Do not infer distance or a safe path from detection results.

Run `npm.cmd run check` at the root and `npm.cmd --prefix frontend test` for automated validation. These checks do not verify a physical camera, screen reader, mobile speech playback, or live AI inference. See [PWA and device checks](PWA_INTEGRATION.md) and the [backend guide](../backend/README.md).

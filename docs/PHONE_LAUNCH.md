# Launch the browser camera sample on an iPhone

The browser sample needs HTTPS for camera access on a physical iPhone. A local `http://<Mac-IP>` address can show the guided walkthrough but does not provide the same camera-access development exception as desktop localhost.

## Temporary HTTPS preview

1. Run `npm --prefix backend ci` if the backend dependencies are missing, then `npm run demo` at the repository root. The browser app normally serves at `http://localhost:5180`.
2. Install the official [Cloudflare tunnel client](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) if needed.
3. Run a Quick Tunnel to the app server:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:5180
   ```

4. Open the printed `https://…trycloudflare.com` address in iPhone Safari. Choose **Live camera → Start camera scan → Allow**. Try a supported backpack, chair, suitcase, or person in a controlled scene.
5. To launch from the home screen, use Safari's **Share → Add to Home Screen**, then verify camera and audio permissions in that mode separately.

The app uses relative URLs, so the same HTTPS origin serves its interface and forwards camera frames to the backend. No code or model key needs to be embedded in browser assets. Camera frames pass through Cloudflare to the Mac for inference; the application backend does not save them.

A Quick Tunnel is a temporary development link. The Mac, app server, detector, and tunnel must stay running, and the URL changes when a new tunnel is created. Anyone who has the URL can access this demo. Stop the tunnel process to end internet access. The app still scans only while its page is visible; HTTPS does not grant background camera access.

## Verified current session

On October 16, 2026, the existing LAN preview on port 3002 was tunneled instead of starting another detector. Its public homepage returned 200, `/ready` returned `ready: true`, and two actual test-image uploads reached COCO-SSD. The first observation detected a cat; the second triggered the backend's confirmation alert. Full public request times were 300 ms and 175 ms for those small test frames. This is a controlled connection check, not phone-camera, alert-hardware, model-accuracy, or general performance validation.

The native iPhone app is a separate Xcode installation; this link opens the browser sample. The HTTPS origin can also be entered as the backend address in an installed native sample.

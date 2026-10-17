# Learning sample: camera scanner with smart alerts

A single-file, commented version of the scanning loop for learning and phone testing. It is separate from the main browser demo in `frontend/`. Read [index.html](index.html) top to bottom; its sections are numbered.

## Run

```sh
cd backend && npm start            # terminal 1: API on :3001 (loads COCO-SSD + surface model)
node frontend/sample/serve.mjs     # terminal 2: page + same-origin API proxy on :5173
```

Open http://127.0.0.1:5173 on the laptop. On an iPhone the camera needs HTTPS, so expose port 5173 through a tunnel (for example `cloudflared tunnel --url http://127.0.0.1:5173`) and open the printed URL in Safari. Anyone with the tunnel URL can use the page until you stop the tunnel, and frames pass through the tunnel provider.

Tick **Mock mode** to see the alert behavior without a camera or backend.

## What it adds on top of the API

| Feature | How |
| --- | --- |
| Direction | Box anchor x: left of 0.4 = left, right of 0.6 = right, otherwise ahead |
| Distance (estimate) | `d = H / tan(pitch + atan((y − 0.5) / f))`, where H is the phone's height (setting), pitch comes from `DeviceOrientationEvent` and f from an approximate iPhone 1× field of view. Assumes flat ground and the object touching it. |
| Alert manager | Announces only server-confirmed objects. Speaks when something new appears, changes direction, or gets closer. Repeats the same label, direction, and distance band at most 3 times, at least 4 s apart, and forgets an object after 2 s unseen. "Very close" interrupts other speech. |
| Getting closer | Box height grew more than 15% in the last 1.5 s |
| Surface hazards | Speaks `surface.warning` (wall, pole, stairs…) once it appears on two different segmentation results; 6 s cooldown |
| Beeps | Pitch and count encode distance band; stereo pan encodes direction (iPhone has no web vibration) |
| iOS care | Audio, speech, and motion permission unlocked in the Start tap; `speechSynthesis.resume()` plus an `onend` timeout; wake lock re-requested; pauses on hidden page or ended camera track |
| Blocked camera | A very dark frame for 3 frames says "Camera blocked or too dark" instead of staying silent |

Distances and surface labels are rough estimates for a prototype, not safety guarantees. The status line never says the path is clear.

# Sensor fusion for phones without LiDAR

Research checked October 16, 2026. Companion to [TESLA_AND_NO_LIDAR_RESEARCH.md](TESLA_AND_NO_LIDAR_RESEARCH.md). Every phone has an accelerometer and gyroscope; this doc says what each sensor can and cannot contribute, and specifies one JavaScript module, `frontend/sensors.js`, that the alert policy consumes.

Short version: in the time left, the sensors buy four things. A better pitch from the gravity vector, a walking and cadence gate, gyro-based ego-motion compensation so temporal confirmation survives hand sway, and a one-time field-of-view calibration. Barometer, GPS, magnetometer, proximity, dual cameras, and front-camera face detection are unavailable in the browser, too slow, or too risky for this deadline.

## What the browser exposes

| Sensor or API | Chrome Android | iOS Safari | Notes |
| --- | --- | --- | --- |
| `devicemotion` (accel incl. gravity, rotationRate) | Yes, about 60 Hz | Yes, about 60 Hz | iOS 13+: `DeviceMotionEvent.requestPermission()` from a tap, HTTPS only |
| `deviceorientation` (alpha, beta, gamma) | Yes; alpha is relative and drifts | Yes; alpha is arbitrary | Same iOS permission gate |
| `deviceorientationabsolute` | Yes (magnetometer) | No; use `webkitCompassHeading` | Heading only, not needed for alerts |
| Generic Sensor API (Accelerometer, Gyroscope, GravitySensor, orientation sensors) | Yes | No; WebKit formally opposed it | Use `devicemotion` for both platforms |
| Magnetometer, AmbientLightSensor | Flag only | No | Do not plan on them |
| Proximity sensor, barometer | No | No | Native only |
| Geolocation speed and heading | Yes | Yes | Noisy at walking pace, dead indoors; skip |
| Screen Wake Lock | Yes | iOS 16.4+; installed PWA needs iOS 18.4+ | Required; screen lock stops camera and sensors |
| Vibration API | Yes | No, through iOS 27 | Use audio and screen flash on iOS |
| Second simultaneous camera | Unreliable | No; second `getUserMedia` ends the first track | Stereo is native only |
| Camera intrinsics (`MediaTrackSettings`) | No FOV or focal length | No | Calibrate once or assume |

Sources: [caniuse accelerometer](https://caniuse.com/accelerometer), [WebKit position on Generic Sensors](https://github.com/WebKit/standards-positions/issues/347), [Chrome 50 relative alpha](https://developer.chrome.com/blog/device-orientation-changes), [WebKit 60 Hz motion](https://bugs.webkit.org/show_bug.cgi?id=145814), [caniuse wake lock](https://caniuse.com/wake-lock), [caniuse vibration](https://caniuse.com/vibration), [WebKit single camera](https://bugs.webkit.org/show_bug.cgi?id=179363), [caniuse proximity](https://caniuse.com/proximity).

## Native extras for the Swift and Android samples

- iOS CoreMotion: `CMDeviceMotion` gravity, attitude, rotationRate at up to 100 Hz with no prompt. `CMPedometer` cadence and `CMMotionActivityManager` walking state need `NSMotionUsageDescription` and arrive with seconds of latency. `CMAltimeter` relative altitude works for floor changes, not curbs. Camera FOV from `AVCaptureDevice.activeFormat.videoFieldOfView`, or per-frame intrinsics via `isCameraIntrinsicMatrixDeliveryEnabled`. Haptics via `UIImpactFeedbackGenerator` or Core Haptics.
- Android: prefer `TYPE_GAME_ROTATION_VECTOR` or `TYPE_GRAVITY` for pitch (no magnetometer disturbance). `TYPE_STEP_DETECTOR` needs `ACTIVITY_RECOGNITION` on API 29+. `TYPE_PRESSURE` and `TYPE_PROXIMITY` exist. FOV from `LENS_INFO_AVAILABLE_FOCAL_LENGTHS` plus `SENSOR_INFO_PHYSICAL_SIZE`, corrected for the stream crop; `LENS_INTRINSIC_CALIBRATION` when the HAL provides it. Vibration works from the foreground service.

## Ranked techniques

| # | Technique | Sensors | PWA or native | Improves | Effort | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Gravity-vector pitch and roll, landscape aware | accel incl. gravity | Both | No gimbal-lock flips near vertical; handles roll; one place for iOS/Android sign differences; feeds the distance formula directly | 1 to 1.5 h | Low |
| 2 | Step detector: walking, cadence, step count | accel magnitude | Both | Suppress alerts when stationary; speed = cadence x 0.7 m feeds time-to-contact | 2 h | Low; tune threshold for hand-held carry |
| 3 | Gyro ego-rotation compensation for temporal confirmation | rotationRate integrated between frames | Both | Two-frame confirmation stops breaking on hand sway | 2 to 3 h plus 30 min sign calibration per OS | Medium |
| 4 | "Looking down while walking" arming signal | 1 + 2 + page visibility | PWA | Defines when StepSense is armed | 1 h | Low |
| 5 | One-time FOV calibration (frame an A4 sheet at 1 m or a floor mark at 2 m) | camera | PWA | The 67/53 degree assumption is off by about 10 degrees across phones, a 15 to 25 percent distance error | 1 h | Low |
| 6 | Native intrinsics | camera | Native | Exact focal length in pixels | 0.5 to 1 h each | Low |
| 7 | Camera-height prior from pitch (over 55 degrees down means held low, H about 1.0 m; 20 to 45 degrees means chest, H about 1.3 m) | 1 | Both | Small improvement to the height assumption | 0.5 h | Medium, weak signal |
| 8 | Native pedometer or activity recognition as a second vote | CMPedometer, step detector | Native | Robust walking gate | 1 to 2 h | Low, seconds of latency |
| 9 | Haptic alert | Vibration API, Core Haptics | Android web and native; iOS native only | Salience when the user is not looking at the frame | 0.5 h | Low |
| 10 | Motion-parallax metric depth using step length as the baseline | camera + 2 + 3 | PWA possible | Independent metric distance | 6 to 10 h | High: flow near the focus of expansion, which is where hazards are, is near zero. Do not build |
| 11 | Barometer for stairs | altimeter, pressure | Native | Floor changes only; a 15 cm step is below sensor noise | 2 h | Low value |
| 12 | Front-camera attention detection | FaceDetector, MediaPipe | Native only in practice | Confirms eyes on screen | 4 h+ | High; iOS kills the rear stream. Skip |
| 13 | GPS speed and heading, magnetometer | geolocation, compass | PWA | Nothing for obstacle distance | | Skip |

Why IMU-based metric depth is out: accelerometer double integration drifts with time squared and is unusable past about a second. The only metric baseline a browser can get is pedestrian dead reckoning (one detected step is about 0.7 m), and parallax from that baseline is weakest straight ahead. The ground-plane and Depth Anything path already gives metric distance where parallax is weakest. Sources: [double-integration drift](https://arxiv.org/pdf/1704.06053), [step-length models](https://pmc.ncbi.nlm.nih.gov/articles/PMC5038701), [rotation homography](https://arxiv.org/pdf/2101.11183).

## The sensor fusion module

`frontend/sensors.js` exposes `start()` (must run inside a tap handler for iOS) and `snapshot()` returning:

```
{ pitchDeg, rollDeg, walking, cadenceHz, stepCount, speedMps, headingDeg | null,
  egoRotationSinceLastFrame: { x, y, z }, lookingDown, pocketLikely, confidence }
```

Device frame: x right, y up the screen, z out of the screen; the rear camera looks along negative z.

- Gravity: low-pass `accelerationIncludingGravity` with k = 0.1 at 60 Hz, after multiplying by a platform sign (iOS reports the opposite sign from Chrome Android). Verify once per device: flat and face up should give z about +9.8 after the sign fix.
- Pitch below the horizon: `pitchDown = asin(g_z / |g|)`, 90 is straight down, 0 is the horizon. Rotate (g_x, g_y) by `screen.orientation.angle` first so landscape works. This replaces `90 - beta` in the distance formula and has no singularity.
- Roll: `atan2(g_x, g_y)`. Rotate the box bottom-center into the gravity-aligned frame before reading its row; a 10 degree roll moves a bottom edge noticeably.
- Steps: peak detection on a band-passed acceleration magnitude, peak above about 0.8 m/s^2 (tune on device), 300 ms refractory, intervals between 0.3 and 1.0 s. Walking means at least three consecutive valid intervals and a peak within the last 1.5 s. Cadence is 1 over the median interval; typical walking is 1.5 to 2.2 Hz. Speed is cadence times a 0.7 m step.
- Ego rotation: integrate `rotationRate` between processed frames. All shipping browsers put the rate about device x in `.alpha`, about y in `.beta`, about z in `.gamma`, which is not the orientation-event naming.
- lookingDown: pitch between 20 and 60 degrees held for at least 1 s, and walking, and the page visible. For a 1.3 m camera height, that band sees the floor 1 to 3 m ahead.
- pocketLikely: mean frame luminance below threshold (the sample already computes it) and walking and pitch outside the band. Pause inference.
- confidence: product of gravity magnitude sanity (8.5 to 11 m/s^2), cadence regularity (1 minus the coefficient of variation of intervals), small ego rotation (under 15 degrees per frame), and pitch in band.

### How the alert policy consumes it

1. Send pitch, roll, focal length in pixels, camera height, walking, speed, ego rotation, and a timestamp with every frame. Compute distance with the pitch at capture time, not a value smoothed 200 ms later.
2. Temporal confirmation: predict last frame's boxes with the ego rotation, match by IoU above 0.3, require two consecutive matches, three if ego rotation exceeded 10 degrees. This plugs into `frontend/tracking.js`.
3. Alert only if lookingDown and walking and distance under max(1.5 m, speed x 2 s), with a per-track cooldown of at least 3 s. When not walking, show a passive outline only. When pocketLikely or the page is hidden, stop capture and release the wake lock.
4. Camera height: 1.0 m when pitch exceeds 55 degrees down, 1.3 m otherwise; prefer a user-entered height.

## Code

### Permission plus gravity-based pitch and roll

```js
// sensors.js. Call start() from a click or touch handler (iOS 13+ requirement).
const IOS = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
const G_SIGN = IOS ? -1 : 1; // verify once: flat, face up gives g.z about +9.8
const g = [0, 0, 0];

export async function start() {
  if (IOS) {
    const r = await DeviceMotionEvent.requestPermission(); // HTTPS and user gesture
    if (r !== 'granted') throw new Error('motion permission denied');
  }
  window.addEventListener('devicemotion', onMotion);
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const k = 0.1; // about 1 Hz low-pass at 60 Hz
  g[0] += k * (G_SIGN * a.x - g[0]);
  g[1] += k * (G_SIGN * a.y - g[1]);
  g[2] += k * (G_SIGN * a.z - g[2]);
  stepUpdate(Math.hypot(a.x, a.y, a.z), e.timeStamp);
  gyroUpdate(e.rotationRate, e.timeStamp, e.interval);
}

export function pitchRoll() {
  let [x, y, z] = g;
  const ang = (screen.orientation && screen.orientation.angle) || 0;
  if (ang === 90) [x, y] = [-y, x];
  else if (ang === 270) [x, y] = [y, -x];
  else if (ang === 180) [x, y] = [-x, -y];
  const n = Math.hypot(x, y, z) || 1;
  const pitchDown = Math.asin(Math.max(-1, Math.min(1, z / n))) * 180 / Math.PI; // 90 = down, 0 = horizon
  const roll = Math.atan2(x, y) * 180 / Math.PI; // 0 = upright
  return { pitchDeg: pitchDown, rollDeg: roll, gravityOk: n > 8.5 && n < 11 };
}
```

Distance stays as implemented, with `fPx = (frameH / 2) / tan(vFOV / 2)` and `pitchDeg` from above instead of `90 - beta`.

### Step detector and cadence

```js
const S = { lp: 0, base: null, prev: 0, wasRising: false, lastPeak: 0, iv: [], count: 0 };
const PEAK = 0.8, REFRACTORY = 300, MAX_IV = 1000, MIN_IV = 300; // m/s^2 and ms; tune on device

function stepUpdate(mag, t) {
  if (S.base == null) S.base = mag;
  S.lp += 0.25 * (mag - S.lp);   // about 2.5 Hz low-pass
  S.base += 0.01 * (mag - S.base); // slow baseline (gravity)
  const s = S.lp - S.base;         // bob signal
  const rising = s > S.prev;
  if (!rising && S.wasRising && S.prev > PEAK && t - S.lastPeak > REFRACTORY) {
    const dt = t - S.lastPeak;
    if (S.lastPeak && dt >= MIN_IV && dt <= MAX_IV) { S.iv.push(dt); if (S.iv.length > 6) S.iv.shift(); }
    else S.iv.length = 0;
    S.lastPeak = t; S.count++;
  }
  S.wasRising = rising; S.prev = s;
}

export function gait(now = performance.now(), stepLen = 0.7) {
  const walking = S.iv.length >= 3 && now - S.lastPeak < 1500;
  const sorted = [...S.iv].sort((a, b) => a - b);
  const med = sorted.length ? sorted[sorted.length >> 1] : 0;
  const cadenceHz = walking ? 1000 / med : 0;
  const mean = S.iv.reduce((a, b) => a + b, 0) / (S.iv.length || 1);
  const cv = Math.sqrt(S.iv.reduce((a, b) => a + (b - mean) ** 2, 0) / (S.iv.length || 1)) / (mean || 1);
  return { walking, cadenceHz, stepCount: S.count, speedMps: cadenceHz * stepLen, regularity: 1 - Math.min(1, cv) };
}
```

### Gyro ego-rotation and box prediction

```js
let rot = { x: 0, y: 0, z: 0 }, lastT = null;
function gyroUpdate(r, t, intervalMs) {
  if (!r || r.alpha == null) return;
  const dt = (lastT ? t - lastT : intervalMs) / 1000; lastT = t;
  rot.x += r.alpha * dt; // rate about device x (pitch)
  rot.y += r.beta * dt;  // about y (yaw)
  rot.z += r.gamma * dt; // about z (roll)
}
export function takeEgoRotation() { const o = rot; rot = { x: 0, y: 0, z: 0 }; return o; } // once per processed frame

// Signs: set by a five-minute test per OS (pan right, a static object moves left in the image).
const SX = 1, SY = 1, SZ = 1;
export function predictBox(box, ego, fPx, W, H) {
  const d2r = Math.PI / 180;
  const du = SX * fPx * Math.tan(ego.y * d2r); // yaw to horizontal shift
  const dv = SY * fPx * Math.tan(ego.x * d2r); // pitch to vertical shift
  const dr = SZ * ego.z * d2r;                 // roll about the principal point
  const rx = box.cx - W / 2, ry = box.cy - H / 2;
  return { cx: W / 2 + rx * Math.cos(dr) - ry * Math.sin(dr) + du,
           cy: H / 2 + rx * Math.sin(dr) + ry * Math.cos(dr) + dv, w: box.w, h: box.h };
}
```

Confirmation is then `iou(predictBox(prev, takeEgoRotation(), fPx, W, H), det) > 0.3`. This is the small-angle form of the rotation homography, good to about 15 degrees per frame interval.

## Pitfalls

1. iOS permission works only from a user gesture over HTTPS and is not persisted across reloads. Some iOS versions returned null `rotationRate` after grant; feature-detect per event and fall back to `deviceorientation` for pitch.
2. iOS and Chrome Android report `accelerationIncludingGravity` with opposite signs. Calibrate signs on both test phones in the first hour and keep them in one constant.
3. Euler angles hit gimbal lock when the phone is vertical; the gravity vector avoids it.
4. `deviceorientation.alpha` is relative on Chrome and drifts; never use it for anything time-critical.
5. Sensors deliver only to visible, focused pages. Hold the wake lock and re-acquire on `visibilitychange`.
6. Both platforms cap at 60 Hz; use event timestamps, not a constant dt.
7. Motion timestamps are DOM time; video frames carry media time. Integrating between your own frame-processing calls is good enough at 10 to 15 fps.
8. Hand-held step detection is harder than in-pocket: arm swing and damping change the amplitude. Use the magnitude signal and gate on cadence regularity.

## Libraries

No dependency is needed; the snippets above are the practical route. If a fused attitude is wanted later: [ahrs](https://github.com/psiphi75/ahrs) (Apache-2.0, Madgwick and Mahony). [gyronorm.js](https://github.com/dorukeker/gyronorm.js) is MIT but unmaintained. [Full-Tilt](https://github.com/richtr/Full-Tilt) is CC BY-NC 4.0, non-commercial, so avoid shipping it. OpenCV.js is Apache-2.0 but 6 to 8 MB and not worth loading for this.

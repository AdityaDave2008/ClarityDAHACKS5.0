# Backend API v1

This document specifies the backend for the camera prototype. The browser sample in `frontend/` and native examples in `samples/` capture frames, draw detections, and deliver notifications. The backend recognizes supported object categories and makes per-session alert decisions. It does not operate the phone's camera, sound, vibration, or speech. See [the sample guide](../samples/README.md) for launch instructions; hosting setup is separate.

All paths below are relative to the backend origin. JSON request bodies use `Content-Type: application/json`. Frame uploads use the raw image bytes described below. Session IDs are secret bearer capabilities: anyone who knows an ID can submit frames, change its preferences, or delete that session. Keep them private. Sessions do not provide user accounts or login.

The default local origin is `http://127.0.0.1:3001`; `HOST` and `PORT` configure it. Responses include `Cache-Control: no-store`.

## Frontend flow

1. Check `GET /ready` before starting detection.
2. Create a session with the person's notification preferences.
3. After camera permission and a Start action, capture a small JPEG or PNG frame.
4. Send one frame request and wait for its response before capturing another frame for upload.
5. Render detections and, when `alert.triggered` is `true`, deliver the requested supported notification modes.
6. On Stop or when the page is hidden, stop capturing/uploading. Delete the session when leaving the scanning flow.

Downsample camera images on the client before uploading; approximately 640 pixels wide is a starting point. Measure the complete capture/upload/inference cycle on the demo phone before choosing the sampling interval. There is no queue of frames to replay after a slow request.

## Health and model readiness

| Request | Meaning | Success | Unavailable |
| --- | --- | --- | --- |
| `GET /health` | The HTTP process is alive | `200` | Connection failure if the process is down |
| `GET /ready` | The detector is ready for frames | `200` | `503` while loading or after model initialization failure |
| `GET /api/v1/model` | Detector identity, supported categories, and detection configuration | `200` | Inspect model readiness before submitting frames |

Liveness does not imply that the detector has finished loading. Keep the frontend's Start state separate from its model-loading state.

`GET /health` returns `{"status":"ok"}`. Readiness returns `{"ready":true,"modelState":"ready"}` with `200`, or `{"ready":false,"modelState":"loading"}` / `{"ready":false,"modelState":"error"}` with `503`.

The model is a pretrained COCO-SSD object detector running with TensorFlow.js in a WebAssembly-accelerated CPU worker. The application does not train a custom model during a request. It can recognize only its supported object labels. Examples include people, bicycles, cars, chairs, backpacks, and suitcases. There is no generic "every obstacle" class. Curbs, stairs, potholes, construction cones, and barriers do not have dedicated categories in this model.

Model confidence is a classification score, not a measure of physical distance or the probability that a route is safe. A detection in the marked image zone is a heuristic for the prototype; camera orientation and the object’s position in the image affect it.

`GET /api/v1/model` returns:

```json
{
  "name": "coco-ssd",
  "base": "lite_mobilenet_v2",
  "runtime": "tensorflowjs-wasm",
  "state": "ready",
  "supportedLabels": [
    "person", "bicycle", "car", "motorcycle", "bus", "truck",
    "bench", "cat", "dog", "backpack", "handbag", "suitcase",
    "bottle", "cup", "chair", "potted plant"
  ],
  "zone": [
    {"x": 0.38, "y": 0.42},
    {"x": 0.62, "y": 0.42},
    {"x": 0.95, "y": 1},
    {"x": 0.05, "y": 1}
  ],
  "limits": {
    "maxFrameBytes": 1048576,
    "maxImagePixels": 1000000,
    "maxImageSide": 1280,
    "processedMaxSide": 640
  },
  "limitations": ["Model scores do not measure distance or establish safety."]
}
```

The `limitations` example is shortened. Display the service's actual limitation text where appropriate. `state` is `loading`, `ready`, or `error`. Draw the returned `zone` rather than hard-coding a different frontend corridor. `supportedLabels` is the set used by this prototype's alert policy; the underlying COCO model contains additional classes.

## Sessions and notification preferences

### Create a session

`POST /api/v1/sessions`

A JSON object body is required. Send `{}` to accept all standard defaults; do not omit the body. Unknown fields are rejected.

```json
{
  "preset": "standard",
  "preferences": {
    "alertModes": ["sound"],
    "confidenceThreshold": 0.6,
    "cooldownMs": 3000
  }
}
```

`preset` accepts `standard` or `accessibility` and defaults to `standard` when omitted. The standard preset defaults to sound, and the accessibility preset defaults to speech. Both are editable starting points; the app does not ask a person to identify or prove a disability. Explicit `preferences` override preset defaults.

| Preference | Meaning | Default |
| --- | --- | --- |
| `alertModes` | Zero to three unique modes from `sound`, `vibration`, `speech`; `[]` means visual feedback only | `sound` for standard; `speech` for accessibility |
| `confidenceThreshold` | Minimum model classification score considered by alert logic; from `0.4` to `0.95`, inclusive | `0.6` |
| `cooldownMs` | Integer cooldown between emitted alerts for this session; from `1000` to `10000`, inclusive | `3000` |

Use the returned session ID in subsequent routes. By default, sessions expire after 30 minutes of inactivity and the backend holds at most 200 sessions. `SESSION_TTL_MS` and `MAX_SESSIONS` can configure those limits. State is held in memory and sessions are lost on process restart. Create a new session if a previous session returns `404`.

Success returns `201`. The creation response includes the effective preferences:

```json
{
  "sessionId": "opaque-generated-session-id",
  "preset": "standard",
  "preferences": {
    "alertModes": ["sound"],
    "confidenceThreshold": 0.6,
    "cooldownMs": 3000
  },
  "expiresAt": "2026-10-16T20:30:00.000Z"
}
```

The ID and expiry above are illustrative. Use the values returned by the service.

### Change preferences

`PATCH /api/v1/sessions/:sessionId/preferences`

Send a nonempty object containing the preferences being changed, directly at the top level rather than under a `preferences` wrapper. Unknown fields are rejected:

```json
{
  "alertModes": ["speech", "vibration"],
  "cooldownMs": 4000
}
```

Success returns `200` with the same session envelope as creation. Changing preferences resets that session's alert history, including confirmation and cooldown, but does not reset its frame sequence. If preferences change while a frame is in flight, that frame returns `409` with code `SESSION_CHANGED` instead of emitting an alert based on old preferences. Do not update preferences during every frame request.

The browser must feature-detect requested notification capabilities and provide a visible fallback. The response describes the user's requested modes; it cannot guarantee a device supports them or that a browser will play audio without prior interaction.

### End a session

`DELETE /api/v1/sessions/:sessionId`

Success returns `204` with no response body. Delete a session when the scanning flow ends. A deleted, expired, or unknown session cannot accept frames. Session state is isolated: changing one person's preferences or triggering their cooldown does not change another session.

## Submit a frame

`POST /api/v1/sessions/:sessionId/frames`

Send the JPEG or PNG as the request body, not as multipart form data or a base64 JSON field.

| Header | Required | Value |
| --- | --- | --- |
| `Content-Type` | Yes | `image/jpeg` or `image/png` |
| `X-Frame-Sequence` | Yes | Positive decimal integer of at most 15 digits, without leading zeros, increasing for each submitted frame in this session |

The first sequence can be `1`. Increment the sequence before every new upload attempt; gaps are allowed. Do not assume a failed upload leaves the previous sequence reusable. Stale or repeated sequence values receive `409`.

Do not apply HTTP content compression to the upload. Omit `Content-Encoding` or use `identity`; other values receive `415`. Image compression within a JPEG or PNG file is expected.

### Image limits

- Compressed request body: at most 1 MiB, or 1,048,576 bytes.
- Source image: at most 1,280 pixels on either side and 1,000,000 total pixels.
- Valid decodable JPEG or PNG content is required, regardless of the declared media type.
- The actual image format must match `Content-Type`. Animated/multiple-page images are rejected.
- The backend applies image orientation, then resizes to fit within 640 × 640 without enlarging small images.
- The response's `frame.width` and `frame.height` describe that processed image, after orientation and resizing.

Only one model inference runs at a time globally. If another frame is being processed, the backend returns `429` with a busy response instead of accumulating a backlog. There is also at most one in-flight frame per session. `429` responses include `Retry-After: 1`, which the frontend can read across origins. Wait before retrying and capture a fresh frame; a delayed old image is less useful for a live demo.

### Successful result

```json
{
  "frame": {
    "sequence": 12,
    "width": 480,
    "height": 640
  },
  "detections": [
    {
      "label": "backpack",
      "confidence": 0.89,
      "bbox": {
        "x": 0.35,
        "y": 0.42,
        "width": 0.28,
        "height": 0.4
      },
      "anchor": {
        "x": 0.49,
        "y": 0.82
      },
      "inZone": true
    }
  ],
  "alert": {
    "triggered": true,
    "reason": "triggered",
    "modalities": ["sound"],
    "message": "Object in camera zone. Check your surroundings.",
    "cooldownRemainingMs": 3000
  },
  "processingMs": 240
}
```

The image and timing above are illustrative; they are not a measured latency claim.

| Response field | Meaning |
| --- | --- |
| `frame.sequence` | Echo of the accepted sequence |
| `frame.width`, `frame.height` | Processed image dimensions |
| `detections` | Model detections retained by the supported-label allowlist and session confidence threshold, mapped into the processed image |
| `label` | Supported model class label |
| `confidence` | Model score from 0 to 1 |
| `bbox` | Normalized top-left position and size: `{x, y, width, height}` |
| `anchor` | Bottom-center of the bounding box, normalized to the image |
| `inZone` | Whether the anchor lies inside or on the boundary of the returned zone polygon |
| `alert.triggered` | Whether this response requests an alert now |
| `alert.reason` | `no_candidate`, `confirming`, `cooldown`, or `triggered` |
| `alert.modalities` | Selected notification modes only when triggered; otherwise `[]` |
| `alert.message` | Generic notification text only when triggered; otherwise `null` |
| `alert.cooldownRemainingMs` | Remaining cooldown, measured by the backend |
| `surface` | Latest walking-surface summary for this session, or `null` (see below) |
| `processingMs` | Backend processing duration; excludes client capture and network time |

Coordinates start at the top-left: `x` increases to the right and `y` increases downward. All positions and dimensions are normalized to the processed image. For a 480-pixel-wide processed image, `bbox.x = 0.35` corresponds to 168 pixels. Account for the video element's `object-fit` crop when drawing the overlay. Do not mirror the box independently of the displayed camera image.

`detections: []` means the model returned no retained detections for this frame. A model or decoder failure is an error response, not an empty successful detection list. No alert does not establish that the path is clear.

### Alert decisions

A candidate must use one of `supportedLabels`, meet the session's confidence threshold, and have its bottom-center anchor inside or on the boundary of the image zone. The bottom edge is included, so an object clipped by the bottom of the image can still qualify. Confirmation requires two nearby detections of the same label: their normalized box centers must be less than `0.18` apart, with at most `2500` ms between frames. This is a lightweight temporal check, not persistent tracking or a distance estimate.

| `alert.reason` | Meaning | `triggered` |
| --- | --- | --- |
| `no_candidate` | No qualifying object in the zone; `message` is `null` | `false` |
| `confirming` | Qualifying object needs a matching observation | `false` |
| `cooldown` | A confirmed object is present but the previous alert's cooldown is active | `false` |
| `triggered` | A confirmed object is present and this session can issue an alert | `true` |

Cooldown and confirmation state belong to the session and use backend processing-completion time, not a timestamp supplied by the camera. A missing candidate or a frame that fails after being accepted for processing breaks the confirmation streak. An object that remains confirmed can trigger again after cooldown expires. Resetting preferences resets that history. The frontend should not infer trigger state from the presence of a box alone.

### Surface hazards (optional second model)

When the backend's surface model is enabled and ready (`GET /api/v1/model` → `surface.state`), frame responses include a `surface` object. A SegFormer-b0 model trained on ADE20K labels every pixel, and the backend summarizes the pixels inside the zone polygon:

```json
"surface": {
  "sequence": 11,
  "walkableRatio": 0.42,
  "hazards": [{ "label": "wall", "ratio": 0.51 }, { "label": "pole", "ratio": 0.06 }],
  "warning": { "label": "wall", "ratio": 0.51 }
}
```

| Field | Meaning |
| --- | --- |
| `sequence` | The frame this result was computed from. Segmentation runs alongside object detection without blocking it, so it usually trails the current frame by one or two. Results more than 5 frames old are omitted (`surface: null`). |
| `walkableRatio` | Share of zone pixels labeled floor, road, sidewalk, path, grass, earth, rug, and similar |
| `hazards` | Hazard labels covering at least 5% of the zone, largest first. Labels come from `surface.hazardLabels` (wall, fence, railing, pole, column, stairs, stairway, step, door, and others). |
| `warning` | The first hazard over its threshold (25% of the zone, or 12% for stairs, steps, and escalators), else `null` |

`surface` is `null` when the model is disabled, still loading, failed, or has not finished a frame for this session yet. It does not affect `alert`: confirmation and cooldown for surface warnings are the frontend's job (the sample requires the same label on two different `surface.sequence` values). Ratios are image area, not distance. The labels are frequently wrong on unusual surfaces, and the model cannot measure a curb's height or a drop-off.

### Browser upload example

```js
let sequence = 0;

async function analyzeFrame(apiBase, sessionId, imageBlob) {
  sequence += 1;
  const response = await fetch(
    `${apiBase}/api/v1/sessions/${encodeURIComponent(sessionId)}/frames`,
    {
      method: "POST",
      headers: {
        "Content-Type": imageBlob.type,
        "X-Frame-Sequence": String(sequence)
      },
      body: imageBlob
    }
  );

  if (!response.ok) {
    // Distinguish expired session, busy detector, and model/network failure.
    throw new Error(`Frame request failed: ${response.status}`);
  }

  return response.json();
}
```

Serialize calls to this function. Render every returned detection result, but play notifications only when `result.alert.triggered` is true. Clear stale boxes and show a connection or model status when a request fails.

## Error handling

| HTTP status | Likely cause | Frontend action |
| --- | --- | --- |
| `400` | Missing/invalid sequence, invalid preferences, malformed image | Correct the request; show a recoverable input state |
| `403` | Request has an unapproved browser origin | Configure the exact frontend origin in `ALLOWED_ORIGINS` |
| `404` | Unknown or expired session | Create a new session and restart its frame sequence |
| `409` | Stale sequence, preferences changed during analysis, or cancelled request | Use a fresh frame with a higher sequence and current preferences |
| `413` | Body, dimensions, or pixel count exceed limits | Downsample and encode the next frame smaller |
| `415` | Unsupported/mismatched media type, animated image, or HTTP content compression | Encode a still JPEG or PNG and set the matching type |
| `429` | Inference worker or session is busy, or session capacity is reached | Back off; avoid parallel uploads |
| `503` | Model is not ready, unavailable, or inference failed | Check readiness and show loading/error status; a worker error may require a server restart |
| `5xx` | Unexpected backend or model execution failure | Show failure and let the person retry; do not interpret as clear space |

Errors use this envelope:

```json
{
  "error": {
    "code": "SESSION_CHANGED",
    "message": "Preferences changed while the frame was processing. Capture a fresh frame."
  }
}
```

The code above illustrates the in-flight preference conflict (`409`). Readiness is a status endpoint with the dedicated `ready` / `modelState` response described above. An expired, deleted, or unknown session returns `404`.

Codes useful for client handling include:

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` / `INVALID_REQUEST` | `400` | Invalid fields or an unreadable request body |
| `INVALID_IMAGE` | `400` | Empty or undecodable image |
| `ORIGIN_NOT_ALLOWED` | `403` | Browser origin is not configured |
| `SESSION_NOT_FOUND` / `NOT_FOUND` | `404` | Session missing/expired or endpoint absent |
| `STALE_FRAME` | `409` | Sequence has already been accepted or is older |
| `SESSION_CHANGED` | `409` | Preferences changed during analysis |
| `FRAME_CANCELLED` | `409` | Request cancelled before alert state was updated |
| `FRAME_TOO_LARGE` / `IMAGE_TOO_LARGE` | `413` | Byte, side, or pixel limit exceeded |
| `UNSUPPORTED_MEDIA_TYPE` / `UNSUPPORTED_IMAGE_TYPE` | `415` | Unsupported request type |
| `IMAGE_TYPE_MISMATCH` / `ANIMATED_IMAGE` / `UNSUPPORTED_ENCODING` | `415` | Format mismatch, animation, or HTTP content compression |
| `DETECTOR_BUSY` / `SESSION_CAPACITY` | `429` | Inference slot or session capacity unavailable |
| `MODEL_NOT_READY` / `MODEL_UNAVAILABLE` / `INFERENCE_FAILED` | `503` | Model startup, worker, or analysis failure |
| `INTERNAL_ERROR` | `500` | Unexpected backend failure |

## Data handling and deployment

Camera frames are processed for the request and are not saved by this backend. Session preferences and alert history are transient in-memory data. Do not put frame contents into logs, analytics, issue reports, or third-party error payloads.

Use the configured frontend origin for CORS. `ALLOWED_ORIGINS` takes comma-separated exact HTTP(S) origins, without a trailing slash, path, or wildcard. Its defaults are `http://localhost:5173` and `http://127.0.0.1:5173`. Requests without an `Origin` header, such as local command-line requests, are allowed; CORS is not authentication. Browser credentials are not used.

The custom sequence header and image media type can cause a browser preflight request; ensure deployment forwards `OPTIONS` requests. Allowed request headers are `Content-Type` and `X-Frame-Sequence`. Prefer one HTTPS origin for the installable frontend and backend where deployment permits it.

Home-screen installation, camera permission, foreground lifecycle, and delivery of each notification mode belong to the frontend. This API provides no background-camera capability, route guidance, community reports, metric distance estimates, or guarantee of detecting every hazard.


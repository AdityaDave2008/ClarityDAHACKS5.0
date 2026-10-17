# Backend

Owner: Yash, as recorded in [team ownership](../docs/team.md).

A backend for the team's installable mobile website: upload a camera frame, detect supported object categories, and return a session-specific alert decision. The frontend owns the camera, home-screen installation, overlays, and sound/vibration/speech playback.

## Run locally

Use **Node.js 24 or newer**. Run these commands from the repository's `backend/` directory.

```sh
npm ci
cp .env.example .env
npm run dev
```

The API starts at `http://127.0.0.1:3001`. `GET /health` checks the HTTP process; `GET /ready` returns `503` until the real model has loaded. The model downloads provider-hosted weights on startup, so server network access is required. Check `/api/v1/model` for supported labels, limits, and readiness.

```sh
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/ready
curl -X POST http://127.0.0.1:3001/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"preset":"accessibility","preferences":{"alertModes":["speech","sound"]}}'
```

Use the returned `sessionId` in the next request:

```sh
curl -X POST http://127.0.0.1:3001/api/v1/sessions/SESSION_ID/frames \
  -H 'Content-Type: image/jpeg' \
  -H 'X-Frame-Sequence: 1' \
  --data-binary @small-photo.jpg
```

Two nearby, same-category detections in the marked image zone can trigger an alert. Each new frame attempt must have a higher sequence number. Send only one frame at a time. No result means no alert triggered, not a verified clear path.

## Frontend handoff

- [Exact API and fetch examples](../docs/api.md)
- [iPhone/Android PWA capabilities and integration](../docs/PWA_INTEGRATION.md)
- [Team responsibilities and milestones](../docs/BACKEND_TEAM_PLAN.md)
- [Model/library attribution](../ATTRIBUTION.md)
- [Completed validation and remaining phone checks](../docs/VALIDATION.md)

Choose the optional `standard` or `accessibility` preset, then edit individual notification preferences. A person does not need to disclose a disability. On iPhone, plan for sound/spoken alerts; vibration needs browser feature detection and actual-device testing.

The live frontend must use HTTPS for camera access, and its API must also use HTTPS. Add the frontend's exact origin to `ALLOWED_ORIGINS`. A home-screen PWA stays a foreground web app; installation does not enable background camera scanning.

## What is implemented

- Fastify HTTP API with strict input schemas and explicit CORS origins.
- Bounded JPEG/PNG decoding and orientation/resize handling with sharp.
- Real TensorFlow.js COCO-SSD inference in a dedicated worker, accelerated by WebAssembly/SIMD where available.
- Normalized bounding boxes, a shared image-zone polygon, two-frame confirmation, and cooldowns.
- Isolated, expiring in-memory sessions with customizable sound/vibration/speech choices.
- Ordered frame handling, busy responses instead of a frame backlog, and Stop/preferences-change race protection.
- Separate liveness/readiness and structured error responses.
- Optional SegFormer-b0 (ADE20K) surface segmentation in a second worker via onnxruntime-web, summarizing walls, poles, stairs, and walkable floor inside the zone. It runs without blocking object detection and never fails a frame; set `SURFACE_MODEL=off` to disable it. The 4.4 MB quantized model is downloaded once into `backend/.cache/segformer/` from a pinned Hugging Face revision.

There is no database, user account system, community reporting, route recommendation, or frontend UI in this backend starter. Sessions and preferences are lost when the process restarts. Run **one backend process/instance** for this MVP; multiple replicas need shared session state or sticky routing.

## Verify

```sh
npm run check
npm test
npm run smoke:model -- /absolute/path/to/small-photo.jpg
```

Automated API tests inject a test-only detector to exercise errors and concurrency without network/model downloads. The smoke command uses the real model through the HTTP handler and prints detections and server processing time. Use a real photo of a supported object, at most 1 MiB, 1 MP, and 1280 pixels per side. A server timing excludes phone capture, upload, and return latency.

## Model scope and demo

Try a backpack, chair, or suitcase in a controlled, stationary demo. COCO-SSD does not have dedicated categories for curbs, potholes, stairs, construction cones, or construction barriers. The optional surface model labels walls, poles, fences, and stairs as image regions, but it is not validated outdoors and cannot detect curb height or drop-offs. Detecting those requires additional attributed data and validation. Image-space location does not establish ground contact, physical distance, or collision risk. This is an experimental alert prototype, not validated navigation assistance.

CPU inference and network latency must be measured on the actual demo setup before choosing a capture rate. Browser-local inference is a future option if upload latency is too high.

## Data and deployment

Frames are sent to **your backend**, processed in memory, and discarded; this server saves no frame images. Session IDs are private bearer capabilities, so anyone with an ID can use or change that session. The service disables automatic request logging to avoid logging IDs/frames. Do not add image payloads to proxy logs or analytics.

The default server binds to loopback. A deployment host can set `HOST=0.0.0.0`, `PORT`, and `ALLOWED_ORIGINS` using the environment. Terminate TLS at the hosting proxy. CORS is a browser policy, not server authentication. A public deployment should use the hosting provider's access controls and appropriate quotas for the demo.

All repository changes are local for review; no hosting or GitHub publication is part of this backend implementation.

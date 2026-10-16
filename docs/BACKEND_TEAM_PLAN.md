# Backend work and frontend handoff

The implemented backend lives in `backend/` within the team's shared scaffold. Frontend development and hosting remain team integration work. The MVP receives a camera frame, detects supported object categories, and returns an alert decision. The intended browser client displays the live camera and plays the user's selected notifications. The camera page stays open during scanning. Use [the API contract](api.md) as the frontend handoff and [team ownership and workflow](team.md) as the source for responsibilities.

## Work ownership

| Owner | Deliverable | Can proceed independently with |
| --- | --- | --- |
| Backend: Yash | HTTP API, model loading, image validation, session preferences, alert logic, backend tests | API contract, detector interface, local sample images |
| Frontend: design-focused | User flow, shared components, styling, accessibility, detection overlay and notification feedback | API response examples, zone geometry, supported alert modes |
| Frontend: newer developer | Scoped camera/control screens, preference forms, API integration, loading and failure states | API request examples and shared frontend components |
| QA/QC | Acceptance criteria, end-to-end checks, bug triage, release verification | API contract, agreed demo flow, [acceptance checklist](../tests/e2e/README.md) |
| DevOps | Environments, HTTPS deployment, CI, operational logs and recovery | Backend commands below and [deployment checklist](../infra/README.md) |

These are responsibilities, not exclusive permissions; everyone tests their changes. Keep each pull request small and agree on request and response shapes before connecting the frontend. Assign the scope owner, demo/submission owner, and integration coordinator from the existing team and record them in [team.md](team.md).

## Backend commands

Use Node.js 24 or newer. Run backend installation and development from the repository root as follows:

```sh
cd backend
npm ci
npm run dev
```

The API defaults to `http://127.0.0.1:3001`. If local overrides are needed, create `backend/.env` from `backend/.env.example` and keep it uncommitted. The backend reads that file from its working directory. Use `npm start` from `backend/` to start without watch mode.

Run checks from the same `backend/` directory:

```sh
npm run check
npm test
npm run smoke:model -- /absolute/path/to/a-small-photo.jpg
```

The smoke command uses the real model and a local JPEG or PNG that meets the API's image limits. It requires access to the model assets during initialization. Use a supported object in the marked image zone when checking the complete alert flow. Backend tests and scripts remain inside `backend/`; cross-app acceptance work belongs in `tests/e2e/`. This MVP has no database migrations or seed command. See [the backend README](../backend/README.md) for the complete setup and runtime configuration.

## Milestones

### 1. Boot and agree on the contract

- Yash starts the API from `backend/` using the commands above.
- Check health and model status independently: a running API can still be loading its model.
- Give the frontend the API base URL (locally `http://127.0.0.1:3001`), session creation example, raw frame upload example, and example error.
- DevOps agrees on the deployment target and HTTPS origin used by the phone, including frontend CORS configuration.

**Done when:** both frontend developers can call the health endpoint and create their own sessions.

### 2. Prove real detection

- Yash loads the selected pretrained detector once per server process.
- Submit a known sample image and inspect class labels, scores, and box alignment.
- Reject invalid or oversized images before model inference.
- Time model startup and a frame request on the actual demo machine.
- QA/QC records the expected supported-object result and failure cases in the acceptance checklist.

**Done when:** a real image produces model detections through the HTTP endpoint. Test fixtures and stub detectors remain confined to tests.

### 3. Connect the alert loop

- Capture a forward-facing frame in the browser and upload it with the session ID.
- Convert normalized boxes to the displayed video's coordinates, including any cropping or mirroring.
- Draw the same corridor used by the server so the person holding the phone understands what is being evaluated.
- Trigger local sound, vibration, or speech only when `alert.triggered` is true, using supported modes from `alert.modalities`; respect `[]` as visual feedback only.
- Send the next frame after the previous request finishes. Stop uploading when the user stops scanning or the page is hidden.
- QA/QC checks the integrated flow, and DevOps verifies it on the deployed HTTPS origins.

**Done when:** a supported object confirmed in the marked image zone causes an alert, remaining in view does not cause an alert on every frame, and separate sessions do not share cooldown state. Keep accepted frames within 2.5 seconds of each other for two-frame confirmation.

### 4. Rehearse and submit

- Rehearse with the physical object, phone, network, and camera angle used in the presentation.
- QA/QC checks the empty scene, object outside the corridor, object inside it, stop/restart, disconnected network, and unavailable model states; every developer also checks their own changes.
- Keep a short recording of the real system as a backup to a live demonstration.
- The assigned demo/submission owner records setup steps, model/library attribution, known limits, repository URL, demo URL, and video URL for Devpost using [the submission checklist](demo.md).
- Leave time before the submission deadline to verify every judge-facing link from a signed-out browser.

**Done when:** another teammate can follow the README to run the backend and explain the result without assistance.

## Decisions that keep the MVP small

- No user accounts, disability declaration, database, route planning, community reporting, or background camera service.
- Offer notification preferences directly. An optional accessibility preset can choose defaults; each choice must remain editable.
- Keep session state in memory. Restarting the backend starts fresh sessions.
- Treat session IDs as private bearer capabilities. Anyone with an ID can use or reset that session; keep IDs out of shared screenshots and analytics.
- Detect the categories supported by the selected model. Construction conditions, potholes, curbs, stairs, and unknown objects require their own data and validation; do not imply that the model recognizes them.
- Explain that confidence is a model classification score. It is not the probability that walking is safe or that an object is at a particular distance.
- Base the demo on supported object categories and a visible, simple corridor. Do not describe camera-frame overlap as measurement of the walking path.

## Frontend integration checklist

- Use the same HTTPS backend origin or configure the exact frontend origin in `ALLOWED_ORIGINS`, without a path, trailing slash, or wildcard.
- Create sessions with a JSON object body (`{}` uses defaults). Submit frames as raw JPEG or PNG bytes with an increasing `X-Frame-Sequence` header.
- Handle `429` by honoring `Retry-After: 1` and sending a fresh frame after the wait. Allow only one request at a time.
- Keep frame sequence increasing after a preference update; create a new sequence only for a new session. An in-flight preference change returns `409` rather than a stale alert.
- Request camera access only after a user action and show a clear recovery state when permission is denied.
- Prefer the outward-facing camera and let the user correct the selection.
- Feature-detect notification capabilities and provide a visible fallback when a requested mode is unavailable.
- Unlock browser audio through the user's Start action and provide an alert test button.
- Keep the screen awake only if supported and requested while scanning.
- Keep photos off analytics and application logs. Do not add frame storage to the demo.


# DAHacks26

Team project for De Anza Hacks 5.0, October 16–17, 2026.

[Devpost](https://dahacks5.devpost.com/) · [Rules](https://dahacks5.devpost.com/rules) · [Schedule](https://dahacks5.devpost.com/details/dates)

## Start here

Clarity is a camera-based obstacle alert prototype. **Prototype 1 — Alpha (α)** combines the website/browser frontend and native samples. The browser in `frontend/` uses the Node.js/Fastify detection backend in `backend/`. The iPhone sample in `samples/ios/` uses packaged offline object detection, with optional LiDAR depth estimation. An Android example also remains in `samples/`.

See [Alpha architecture, verification, and limitations](docs/PROTOTYPE_1_ALPHA.md) and [the sample guide](samples/README.md). Backend account features are planned architecture rather than an implemented account system. The native iPhone scanner does not upload camera or LiDAR data.

## Try the browser sample

```sh
npm --prefix backend ci
npm run demo
```

Open **http://localhost:5180** for the integrated website and browser camera flow. Browser camera frames use backend detection only after Start. For the offline iPhone app and its floating-window behavior, follow [native setup and limitations](samples/ios/README.md). Background native object alerts are not guaranteed. The Android example uses a camera foreground service for app switching and still needs an Android build/device check.

For iPhone Safari, see [launching over HTTPS](docs/PHONE_LAUNCH.md). [Related projects and tutorials](docs/RELATED_PROJECTS.md) collect the useful GitHub, YouTube, and Instructables references.

## Team workflow

1. Read [team ownership and workflow](docs/team.md).
2. Agree on one core user journey and record acceptance criteria in [the QA checklist](tests/e2e/README.md).
3. Agree on API examples in [the API contract](docs/api.md) before parallel implementation.
4. Add actual install, run, and test commands to the frontend and backend READMEs when selecting the stack.
5. Deploy one end-to-end flow early using [the deployment checklist](infra/README.md).

## Run the backend

```sh
cd backend
npm ci
cp .env.example .env
npm run dev
```

The API defaults to `http://127.0.0.1:3001`. `/health` checks liveness and `/ready` reports model readiness. See [backend setup and limitations](backend/README.md), [the API contract](docs/api.md), and [PWA integration notes](docs/PWA_INTEGRATION.md).

## Layout

| Path | Purpose |
| --- | --- |
| `backend/` | API, business logic, database migrations, backend tests |
| `frontend/` | One shared app, design system, screens, frontend tests |
| `samples/` | Native iPhone/Android apps and a guide to trying all three samples |
| `tests/e2e/` | Cross-app acceptance and regression checks |
| `infra/` | Deployment configuration and runbook |
| `docs/` | API agreement, roles, demo and submission |
| `.github/` | Pull request checklist |

## Submission

Deadline: **October 17, 2026 at 2:00 PM PDT**. Follow [the demo and submission checklist](docs/demo.md). Published eligibility and team-size wording conflicts between Devpost pages, so confirm eligibility with organizers.

Never commit credentials, personal data, or local environment files. Attribute existing code, libraries, assets, and tools.

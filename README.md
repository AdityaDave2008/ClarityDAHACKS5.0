# DAHacks26

Team project for De Anza Hacks 5.0, October 16–17, 2026.

[Devpost](https://dahacks5.devpost.com/) · [Rules](https://dahacks5.devpost.com/rules) · [Schedule](https://dahacks5.devpost.com/details/dates)

## Start here

This repository contains the team structure, not a runnable application yet. Frameworks and the product idea have not been selected in this scaffold.

1. Read [team ownership and workflow](docs/team.md).
2. Agree on one core user journey and record acceptance criteria in [the QA checklist](tests/e2e/README.md).
3. Agree on API examples in [the API contract](docs/api.md) before parallel implementation.
4. Add actual install, run, and test commands to the frontend and backend READMEs when selecting the stack.
5. Deploy one end-to-end flow early using [the deployment checklist](infra/README.md).

## Layout

| Path | Purpose |
| --- | --- |
| `backend/` | API, business logic, database migrations, backend tests |
| `frontend/` | One shared app, design system, screens, frontend tests |
| `tests/e2e/` | Cross-app acceptance and regression checks |
| `infra/` | Deployment configuration and runbook |
| `docs/` | API agreement, roles, demo and submission |
| `.github/` | Pull request checklist |

## Submission

Deadline: **October 17, 2026 at 2:00 PM PDT**. Follow [the demo and submission checklist](docs/demo.md). Published eligibility and team-size wording conflicts between Devpost pages, so confirm eligibility with organizers.

Never commit credentials, personal data, or local environment files. Attribute existing code, libraries, assets, and tools.

# Team ownership and workflow

| Role | Owns |
| --- | --- |
| Backend: Yash | API, data model, validation, backend tests |
| Frontend: design-focused | User flow, styling, shared components, accessibility |
| Frontend: newer developer | Scoped screens, forms, integration, UI states |
| QA/QC | Acceptance checks, end-to-end testing, bug triage, release verification |
| DevOps | CI after stack selection, deployments, environments, logs and recovery |

These are responsibilities, not exclusive permissions. Every developer tests their changes. QA is not the only quality owner.

## Assign at kickoff

Choose one existing member as scope owner, one as demo/submission owner, and one as integration coordinator. Record their names here when agreed. The scope owner protects one core user journey and cuts nonessential features. The submission owner tracks Devpost and demo materials. The integration coordinator keeps frontend/backend changes compatible.

## Working agreement

- Keep `main` demoable. Use short-lived `feat/…`, `fix/…`, or `docs/…` branches.
- Open small PRs with one teammate reviewing before merge. This is a team agreement, not configured branch protection.
- Agree who edits shared files. Do not force-push shared history.
- Agree on API examples before frontend/backend work diverges.
- Use issues for tasks with one owner, acceptance criteria, and a priority: must-have or optional.
- Integrate frequently and get a deployed vertical slice working early.
- Reserve the final hour for regression testing, demo recording, and submission.
- Never commit secrets. Share credentials through an appropriate private channel or platform secret store.

## Definition of done

The agreed user behavior works, relevant tests/checks pass, loading and failure cases are handled, setup changes are documented, and the deployed demo still works.

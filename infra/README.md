# Deployment runbook

Owner: DevOps. No hosting service or deployment workflow has been configured by this scaffold.

## First deployment

- [ ] Agree on hosting and runtime after stack selection.
- [ ] Record build/start commands, public URL, and health-check path here.
- [ ] Store secrets in the hosting platform, never in Git or frontend bundles.
- [ ] Document required environment-variable names with safe `.env.example` files.
- [ ] Configure frontend API URL and intended backend CORS origins.
- [ ] Apply migrations and safe seed data if a database is used.
- [ ] Add CI for actual lint, test, and build commands after they exist.
- [ ] Smoke-test the full user journey and inspect logs.
- [ ] Record how to redeploy the last known-good version.

Avoid adding infrastructure that is not needed for the demo. Do not introduce paid resources without team approval.

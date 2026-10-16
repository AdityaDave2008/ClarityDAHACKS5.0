# QA and acceptance checks

Owner: QA/QC, with developers responsible for their own tests. This is a manual checklist until the stack and test runner are selected, not an automated test suite.

At kickoff, write the core user journey as concrete actions and expected results here. Prioritize blockers to that journey over cosmetic issues.

## Release checklist

- [ ] Core user journey completes against the real backend.
- [ ] Inputs reject invalid or missing values clearly.
- [ ] Loading, empty, success, and failure states are understandable.
- [ ] Refresh and repeat actions do not corrupt the demo.
- [ ] Keyboard navigation, labels, and readable contrast are checked.
- [ ] Primary demo viewport and a narrow viewport work.
- [ ] Fresh setup instructions work for another teammate.
- [ ] Deployed URL works in a fresh browser session.
- [ ] No secrets or sensitive data appear in UI, logs, or committed files.

Report bugs with reproduction steps, expected/actual result, environment, severity, and evidence. Record the tested commit and deployment with release results. Add automated end-to-end checks here once a runner is chosen.

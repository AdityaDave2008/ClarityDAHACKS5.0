# Clarity real UI tests

`ClarityUITests` uses the actual Clarity application, SwiftUI settings, persisted preferences, and SpringBoard permission alert. No app source changes, mocks, launch overrides, or backend are involved.

## Environment

- Use an English-language iPhone simulator with a fresh installation and notification permission not yet requested.
- The fresh-launch and permission-request tests require this clean permission state. XCTest does not expose a notification authorization reset resource. Use a fresh simulator before repeating those tests, or run them individually on separate fresh simulators. Other tests restore the original notification opt-in on successful completion.
- The scheme disables parallel execution for this test bundle because tests manipulate real persisted preferences. Run with the normal standard build, without Critical Alerts approval.
- Persistence refers to notification preferences across Close/reopen and app relaunch. FAQ disclosure expansion is transient in the app and is not expected to persist.

## Build only, without executing tests

From the repository root:

```sh
xcodebuild build-for-testing \
  -project samples/ios/MyEyes.xcodeproj \
  -scheme Clarity \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
```

Signing is disabled in the new test target. Supply the command-line flags above to disable signing for the existing app as well without altering its configuration. No tests were executed when adding this target.

Five small tests cover fresh launch without a permission prompt, notification opt-in persistence, disabled Critical alerts, explicit permission approval plus the test-scheduled message, and all five FAQ disclosures. The actual toggle label is **Opt in to system notifications**, while **System notifications** is the section heading.

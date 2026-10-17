# LiDAR-first deadline repair, October 17, 2026

Scope was narrowed by the owner to native LiDAR/sound and a usable visual fallback. Notification/FAQ integration and web changes were not shipped in this repair.

## Behavior

- Retain calibrated, absolute, unfiltered LiDAR capture, exact RGB pairing, 0.75-second freshness, range checks and two-frame alert confirmation.
- A broad central-half ROI that varies in depth can use a coherent, exact-center patch of at most 5×5 depth pixels. It requires at least 9 valid samples, 90% coverage, a valid center return and the existing 8 cm / 6% spread bound. It never searches elsewhere for a convenient background surface. Labels represent approximate axial **surface** depth, not object segmentation or clearance.
- If the current detection has no usable measured depth, use its fresh normalized box area for visual proximity: at least 35% near, 12% intermediate, 3% far. Smaller boxes are outside the visual alert bands. This fallback never produces meters.
- Valid LiDAR retains priority. Invalid RGB pairing or stale frames cannot produce visual feedback. Existing sound/haptic/speech preferences and cadence remain intact.
- Home-screen display name is **Clarity**. The existing bundle ID remains unchanged so installing does not intentionally reset preferences or permissions.

## Verification

- Reproduced a failure for a completely valid sloped depth surface before the center-patch repair, then passed it with curved-surface, mixed-boundary, central-hole, outlier, stale-map and portrait-orientation cases.
- Reproduced missing/disabled LiDAR failing the requested visual fallback before the change, then passed actual enrichment → policy → routing → feedback tests.
- Final native suite: 92 tests, 91 passed, one optional built-bundle check skipped, no failures. Includes executed Swift policy, lifecycle and cadence tests.
- Signed Debug iPhone build succeeded. Code signature verification succeeded. Built `CFBundleDisplayName` is exactly `Clarity`.
- Installed successfully on the owner's connected iPhone 15 Pro at 20:38 UTC. Physical camera aim, audible sound and measured distance accuracy still require live confirmation. Installation and synthetic depth fixtures do not prove these.

Local evidence: `~/.jcode/scratch/aditya-notifications-review/` contains `lidar-surface-red.log`, `fallback-red.log`, `lidar-named-final-tests.log`, `lidar-signed-build.log` and `lidar-phone-final.log`.

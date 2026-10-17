# Visual proximity fallback

Approved October 17, 2026: larger normalized boxes produce stronger proximity feedback on devices **without LiDAR hardware**. LiDAR-capable devices use only fresh measured object depth. Missing, disabled, failed or stale LiDAR does not silently switch to visual estimates.

## Relative visual bands

| Normalized box area | Band | Selected sound/haptic cadence |
|---|---|---|
| At least 35% | Near, red | 2 Hz |
| At least 12%, below 35% | Intermediate, amber | 1 Hz |
| At least 3%, below 12% | Far, green | 0.5 Hz |
| Below 3% | Small image footprint, muted blue | No proximity pulses |

These are prototype **image-size heuristics**, not calibrated physical distances. A large distant object can occupy more of an image than a small nearby object. No visual estimate is expressed in meters or used to claim safe clearance. Preview resizing does not affect normalized area.

Both paths require two distinct fresh in-zone observations. Retreat requires two fresh frames past hysteresis; visual retreat uses 10% below the old area boundary. Source changes reset identity confirmation. Observations expire after 0.75 seconds. Stop, interruption and existing lifecycle resets stop outputs. Speech identifies visual estimates explicitly. LiDAR keeps its existing configurable 1/2/3-meter defaults and measured-depth validation.

## Evidence

- Executable policy matrix covers source selection, area thresholds, malformed boxes, staleness/future observations, replay, confirmation and hysteresis.
- Production `addingProximity` → `ProximityPolicy` → `ProximityAlertRoute` → `ProximityFeedbackInput` → cadence integration test verifies selected modalities, no fabricated meters, measured depth overriding large box area, and invalid LiDAR remaining unknown.
- A deliberate conflicting expiry regression failed before the bridge used `freshProximityExpiry(at:)`; it passes after the fix. Visual metadata cannot extend measured-depth output.
- Full native suite passed 92/92 with zero skips before the final source-expiry regression. That regression passed separately and the final signed iOS build succeeded.
- Independent integration review found no blocking source-selection or lifecycle issue.

Physical non-LiDAR fallback behavior, perception of haptic/sound cadence, and physical LiDAR accuracy still require device testing. Synthetic fixtures and a build do not prove those outcomes. This change does not improve classifier recall, change model weights/thresholds, or implement floor-mode obstacle detection. The user's iPhone15Pro has LiDAR, so it remains on the measured-depth path.

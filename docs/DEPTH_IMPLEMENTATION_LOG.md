# Depth implementation ledger

Plan: docs/superpowers/plans/2026-10-17-capability-aware-depth.md
Spec approved explicitly by user at 2026-10-17T06:52:34Z.
Baseline code: 11fc777. Plan commit: ea84707.

| Task | Interface / ownership check | Result |
| --- | --- | --- |
| Native | Owns iOS sources/tests only; default true still respects explicit stored false | Independent from web changes |
| Geometry | Owns depth-geometry.js/tests; exports radians-based geometry and same-frame fit | Schema sent to UI implementer |
| Model | Owns depth-model.js/tests/provenance; raw relative tensor only | No UI or detector ownership overlap |
| UI/sensors | Owns new controller, sensor, UI files and frontend integration | Consumes geometry/model contracts |
| Acceptance | Coordinator runs actual browser and independent review | Does not infer physical accuracy from unit tests |
| Geometry/UI | Frame identity and age in monotonic ms; measured projection and declared floor/contact required | Shared contract documented in agent messages |
| Model/UI | load({onStatus}), estimate(canvas) => {data,width,height}, dispose() | One inference maximum and snapshot isolation required |

Execution choices: existing feature branch and shared workspace, with non-overlapping worker file ownership. Preserve teammate backend/package.json and backend/scripts/measure-latency.js changes. No git worktrees or resets.

Physical acceptance limitation: no attached-device range measurements have been observed. Record separately from real-browser inference and synthetic-camera UI tests.

Ruling: expose the optional monocular model as explicit frozen snapshot analysis rather than pretending it meets the 500 ms live geometry budget. Actual worker inference at 252px processor input took 2.32 seconds on this host. Pair its source snapshot and relative heatmap, label both non-live/no metres, clear on stop/hide/disable/calibration change, and retain strict live-geometry freshness. This costs continuous model-depth availability, but prevents stale model output masquerading as current geometry. The model worker kept a 20 ms browser timer responsive (115 ticks, maximum gap 21.6 ms in the observed run).

Ruling: the initial browser UI does not automatically fit relative model output to metres because it cannot establish trustworthy same-frame floor references. Ship tested fit primitives without calling them from the UI. Metric browser output is restricted to a calibrated, user-declared ground-contact point. This limits supported scenes rather than inventing arbitrary-object distances.

Ruling: deliver the three pinned public model artifacts through a strictly allowlisted same-origin read-only route. Public Chromium testing reproduced `MissingAllowOriginHeader` on direct Hugging Face configuration downloads from the workers.dev origin, although localhost succeeded. The route streams only the exact revision's config, processor config and ONNX weights, not camera frames or inference. This adds model-download requests to Cloudflare but removes dependence on third-party browser CORS. Arbitrary destinations, credential forwarding, writes and alternate model revisions are not allowed.

Review: native preference/capture change passed scoped review. Geometry fixes in 2424e0f closed understated inverse-fit bounds and coerced sensor timestamps; 45 tests passed and scoped re-review approved. Browser opt-out fix 6cea7a9 closed the pending-factory/download race, with five added regressions and scoped approval. Full suite passed 251 tests before the model-delivery correction.

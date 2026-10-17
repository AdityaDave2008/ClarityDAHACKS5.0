# YOLOX candidate testing implementation plan

**Goal:** Run the actual fine-tuned experimental YOLOX-Nano ONNX candidate offline on the connected iPhone, preserving camera, LiDAR, PiP and alert lifecycle.
**Approved design:** Keep the existing WKWebView bridge and replace its bundled TFJS engine with pinned ONNX Runtime Web 1.20.1 single-thread WASM. No remote inference or runtime downloads. Preserve the existing 16-label alert policy despite the model's 80-class output. Clearly label experimental candidate, worse mAP than baseline, no safety claims.
**Isolation:** Fresh main b1bbc49 in separate clone, v2-testing only. Install separate testing bundle ID so original app and settings remain untouched.
**Contract:** BGR float32 0..255 CHW 1x3x416x416, aspect resize top-left pad114. Decoded 1x3549x85 xywh, objectness*class score, external class-aware NMS .65. Candidate threshold .7874982953071594. SHA256 516617114420ce3c2bac545869ee91bac8ff7a63e148a73afdb12f126433fab4.

- [x] Write failing node tests for preprocessing channels/padding, score multiplication, coordinate reversal, class-aware NMS, malformed outputs and threshold.
- [x] Implement yolox.js pure contract helpers and detector.js runtime adapter. Bundle model, runtime, license, hashes and contract. Run tests.
- [x] Run real production WKWebView with actual candidate, known image and lifecycle harness. Validate reference output parity, cancellation/restart, malformed image, stale frame, timeout and network denial.
- [ ] Build signed testing app with Xcode. Install and launch on verified connected iPhone without uninstall or permission reset. Report physical validation separately.
- [ ] Run complete regression suite, document evidence and limits, commit scoped files, push only v2-testing.

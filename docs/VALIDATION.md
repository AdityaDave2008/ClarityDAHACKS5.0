# Backend validation

Checked on October 16, 2026, with Node.js 24.19.0 on the development Mac.

## Automated checks

Run these commands from `backend/`. Backend tests live in `backend/tests/`; cross-app acceptance checks remain in `tests/e2e/`.

- `npm run check`: passed JavaScript syntax checks.
- `npm test`: 23 tests passed. API tests use a test-only detector and generated images, and do not measure model accuracy.
- `git diff --check`: passed.

The tests cover normalized geometry, confidence filtering, repeated-object confirmation, cooldowns, session isolation, upload limits, real JPEG/PNG decoding, EXIF rotation, stale frame sequences, concurrent requests, model errors, expiry, CORS, and preferences/Stop changes during inference.

## Real model through the API handlers

Ran the real-model smoke command with the TensorFlow project's [sample cat photograph](https://github.com/tensorflow/tfjs-models/blob/master/coco-ssd/demo/cat.jpg), downloaded temporarily outside the repository. This image is not bundled in the project.

Model: COCO-SSD 2.2.3, `lite_mobilenet_v2`; TensorFlow.js and its WebAssembly backend: 4.22.0. The processed image was **224 × 224 pixels**.

| Frame | Result | Server processing |
| --- | --- | --- |
| 1 | Cat detected in the image zone; confirmation pending | 157 ms |
| 2 | Matching cat detected; sound alert decision triggered | 113 ms |

The smoke script asserts that a repeated, qualifying image produces an alert within the confirmation window. It closes the model worker afterward. An earlier plain JavaScript CPU run took approximately 3.5 seconds per frame and exceeded that window; the final implementation uses WebAssembly acceleration.

These are two local handler measurements, not a benchmark distribution or phone end-to-end latency. They exclude camera capture and network transport. They do not validate detection of general obstacles, safety, or accessible alert delivery.

## Remaining integration checks

The frontend and an HTTPS deployment are not part of this backend implementation. Test the complete capture/upload/response/notification loop on an actual iPhone and Android, using real supported objects in a controlled scene. Verify stop/restart, network failure, camera permission, box alignment, sound/speech, and supported vibration. Record end-to-end timing before making latency claims.

# Attribution and provenance

- **Fastify**: HTTP server, MIT. [Source/license](https://github.com/fastify/fastify).
- **@fastify/cors**: CORS integration, MIT. [Source/license](https://github.com/fastify/fastify-cors).
- **sharp**: bounded image decoding and resizing, Apache-2.0. sharp and libvips have separate included third-party notices. [Source/license](https://github.com/lovell/sharp).
- **TensorFlow.js 4.22.0**: CPU machine-learning runtime, Apache-2.0. [Source/license](https://github.com/tensorflow/tfjs).
- **TensorFlow.js WebAssembly backend 4.22.0**: accelerated inference using the package's local WebAssembly binaries, Apache-2.0. [Source/documentation](https://github.com/tensorflow/tfjs/tree/master/tfjs-backend-wasm).
- **TensorFlow.js COCO-SSD 2.2.3**, `lite_mobilenet_v2`: pretrained model/adapter, Apache-2.0 source repository. [Documentation/license](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd).
- **ONNX Runtime Web 1.30.0**: WebAssembly runtime for the optional surface model, MIT. [Source/license](https://github.com/microsoft/onnxruntime).
- **SegFormer-b0 fine-tuned on ADE20K** (`Xenova/segformer-b0-finetuned-ade-512-512`, ONNX conversion of `nvidia/segformer-b0-finetuned-ade-512-512`), pinned revision `d3e5499`: pretrained surface segmentation model. NVIDIA's SegFormer license permits research/non-commercial use only; replace it before any commercial use. [Model](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512) · [Original](https://huggingface.co/nvidia/segformer-b0-finetuned-ade-512-512) · [License](https://github.com/NVlabs/SegFormer/blob/master/LICENSE).
- **ADE20K**: training data and label provenance for the surface model. [Dataset](https://ade20k.csail.mit.edu/). No ADE20K images are bundled.
- **COCO**: training data/category provenance for the pretrained detector. This project did not train the initial model. [Dataset terms](https://cocodataset.org/#termsofuse). No COCO image dataset is bundled.

`backend/package-lock.json` records installed versions, and the dependencies include their license files. Model weights are downloaded from their provider by the model adapter. Retain applicable notices in distributions and credit any later test photos, training data, sounds, icons, or other assets separately.

The session handling, API contract, normalized detection-zone logic, alert policy, tests, and integration documentation were developed for this project with AI assistance. Tests use generated image data and test-only detector outputs; these are not evidence of model accuracy. Describe AI assistance in the submission according to organizer requirements.

The browser sample's sidewalk illustration, footprint icon, UI, generated notification tones, and native sample code were created for this project with AI assistance. The guided browser mode is an explicitly labeled simulation. Native samples use Apple/Android platform frameworks and the existing backend; they do not bundle another detector or training dataset.

The Android sample includes the official **Gradle 8.13 wrapper**, Apache-2.0. Its wrapper license is retained in `samples/android/gradle/wrapper/LICENSE`; Gradle and the Android Gradle Plugin are build tools downloaded by the wrapper, not embedded app detection libraries. [Gradle source/license](https://github.com/gradle/gradle).

### Published concepts (no code used)

The depth, confirmation, and occupancy-grid plan in [docs/TESLA_AND_NO_LIDAR_RESEARCH.md](docs/TESLA_AND_NO_LIDAR_RESEARCH.md) adapts ideas Tesla described publicly: vision-only depth, the data engine, shadow mode, and triggers (A. Karpathy, Tesla, [CVPR 2021 WAD keynote](https://www.youtube.com/watch?v=NSDTZQdo6H8)); temporal fusion and multi-task heads ([Tesla AI Day 2021](https://www.youtube.com/watch?v=j0z4FweCy4M)); the class-agnostic occupancy grid (A. Elluswamy, Tesla, [CVPR 2022 WAD keynote](https://www.youtube.com/watch?v=jPCV4GKX9Dw); [Tesla AI Day 2022](https://www.youtube.com/watch?v=ODSJsviD_SU)). Occupancy grids are a long-standing robotics technique (Moravec and Elfes, 1985). Tesla's Autopilot and FSD software is proprietary and is not used; no Tesla repository code, weights, or data are included, and Tesla's Patent Pledge is not relied upon. When the monocular depth worker lands, add its model line here: Depth Anything V2 Small, Apache-2.0, ONNX conversion `onnx-community/depth-anything-v2-small` with the pinned revision.

### Ideas adapted in `frontend/sample/`

The sample's alert manager reimplements ideas from these open-source projects. None of them publishes a license, so no code was copied:

- Edge-triggered announcements and stale-detection auto-clear: [benz16107/BlindSpot](https://github.com/benz16107/BlindSpot).
- Multi-frame confirmation, limited repeats, and forgetting unseen objects: [Shubhajagadeesh123/AIVI](https://github.com/Shubhajagadeesh123/AIVI).
- Urgent-interrupt speech and distance-coded beeps: [hariomkale18-sys/VISION_AI](https://github.com/hariomkale18-sys/VISION_AI) and [hariomkale-264/VISION_AI](https://github.com/hariomkale-264/VISION_AI).
- Newest-message-only speech and the "getting closer" cue: [Rokhaya8/SmartObstacleDetector](https://github.com/Rokhaya8/SmartObstacleDetector).
- Speech `resume()`/timeout handling and dark-frame detection: [Dev-chxrlez/SightBuddy](https://github.com/Dev-chxrlez/SightBuddy).

The ground-plane distance estimate (camera height, motion-sensor pitch, and the box's bottom edge) and stereo-panned direction beeps were written for this project with AI assistance.

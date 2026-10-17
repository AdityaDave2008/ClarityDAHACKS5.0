# StepSense detection API on Cloudflare

Live: **https://stepsense-detection.stepsense-dahacks.workers.dev**

Serves the same v1 contract as the Node backend in `../backend`, so clients only change origin.

```sh
curl https://stepsense-detection.stepsense-dahacks.workers.dev/ready
curl https://stepsense-detection.stepsense-dahacks.workers.dev/api/v1/model
```

Send a frame:

```sh
ID=$(curl -s -X POST .../api/v1/sessions -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["sessionId"])')
curl -X POST ".../api/v1/sessions/$ID/frames" \
  -H 'Content-Type: image/jpeg' -H 'X-Frame-Sequence: 1' --data-binary @frame.jpg
```

## What the model does, and does not do

`@cf/microsoft/resnet-50` classifies each frame across the same 16 categories the other
backends use. `@cf/llava-hf/llava-1.5-7b-hf` then estimates where that object sits.

**There are no bounding boxes.** Every detection carries `bbox: null`, `anchor: null`, and a
coarse `region`. Two alternatives were measured against the live API first:

- `@cf/moondream/moondream3.1-9B-A2B` documents a `detect` task returning corner
  coordinates, but returned an empty result for every input form tried: byte array, base64
  data URI, and public HTTPS URL, across its `detect`, `caption`, and `query` tasks.
- LLaVA asked directly for boxes returned all-zero coordinates.

Coarse position was measured over six synthetic frames with known placement: horizontal
thirds correct 4/6, vertical halves 5/6. That is a hint, not a measurement, so the API
reports the region rather than drawing a rectangle clients would render as if it were real.

Because there is no box, `inZone` means only that the object appeared in the lower half of
the frame. It does not establish ground contact, distance, or a safe path.

Observed latency on a deployed frame was roughly 12 seconds, two model calls over the
network. That is far slower than the iPhone's bundled detector and is not suitable as the
live demo path.

## Deploying

```sh
npm --prefix worker test
npx wrangler deploy
```

Sessions use a Durable Object. An earlier deployment kept them in isolate memory and lost
roughly three in five between requests, because isolates do not share memory.

`ALLOWED_ORIGINS` is empty, which allows any origin. Set exact origins to restrict the API.
Session IDs are bearer capabilities: anyone holding one can submit frames to that session.

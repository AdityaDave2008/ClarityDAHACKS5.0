# Browser obstacle tracking

`frontend/tracking.js` provides `ObjectTracker.update(detections, monotonicMilliseconds)` and `reset()`.
Inputs use normalized `{label, confidence, bbox: {x,y,width,height}, inZone}`. Outputs preserve those fields and add `trackId`, `hits`, `confirmed`, `age` (milliseconds), and `status`. Only tracks observed in the current frame are returned: predicted boxes cannot trigger an alert by themselves. Two observations confirm a track by default. Detector filtering must retain observations down to confidence 0.1 for the low-score stage to work.

This is a browser adaptation of the ByteTrack algorithm, **not the official Python implementation or its benchmark-equivalent port**. It implements high-score association against confirmed/lost tracks, low-score association against remaining active tracks, confirmation of tentative tracks, creation only from high scores, and expiry/reacquisition. Association uses Hungarian global assignment and intersection-over-union; high-score costs fuse detector confidence. Motion uses four independent two-state Kalman filters on normalized box centers and sizes, rather than upstream's coupled eight-dimensional XYAH Kalman filter. Other deliberate differences are class-gated association, elapsed-time expiry, consecutive two-hit confirmation for all new tracks, and no upstream duplicate-track suppression. Camera motion, occlusion, and crossing objects can still change IDs. This provides identity continuity, not depth or fall-prevention guarantees.

Defaults: high score 0.5, low score 0.1, creation score 0.6, confirmation 2 hits, lost buffer 1500 ms. Track identities reset when scanning restarts.

Run deterministic verification with `node --test frontend/tracking.test.js` from the project root.

## Attribution

Algorithm and lifecycle adapted from [FoundationVision/ByteTrack](https://github.com/FoundationVision/ByteTrack), specifically `yolox/tracker/byte_tracker.py` and the paper *ByteTrack: Multi-Object Tracking by Associating Every Detection Box* by Yifu Zhang et al. The browser numerical implementation and assignment solver are implemented locally and require no external runtime package. Upstream license is reproduced below to retain attribution for the adapted algorithm structure.

MIT License

Copyright (c) 2021 Yifu Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

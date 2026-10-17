import Foundation

@main
struct CenterDepthSensorTests {
    static func main() {
        var gate = CenterDepthDeliveryGate()
        let first = gate.reserve(now: 10)!
        precondition(gate.reserve(now: 11) == nil, "slow UI must not accumulate sensor callbacks")
        gate.complete(first)
        precondition(gate.reserve(now: 10.05) == nil, "delivery is capped at 10 Hz")
        let second = gate.reserve(now: 10.11)!
        gate.complete(first)
        precondition(gate.reserve(now: 11) == nil, "old completion cannot release newer delivery")
        gate.reset()
        let restarted = gate.reserve(now: 11)!
        gate.complete(second)
        precondition(gate.reserve(now: 12) == nil, "old run completion cannot release new run")
        gate.complete(restarted)
        precondition(gate.reserve(now: .nan) == nil)
        precondition(gate.reserve(now: .infinity) == nil)
        precondition(gate.reserve(now: 10) == nil, "backward time is rejected")
        precondition(gate.reserve(now: 12) != nil)
        var cadence = CenterDepthDeliveryGate()
        var deliveries = 0
        for frame in 0..<300 {
            if let reservation = cadence.reserve(now: Double(frame) / 30) {
                deliveries += 1
                cadence.complete(reservation)
            }
        }
        precondition(deliveries > 70 && deliveries <= 100, "30fps capture must deliver a bounded live sensor cadence")

        let snapshot = DepthSnapshot(width: 3, height: 3, meters: Array(repeating: 2, count: 9), capturedAt: 20)
        let live = CenterDepthSample(snapshot: snapshot, now: 20.1, diagnostic: "LiDAR · snapshot accepted")
        precondition(live.meters == 2 && live.capturedAt == 20)
        precondition(live.diagnostic == "LiDAR · snapshot accepted")
        precondition(live.measurement(now: 20.749)?.meters == 2)
        precondition(live.measurement(now: 20.749)?.capturedAt == 20)
        precondition(live.measurement(now: 20.1, notBefore: 20.01) == nil, "pre-interruption sample cannot reappear after resume")
        precondition(live.measurement(now: 20.1, notBefore: 20)?.meters == 2, "sample at lifecycle boundary is accepted")
        precondition(live.measurement(now: 20.1, notBefore: 19)?.meters == 2)
        precondition(live.measurement(now: 20.1, notBefore: .nan) == nil)
        precondition(live.measurement(now: 20.1, notBefore: .infinity) == nil)
        precondition(live.measurement(now: 20.75) == nil, "actor-delayed sensor delivery must expire")
        for now in [19, Double.nan, .infinity, -.infinity] {
            precondition(live.measurement(now: now) == nil, "invalid/future delivery time must be rejected")
        }
        let stale = CenterDepthSample(snapshot: snapshot, now: 20.75, diagnostic: "accepted")
        precondition(stale.meters == nil && stale.capturedAt == nil)
        precondition(stale.diagnostic == "stale/invalid time")
        let future = CenterDepthSample(snapshot: snapshot, now: 19, diagnostic: "accepted")
        precondition(future.meters == nil)
        let missing = CenterDepthSample(snapshot: nil, now: 20, diagnostic: "depth missing/dropped")
        precondition(missing.meters == nil && missing.capturedAt == nil)
        precondition(missing.diagnostic == "depth missing/dropped")
        precondition(missing.measurement(now: 20) == nil)
        let hole = DepthSnapshot(width: 3, height: 3, meters: Array(repeating: .nan, count: 9), capturedAt: 20)
        precondition(CenterDepthSample(snapshot: hole, now: 20, diagnostic: "accepted").diagnostic == "no center return")
        for value: Float in [0.1, 6, .infinity] {
            let invalid = DepthSnapshot(width: 3, height: 3, meters: Array(repeating: value, count: 9), capturedAt: 20)
            let sample = CenterDepthSample(snapshot: invalid, now: 20, diagnostic: "accepted")
            precondition(sample.meters == nil && sample.capturedAt == nil)
            precondition(sample.diagnostic != "accepted")
        }
        // Sensor delivery has no detector phase, pending inference, or bounding-box input.
        // Object enrichment still uses the original snapshot and original freshness limit.
        let full = NormalizedBox(x: 0, y: 0, width: 1, height: 1)
        let objectMap = DepthSnapshot(width: 20, height: 20, meters: Array(repeating: 2, count: 400), capturedAt: 20)
        precondition(objectMap.estimate(in: full, now: 20.749) == 2)
        precondition(objectMap.estimate(in: full, now: 20.75) == nil)
        print("Independent center sensor throttling, bounded delivery, restart and freshness passed")
    }
}

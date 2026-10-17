import Foundation
@main struct ProximityDepthPipelineTests {
    static func main() {
        let base = Detection(label: "unclassified test object", confidence: 0.99,
                             bbox: .init(x: 0, y: 0, width: 1, height: 1),
                             anchor: .init(x: 0.5, y: 1), inZone: true)
        func classify(_ values: [Float]?, now: Double = 100.1, matched: Bool = true, enabled: Bool = true) -> [Detection] {
            let snapshot = values.map { DepthSnapshot(width: 20, height: 20, meters: $0, capturedAt: 100) }
            let enriched = base.addingDepth(from: snapshot, enabled: enabled, matchingFrame: matched, now: now)
            var policy = ProximityPolicy()
            let initialSnapshot = values.map { DepthSnapshot(width: 20, height: 20, meters: $0, capturedAt: 99.9) }
            let initial = base.addingDepth(from: initialSnapshot, enabled: enabled, matchingFrame: matched, now: 100)
            _ = policy.update([initial], settings: .init(), now: 100)
            return policy.update([enriched], settings: .init(), now: now)
        }
        let flat = Array(repeating: Float(0.8), count: 400)
        let near = classify(flat)
        guard case .proximity(let target) = ProximityAlertRoute.select(near, now: 100.1, genericTriggered: false) else { fatalError("real depth estimator must feed near routing") }
        precondition(target.freshProximityBand(at: 100.1) == .near)
        var cadence = ProximityCadence()
        let input = ProximityFeedbackInput(interval: target.freshProximityBand(at: 100.1).pulseInterval,
                                          expiry: target.depthExpiresAt!, speechKey: "test", message: "near",
                                          sound: true, haptic: true, speech: false)
        let event = cadence.tick(input, at: 100.1)
        precondition(event.sound && event.haptic && event.message == nil)
        precondition(cadence.tick(input, at: 100.75).isEmpty, "expired depth cannot produce feedback")
        var mixed = flat; mixed[10 * 20 + 10] = 1.5
        let invalid = [classify(nil), classify(flat, matched: false), classify(flat, enabled: false),
                       classify(flat, now: 100.75), classify(mixed), classify(Array(repeating: Float.nan, count: 400))]
        for detections in invalid {
            precondition(detections[0].freshProximityBand(at: 100.1) == .unknown)
            precondition(ProximityAlertRoute.select(detections, now: 100.1, genericTriggered: false) == .detectionOnly(shouldAlert: false))
        }
        let distant = classify(Array(repeating: 4, count: 400))
        guard case .outsideRange = ProximityAlertRoute.select(distant, now: 100.1, genericTriggered: true) else { fatalError("distant surface must suppress proximity alerts") }
        print("PASS actual depth-estimator → policy → routing → cadence pipeline; synthetic maps, not device calibration")
    }
}

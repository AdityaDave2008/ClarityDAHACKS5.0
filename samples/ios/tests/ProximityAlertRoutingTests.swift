import Foundation
@main struct ProximityAlertRoutingTests {
    static func main() {
        func object(_ meters: Double?, x: Double = 0.1, inZone: Bool = true) -> Detection {
            var d = Detection(label: "person", confidence: 0.9,
                              bbox: .init(x: x, y: 0.1, width: 0.2, height: 0.3),
                              anchor: .init(x: x + 0.1, y: 0.4), inZone: inZone)
            d.depthRequested = true; d.depthMeters = meters; d.depthExpiresAt = meters == nil ? nil : 10.75
            return d
        }
        func classify(_ values: [Detection]) -> [Detection] {
            var policy = ProximityPolicy()
            let previous = values.map { detection -> Detection in
                var earlier = detection
                earlier.depthExpiresAt = earlier.depthExpiresAt.map { $0 - 0.1 }
                return earlier
            }
            _ = policy.update(previous, settings: .init(), now: 9.9)
            return policy.update(values, settings: .init(), now: 10)
        }
        var firstPolicy = ProximityPolicy()
        let first = firstPolicy.update([object(0.8)], settings: .init(), now: 10)
        precondition(ProximityAlertRoute.select(first, now: 10, genericTriggered: true) != .proximity(first[0]),
                     "A first-frame object must not escalate before independent confirmation")
        let near = classify([object(0.8)])
        guard case .proximity(let target) = ProximityAlertRoute.select(near, now: 10, genericTriggered: false) else {
            fatalError("Fresh near target must bypass unrelated generic cooldown")
        }
        precondition(target.depthMeters == 0.8)
        let distant = classify([object(4)])
        guard case .outsideRange = ProximityAlertRoute.select(distant, now: 10, genericTriggered: true) else {
            fatalError("Known out-of-range object must not trigger generic beeps")
        }
        let unknown = classify([object(nil)])
        precondition(ProximityAlertRoute.select(unknown, now: 10, genericTriggered: true) == .detectionOnly(shouldAlert: true))
        precondition(ProximityAlertRoute.select(unknown, now: 10, genericTriggered: false) == .detectionOnly(shouldAlert: false))
        precondition(ProximityAlertRoute.select(near, now: 10.75, genericTriggered: false) == .detectionOnly(shouldAlert: false))
        let mixed = classify([object(4), object(nil, x: 0.6)])
        precondition(ProximityAlertRoute.select(mixed, now: 10, genericTriggered: true) == .detectionOnly(shouldAlert: true), "Unknown depth must not be silenced by another distant object")
        let outside = classify([object(0.5, inZone: false)])
        precondition(ProximityAlertRoute.select(outside, now: 10, genericTriggered: false) == .detectionOnly(shouldAlert: false))
        let multiple = classify([object(2.5), object(0.7, x: 0.6)])
        guard case .proximity(let closest) = ProximityAlertRoute.select(multiple, now: 10, genericTriggered: true) else { fatalError("closest route missing") }
        precondition(closest.depthMeters == 0.7)
        print("PASS proximity alert routing")
    }
}

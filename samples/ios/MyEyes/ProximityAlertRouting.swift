import Foundation

enum ProximityAlertRoute: Equatable {
    case proximity(Detection)
    case confirmingProximity(Detection)
    case outsideRange(Detection)
    case detectionOnly(shouldAlert: Bool)

    static func select(_ detections: [Detection], now: TimeInterval, genericTriggered: Bool) -> Self {
        guard let closest = ProximityPolicy.closest(in: detections, now: now) else {
            return .detectionOnly(shouldAlert: genericTriggered)
        }
        if closest.freshProximityBand(at: now).pulseInterval != nil {
            return closest.proximityConfirmed == true ? .proximity(closest) : .confirmingProximity(closest)
        }
        // A known distant object must not silence a different object with unknown depth.
        if detections.contains(where: { $0.inZone && $0.freshProximityBand(at: now) == .unknown }) {
            return .detectionOnly(shouldAlert: genericTriggered)
        }
        return .outsideRange(closest)
    }
}

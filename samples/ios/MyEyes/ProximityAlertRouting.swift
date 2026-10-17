import Foundation

extension ProximityFeedbackInput {
    /// One tested bridge for both measured and visual observations. Never invent meters.
    init?(target: Detection, modes: [AlertMode], now: TimeInterval) {
        guard target.proximityConfirmed == true,
              let source = target.freshProximitySource(at: now),
              target.freshProximityStrength(at: now) != nil,
              let expiry = target.freshProximityExpiry(at: now),
              let interval = target.freshProximityBand(at: now).pulseInterval,
              let description = target.proximityDescription(at: now) else { return nil }
        let identity = target.proximityTrackID.map(String.init) ?? target.label
        let band = target.freshProximityBand(at: now)
        self.init(interval: interval, expiry: expiry,
                  speechKey: "\(source):\(identity):\(target.label):\(band.title)",
                  message: "\(target.label), \(description), \(band.title)",
                  sound: modes.contains(.sound), haptic: modes.contains(.vibration),
                  speech: modes.contains(.speech))
    }
}

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

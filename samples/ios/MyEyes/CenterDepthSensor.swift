import Foundation

/// A scalar sensor observation, not an object measurement. No image/map crosses this lane.
struct CenterDepthSample: Sendable {
    let meters: Double?
    let capturedAt: TimeInterval?
    let diagnostic: String

    init(snapshot: DepthSnapshot?, now: TimeInterval, diagnostic: String) {
        var reason = diagnostic
        let value = snapshot?.centerSurface(now: now, onRejection: { reason = $0 })
        meters = value
        capturedAt = value == nil ? nil : snapshot?.capturedAt
        self.diagnostic = reason
    }

    /// Revalidate after the actor hop, which may have been delayed by a busy UI.
    func measurement(now: TimeInterval, notBefore: TimeInterval = -.infinity) -> (meters: Double, capturedAt: TimeInterval)? {
        guard let meters, meters.isFinite, meters >= 0.2, meters <= 5,
              let capturedAt, capturedAt.isFinite, now.isFinite,
              capturedAt >= notBefore else { return nil }
        let age = now - capturedAt
        guard age >= 0, age < DepthSnapshot.maximumAge else { return nil }
        return (meters, capturedAt)
    }
}

/// Frame-queue owned. At most one asynchronous delivery and at most ten starts/second.
/// Completion tokens prevent a callback from an old run from releasing a new reservation.
struct CenterDepthDeliveryGate {
    private var lastStartedAt: TimeInterval?
    private var pending: UUID?

    mutating func reserve(now: TimeInterval) -> UUID? {
        guard now.isFinite, pending == nil else { return nil }
        if let lastStartedAt, now - lastStartedAt < 0.1 { return nil }
        let token = UUID()
        pending = token
        lastStartedAt = now
        return token
    }

    mutating func complete(_ token: UUID) {
        if pending == token { pending = nil }
    }

    mutating func reset() {
        lastStartedAt = nil
        pending = nil
    }
}

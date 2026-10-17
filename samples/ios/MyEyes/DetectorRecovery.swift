import Foundation

enum DetectorRecoveryError: LocalizedError {
    case exhausted
    case deferred
    var errorDescription: String? {
        switch self {
        case .exhausted: return "Model recovery failed repeatedly. Stop and Start to retry."
        case .deferred: return "Model recovery will resume when the app and camera are active."
        }
    }
}

/// A successful reload is not evidence of a healthy model. Only a completed fresh frame
/// replenishes this budget, preventing repeated WebKit failures from creating a reload loop.
@MainActor
final class DetectorRecovery {
    private var attempts = 0
    func reset() { attempts = 0 }
    func recordHealthyFrame() { reset() }

    func reload(wait: (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
                canLoad: () -> Bool = { true },
                load: () async throws -> Void) async throws {
        while attempts < 2 {
            try Task.checkCancellation()
            guard canLoad() else { throw DetectorRecoveryError.deferred }
            try await wait(UInt64(attempts + 1) * 1_000_000_000)
            try Task.checkCancellation()
            guard canLoad() else { throw DetectorRecoveryError.deferred }
            attempts += 1
            do {
                try await load()
                try Task.checkCancellation()
                // The app can suspend during model initialization, not only during backoff.
                // The catch below refunds this attempt exactly once before deferring.
                guard canLoad() else { throw DetectorRecoveryError.deferred }
                return
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                if !canLoad() {
                    attempts -= 1
                    throw DetectorRecoveryError.deferred
                }
                if attempts >= 2 { throw error }
            }
        }
        throw DetectorRecoveryError.exhausted
    }
}

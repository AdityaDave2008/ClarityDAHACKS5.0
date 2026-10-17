import Foundation

@main
struct DetectorRecoveryTests {
    @MainActor static func main() async throws {
        let recovery = DetectorRecovery()
        var loads = 0
        var waits = 0
        enum Probe: Error { case failed }
        try await recovery.reload(wait: { _ in waits += 1 }) {
            loads += 1
            if loads == 1 { throw Probe.failed }
        }
        precondition(loads == 2 && waits == 2, "Retry a failed reload once")
        do {
            try await recovery.reload(wait: { _ in }) { loads += 1 }
            preconditionFailure("A reload alone must not reset a crash loop budget")
        } catch is DetectorRecoveryError {}
        precondition(loads == 2)
        recovery.recordHealthyFrame()
        try await recovery.reload(wait: { _ in }) { loads += 1 }
        precondition(loads == 3, "Healthy inference restores recovery budget")
        recovery.reset()
        var foreground = false
        do {
            try await recovery.reload(wait: { _ in preconditionFailure("Background recovery waited") }, canLoad: { foreground }) { loads += 1 }
            preconditionFailure("Background recovery started")
        } catch DetectorRecoveryError.deferred {}
        foreground = true
        do {
            try await recovery.reload(wait: { _ in foreground = false }, canLoad: { foreground }) { loads += 1 }
            preconditionFailure("Recovery started after backgrounding during backoff")
        } catch DetectorRecoveryError.deferred {}
        foreground = true
        var probeAttempts = 0
        try await recovery.reload(wait: { _ in }, canLoad: { foreground }) {
            probeAttempts += 1
            if probeAttempts == 1 { throw Probe.failed }
        }
        precondition(probeAttempts == 2, "Deferral must not consume attempts")
        recovery.reset()
        do {
            try await recovery.reload(wait: { _ in }, canLoad: { foreground }) { foreground = false }
            preconditionFailure("A model finishing in background must defer")
        } catch DetectorRecoveryError.deferred {}
        foreground = true
        probeAttempts = 0
        try await recovery.reload(wait: { _ in }, canLoad: { foreground }) {
            probeAttempts += 1
            if probeAttempts == 1 { throw Probe.failed }
        }
        precondition(probeAttempts == 2, "Successful suspended load must not consume budget")
        recovery.reset()
        let cancelled = Task { @MainActor in
            try await recovery.reload(wait: { _ in throw CancellationError() }) { loads += 1 }
        }
        do { try await cancelled.value; preconditionFailure("Cancelled recovery succeeded") }
        catch is CancellationError {}
        precondition(loads == 3, "Cancellation must never start another model")
        recovery.reset()
        do {
            try await recovery.reload(wait: { _ in }) { throw Probe.failed }
            preconditionFailure("Persistent load failure succeeded")
        } catch is Probe {}
        do {
            try await recovery.reload(wait: { _ in }) { loads += 1 }
            preconditionFailure("Exhausted failures restarted the model")
        } catch is DetectorRecoveryError {}
        print("PASS bounded model recovery, actual-frame budget reset, cancellation and persistent failure")
    }
}

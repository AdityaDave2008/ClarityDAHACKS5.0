import Foundation

@MainActor
private final class Gate {
    var continuation: CheckedContinuation<Void, Never>?
    func wait() async { await withCheckedContinuation { continuation = $0 } }
    func open() { continuation?.resume(); continuation = nil }
}

@main
struct ModelFirstStartupTests {
    @MainActor static func main() async throws {
        enum Probe: Error { case model, permission }
        var events: [String] = []
        let gate = Gate()
        let cold = Task { @MainActor in
            try await ModelFirstStartup.run(loadModel: {
                events.append("loading")
                await gate.wait()
                events.append("ready")
            }, authorizeCamera: { events.append("permission") }, startCamera: { events.append("camera") }, isCurrent: { true })
        }
        while gate.continuation == nil { await Task.yield() }
        precondition(events == ["loading"], "Camera/permission must stay untouched while model is pending")
        gate.open()
        try await cold.value
        precondition(events == ["loading", "ready", "permission", "camera"])

        events = []
        do {
            try await ModelFirstStartup.run(loadModel: { throw Probe.model }, authorizeCamera: { events.append("permission") }, startCamera: { events.append("camera") }, isCurrent: { true })
            preconditionFailure("Model failure succeeded")
        } catch Probe.model {}
        precondition(events.isEmpty, "Model failure must never request camera")

        events = []
        do {
            try await ModelFirstStartup.run(loadModel: { events.append("ready") }, authorizeCamera: { throw Probe.permission }, startCamera: { events.append("camera") }, isCurrent: { true })
            preconditionFailure("Permission denial succeeded")
        } catch Probe.permission {}
        precondition(events == ["ready"])

        for cancel in [false, true] {
            events = []
            var current = true
            let pending = Gate()
            let task = Task { @MainActor in
                try await ModelFirstStartup.run(loadModel: { await pending.wait() }, authorizeCamera: { events.append("permission") }, startCamera: { events.append("camera") }, isCurrent: { current })
            }
            while pending.continuation == nil { await Task.yield() }
            if cancel { task.cancel() } else { current = false }
            pending.open()
            do { try await task.value; preconditionFailure("Cancelled/superseded startup succeeded") }
            catch is CancellationError {}
            precondition(events.isEmpty, "Late ready must not acquire a camera")
        }

        events = []
        var current = true
        do {
            try await ModelFirstStartup.run(loadModel: {}, authorizeCamera: { current = false }, startCamera: { events.append("camera") }, isCurrent: { current })
            preconditionFailure("Superseded permission dialog started capture")
        } catch is CancellationError {}
        precondition(events.isEmpty)
        try await ModelFirstStartup.run(loadModel: { events.append("warm-ready") }, authorizeCamera: { events.append("permission") }, startCamera: { events.append("camera") }, isCurrent: { true })
        precondition(events == ["warm-ready", "permission", "camera"], "Retry/warm startup must obey the same ordering")
        print("PASS model-first startup: pending, ready, failure, permission denial, cancel, supersede and retry")
    }
}

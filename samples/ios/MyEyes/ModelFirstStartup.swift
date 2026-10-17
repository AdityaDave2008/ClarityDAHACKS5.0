import Foundation

/// Every suspension boundary rechecks cancellation and ownership before touching the camera.
@MainActor
enum ModelFirstStartup {
    static func run(loadModel: () async throws -> Void,
                    authorizeCamera: () async throws -> Void,
                    startCamera: () async throws -> Void,
                    isCurrent: () -> Bool) async throws {
        func checkCurrent() throws {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
        }
        try checkCurrent()
        try await loadModel()
        try checkCurrent()
        try await authorizeCamera()
        try checkCurrent()
        try await startCamera()
        try checkCurrent()
    }
}

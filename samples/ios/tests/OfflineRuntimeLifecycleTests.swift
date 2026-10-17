import AppKit
import Foundation
import WebKit

// Lightweight real-WK bridge tests. HTML fixtures replace model loading, not the native runtime.
// Compile with APIClient.swift, DepthEstimate.swift and OfflineDetector.swift.
@main
struct OfflineRuntimeLifecycleTests {
    struct Failure: Error, CustomStringConvertible { let description: String }
    @MainActor static func expect(_ condition: Bool, _ message: String) throws {
        if !condition { throw Failure(description: message) }
    }
    @MainActor static func fixture(_ root: URL, reply: String = "{backend:'fixture',zone:[{x:0,y:0}]}", delay: Int = 10) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try """
        <script>
        const ready = \(reply);
        window.resets = 0;
        window.resetOffline = id => { window.resets++; window.webkit.messageHandlers.detector.postMessage({id, value:ready}); };
        setTimeout(() => window.webkit.messageHandlers.detector.postMessage({id:'ready',value:ready}), \(delay));
        </script>
        """.write(to: root.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
    }
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        Task { @MainActor in
            let root = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            var failures = 0
            let cases: [(String, @MainActor () async throws -> Void)] = [
                ("warm start preserves view and acknowledges reset", {
                    try fixture(root)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    let cold = try await detector.start()
                    let view = detector.webView
                    detector.stop(keepingReadyModel: true)
                    try expect(detector.webView === view, "idle ready model not retained on user Stop")
                    let warm = try await detector.start()
                    try expect(detector.webView === view, "warm start replaced fully loaded view")
                    try expect(cold == warm, "warm start changed zone")
                    let resets = try await view!.evaluateJavaScript("window.resets")
                    try expect(resets as? Int == 1, "warm start returned without acknowledged reset")
                    detector.stop()
                    try expect(detector.webView == nil, "default Stop retained ready model")
                }),
                ("retain Stop destroys incomplete startup", {
                    try fixture(root, delay: 200)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    let loading = Task { try await detector.start() }
                    await Task.yield()
                    detector.stop(keepingReadyModel: true)
                    do { _ = try await loading.value; throw Failure(description: "stopped load succeeded") }
                    catch is Failure { throw Failure(description: "stopped load succeeded") }
                    catch { }
                    try expect(detector.webView == nil, "Stop retained incomplete startup")
                }),
                ("retain Stop destroys pending inference", {
                    try fixture(root)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    _ = try await detector.start()
                    _ = try await detector.webView!.evaluateJavaScript("window.analyzeOffline = () => {}; true")
                    let frame = Task { try await detector.analyze(jpeg: Data(), sequence: 1, preferences: ScanPreferences(), capturedAt: ProcessInfo.processInfo.systemUptime) }
                    await Task.yield()
                    detector.stop(keepingReadyModel: true)
                    do { _ = try await frame.value; throw Failure(description: "stopped frame succeeded") }
                    catch is Failure { throw Failure(description: "stopped frame succeeded") }
                    catch { }
                    try expect(detector.webView == nil, "Stop retained model with pending operation")
                }),
                ("warm reset failure destroys ready model", {
                    try fixture(root)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    _ = try await detector.start()
                    _ = try await detector.webView!.evaluateJavaScript("window.resetOffline = () => { throw Error('reset failed'); }; true")
                    do { _ = try await detector.start(); throw Failure(description: "failed reset accepted") }
                    catch is Failure { throw Failure(description: "failed reset accepted") }
                    catch { }
                    try expect(detector.webView == nil, "failed reset retained runtime")
                }),
                ("canceled warm reset destroys incomplete operation and can retry", {
                    try fixture(root)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    _ = try await detector.start()
                    _ = try await detector.webView!.evaluateJavaScript("window.resetOffline = () => {}; true")
                    let warm = Task { try await detector.start() }
                    await Task.yield()
                    warm.cancel()
                    do { _ = try await warm.value; throw Failure(description: "canceled reset succeeded") }
                    catch is Failure { throw Failure(description: "canceled reset succeeded") }
                    catch { }
                    try expect(detector.webView == nil, "canceled reset retained runtime")
                    _ = try await detector.start()
                }),
                ("concurrent start rejects without canceling first", {
                    try fixture(root, delay: 200)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    let first = Task { try await detector.start() }
                    await Task.yield()
                    do {
                        _ = try await detector.start()
                        throw Failure(description: "concurrent startup accepted")
                    } catch is Failure { throw Failure(description: "concurrent startup accepted") }
                    catch { /* Expected rejection; first must still succeed. */ }
                    _ = try await first.value
                }),
                ("malformed ready destroys incomplete runtime and permits retry", {
                    try fixture(root, reply: "{backend:'broken'}")
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    do {
                        _ = try await detector.start()
                        throw Failure(description: "malformed readiness accepted")
                    } catch is Failure { throw Failure(description: "malformed readiness accepted") }
                    catch { }
                    try expect(detector.webView == nil, "failed load retained incomplete WebKit")
                    try expect(detector.backend == "not loaded", "failed load advertised readiness")
                    try fixture(root)
                    _ = try await detector.start()
                }),
                ("canceled startup cannot tear down replacement", {
                    try fixture(root, delay: 100)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    let abandoned = Task { try await detector.start() }
                    await Task.yield()
                    let oldView = detector.webView
                    abandoned.cancel()
                    detector.stop()
                    let replacement = try await detector.start()
                    do {
                        _ = try await abandoned.value
                        throw Failure(description: "canceled startup succeeded")
                    } catch is Failure { throw Failure(description: "canceled startup succeeded") }
                    catch { }
                    try expect(detector.webView != nil && detector.webView !== oldView, "old startup removed replacement")
                    try expect(detector.backend == "fixture" && replacement.count == 1, "replacement lost readiness")
                }),
                ("already canceled start does not allocate a runtime", {
                    try fixture(root)
                    let detector = OfflineDetector(resourceRoot: root)
                    defer { detector.stop() }
                    let task = Task {
                        withUnsafeCurrentTask { $0?.cancel() }
                        return try await detector.start()
                    }
                    do { _ = try await task.value; throw Failure(description: "canceled start succeeded") }
                    catch is Failure { throw Failure(description: "canceled start succeeded") }
                    catch { }
                    try expect(detector.webView == nil, "pre-canceled start leaked a view")
                }),
                ("missing page fails cleanly", {
                    let detector = OfflineDetector(resourceRoot: root.appendingPathComponent("missing"))
                    defer { detector.stop() }
                    do { _ = try await detector.start(); throw Failure(description: "missing assets accepted") }
                    catch is Failure { throw Failure(description: "missing assets accepted") }
                    catch { }
                    try expect(detector.webView == nil, "missing page retained failed runtime")
                })
            ]
            for (name, run) in cases {
                do { try await run(); print("PASS \(name)") }
                catch { failures += 1; print("FAIL \(name): \(error)") }
            }
            exit(failures == 0 ? 0 : 1)
        }
        app.run()
    }
}

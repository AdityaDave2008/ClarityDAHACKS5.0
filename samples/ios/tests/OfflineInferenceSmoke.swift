import AppKit
import Foundation
import WebKit

// Runs the actual production WKWebView bridge and packaged JS/model on macOS.
// Usage: smoke /absolute/OfflineDetector /absolute/photo.jpg
@main
struct OfflineInferenceSmoke {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        Task { @MainActor in
            let detector = OfflineDetector(resourceRoot: URL(fileURLWithPath: CommandLine.arguments[1]))
            do {
                // Old startup cancellation must never cancel the replacement startup's "ready" wait.
                let abandoned = Task { try await detector.start() }
                await Task.yield()
                abandoned.cancel()
                detector.stop()
                let started = ProcessInfo.processInfo.systemUptime
                let zone = try await detector.start()
                print("READY backend=\(detector.backend) zoneVertices=\(zone.count) seconds=\(ProcessInfo.processInfo.systemUptime - started)")
                let jpeg = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
                let defaults = ScanPreferences()
                guard defaults.confidenceThreshold == 0.7874982953071594 else { throw OfflineDetectorError.unavailable("Wrong candidate default") }
                let defaultResult = try await detector.analyze(jpeg: jpeg, sequence: 0, preferences: defaults, capturedAt: ProcessInfo.processInfo.systemUptime)
                guard defaultResult.detections.isEmpty, !defaultResult.alert.triggered else { throw OfflineDetectorError.unavailable("Candidate default did not suppress below-threshold cat") }
                print("PASS native default 0.7874982953071594 suppresses known below-threshold cat")
                if CommandLine.arguments.count > 3 {
                    let positiveImage = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
                    let positive = try await detector.analyze(jpeg: positiveImage, sequence: 100, preferences: defaults, capturedAt: ProcessInfo.processInfo.systemUptime)
                    guard let cat = positive.detections.first(where: { $0.label == "cat" }), cat.confidence >= defaults.confidenceThreshold,
                          abs(cat.confidence - 0.7943040132522583) < 0.005,
                          abs(cat.bbox.x - 0) < 0.01, abs(cat.bbox.y - 0.1271128287682166) < 0.01,
                          abs(cat.bbox.width - 0.9143495192894567) < 0.01, abs(cat.bbox.height - 0.8383545508751504) < 0.01
                    else { throw OfflineDetectorError.unavailable("Lossless positive reference score/geometry mismatch") }
                    print("PASS default positive lossless fixture and independent reference geometry: \(cat.confidence)")
                }
                var results: [FrameAnalysis] = []
                for sequence in 1...3 {
                    var framePreferences = ScanPreferences(confidenceThreshold: 0.4)
                    framePreferences.isLidarEnabled = sequence == 3
                    let result = try await detector.analyze(jpeg: jpeg, sequence: sequence, preferences: framePreferences, capturedAt: ProcessInfo.processInfo.systemUptime)
                    results.append(result)
                    print("FRAME \(sequence) size=\(result.frame.width)x\(result.frame.height) ms=\(result.processingMs) alert=\(result.alert.reason)")
                    for item in result.detections { print("DETECTION \(item.label) confidence=\(item.confidence) box=\(item.bbox) zone=\(item.inZone)") }
                }
                guard results[0].detections.contains(where: { $0.label == "cat" && abs($0.confidence - 0.7431903383972909) < 0.005 }),
                      results[0].alert.reason == "confirming", results[1].alert.triggered,
                      results[2].alert.reason == "cooldown" else { throw OfflineDetectorError.unavailable("Known-cat confidence or confirmation/cooldown regression") }
                let stale = try await detector.analyze(jpeg: jpeg, sequence: 4, preferences: ScanPreferences(confidenceThreshold: 0.4), capturedAt: ProcessInfo.processInfo.systemUptime - 3)
                guard stale.detections.isEmpty, !stale.alert.triggered, stale.alert.reason == "stale" else { throw OfflineDetectorError.unavailable("Stale frame was not suppressed") }
                let fresh = try await detector.analyze(jpeg: jpeg, sequence: 5, preferences: ScanPreferences(confidenceThreshold: 0.4), capturedAt: ProcessInfo.processInfo.systemUptime)
                guard fresh.alert.reason == "confirming" else { throw OfflineDetectorError.unavailable("Stale frame contributed to confirmation") }
                do {
                    _ = try await detector.analyze(jpeg: Data([1, 2, 3]), sequence: 6, preferences: ScanPreferences(confidenceThreshold: 0.4), capturedAt: ProcessInfo.processInfo.systemUptime)
                    throw OfflineDetectorError.unavailable("Malformed image incorrectly accepted")
                } catch let error as OfflineDetectorError {
                    guard error.localizedDescription.contains("EncodingError") else { throw error }
                }
                let recovered = try await detector.analyze(jpeg: jpeg, sequence: 7, preferences: ScanPreferences(confidenceThreshold: 0.4), capturedAt: ProcessInfo.processInfo.systemUptime)
                guard recovered.alert.reason == "confirming" else { throw OfflineDetectorError.unavailable("Failed image did not break confirmation") }
                // Model process is alive but deliberately gives no answer: enforce native single-flight and timeout.
                _ = try await detector.webView!.evaluateJavaScript("window.analyzeOffline = function () {}; true")
                let hanging = Task { try await detector.analyze(jpeg: jpeg, sequence: 8, preferences: ScanPreferences(), capturedAt: ProcessInfo.processInfo.systemUptime) }
                await Task.yield()
                do {
                    _ = try await detector.analyze(jpeg: jpeg, sequence: 9, preferences: ScanPreferences(), capturedAt: ProcessInfo.processInfo.systemUptime)
                    throw OfflineDetectorError.unavailable("Concurrent frame incorrectly accepted")
                } catch let error as OfflineDetectorError {
                    guard error.localizedDescription.contains("already being processed") else { throw error }
                }
                do {
                    _ = try await hanging.value
                    throw OfflineDetectorError.unavailable("Hung frame never timed out")
                } catch let error as OfflineDetectorError {
                    guard error.localizedDescription.contains("timed out") else { throw error }
                }
                guard detector.webView == nil else { throw OfflineDetectorError.unavailable("Timed-out WebKit was retained") }
                let recovery = DetectorRecovery()
                try await recovery.reload { _ = try await detector.start() }
                for sequence in 10..<130 {
                    let resumed = try await detector.analyze(jpeg: jpeg, sequence: sequence,
                        preferences: ScanPreferences(confidenceThreshold: 0.4), capturedAt: ProcessInfo.processInfo.systemUptime)
                    guard resumed.frame.sequence == sequence,
                          resumed.detections.contains(where: { $0.label == "cat" }), resumed.alert.reason != "stale"
                    else { throw OfflineDetectorError.unavailable("Recovered runtime failed sustained fresh inference") }
                    recovery.recordHealthyFrame()
                    if sequence % 30 == 0 { print("RECOVERY SOAK frame=\(sequence) ms=\(resumed.processingMs)") }
                }
                print("PASS actual timed-out runtime recovered and completed 120 fresh model inferences")
                let network = try await detector.webView!.callAsyncJavaScript("try { await fetch('https://example.com/'); return 'unexpected'; } catch (_) { return 'blocked'; }", arguments: [:], in: nil, contentWorld: .page)
                guard network as? String == "blocked" else { throw OfflineDetectorError.unavailable("CSP allowed remote fetch") }
                detector.stop()
                guard detector.webView == nil else { throw OfflineDetectorError.unavailable("Stop retained WebKit") }
                print("PASS lifecycle cancellation/restart, malformed-image recovery, single-flight, 15-second timeout, remote fetch blocked")
                print("PASS actual WKWebView offline inference, normalized boxes, confidence, two-frame confirmation, cooldown, stale suppression")
                exit(0)
            } catch {
                detector.stop()
                fputs("FAIL \(error)\n", stderr)
                exit(1)
            }
        }
        app.run()
    }
}

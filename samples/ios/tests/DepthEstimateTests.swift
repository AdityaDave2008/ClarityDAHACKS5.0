import Foundation

@main
struct DepthEstimateTests {
    static func main() throws {
        // Observed physical iPhone timestamps: depth belongs to previous RGB, not current.
        precondition(DepthFrameMatch.select(depthTime: 11593.424980083, currentRGBTime: 11593.4583165, previousRGBTime: 11593.424980083) == .previous)
        precondition(DepthFrameMatch.select(depthTime: 10, currentRGBTime: 10, previousRGBTime: 9.97) == .current)
        precondition(DepthFrameMatch.select(depthTime: 10, currentRGBTime: 10.033, previousRGBTime: nil) == nil)
        precondition(DepthFrameMatch.select(depthTime: 10, currentRGBTime: 10.033, previousRGBTime: 9.998) == nil, "do not widen 1ms tolerance")
        precondition(DepthFrameMatch.select(depthTime: 10, currentRGBTime: 11, previousRGBTime: 10) == nil, "do not retain stale RGB")
        precondition(DepthFrameMatch.select(depthTime: 11, currentRGBTime: 10, previousRGBTime: 11) == nil, "reject future prior frame")
        for bad in [Double.nan, .infinity, -.infinity] {
            precondition(DepthFrameMatch.select(depthTime: bad, currentRGBTime: 10, previousRGBTime: 9.97) == nil)
            precondition(DepthFrameMatch.select(depthTime: 9.97, currentRGBTime: bad, previousRGBTime: 9.97) == nil)
        }
        let full = NormalizedBox(x: 0, y: 0, width: 1, height: 1)
        func snapshot(_ values: [Float], width: Int = 20, height: Int = 20) -> DepthSnapshot {
            DepthSnapshot(width: width, height: height, meters: values, capturedAt: 10)
        }
        precondition(ScanPreferences(confidenceThreshold: 0.4).confidenceThreshold == 0.4)
        let good = snapshot(Array(repeating: 2, count: 400))
        let distribution = snapshot([.nan, .infinity, 0.1, 6, 2, 3], width: 3, height: 2).distributionSummary
        precondition(distribution.contains("valid=2"))
        precondition(distribution.contains("nan=1"))
        precondition(distribution.contains("nonfinite=1"))
        precondition(distribution.contains("below=1"))
        precondition(distribution.contains("beyond=1"))
        precondition(distribution.contains("center=2.000"))
        precondition(snapshot([2]).distributionSummary == "malformed map")
        precondition(good.centerSurface(now: 10.1) == 2)
        precondition(good.centerSurface(now: 10.75) == nil, "center test expires")
        precondition(good.centerSurface(now: 9) == nil, "center test rejects future capture")
        precondition(snapshot([2]).centerSurface(now: 10) == nil, "malformed center map")
        for value: Float in [.nan, .infinity, -.infinity, 0, -1, 0.19, 5.01] {
            precondition(snapshot(Array(repeating: value, count: 400)).centerSurface(now: 10) == nil)
        }
        var centerOnly = Array(repeating: Float.nan, count: 400)
        centerOnly[10 * 20 + 10] = 1.25
        precondition(snapshot(centerOnly).centerSurface(now: 10) == 1.25, "raw center does not claim object ROI validity")
        var rejection = ""
        for (value, expected): (Float, String) in [(.nan, "no center return"), (.infinity, "nonfinite center"), (0.1, "center below 0.2 m"), (6, "center beyond 5 m")] {
            _ = snapshot(Array(repeating: value, count: 400)).centerSurface(now: 10, onRejection: { rejection = $0 })
            precondition(rejection == expected, "center failure must not masquerade as object ROI failure")
        }
        _ = good.centerSurface(now: 11, onRejection: { rejection = $0 })
        precondition(rejection == "stale/invalid time")

        precondition(good.estimate(in: full, now: 11, onRejection: { rejection = $0 }) == nil)
        precondition(rejection == "stale/invalid time")
        _ = snapshot(Array(repeating: Float.nan, count: 400)).estimate(in: full, now: 10, onRejection: { rejection = $0 })
        precondition(rejection == "insufficient valid coverage")
        _ = snapshot((0..<400).map { Float($0 % 20 < 10 ? 1 : 4) }).estimate(in: full, now: 10, onRejection: { rejection = $0 })
        precondition(rejection == "mixed-depth spread")
        precondition(good.estimate(in: full, now: 10.1) == 2, "valid absolute depth")
        precondition(good.estimate(in: full, now: 10.749) == 2, "fresh before boundary")
        precondition(good.estimate(in: full, now: 10.75) == nil, "expiry boundary")
        for now in [9.99, 11, Double.nan, Double.infinity] {
            precondition(good.estimate(in: full, now: now) == nil, "invalid/stale time")
        }
        for (value, reason): (Float, String) in [(.infinity, "nonfinite surface"), (0, "surface below 0.2 m"), (6, "surface beyond 5 m")] {
            _ = snapshot(Array(repeating: value, count: 400)).estimate(in: full, now: 10, onRejection: { rejection = $0 })
            precondition(rejection == reason, "show exact range rejection")
        }
        let invalidValues: [Float] = [.nan, .infinity, -.infinity, 0, -1, 0.19, 5.01]
        for value in invalidValues {
            precondition(snapshot(Array(repeating: value, count: 400)).estimate(in: full, now: 10) == nil)
        }
        for box in [NormalizedBox(x: -0.1, y: 0, width: 1, height: 1),
                    NormalizedBox(x: 0.9, y: 0, width: 0.2, height: 1),
                    NormalizedBox(x: 0, y: .nan, width: 1, height: 1),
                    NormalizedBox(x: 0, y: 0, width: 0, height: 1),
                    NormalizedBox(x: 0, y: 0, width: 0.02, height: 0.02)] {
            precondition(good.estimate(in: box, now: 10) == nil, "bad/tiny box")
        }
        precondition(snapshot([2]).estimate(in: full, now: 10) == nil, "malformed map")
        let mixed = (0..<400).map { Float($0 % 20 < 10 ? 1 : 4) }
        precondition(snapshot(mixed).estimate(in: full, now: 10) == nil, "mixed foreground/background")
        var sparse = Array(repeating: Float.nan, count: 400)
        for y in 5..<15 { for x in 5..<10 { sparse[y * 20 + x] = 2 } }
        precondition(snapshot(sparse).estimate(in: full, now: 10) == nil, "sparse foreground")
        var outlier = Array(repeating: Float(2), count: 400)
        outlier[10 * 20 + 10] = 4
        precondition(snapshot(outlier).estimate(in: full, now: 10) == nil, "outlier surface")
        outlier[10 * 20 + 10] = 6
        precondition(snapshot(outlier).estimate(in: full, now: 10) == nil, "out-of-range background cannot be silently trimmed")
        // Non-square portrait map with distinct top/bottom and left/right values catches flips.
        let portrait = (0..<800).map { i -> Float in i / 20 < 20 ? (i % 20 < 10 ? 1 : 2) : (i % 20 < 10 ? 3 : 4) }
        for (x, y, value) in [(0.0, 0.0, 1.0), (0.5, 0.0, 2.0), (0.0, 0.5, 3.0), (0.5, 0.5, 4.0)] {
            precondition(snapshot(portrait, height: 40).estimate(in: NormalizedBox(x: x, y: y, width: 0.5, height: 0.5), now: 10) == value)
        }
        let old = Data(#"{"alertModes":["sound"],"confidenceThreshold":0.7,"cooldownMs":4000}"#.utf8)
        var preferences = try JSONDecoder().decode(ScanPreferences.self, from: old)
        precondition(!preferences.isLidarEnabled && !ScanPreferences().isLidarEnabled, "default OFF / migration")
        preferences.isLidarEnabled = true
        let roundTrip = try JSONDecoder().decode(ScanPreferences.self, from: JSONEncoder().encode(preferences))
        precondition(roundTrip.isLidarEnabled && roundTrip.cooldownMs == 4000, "persist enabled without losing settings")
        preferences.isLidarEnabled = false
        let disabled = try JSONDecoder().decode(ScanPreferences.self, from: JSONEncoder().encode(preferences))
        precondition(!disabled.isLidarEnabled)
        var detection = Detection(label: "cat", confidence: 0.9, bbox: full, anchor: NormalizedPoint(x: 0.5, y: 1), inZone: true)
        detection = detection.addingDepth(from: good, enabled: true, matchingFrame: true, now: 10)
        precondition(detection.depthMeters == 2 && detection.depthLabel(at: 10.1) == "depth ≈2.0 m")
        precondition(detection.depthLabel(at: 10.75) == "depth unavailable")
        precondition(detection.addingDepth(from: good, enabled: false, matchingFrame: true, now: 10).depthLabel(at: 10) == nil)
        precondition(detection.addingDepth(from: good, enabled: false, matchingFrame: true, now: 10).depthMeters == nil)
        precondition(detection.addingDepth(from: good, enabled: true, matchingFrame: false, now: 10).depthMeters == nil)
        precondition(detection.addingDepth(from: nil, enabled: true, matchingFrame: true, now: 10).depthMeters == nil)
        precondition(detection.addingDepth(from: good, enabled: true, matchingFrame: true, now: 11).depthMeters == nil)
        print("Depth estimation, rejection, portrait mapping and preference migration passed")
    }
}

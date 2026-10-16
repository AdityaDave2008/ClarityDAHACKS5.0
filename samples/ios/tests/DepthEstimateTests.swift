import Foundation

@main
struct DepthEstimateTests {
    static func main() throws {
        let full = NormalizedBox(x: 0, y: 0, width: 1, height: 1)
        func snapshot(_ values: [Float], width: Int = 20, height: Int = 20) -> DepthSnapshot {
            DepthSnapshot(width: width, height: height, meters: values, capturedAt: 10)
        }
        let good = snapshot(Array(repeating: 2, count: 400))
        precondition(good.estimate(in: full, now: 10.1) == 2, "valid absolute depth")
        precondition(good.estimate(in: full, now: 10.749) == 2, "fresh before boundary")
        precondition(good.estimate(in: full, now: 10.75) == nil, "expiry boundary")
        for now in [9.99, 11, Double.nan, Double.infinity] {
            precondition(good.estimate(in: full, now: now) == nil, "invalid/stale time")
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
        print("Depth estimation, rejection, portrait mapping and preference migration passed")
    }
}
